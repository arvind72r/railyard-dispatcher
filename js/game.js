/* ------------------------------------------------------------------
   game.js — simulation clock, interlocking, scoring, HUD and input.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY;
  var L = RY.LAY, T = RY.TRACKS;

  var LEVEL_SECS = 68;          // real seconds per shift
  var LATE_MAX   = 8;           // minutes late before a service is cancelled
  var MINS_PER_SEC = 1;         // station clock runs a minute a second

  var cv  = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var stage = document.getElementById('stage');
  var elToasts = document.getElementById('toasts');
  var elBanner = document.getElementById('banner');
  var elBoard  = document.getElementById('board');
  var elHint   = document.getElementById('hint');
  var elOverlay = document.getElementById('overlay');

  var view = { scale: 1, ox: 0, oy: 0 };
  var introHTML = elOverlay.innerHTML;
  var selectedStationId = RY.station.id;   // whatever geom.js booted with

  function freshTrackOwner() { return RY.TRACKS.map(function () { return null; }); }
  function stationById(id) {
    var i;
    for (i = 0; i < RY.STATIONS.length; i++) if (RY.STATIONS[i].id === id) return RY.STATIONS[i];
    return RY.STATIONS[0];
  }

  var G = {
    state: 'menu',
    trains: [], trackOwner: freshTrackOwner(),
    throat: { W: { pos: null, neg: null }, E: { pos: null, neg: null } },
    gameT: 360, elapsed: 0, level: 1, score: 0, lives: 3, combo: 0,
    onTime: 0, events: 0, arrivals: 0,
    spawnIn: 2.5, sel: null, hoverTrack: -1, hoverTrain: null,
    night: 0, fullHouse: false, people: [], lastBoard: 0, ttDone: []
  };
  RY.G = G;

  /* ================= canvas fitting ================= */
  function resize() {
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = stage.clientWidth, h = stage.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var sc = Math.min(w / RY.W, h / RY.H);
    view.scale = sc;
    view.ox = (w - RY.W * sc) / 2;
    view.oy = (h - RY.H * sc) / 2;
    view.dpr = dpr;
  }
  root.addEventListener('resize', resize);

  function toScreen(x, y) {
    return { x: view.ox + x * view.scale, y: view.oy + y * view.scale };
  }
  function toWorld(cx, cy) {
    return { x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale };
  }

  /* ================= helpers ================= */
  function fmtTime(mins) {
    var h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function trName(tr) { return tr.svcName || tr.code; }
  function toast(x, y, text, cls) {
    var p = toScreen(x, y), d = document.createElement('div');
    d.className = 'toast ' + (cls || 'info');
    d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
    d.textContent = text;
    elToasts.appendChild(d);
    setTimeout(function () { d.remove(); }, 1600);
  }
  function banner(main, sub) {
    elBanner.innerHTML = '<div class="bnr">' + main +
      (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    setTimeout(function () { elBanner.innerHTML = ''; }, 2300);
  }
  function hint(t) { elHint.innerHTML = t; }

  /* ================= interlocking ================= */
  /* A direction owns one slot per throat: every dir>0 route (west entry,
     east exit) runs on mainB throughout, every dir<0 route (east entry,
     west exit) runs on mainA — see buildPath. Two routes sharing a
     direction always meet at that shared main, so they're never let in
     together; that alone reproduces the old single-file approach queue.
     A route of the OTHER direction only conflicts if its curve actually
     crosses this one's inside the throat — see RY.crossTable, worked out
     once from the real geometry. That's what lets, say, a west arrival
     into P2 share the west throat with a P1 departure (their curves never
     meet) while refusing one into P1 or TL (which do meet it) — and, on
     the east side, lets an arrival into any road share the throat with a
     P4 departure, since P4's departure curve clears every other road's
     turnout before any of them reach theirs. */
  function slotOf(dir) { return dir > 0 ? 'pos' : 'neg'; }

  /* Which throat side a train's move claims. A through station has two —
     dir>0 enters/exits west, dir<0 east. A terminus has exactly one, on
     the east, for both directions (see geom.js's buildPath) — an
     arrival's entry and its later yard-bound shunt, and a departure's
     yard-to-platform shunt and its later real departure, all pass
     through the same physical ladder, just at different points in time. */
  function entSide(tr) { return RY.station.terminus ? 'E' : (tr.dir > 0 ? 'W' : 'E'); }

  /* Drop just the throat lock on `side`, leaving trackOwner untouched —
     used at a terminus, where entry and exit share one resource across
     time, to free it between the two claims instead of holding it the
     whole time a train dwells (which would make the second claim look
     like a self-conflict — see throatConflict). */
  function releaseThroatHold(tr, side) {
    var slot = slotOf(tr.dir);
    if (G.throat[side][slot] === tr) G.throat[side][slot] = null;
    tr.holdsThroat[side] = false;
  }

  function crosses(side, tr, trackId, opp) {
    if (!opp) return false;
    var posId = tr.dir > 0 ? trackId : opp.trackId;
    var negId = tr.dir > 0 ? opp.trackId : trackId;
    return RY.crossTable[side][posId][negId];
  }

  /* Is `side` (W/E) free for `tr` to use against road id `trackId`? Two
     shapes of conflict: a same-direction train already has that shared
     main (it's first-come-first-served, same as an approach queue always
     was), or an opposite-direction train's route physically crosses this
     one's, per the precomputed geometry in RY.crossTable. */
  function throatConflict(side, tr, trackId) {
    var same = G.throat[side][slotOf(tr.dir)];
    if (same) return { train: same, crossing: false };
    var opp = G.throat[side][slotOf(-tr.dir)];
    return crosses(side, tr, trackId, opp) ? { train: opp, crossing: true } : null;
  }

  /* The roads a train is physically able to use, ignoring who holds what. */
  function eligible(tr) {
    var out = [], i;
    for (i = 0; i < T.length; i++) if (!compat(tr, T[i])) out.push(T[i]);
    return out;
  }

  function compat(tr, track) {
    if (tr.cars > track.maxCars) {
      return track.short + ' takes ' + track.maxCars + ' cars — this is ' + tr.cars;
    }
    if (tr.stops && !track.platform) return 'The through road has no platform';
    return null;
  }
  function routeBlocked(tr, track) {
    var own = G.trackOwner[track.id];
    if (own) return track.short + ' occupied by ' + trName(own);
    var ent = entSide(tr), side = ent === 'W' ? 'West' : 'East';
    var c = throatConflict(ent, tr, track.id);
    if (c) {
      return c.crossing
        ? side + ' throat: ' + track.short + ' crosses ' + trName(c.train) + ' on ' + T[c.train.trackId].short
        : side + ' throat busy — ' + trName(c.train) + ' is still using it';
    }
    // A through-running service's far-side throat is not reserved up front —
    // see updateTrain()'s 'routed' branch, which holds it at that gate if
    // the far throat is still busy when it actually gets there.
    return null;
  }
  function canAssign(tr, track) {
    if (!tr || tr.state !== 'approach') return 'Train is already on its road';
    return compat(tr, track) || routeBlocked(tr, track);
  }

  function assign(tr, idx) {
    var track = T[idx], why = canAssign(tr, track), i, minCap = 99, comp = [];
    if (why) {
      var m = tr ? tr.mid() : null;
      if (m) toast(m.x, m.y - 34, why, 'bad');
      hint('<b>Refused.</b> ' + why);
      return false;
    }
    for (i = 0; i < T.length; i++) if (!compat(tr, T[i])) { comp.push(T[i]); minCap = Math.min(minCap, T[i].maxCars); }

    G.trackOwner[idx] = tr; tr.holdsTrack = true;
    var ent = entSide(tr);
    G.throat[ent][slotOf(tr.dir)] = tr; tr.holdsThroat[ent] = true;
    // A yard-origin service is physically leaving its stabling road for
    // good the moment it's called forward — free that road now, or it
    // stays "occupied" by a train that's no longer anywhere near it,
    // quietly shrinking the yard's real capacity for good.
    if (tr.yardOrigin && tr.yardRoad !== null) {
      RY.YARD[tr.yardRoad].occupant = null;
      tr.yardRoad = null;
    }
    tr.routeTo(track);
    tr.state = tr.yardOrigin ? 'toPlatform' : 'routed';
    tr.flash = 0.7;

    var mm = tr.mid();
    toast(mm.x, mm.y - 34, (tr.yardOrigin ? 'FORMING · ' : 'ROAD SET · ') + track.short +
          (tr.stops ? '' : ' · RUNS THROUGH'), 'good');
    if (tr.stops && track.maxCars === minCap) {
      G.score += 40;
      toast(mm.x, mm.y - 58, 'EFFICIENT +40', 'good');
    }
    if (G.sel === tr) G.sel = null;
    hint('<b>' + trName(tr) + '</b> ' + (tr.yardOrigin ? 'forming at ' : 'routed into ') + track.name + '.');
    return true;
  }

  /* ================= scoring ================= */
  function mult() { return 1 + Math.min(G.combo, 12) * 0.08; }

  function punctual(delay, base, tr, label) {
    var pts, tag, good;
    if (delay <= 0.75)      { pts = base;                                   tag = 'ON TIME';  good = true; }
    else if (delay <= 2.5)  { pts = Math.round(base * (1 - delay * 0.15));  tag = '+' + delay.toFixed(1) + ' MIN'; good = true; }
    else                    { pts = Math.max(15, Math.round(base - delay * 22)); tag = 'LATE ' + delay.toFixed(0) + ' MIN'; good = false; }

    if (good) G.combo++; else G.combo = 0;
    pts = Math.round(pts * mult());
    G.score += pts;
    G.events++; if (good) G.onTime++;

    var m = tr.mid();
    toast(m.x, m.y - 34, label + ' ' + tag, good ? 'good' : 'bad');
    toast(m.x, m.y - 58, (pts >= 0 ? '+' : '') + pts, good ? 'good' : 'bad');
  }

  function cancelService(tr) {
    var m = tr.mid();
    G.score -= 250; G.combo = 0; G.lives--; G.events++;
    toast(m.x, m.y - 34, 'CANCELLED −250', 'bad');
    banner('SERVICE CANCELLED', trName(tr) + ' held ' + LATE_MAX + ' minutes at the home signal');
    release(tr);
    // A departure formed in the yard but never called forward is still
    // parked there, holding a stabling road that release() above never
    // touches — leave that held and the yard quietly loses a road for
    // the rest of the shift.
    if (tr.yardRoad !== null) { RY.YARD[tr.yardRoad].occupant = null; tr.yardRoad = null; }
    tr.state = 'gone';
    if (G.lives <= 0) gameOver();
  }

  function release(tr) {
    if (G.trackOwner[tr.trackId] === tr) G.trackOwner[tr.trackId] = null;
    var slot = slotOf(tr.dir);
    if (G.throat.W[slot] === tr) G.throat.W[slot] = null;
    if (G.throat.E[slot] === tr) G.throat.E[slot] = null;
    tr.holdsTrack = false; tr.holdsThroat.W = false; tr.holdsThroat.E = false;
  }

  /* ================= spawning ================= */
  /* The longest platform this station has, so a train type only spawns
     where a platform actually exists to hold it. */
  function maxPlatformCars() {
    var m = 0, i;
    for (i = 0; i < T.length; i++) if (T[i].platform) m = Math.max(m, T[i].maxCars);
    return m;
  }

  function weightedType() {
    var w = [['local', 40], ['express', 32]];
    if (G.level >= 2) w.push(['intercity', 12 + G.level * 2]);
    if (G.level >= 2 && maxPlatformCars() >= RY.TYPES.sleeper.cars) w.push(['sleeper', 10 + G.level * 2]);
    if (G.level >= 3) w.push(['freight', 8 + G.level * 2]);
    if (G.level >= 4) w.push(['nonstop', 6 + G.level * 2]);
    var tot = 0, i;
    for (i = 0; i < w.length; i++) tot += w[i][1];
    var r = Math.random() * tot;
    for (i = 0; i < w.length; i++) { r -= w[i][1]; if (r <= 0) return w[i][0]; }
    return 'local';
  }

  function sideLoad(dir) {
    var n = 0, i;
    for (i = 0; i < G.trains.length; i++) {
      if (G.trains[i].dir === dir && G.trains[i].state === 'approach') n++;
    }
    return n;
  }

  function spawn() {
    var live = 0, i;
    for (i = 0; i < G.trains.length; i++) if (G.trains[i].state !== 'gone') live++;
    if (live >= 6 + G.level) return;

    var lw = sideLoad(1), le = sideLoad(-1);
    var dir = lw === le ? (Math.random() < 0.5 ? 1 : -1) : (lw < le ? 1 : -1);
    if (Math.random() < 0.25) dir = -dir;

    var tr = new RY.Train(weightedType(), dir, G.gameT);

    // Book the arrival off an actual unobstructed run rather than a guess,
    // and off the slowest road the train could legitimately be given, so a
    // driver is never booked for a time only the shortest way round allows.
    var est = 0, i, tk;
    for (i = 0; i < T.length; i++) {
      tk = T[i];
      if (tr.cars > tk.maxCars || (tr.stops && !tk.platform)) continue;
      est = Math.max(est, tr.runTimeOn(RY.buildPath(dir, tk.y)));
    }
    var slack = Math.max(1.2, 3.4 - (G.level - 1) * 0.24);
    tr.sched = G.gameT + est + slack;
    tr.schedDep = tr.sched + tr.cfg.dwell;
    G.trains.push(tr);
  }

  /* ================= terminus timetable ================= */
  var YARD_ARRIVE_LEAD = 9;   // minutes an arrival is visible before it's booked to reach the platform

  function freeYardRoad() {
    for (var i = 0; i < RY.YARD.length; i++) if (!RY.YARD[i].occupant) return RY.YARD[i];
    return null;
  }

  /* A departure's initial position: parked on a yard road with nowhere
     else to be yet, exactly like a train that arrived and was stabled —
     except this one is still in 'approach', selectable, and its first
     routeTo() shunts it to a platform rather than building the usual
     mainline path (see routeTo() in train.js). */
  function parkNewArrival(tr, road) {
    var parkX = L.yardNear + 250;   // matches the depth an arrival's own shunt parks at
    tr.path = RY.makePath([{ x: parkX - tr.len - 60, y: road.y }, { x: parkX + 60, y: road.y }]);
    tr.s = tr.len + 60;
    tr.sSlow = 0; tr.sFast = tr.path.len;
    tr.v = 0;
    tr.targetS = tr.s;
    tr.yardRoad = road.id;
    tr.yardOrigin = true;
    road.occupant = tr;
  }

  /* Runs instead of spawn()/weightedType() at a terminus: services appear
     on their own booked times rather than a random weighted mix. */
  function scheduleTimetable() {
    var tt = RY.station.timetable, i, e, tr, road;
    for (i = 0; i < tt.length; i++) {
      if (G.ttDone[i]) continue;
      e = tt[i];
      if (e.dir > 0) {
        if (G.gameT < e.t - YARD_ARRIVE_LEAD) continue;
        tr = new RY.Train(e.type, 1, G.gameT);
        tr.sched = e.t;
        tr.schedDep = e.t + tr.cfg.dwell;
        tr.svcName = e.name;
        G.trains.push(tr);
        G.ttDone[i] = true;
      } else {
        if (G.gameT < e.t - e.prep) continue;
        road = freeYardRoad();
        if (!road) continue;             // yard's full — try again once one clears
        tr = new RY.Train(e.type, -1, G.gameT);
        parkNewArrival(tr, road);
        tr.sched = e.t - e.prep + Math.min(e.prep - 4, 10);   // how long they'll wait before it's fair to call this late
        tr.schedDep = e.t;
        tr.svcName = e.name;
        G.trains.push(tr);
        G.ttDone[i] = true;
      }
    }
  }

  /* ================= per-frame simulation ================= */
  function followTargets() {
    [1, -1].forEach(function (dir) {
      // A yard-origin service isn't on the shared approach line at all —
      // it's sitting in the yard on its own path, so it has no place in
      // this queue and no business being capped behind whoever's in it.
      var list = G.trains.filter(function (t) {
        return t.dir === dir && !t.yardOrigin && (t.state === 'approach' || t.state === 'routed');
      }).sort(function (a, b) { return b.s - a.s; });
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (t.state !== 'approach') continue;
        var tgt = t.sHome;
        if (i > 0) tgt = Math.min(tgt, list[i - 1].s - list[i - 1].len - 38);
        t.targetS = Math.max(0, tgt);
      }
    });
  }

  /* At a terminus, entry and exit share the one throat side, so these
     generic thresholds (each keyed to a distinct, opposite-end signal
     that doesn't exist there) don't apply — every lock at a terminus is
     taken and dropped explicitly at the relevant state transition in
     updateTrain() instead. */
  function updateResources(tr) {
    if (RY.station.terminus) return;
    var ent = tr.dir > 0 ? 'W' : 'E', ex = ent === 'W' ? 'E' : 'W', tx = tr.tailX();
    var slot = slotOf(tr.dir);

    if (tr.holdsThroat[ent] && tr.state !== 'approach') {
      var out = tr.dir > 0 ? (tx >= L.xThroatW + 8) : (tx <= L.xThroatE - 8);
      if (out) { tr.holdsThroat[ent] = false; if (G.throat[ent][slot] === tr) G.throat[ent][slot] = null; }
    }
    if (tr.holdsTrack && (tr.state === 'depart' || !tr.stops)) {
      var off = tr.dir > 0 ? (tx >= L.xThroatE) : (tx <= L.xThroatW);
      if (off) { tr.holdsTrack = false; if (G.trackOwner[tr.trackId] === tr) G.trackOwner[tr.trackId] = null; }
    }
    if (tr.holdsThroat[ex]) {
      var gone = tr.dir > 0 ? (tx >= L.xEastHome + 8) : (tx <= L.xWestHome - 8);
      if (gone) { tr.holdsThroat[ex] = false; if (G.throat[ex][slot] === tr) G.throat[ex][slot] = null; }
    }
  }

  function updateTrain(tr, dt) {
    if (tr.flash > 0) tr.flash -= dt;

    switch (tr.state) {
      case 'approach':
        if (G.gameT - tr.sched > LATE_MAX) cancelService(tr);
        break;

      case 'routed':
        if (tr.stops) {
          if (tr.s >= tr.stopS - 0.4 && tr.v < 0.6) {
            tr.state = 'dwell';
            tr.dwellUntil = G.gameT + tr.cfg.dwell;
            // A yard-origin service reaching its platform via a shunt
            // isn't arriving off the network — it already scored (or
            // didn't) when it was first sent for; this dwell is the
            // boarding call, not a fresh arrival.
            if (!tr.yardOrigin) {
              G.arrivals++;
              punctual(G.gameT - tr.sched, 120, tr, 'ARRIVED');
            }
            // At a terminus this train is now well clear of the one
            // throat it shares with everything else — drop that claim
            // now rather than holding it for the whole dwell; it (or,
            // for a yard-formed departure, the exit-side claim) gets
            // taken fresh when this train actually needs the throat
            // again (see 'awaitYard'/'awaitDepart' below).
            if (RY.station.terminus) releaseThroatHold(tr, 'E');
          }
        } else {
          var farSide = tr.dir > 0 ? 'E' : 'W';
          // Only start caring about the far throat once genuinely close to
          // it — station speed (100) needs well under 100px to stop, so
          // 160px of lookahead is ample runway with no visible pre-brake.
          // gateCleared makes the decision one-shot: once this train has
          // either taken the lock or been told to hold for it, it's never
          // reconsidered — the lock later releasing far down the line
          // (routine, once the train is long past here) must not be
          // mistaken for a fresh arrival at the gate.
          if (!tr.gateCleared && tr.s > tr.sFarGate - 160) {
            if (throatConflict(farSide, tr, tr.trackId)) {
              tr.targetS = tr.sFarGate;             // hold clear of the far ladder
            } else {
              G.throat[farSide][slotOf(tr.dir)] = tr; tr.holdsThroat[farSide] = true;
              tr.targetS = Infinity;                 // clear — run straight through
              tr.gateCleared = true;
            }
          }
          if (!tr.passed) {
            var hx = tr.headX();
            if ((tr.dir > 0 && hx >= L.stopX) || (tr.dir < 0 && hx <= L.stopX)) {
              tr.passed = true;
              G.arrivals++;
              RY.audio.horn(hx, tr.type === 'freight');
              punctual(G.gameT - tr.sched, 110, tr, 'PASSED');
            }
          }
          if (tr.s >= tr.path.len - 1) { release(tr); tr.state = 'gone'; }
        }
        break;

      case 'dwell':
        if (G.gameT >= tr.dwellUntil) {
          // At a terminus, an arrival's passengers are off and it's the
          // yard it wants next, not the open road — a departure formed in
          // the yard, though, is a normal working from here: it boards,
          // then leaves west exactly like any other station's departure.
          tr.state = (RY.station.terminus && tr.dir > 0) ? 'awaitYard' : 'awaitDepart';
        }
        break;

      case 'awaitDepart':
        var ex = RY.station.terminus ? 'E' : (tr.dir > 0 ? 'E' : 'W');
        if (!throatConflict(ex, tr, tr.trackId)) {
          G.throat[ex][slotOf(tr.dir)] = tr; tr.holdsThroat[ex] = true;
          tr.state = 'depart';
          tr.targetS = Infinity;
          RY.audio.horn(RY.pathAt(tr.path, tr.s).x, tr.type === 'freight');
          punctual(G.gameT - tr.schedDep, 75, tr, 'DEPARTED');
        }
        break;

      case 'depart':
        if (tr.s >= tr.path.len - 1) { release(tr); tr.state = 'gone'; }
        break;

      /* ---- terminus only, from here down ---- */

      // An arrival that's done unloading isn't going anywhere on the
      // mainline any more — the platform road simply ends at the buffer
      // (see buildPath) — so what it needs next is a fresh shunt curve
      // straight to a stabling road, built from wherever it's actually
      // standing right now (it's been at rest since 'dwell' began).
      case 'awaitYard':
        var freeRoad = null, fi;
        for (fi = 0; fi < RY.YARD.length; fi++) if (!RY.YARD[fi].occupant) { freeRoad = RY.YARD[fi]; break; }
        if (freeRoad && !throatConflict('E', tr, tr.trackId)) {
          G.throat.E[slotOf(tr.dir)] = tr; tr.holdsThroat.E = true;
          freeRoad.occupant = tr; tr.yardRoad = freeRoad.id;
          var from = tr.pos(), parkX = L.yardNear + 250;
          tr.path = RY.shuntCurve(from.x, from.y, parkX, freeRoad.y);
          tr.s = 0; tr.sSlow = 0; tr.sFast = tr.path.len;
          tr.targetS = tr.path.len;
          tr.state = 'toYard';
          // The platform is vacated the moment this shunt is committed to
          // — freeRoad, just claimed above, is the only road this train
          // owns from here on.
          if (G.trackOwner[tr.trackId] === tr) G.trackOwner[tr.trackId] = null;
          tr.holdsTrack = false;
        }
        break;

      case 'toYard':
        if (tr.v < 0.6 && tr.s >= tr.targetS - 0.5) {
          release(tr);   // clear of the throat claim taken in awaitYard
          tr.state = 'parked';
          tr.parkedUntil = G.gameT + 26;
        }
        break;

      case 'parked':
        if (G.gameT >= tr.parkedUntil) {
          if (tr.yardRoad !== null) RY.YARD[tr.yardRoad].occupant = null;
          tr.state = 'gone';
        }
        break;

      case 'toPlatform':
        if (tr.v < 0.6 && tr.s >= tr.targetS - 0.5) {
          tr.yardLinked = true;
          tr.routeTo(T[tr.trackId]);
          tr.state = 'routed';
          // The shunt from the yard is done — this train is now standing
          // on its platform, clear of the throat, well before it will
          // need that same lock again to actually leave (see
          // 'awaitDepart'). Hold it through the shunt and no longer.
          releaseThroatHold(tr, 'E');
        }
        break;
    }
    updateResources(tr);
  }

  function checkFullHouse() {
    var i, all = true;
    for (i = 0; i < T.length; i++) if (!G.trackOwner[i]) all = false;
    if (all && !G.fullHouse) {
      G.fullHouse = true;
      G.score += 200;
      banner('FULL HOUSE +200', 'every road in use');
    } else if (!all) G.fullHouse = false;
  }

  function updatePeople(dt) {
    var i, p;
    for (i = 0; i < G.people.length; i++) {
      p = G.people[i];
      p.t -= dt;
      if (p.t <= 0) {
        p.t = 1.5 + Math.random() * 4;
        p.vx = (Math.random() - 0.5) * 16;
        p.vy = (Math.random() - 0.5) * 9;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < p.x0) { p.x = p.x0; p.vx = -p.vx; }
      if (p.x > p.x1) { p.x = p.x1; p.vx = -p.vx; }
      if (p.y < p.y0) { p.y = p.y0; p.vy = -p.vy; }
      if (p.y > p.y1) { p.y = p.y1; p.vy = -p.vy; }
    }
  }

  function update(dt) {
    G.elapsed += dt;
    G.gameT += dt * MINS_PER_SEC;

    var lvl = 1 + Math.floor(G.elapsed / LEVEL_SECS);
    if (lvl !== G.level) {
      G.level = lvl;
      banner('SHIFT ' + lvl, 'traffic density rising');
    }
    G.night = Math.min(0.58, Math.max(0, (G.level - 1) * 0.085));

    if (RY.station.terminus) {
      scheduleTimetable();
    } else {
      G.spawnIn -= dt;
      if (G.spawnIn <= 0) {
        spawn();
        var headway = Math.max(5.0, 16 - (G.level - 1) * 1.05);
        G.spawnIn = headway * (0.75 + Math.random() * 0.5);
      }
    }

    followTargets();
    var i;
    for (i = 0; i < G.trains.length; i++) {
      if (G.trains[i].state !== 'gone') G.trains[i].step(dt);
    }
    for (i = 0; i < G.trains.length; i++) {
      if (G.trains[i].state !== 'gone') updateTrain(G.trains[i], dt);
    }
    G.trains = G.trains.filter(function (t) { return t.state !== 'gone'; });
    if (G.sel && G.sel.state !== 'approach') G.sel = null;

    checkFullHouse();
    updatePeople(dt);
    RY.audio.movement(G.trains);
  }

  /* ================= drawing ================= */
  function drawTrackHighlights() {
    if (!G.sel) return;
    var i, t, why, col;
    for (i = 0; i < T.length; i++) {
      t = T[i];
      why = canAssign(G.sel, t);
      col = why ? 'rgba(224,72,50,' : 'rgba(56,190,90,';
      ctx.fillStyle = col + (G.hoverTrack === i ? 0.28 : 0.13) + ')';
      var hlX0 = L.terminus ? RY.platSpan(t).x0 : L.xThroatW;
      RY.rr(ctx, hlX0, t.y - 23, L.xThroatE - hlX0, 46, 6);
      ctx.fill();
      ctx.strokeStyle = col + (G.hoverTrack === i ? 0.85 : 0.4) + ')';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    // preview the road through the throat
    if (G.hoverTrack >= 0 && !canAssign(G.sel, T[G.hoverTrack])) {
      var P = RY.buildPath(G.sel.dir, T[G.hoverTrack].y);
      var s0 = G.sel.s, s1 = RY.sAtX(P, L.stopX);
      ctx.save();
      ctx.strokeStyle = 'rgba(80,220,120,.45)';
      ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (var s = s0; s <= s1; s += 12) {
        var p = RY.pathAt(P, s);
        if (s === s0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSignal(x, y, aspect, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    RY.rr(ctx, -5, -13, 12, 30, 3); ctx.fill();
    ctx.fillStyle = '#252a31';
    RY.rr(ctx, -6, -14, 12, 30, 3); ctx.fill();
    ctx.fillStyle = '#39414b';
    ctx.fillRect(-6, -14, 12, 2.5);
    var cols = ['#c8382c', '#d8a423', '#3fb950'];
    for (var i = 0; i < 3; i++) {
      var on = (i === aspect);
      ctx.fillStyle = on ? cols[i] : 'rgba(24,28,34,.9)';
      ctx.beginPath(); ctx.arc(0, -8 + i * 9, 3.1, 0, 6.2832); ctx.fill();
      if (on) {
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(-0.8, -9 + i * 9, 1.1, 0, 6.2832); ctx.fill();
      }
    }
    ctx.restore();
    if (glow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(x, y - 8 + aspect * 9, 1, x, y - 8 + aspect * 9, 22);
      var c = ['255,60,45', '224,168,40', '70,220,110'][aspect];
      g.addColorStop(0, 'rgba(' + c + ',' + (0.5 * (0.3 + G.night)) + ')');
      g.addColorStop(1, 'rgba(' + c + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - 8 + aspect * 9, 22, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  }

  /* A signal only needs to stay green long enough for the front of the
     train to visibly cross it — real block signals return to danger well
     before the whole consist is clear of the section. Approximating that
     as "the first couple of cars have passed" avoids having to track the
     exact section boundary, and reads correctly at any train length. */
  function pastSignal(tr, sigX) {
    var twoCars = tr.vehicles[0].len + tr.vehicles[1].len;   // varies: a loco leads some consists
    var clearBy = sigX + tr.dir * twoCars;
    return tr.dir > 0 ? tr.headX() >= clearBy : tr.headX() <= clearBy;
  }

  function drawSignals() {
    var i;
    if (L.terminus) {
      // Both streams share the one throat here, so both signal heads
      // stand at the same x (xEastHome) — one for arrivals off the
      // network (G.throat.E.pos), one for departures leaving the same
      // way (G.throat.E.neg) — offset in y exactly like a through
      // station's two opposite home signals are.
      var arr = G.throat.E.pos, dep = G.throat.E.neg;
      var arrGo = arr && arr.state === 'routed' && !pastSignal(arr, L.xEastHome);
      var depGo = dep && dep.state === 'depart' && !pastSignal(dep, L.xEastHome);
      drawSignal(L.xEastHome, L.mainB + 42, arrGo ? 2 : 0, true);
      drawSignal(L.xEastHome, L.mainA - 42, depGo ? 2 : 0, true);
      for (i = 0; i < T.length; i++) {
        var ot = G.trackOwner[i];
        // Only a real departure gets a starter signal here — an arrival's
        // yard-bound shunt releases its platform the moment it commits
        // (see 'awaitYard' in updateTrain), well before it's this signal's
        // business, exactly like the yard shunt is nobody else's.
        var goT = ot && ot.dir < 0 && ot.state === 'depart' && !pastSignal(ot, L.xThroatE - 30);
        drawSignal(L.xThroatE - 30, T[i].y - 34, goT ? 2 : 0, true);
      }
      return;
    }
    // G.throat.W.pos only ever holds a dir>0 (west-entering) train, and
    // G.throat.E.neg only ever a dir<0 (east-entering) one — see slotOf —
    // so the home signal is exactly this train's clearance, not some other
    // road's, however many services are queued behind it at the signal.
    var wArr = G.throat.W.pos, eArr = G.throat.E.neg;
    var wGo = wArr && wArr.state === 'routed' && !pastSignal(wArr, L.xWestHome);
    var eGo = eArr && eArr.state === 'routed' && !pastSignal(eArr, L.xEastHome);
    drawSignal(L.xWestHome, L.mainB + 42, wGo ? 2 : 0, true);
    drawSignal(L.xEastHome, L.mainA - 42, eGo ? 2 : 0, true);
    for (i = 0; i < T.length; i++) {
      var o = G.trackOwner[i];
      // A stopping train clears this signal by actually departing; a
      // through train clears it only once it's past its own far-gate
      // check (see updateTrain's 'routed' branch) — being non-stop is not
      // by itself clearance, or the signal would read green the moment
      // it's assigned a road, long before it's allowed to cross.
      var ready = o && (o.stops ? o.state === 'depart' : o.gateCleared);
      var eastGo = ready && o.dir > 0 && !pastSignal(o, L.xThroatE - 30);
      var westGo = ready && o.dir < 0 && !pastSignal(o, L.xThroatW + 30);
      drawSignal(L.xThroatE - 30, T[i].y + 34, eastGo ? 2 : 0, true);
      drawSignal(L.xThroatW + 30, T[i].y - 34, westGo ? 2 : 0, true);
    }
  }

  function drawPeople() {
    var i, p;
    for (i = 0; i < G.people.length; i++) {
      p = G.people[i];
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(p.x + 1.6, p.y + 2, 3.4, 2.4, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = p.coat;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 3.1, 2.3, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = p.skin;
      ctx.beginPath(); ctx.arc(p.x, p.y - 0.4, 1.5, 0, 6.2832); ctx.fill();
    }
  }

  function drawLabel(tr) {
    // Anchor on the middle of the consist, but keep the plate on stage: a
    // long train waiting at the home signal trails well off the edge.
    var hd = RY.pathAt(tr.path, tr.s);
    var tl = RY.pathAt(tr.path, Math.max(0, tr.s - tr.len));
    if (Math.max(hd.x, tl.x) < 20 || Math.min(hd.x, tl.x) > RY.W - 20) return;
    var m = { x: Math.max(86, Math.min(RY.W - 86, (hd.x + tl.x) / 2)),
              y: (hd.y + tl.y) / 2 };
    var above = tr.dir > 0 ? -1 : 1;
    var y = m.y + above * 38;
    var txt = tr.svcName || tr.code, sub = '', col = '#f0b429', mid = null, midCol = '#9aa4b0';

    if (tr.state === 'approach') {
      var d = G.gameT - tr.sched;
      if (tr.yardOrigin) {
        sub = d > 0.75 ? 'call it forward \u2014 +' + d.toFixed(0) + ' min' : 'ready \u00b7 dep ' + fmtTime(tr.schedDep);
        col = d > 3 ? '#ff7a5c' : '#7ee0a0';
      } else {
        sub = d > 0.75 ? '+' + d.toFixed(0) + ' min late' : 'due ' + fmtTime(tr.sched);
        col = d > 3 ? '#ff7a5c' : d > 0.75 ? '#f0b429' : '#7ee0a0';
      }
      if (tr.stops) {
        mid = 'CALLS \u00b7 ' + eligible(tr).map(function (k) { return k.short; }).join(' ');
        midCol = '#79c0ff';
      } else {
        mid = 'RUNS THROUGH \u00b7 ' + eligible(tr).map(function (k) { return k.short; }).join(' ');
        midCol = '#f0b429';
      }
    } else if (tr.state === 'toPlatform') {
      sub = 'forming \u00b7 ' + T[tr.trackId].short; col = '#7ee0a0';
    } else if (tr.state === 'dwell') {
      sub = 'dep ' + fmtTime(tr.schedDep); col = '#79c0ff';
    } else if (tr.state === 'awaitDepart') {
      sub = 'held \u2014 throat busy'; col = '#ff7a5c';
    } else if (tr.state === 'awaitYard') {
      sub = 'held \u2014 yard busy'; col = '#ff7a5c';
    } else if (tr.state === 'toYard' || tr.state === 'parked') {
      sub = 'stabled'; col = '#9aa4b0';
    } else if (tr.state === 'routed') {
      var atFarGate = !tr.stops && !tr.gateCleared && tr.targetS !== Infinity;
      if (atFarGate) {
        sub = 'held \u2014 far throat busy'; col = '#ff7a5c';
      } else {
        sub = (tr.trackId !== null ? T[tr.trackId].short : '') +
              (tr.stops ? '' : ' \u00b7 no stop');
        col = '#7ee0a0';
      }
    } else { sub = 'away'; col = '#9aa4b0'; }

    ctx.save();
    ctx.font = '700 12px ui-monospace, Menlo, monospace';
    var w = ctx.measureText(txt).width;
    ctx.font = '600 10px ui-monospace, monospace';
    w = Math.max(w, ctx.measureText(sub).width, mid ? ctx.measureText(mid).width : 0) + 18;
    var h = mid ? 42 : 30;
    ctx.fillStyle = 'rgba(8,12,18,.85)';
    RY.rr(ctx, m.x - w / 2, y - 15, w, h, 5); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e6edf3';
    ctx.font = '700 12px ui-monospace, Menlo, monospace';
    ctx.fillText(txt, m.x, y - 5);
    ctx.font = '600 10px ui-monospace, monospace';
    if (mid) {
      ctx.fillStyle = midCol; ctx.fillText(mid, m.x, y + 9);
      ctx.fillStyle = col;    ctx.fillText(sub, m.x, y + 21);
    } else if (sub) {
      ctx.fillStyle = col;    ctx.fillText(sub, m.x, y + 9);
    }

    if (G.sel === tr || G.hoverTrain === tr) {
      ctx.strokeStyle = G.sel === tr ? '#f0b429' : 'rgba(240,180,41,.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y - 24); ctx.lineTo(hd.x, hd.y - 24);
      ctx.lineTo(hd.x, hd.y + 24); ctx.lineTo(tl.x, tl.y + 24); ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawNight() {
    if (G.night < 0.02) return;
    ctx.fillStyle = 'rgba(8,14,34,' + G.night + ')';
    ctx.fillRect(0, 0, RY.W, RY.H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var i, g, isl, x;
    for (i = 0; i < RY.ISLANDS.length; i++) {
      isl = RY.ISLANDS[i];
      var cy = (isl.y0 + isl.y1) / 2, core = RY.islandCore(isl);
      for (x = core.x0 + 66; x < core.x1 - 40; x += 62) {
        g = ctx.createRadialGradient(x, cy, 2, x, cy, 62);
        g.addColorStop(0, 'rgba(255,226,160,' + (0.30 * G.night + 0.05) + ')');
        g.addColorStop(1, 'rgba(255,210,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, cy, 62, 0, 6.2832); ctx.fill();
      }
    }
    g = ctx.createRadialGradient(956, 100, 24, 956, 100, 330);
    g.addColorStop(0, 'rgba(255,224,168,' + (0.24 * G.night) + ')');
    g.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = g; ctx.fillRect(620, 0, 680, 260);
    ctx.restore();
  }

  function draw() {
    var w = stage.clientWidth, h = stage.clientHeight, i;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    if (RY.sceneCanvas) ctx.drawImage(RY.sceneCanvas, 0, 0, RY.W, RY.H);

    drawTrackHighlights();
    drawPeople();

    for (i = 0; i < G.trains.length; i++) RY.drawTrainShadow(ctx, G.trains[i]);
    for (i = 0; i < G.trains.length; i++) RY.drawTrain(ctx, G.trains[i], G.night);

    RY.drawFootbridge(ctx);
    drawSignals();
    drawNight();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < G.trains.length; i++) RY.drawTrainLights(ctx, G.trains[i], G.night);
    ctx.restore();

    for (i = 0; i < G.trains.length; i++) drawLabel(G.trains[i]);

    if (G.state === 'paused') {
      ctx.fillStyle = 'rgba(8,12,20,.62)';
      ctx.fillRect(0, 0, RY.W, RY.H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f0b429';
      ctx.font = '800 46px ui-monospace, Menlo, monospace';
      ctx.fillText('PAUSED', RY.W / 2, RY.H / 2 - 12);
      ctx.fillStyle = '#cfd8e3';
      ctx.font = '600 15px -apple-system, system-ui, sans-serif';
      ctx.fillText('press space, or the button above, to resume', RY.W / 2, RY.H / 2 + 26);
    }

    // direction reminders at the line ends — a terminus has nothing at
    // the west end at all, and everything (network and yard alike) on
    // the one east side.
    ctx.save();
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(190,202,216,.55)';
    if (!L.terminus) {
      ctx.textAlign = 'left';
      ctx.fillText('▶  FROM THE WEST', 12, L.mainB + 66);
    }
    ctx.textAlign = 'right';
    ctx.fillText((L.terminus ? 'NETWORK & YARD' : 'FROM THE EAST') + '  ◀', RY.W - 12, L.mainA - 54);
    ctx.restore();
  }

  /* ================= HUD ================= */
  function statusOf(tr) {
    if (tr.state === 'approach') {
      if (tr.yardOrigin) return (G.gameT - tr.sched > 0.75) ? ['DELAYED', 'st-late'] : ['IN YARD', 'st-wait'];
      return (G.gameT - tr.sched > 0.75) ? ['DELAYED', 'st-late'] : ['WAITING', 'st-wait'];
    }
    if (tr.state === 'toPlatform') return ['FORMING', 'st-run'];
    if (tr.state === 'routed') {
      if (!tr.stops && !tr.gateCleared && tr.targetS !== Infinity) {
        return ['HELD', 'st-late'];
      }
      return ['RUNNING', 'st-run'];
    }
    if (tr.state === 'dwell') return ['AT PLATFORM', 'st-dwell'];
    if (tr.state === 'awaitDepart' || tr.state === 'awaitYard') return ['HELD', 'st-late'];
    return ['DEPARTING', 'st-run'];
  }

  function renderBoard() {
    // Once a service is quietly shunting into or sitting in the yard, it's
    // no longer anything the dispatcher can act on — leave it off the
    // register rather than clutter it with entries nothing can be done
    // with; it's still there, parked, on the canvas.
    var list = G.trains.filter(function (t) { return t.state !== 'toYard' && t.state !== 'parked'; })
                        .sort(function (a, b) { return a.sched - b.sched; });
    if (!list.length) {
      elBoard.innerHTML = '<div class="empty">No services on the panel.<br>Stand by.</div>';
      return;
    }
    /* Two lines per entry: the first identifies the service — which way it
       is running, what it is called, and the road it is on — and the second
       carries its formation and current status. The roads it *could* take
       aren't listed here; selecting it lights the assignable ones up on the
       road buttons below, and its canvas label spells them out. */
    var html = '', i, tr, st;
    for (i = 0; i < list.length; i++) {
      tr = list[i]; st = statusOf(tr);
      html += '<div class="row' + (G.sel === tr ? ' sel' : '') + '" data-id="' + tr.id +
              '" style="border-left-color:' + tr.cfg.body + '">' +
        '<div class="r1"><span class="dir">' + (tr.dir > 0 ? '▶' : '◀') + '</span>' +
        '<span class="code">' + (tr.svcName || tr.code) + '</span>' +
        '<span class="road">' + (tr.trackId !== null ? T[tr.trackId].short : '—') + '</span></div>' +
        '<div class="r2"><span class="kind">' + tr.cfg.label + ' · ' + tr.cars + ' cars · ' +
        fmtTime(tr.svcName ? (tr.dir > 0 ? tr.sched : tr.schedDep) : tr.sched) + '</span>' +
        '<span class="stat2 ' + st[1] + '">' + st[0] + '</span></div>' +
        '</div>';
    }
    elBoard.innerHTML = html;
  }

  var elAkeys = document.querySelector('.akeys');

  /* The road buttons are rebuilt from the current station's tracks —
     there's no fixed count of them any more. */
  function renderAkeys() {
    elAkeys.innerHTML = T.map(function (t, i) {
      return '<button class="akey" data-t="' + i + '"><b>' + (i + 1) + '</b>' +
             '<span>' + t.short + '</span><i>' + t.maxCars + '</i></button>';
    }).join('');
  }
  elAkeys.addEventListener('click', function (e) {
    var b = e.target.closest('.akey');
    if (b && G.sel) { assign(G.sel, +b.dataset.t); renderBoard(); renderKeys(); }
  });

  function renderKeys() {
    var btns = document.querySelectorAll('.akey'), i, b, idx;
    for (i = 0; i < btns.length; i++) {
      b = btns[i]; idx = +b.dataset.t;
      b.classList.remove('ok', 'no');
      if (!G.sel) continue;
      b.classList.add(canAssign(G.sel, T[idx]) ? 'no' : 'ok');
    }
  }

  function renderHud() {
    document.getElementById('s-clock').textContent = fmtTime(G.gameT);
    document.getElementById('s-score').textContent = Math.max(0, Math.round(G.score)).toLocaleString();
    document.getElementById('s-level').textContent = G.level;
    document.getElementById('s-punct').textContent =
      G.events ? Math.round(G.onTime / G.events * 100) + '%' : '—';
    document.getElementById('s-combo').textContent = '×' + mult().toFixed(1);
    document.getElementById('s-lives').textContent =
      '●●●'.slice(0, Math.max(0, G.lives)) + '○○○'.slice(0, Math.max(0, 3 - G.lives));
  }

  /* ================= input ================= */
  function hitTrain(wx, wy) {
    var i, tr, s, p, best = null, bd = 26;
    for (i = 0; i < G.trains.length; i++) {
      tr = G.trains[i];
      for (s = Math.max(0, tr.s - tr.len); s <= tr.s; s += 14) {
        p = RY.pathAt(tr.path, s);
        var d = Math.max(Math.abs(p.x - wx) - 8, Math.abs(p.y - wy));
        if (d < bd) { bd = d; best = tr; }
      }
    }
    return best;
  }
  function hitTrack(wx, wy) {
    var i;
    if (L.terminus) {
      if (wx > L.xThroatE) return -1;
      for (i = 0; i < T.length; i++) {
        if (Math.abs(wy - T[i].y) < 30 && wx >= RY.platSpan(T[i]).x0) return i;
      }
      return -1;
    }
    if (wx < L.xThroatW || wx > L.xThroatE) return -1;
    for (i = 0; i < T.length; i++) if (Math.abs(wy - T[i].y) < 30) return i;
    return -1;
  }

  cv.addEventListener('mousemove', function (e) {
    var r = cv.getBoundingClientRect(), w = toWorld(e.clientX - r.left, e.clientY - r.top);
    G.hoverTrack = hitTrack(w.x, w.y);
    G.hoverTrain = hitTrain(w.x, w.y);
    cv.style.cursor = (G.hoverTrain || (G.sel && G.hoverTrack >= 0)) ? 'pointer' : 'crosshair';
  });

  cv.addEventListener('click', function (e) {
    if (G.state !== 'running') return;
    var r = cv.getBoundingClientRect(), w = toWorld(e.clientX - r.left, e.clientY - r.top);
    var tr = hitTrain(w.x, w.y), ti = hitTrack(w.x, w.y);
    if (tr && tr.state === 'approach') { select(tr); return; }
    if (G.sel && ti >= 0) { assign(G.sel, ti); renderBoard(); renderKeys(); return; }
    if (tr) { select(null); hint('<b>' + trName(tr) + '</b> is already on the move.'); return; }
    select(null);
  });

  function select(tr) {
    G.sel = tr;
    if (tr) {
      var free = [], i;
      for (i = 0; i < T.length; i++) if (!canAssign(tr, T[i])) free.push(T[i].short);
      hint('<b>' + trName(tr) + '</b> · ' + tr.cfg.label + ' · ' + tr.cars + ' cars<br>' +
           (tr.stops
              ? 'Calls here — needs a platform of ' + tr.cars + ' or more.'
              : 'Runs through — no booked stop.') + '<br>' +
           (free.length ? 'Clear now: <b>' + free.join(' ') + '</b>'
                        : 'Nothing clear — hold it at the signal.'));
    } else {
      hint('Select a train, then pick a road.');
    }
    renderBoard(); renderKeys();
  }

  elBoard.addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    var id = +row.dataset.id, i;
    for (i = 0; i < G.trains.length; i++) {
      if (G.trains[i].id === id) {
        select(G.trains[i].state === 'approach' ? G.trains[i] : null);
        return;
      }
    }
  });


  /* Both pause and resume are single, shared choke points — anything that
     stops or restarts play (spacebar, the pause button, the help overlay,
     the tab going into the background) goes through these, so the audio
     engine is always told directly rather than hoping a future animation
     frame notices the state changed. requestAnimationFrame is throttled or
     halted entirely for a hidden tab, so that hope doesn't always pay off. */
  function pauseGame() {
    if (G.state !== 'running') return;
    G.state = 'paused';
    document.getElementById('btn-pause').textContent = '\u25b6';
    elBanner.innerHTML = '';
    RY.audio.suspend();
  }
  function resumeGame() {
    if (G.state !== 'paused') return;
    G.state = 'running';
    document.getElementById('btn-pause').textContent = '\u23f8';
    elBanner.innerHTML = '';
    RY.audio.resume();
  }
  function togglePause() {
    if (G.state === 'running') pauseGame();
    else if (G.state === 'paused') resumeGame();
  }

  root.addEventListener('keydown', function (e) {
    if (e.target === elVol) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
    if (e.key === 'Escape') { select(null); return; }
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= T.length && G.sel && G.state === 'running') {
      assign(G.sel, n - 1); renderBoard(); renderKeys();
    }
  });

  document.getElementById('btn-pause').addEventListener('click', function () { togglePause(); });

  /* Alt-tabbing suspends the animation frame anyway, so make the pause
     explicit rather than leaving a frozen board that claims to be running. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    pauseGame();
    RY.audio.suspend();   // belt and suspenders: covers every state, not just 'running'
  });

  /* Leaving the page entirely — navigating away, closing the tab. A normal
     tab close tears the whole context down on its own, but this catches
     the cases in between (back/forward cache, an embedding iframe) where
     the page stays alive a moment longer than the user expects sound to. */
  ['pagehide', 'beforeunload'].forEach(function (ev) {
    root.addEventListener(ev, function () { RY.audio.suspend(); });
  });

  /* ---------------- sound controls ---------------- */
  var elMute = document.getElementById('btn-mute');
  var elVol  = document.getElementById('vol');
  var elVolWrap = elMute.parentNode;

  function paintAudioUI() {
    var a = RY.audio, pct = Math.round(a.volume * 100);
    elVol.value = pct;
    elVol.style.setProperty('--fill', (a.muted ? 0 : pct) + '%');
    elMute.textContent = a.muted || a.volume === 0 ? '\uD83D\uDD07'
                       : a.volume < 0.45 ? '\uD83D\uDD09' : '\uD83D\uDD0A';
    elVolWrap.classList.toggle('off', a.muted || a.volume === 0);
    elMute.title = a.muted ? 'Unmute (M)' : 'Mute (M)';
  }

  function toggleMute() { RY.audio.init(); RY.audio.toggleMute(); paintAudioUI(); }

  elMute.addEventListener('click', function () { toggleMute(); elMute.blur(); });
  elVol.addEventListener('input', function () {
    RY.audio.init();
    RY.audio.setVolume(elVol.value / 100);
    paintAudioUI();
  });
  elVol.addEventListener('change', function () { elVol.blur(); });
  paintAudioUI();

  /* The audio context may only start from a gesture, so latch onto the
     first one of any kind. */
  ['pointerdown', 'keydown'].forEach(function (ev) {
    root.addEventListener(ev, function once() {
      RY.audio.init();
      root.removeEventListener(ev, once);
    });
  });

  document.getElementById('btn-help').addEventListener('click', function () {
    pauseGame();
    showMenu(false);
  });

  /* ================= lifecycle ================= */
  function makePeople() {
    G.people = [];
    RY.ISLANDS.forEach(function (isl) {
      var midY = (isl.y0 + isl.y1) / 2;
      [[isl.upper, isl.y0, midY - 4], [isl.lower, midY + 4, isl.y1]].forEach(function (f) {
        var sp = RY.platSpan(f[0]);
        // busier platforms carry more people, which is another length cue
        var n = Math.round(f[0].maxCars * 3.4);
        for (var i = 0; i < n; i++) {
          var y0 = f[1] + 13, y1 = f[2] - 13;
          G.people.push({
            x0: sp.x0 + 30, x1: sp.x1 - 30, y0: y0, y1: y1,
            x: sp.x0 + 30 + Math.random() * (sp.len - 60),
            y: y0 + Math.random() * (y1 - y0),
            vx: 0, vy: 0, t: Math.random() * 3,
            coat: ['#2f3b4c', '#4a3340', '#3b4a37', '#5a4636', '#37414d', '#6b3f3f'][(Math.random() * 6) | 0],
            skin: ['#c99a6e', '#8a5f42', '#e0b48c', '#6b4630'][(Math.random() * 4) | 0]
          });
        }
      });
    });
  }

  function gameOver() {
    G.state = 'over';
    RY.audio.suspend();   // cut instantly rather than waiting for the next frame
    elOverlay.innerHTML =
      '<div class="card"><h1>SHIFT <em>ENDED</em></h1>' +
      '<p class="tag">Three services cancelled. Control has been relieved.</p>' +
      '<div class="final">' +
      '<div><label>Final score</label><span>' + Math.max(0, Math.round(G.score)).toLocaleString() + '</span></div>' +
      '<div><label>Shifts worked</label><span>' + G.level + '</span></div>' +
      '<div><label>Trains handled</label><span>' + G.arrivals + '</span></div>' +
      '<div><label>Punctuality</label><span>' + (G.events ? Math.round(G.onTime / G.events * 100) : 0) + '%</span></div>' +
      '</div><button id="btn-again">TAKE ANOTHER SHIFT</button>' +
      '<div class="foot">Keep the long platforms clear for the InterCity sets.</div></div>';
    elOverlay.classList.add('show');
    document.getElementById('btn-again').addEventListener('click', function () { showMenu(true); });
  }

  /* Only offered a station change when nothing is currently in play \u2014 a
     shift already under way (paused for the help card) can't have its
     track layout swapped out from under it, so that case just shows the
     rules again with the picker left off. */
  function showMenu(allowPick) {
    elOverlay.innerHTML = introHTML;
    if (allowPick) renderStationPicker();
    else { var p = document.getElementById('stationPick'); if (p) p.remove(); }
    updateOverlayTag();
    elOverlay.classList.add('show');
    var b = document.getElementById('btn-start');
    if (b && G.state === 'paused') b.textContent = 'RESUME';
  }

  function updateOverlayTag() {
    var tag = document.getElementById('overlayTag');
    if (tag) tag.textContent = stationById(selectedStationId).name + ' \u00b7 Signalling Panel A';
  }

  function renderStationPicker() {
    var wrap = document.getElementById('stationPicker');
    if (!wrap) return;
    // A station marked `hidden` is fully built and playable — it just
    // isn't offered here (see its entry in geom.js for why). Everything
    // else about it still works, so unhiding is a one-word change.
    wrap.innerHTML = RY.STATIONS.filter(function (s) { return !s.hidden; }).map(function (s) {
      var plats = s.tracks.filter(function (t) { return t.platform; }).length;
      var thru = s.tracks.length - plats;
      return '<button type="button" class="stn' + (s.id === selectedStationId ? ' sel' : '') +
        '" data-s="' + s.id + '">' +
        '<span class="stn-name">' + s.name + '</span>' +
        '<span class="stn-meta">' + s.difficulty + ' \u00b7 ' + plats + ' platform' + (plats === 1 ? '' : 's') +
        (thru ? ' \u00b7 ' + thru + ' through' : '') + '</span>' +
        '</button>';
    }).join('');
    var blurb = document.getElementById('stnBlurb');
    if (blurb) blurb.textContent = stationById(selectedStationId).blurb;
  }

  elOverlay.addEventListener('click', function (e) {
    var tile = e.target.closest('.stn');
    if (tile) { selectedStationId = tile.dataset.s; renderStationPicker(); updateOverlayTag(); return; }
  });

  function start() {
    RY.audio.init();
    RY.audio.resume();
    var def = RY.applyStation(selectedStationId);
    RY.bakeScene();
    renderAkeys();
    document.querySelector('.bname').textContent = def.name.toUpperCase();
    document.title = 'Railyard Dispatcher \u2014 ' + def.name;
    G.state = 'running';
    G.trains = []; G.trackOwner = freshTrackOwner();
    G.throat = { W: { pos: null, neg: null }, E: { pos: null, neg: null } };
    G.gameT = 360; G.elapsed = 0; G.level = 1; G.score = 0; G.lives = 3;
    G.combo = 0; G.onTime = 0; G.events = 0; G.arrivals = 0;
    G.spawnIn = 2.0; G.sel = null; G.night = 0; G.fullHouse = false;
    G.ttDone = def.terminus ? def.timetable.map(function () { return false; }) : [];
    makePeople();
    document.getElementById('btn-pause').textContent = '\u23f8';
    elOverlay.classList.remove('show');
    elBanner.innerHTML = '';
    hint('Select a train, then pick a road.');
    renderBoard(); renderKeys();
  }

  elOverlay.addEventListener('click', function (e) {
    if (e.target.id === 'btn-start') {
      if (G.state === 'paused') { resumeGame(); elOverlay.classList.remove('show'); }
      else start();
    }
  });

  /* ================= main loop ================= */
  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (G.state === 'running') {
      update(dt);
      if (ts - G.lastBoard > 220) { G.lastBoard = ts; renderBoard(); renderKeys(); }
      renderHud();
    } else {
      RY.audio.silence();
    }
    draw();
    requestAnimationFrame(frame);
  }

  /* ================= boot ================= */
  resize();
  RY.bakeScene();
  makePeople();
  renderAkeys();
  renderStationPicker();
  updateOverlayTag();
  renderBoard();
  requestAnimationFrame(frame);
})(window);
