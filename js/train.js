/* ------------------------------------------------------------------
   train.js — rolling stock.

   A consist is a list of vehicles, each with its own length and kind, so
   a locomotive is genuinely a different vehicle from the coaches behind
   it.  Movement uses continuous speed limits: service braking eases the
   train down to the station restriction over a few hundred metres, and
   the final approach to a stand tapers rather than clamping to zero.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY;
  var L = RY.LAY;

  var ACC = 74, BRAKE = 104, SERVICE = 26;
  /* The profile used to run down to a stand.  Deliberately gentler than
     the brakes can manage, so the train can always track it and rolls to
     a stand instead of arriving with speed still on and clamping to zero. */
  var STOP_BRAKE = 76;
  var STATION_V = 100;         // permanent restriction over the pointwork
  RY.STATION_V = STATION_V;

  /* cars is the vehicle count, which is what platform capacity is measured in. */
  RY.TYPES = {
    local:     { key:'local',     label:'Local',     prefix:'SU', cars:3, vmax:150, dwell:12,
                 haulage:'emu',  vehLen:104,
                 body:'#2e7a4f', roof:'#6f7a82', stripe:'#ecc84c', elec:true,  stops:true },
    express:   { key:'express',   label:'Express',   prefix:'EX', cars:4, vmax:185, dwell:10,
                 haulage:'emu',  vehLen:108,
                 body:'#24518f', roof:'#74808b', stripe:'#f2f6fa', elec:true,  stops:true },
    intercity: { key:'intercity', label:'InterCity', prefix:'IC', cars:5, vmax:170, dwell:16,
                 haulage:'loco', locoLen:122, vehLen:108,
                 body:'#8d2b36', roof:'#7e8286', stripe:'#e9ddc4', elec:true,  stops:true },
    sleeper:   { key:'sleeper',   label:'Sleeper',   prefix:'SL', cars:6, vmax:160, dwell:18,
                 haulage:'loco', locoLen:122, vehLen:108,
                 body:'#4a2f6b', roof:'#7c7386', stripe:'#d9c9e8', elec:true,  stops:true },
    freight:   { key:'freight',   label:'Freight',   prefix:'6F', cars:6, vmax:105, dwell:0,
                 haulage:'diesel', locoLen:104, vehLen:90,
                 body:'#4b4034', roof:'#6c6156', stripe:'#8b7b60', elec:false, stops:false },
    nonstop:   { key:'nonstop',   label:'Non-Stop',  prefix:'1A', cars:4, vmax:215, dwell:0,
                 haulage:'emu',  vehLen:108,
                 body:'#1c2a3a', roof:'#69737f', stripe:'#dba441', elec:true,  stops:false }
  };

  var ORIGINS_W = ['Ashcombe', 'Wrenford', 'Dalemouth', 'Pentworth', 'Hollowfield'];
  var ORIGINS_E = ['Marlbury', 'Sevenoaks Vale', 'Carrick', 'Bexhaven', 'Norlingham'];

  /* ---- colour helpers ---- */
  function rgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  var shadeCache = {};
  function shade(h, amt) {
    var k = h + '|' + amt, v = shadeCache[k];
    if (v) return v;
    var c = rgb(h);
    function f(x) { return Math.max(0, Math.min(255, amt > 0 ? x + (255 - x) * amt : x * (1 + amt))) | 0; }
    v = 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
    shadeCache[k] = v;
    return v;
  }
  RY.shade = shade;

  var uid = 1;

  /* =================== the train =================== */
  function Train(typeKey, dir, gameT) {
    var c = RY.TYPES[typeKey], i, len, kind, off = 0;
    this.id = uid++;
    this.type = typeKey;
    this.cfg = c;
    this.dir = dir;                                   // +1 eastbound, -1 westbound
    this.cars = c.cars;
    this.stops = c.stops;
    this.code = c.prefix + (100 + ((Math.random() * 800) | 0));
    this.origin = (dir > 0 ? ORIGINS_W : ORIGINS_E)[(Math.random() * 5) | 0];
    this.dest   = (dir > 0 ? ORIGINS_E : ORIGINS_W)[(Math.random() * 5) | 0];
    this.seed = (Math.random() * 1e9) | 0;

    /* Build the consist, front to back. */
    this.vehicles = [];
    for (i = 0; i < c.cars; i++) {
      if (i === 0 && c.haulage === 'loco')        { kind = 'eloco'; len = c.locoLen; }
      else if (i === 0 && c.haulage === 'diesel') { kind = 'dloco'; len = c.locoLen; }
      else if (c.haulage === 'diesel')            { kind = 'wagon'; len = c.vehLen; }
      else if (c.haulage === 'loco')              { kind = 'coach'; len = c.vehLen; }
      else                                        { kind = 'emu';   len = c.vehLen; }
      this.vehicles.push({
        kind: kind, len: len, mid: off + len / 2, idx: i,
        first: i === 0, last: i === c.cars - 1,
        load: (Math.random() * 3) | 0
      });
      off += len;
    }
    this.len = off;

    this.trackId = null;
    // Arc length to the home signal is identical whichever road this
    // placeholder path uses (see buildPath) — any real track will do
    // until routeTo() picks the actual one.
    this.setPath(RY.buildPath(dir, RY.TRACKS[(RY.TRACKS.length / 2) | 0].y));
    this.s = this.len;                                 // whole train on-path, off-stage
    // A service running in off the main is already at line speed; starting
    // from rest made every arrival look like it was pulling away from a stop.
    this.v = Math.min(c.vmax, this.limitAt(this.s));
    this.state = 'approach';
    this.targetS = this.sHome;
    this.stopS = Infinity;

    this.sched = 0;
    this.schedDep = 0;
    this.dwellUntil = 0;
    this.holdsThroat = { W: false, E: false };
    this.holdsTrack = false;
    this.flash = 0;
    // One-shot: whether a through-running service has already settled its
    // far-gate decision (hold or go). Never re-examined after that, so the
    // routine release of holdsThroat far downstream can't be mistaken for
    // a fresh arrival at the gate and yank the train backwards.
    this.gateCleared = false;

    // Terminus-only: a service formed in the yard rather than arriving off
    // the main starts parked on a yard road (see game.js's scheduleTimetable),
    // and its first routeTo() is a shunt move onto its platform rather
    // than the usual mainline path — see routeTo() below. yardRoad is the
    // stabling road it currently owns, whichever end of its journey that's
    // at; svcName is the real timetable name shown in place of the random
    // service code, for services spawned that way.
    this.yardOrigin = false;
    this.yardRoad = null;
    this.yardLinked = false;
    this.parkedUntil = 0;
    this.svcName = null;
    // Set once, the first time this service falls behind its booked time —
    // see markLate() in game.js, which tallies each late service once.
    this.lateFlag = false;
  }
  RY.Train = Train;

  /* Cache the arc lengths that matter, so the speed profile is a couple
     of comparisons rather than a path lookup every frame. */
  Train.prototype.setPath = function (P) {
    this.path = P;
    if (L.terminus) {
      // Every terminus road shares the one throat, on the east — both
      // streams call it home, but which way "before it" lies flips with
      // which way each stream actually travels through it (see
      // buildPath). Nothing here is ever a through-running service (a
      // terminus books none), so sFast/sFarGate are never consulted —
      // they just need a harmless value, not a load-bearing one.
      this.sHome = RY.sAtX(P, L.xEastHome);
      this.sSlow = RY.sAtX(P, this.dir > 0 ? L.xEastHome + 30 : L.xEastHome - 30);
      this.sFast = this.sSlow;
      this.sFarGate = this.sSlow;
      return;
    }
    this.sHome = RY.sAtX(P, this.dir > 0 ? L.xWestHome : L.xEastHome);
    this.sSlow = RY.sAtX(P, this.dir > 0 ? L.xWestHome - 30 : L.xEastHome + 30);
    this.sFast = RY.sAtX(P, this.dir > 0 ? L.xEastHome + 30 : L.xWestHome - 30);
    // Where a through-running train must hold if the far throat is still
    // busy when it gets there — right at the far exit signal (drawn 30px
    // inset from the ladder boundary, same as sSlow/sFast above), so a
    // held train's nose stops under the signal instead of drifting past it.
    this.sFarGate = RY.sAtX(P, this.dir > 0 ? L.xThroatE - 30 : L.xThroatW + 30);
  };

  Train.prototype.tailS = function () { return this.s - this.len; };
  Train.prototype.headX = function () { return RY.posAt(this.path, this.s).x; };
  Train.prototype.tailX = function () { return RY.posAt(this.path, Math.max(0, this.tailS())).x; };
  Train.prototype.pos = function () { return RY.pathAt(this.path, this.s); };
  Train.prototype.mid = function () {
    return RY.pathAt(this.path, Math.max(0, this.s - this.len / 2));
  };

  /* Line speed outside, station speed over the pointwork — but eased
     into with service braking rather than dropped like a step. */
  Train.prototype.limitAt = function (s) {
    if (s < this.sSlow) {
      return Math.min(this.cfg.vmax,
        Math.sqrt(STATION_V * STATION_V + 2 * SERVICE * (this.sSlow - s)));
    }
    if (s > this.sFast) return this.cfg.vmax;
    return STATION_V;
  };

  /* The ceiling in force at s, including braking for a booked stand. */
  Train.prototype.ceiling = function (s) {
    var lim = this.limitAt(s), d;
    if (this.targetS !== Infinity) {
      d = this.targetS - s;
      if (d <= 0) return 0;
      lim = Math.min(lim, Math.sqrt(2 * STOP_BRAKE * d));
    }
    return lim;
  };

  Train.prototype.step = function (dt) {
    if (this.targetS !== Infinity && this.targetS - this.s <= 0) {
      this.s = this.targetS; this.v = 0; return;
    }
    var lim = Math.min(this.ceiling(this.s), this.limitAt(this.s + 60));
    if (this.v < lim) this.v = Math.min(lim, this.v + ACC * dt);
    else              this.v = Math.max(lim, this.v - BRAKE * dt);
    this.s += this.v * dt;
    if (this.targetS !== Infinity && this.s > this.targetS) { this.s = this.targetS; this.v = 0; }
  };

  /* Where the head of this train stands when it is berthed. At a
     terminus the platform is asymmetric — one real end, the buffer —
     so unlike a through station's centred berth, which end of the train
     sits near it depends on which way this train is actually running:
     an arrival comes in nose-first toward the buffer (head just short of
     it); a departure was shunted in tail-first from the yard, so it's
     the tail sitting near the buffer and the head a train-length out
     toward the throat it will leave through. */
  Train.prototype.berthHeadX = function () {
    if (!this.stops) return L.stopX;
    if (L.terminus) {
      var trk = RY.TRACKS[this.trackId];
      var bufX = trk ? RY.platSpan(trk).x0 : L.xThroatE - this.len - 60;
      return this.dir > 0 ? bufX + 16 : bufX + this.len + 16;
    }
    if (this.dir > 0) {
      return Math.max(L.xThroatW + this.len + 14,
             Math.min(L.xThroatE - 14, L.stopX + this.len / 2));
    }
    return Math.min(L.xThroatE - this.len - 14,
           Math.max(L.xThroatW + 14, L.stopX - this.len / 2));
  };

  /* How long an unobstructed run over path P to the berth would take, by
     simulating it.  Booking the timetable off this keeps it honest however
     the physics are tuned — and it has to be done per road, because the
     roads at the outside of the layout are a longer way round the throat. */
  Train.prototype.runTimeOn = function (P) {
    var vmax = this.cfg.vmax;
    var sSlow = RY.sAtX(P, this.dir > 0 ? L.xWestHome - 30 : L.xEastHome + 30);
    var sFast = RY.sAtX(P, this.dir > 0 ? L.xEastHome + 30 : L.xWestHome - 30);
    var target = RY.sAtX(P, this.berthHeadX());
    var s = this.s, v = this.v, dt = 0.05, t = 0, lim, d;
    while (s < target && t < 150) {
      lim = s < sSlow ? Math.min(vmax, Math.sqrt(STATION_V * STATION_V + 2 * SERVICE * (sSlow - s)))
          : s > sFast ? vmax : STATION_V;
      d = target - s;
      lim = Math.min(lim, Math.sqrt(2 * STOP_BRAKE * d));
      if (v < lim) v = Math.min(lim, v + ACC * dt); else v = Math.max(lim, v - BRAKE * dt);
      s += v * dt; t += dt;
    }
    return t;
  };

  /* Re-lay the train onto the road it has been given.  Arc length up to
     the home signal is identical on every road, so s carries over — with
     one exception: a service formed in the yard isn't anywhere near the
     home signal yet. Its first routeTo() instead splices a shunt curve
     from wherever it's actually parked straight to the platform berth;
     once that shunt completes (see updateTrain's 'toPlatform' case) it
     calls routeTo() a second time, by which point yardLinked is set and
     this falls through to the normal path exactly as any other train's. */
  Train.prototype.routeTo = function (track) {
    this.trackId = track.id;
    var here = RY.pathAt(this.path, this.s);
    if (this.yardOrigin && !this.yardLinked) {
      this.path = RY.shuntCurve(here.x, here.y, this.berthHeadX(), track.y);
      this.s = 0;
      this.sSlow = 0; this.sFast = this.path.len;
      this.targetS = this.path.len;
      return;
    }
    this.setPath(RY.buildPath(this.dir, track.y));
    if (this.yardLinked) {
      // Coming off the yard shunt onto the standard road path — re-derive
      // s from where the train actually is, not the shunt curve's own
      // arc length, which means nothing in this path's coordinates.
      this.s = RY.sAtX(this.path, here.x);
    }
    this.stopS = RY.sAtX(this.path, this.berthHeadX());
    this.targetS = this.stops ? this.stopS : Infinity;
  };

  /* =================== rendering =================== */
  /* Everything below is a plan view: what you see is the roof, the
     cantrail, and a sliver of bodyside catching the light. */

  function rr(ctx, x, y, w, h, r) { RY.rr(ctx, x, y, w, h, r); }

  function bodyGradient(ctx, HW, col) {
    var g = ctx.createLinearGradient(0, -HW, 0, HW);
    g.addColorStop(0.00, shade(col, -0.46));
    g.addColorStop(0.09, shade(col,  0.24));
    g.addColorStop(0.30, shade(col,  0.04));
    g.addColorStop(0.70, shade(col, -0.04));
    g.addColorStop(0.91, shade(col, -0.18));
    g.addColorStop(1.00, shade(col, -0.52));
    return g;
  }

  function roofGradient(ctx, RH, col) {
    var g = ctx.createLinearGradient(0, -RH, 0, RH);
    g.addColorStop(0.00, shade(col, -0.58));
    g.addColorStop(0.13, shade(col, -0.32));
    g.addColorStop(0.38, shade(col,  0.00));
    g.addColorStop(0.50, shade(col,  0.13));
    g.addColorStop(0.63, shade(col, -0.05));
    g.addColorStop(0.88, shade(col, -0.38));
    g.addColorStop(1.00, shade(col, -0.60));
    return g;
  }

  /* Hard dark outline under the body: reads as the solebar and lifts the
     vehicle off the ballast. */
  function solebar(ctx, BL, HW) {
    ctx.fillStyle = '#10141a';
    rr(ctx, -BL / 2 - 1.2, -HW - 1.2, BL + 2.4, HW * 2 + 2.4, 7);
    ctx.fill();
  }

  /* Roof panel joints, plus the seam along the crown. */
  function roofRibs(ctx, BL, RH, pitch) {
    var x;
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (x = -BL / 2 + pitch; x < BL / 2 - 2; x += pitch) {
      ctx.moveTo(x, -RH + 1.2); ctx.lineTo(x, RH - 1.2);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.11)';
    ctx.beginPath();
    for (x = -BL / 2 + pitch + 0.9; x < BL / 2 - 2; x += pitch) {
      ctx.moveTo(x, -RH + 1.2); ctx.lineTo(x, RH - 1.2);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(18,22,28,.34)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-BL / 2 + 4, -RH + 2.1); ctx.lineTo(BL / 2 - 4, -RH + 2.1);
    ctx.moveTo(-BL / 2 + 4,  RH - 2.1); ctx.lineTo(BL / 2 - 4,  RH - 2.1);
    ctx.stroke();
  }

  /* Soot and rain-streak weathering, heavier towards the ends. */
  function weather(ctx, BL, RH) {
    var g = ctx.createLinearGradient(-BL / 2, 0, BL / 2, 0);
    g.addColorStop(0.00, 'rgba(28,26,22,.30)');
    g.addColorStop(0.22, 'rgba(28,26,22,.05)');
    g.addColorStop(0.78, 'rgba(28,26,22,.05)');
    g.addColorStop(1.00, 'rgba(28,26,22,.30)');
    ctx.fillStyle = g;
    ctx.fillRect(-BL / 2 + 4, -RH, BL - 8, RH * 2);
  }

  function specular(ctx, BL, RH) {
    ctx.strokeStyle = 'rgba(255,255,255,.17)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-BL / 2 + 11, -1.6); ctx.lineTo(BL / 2 - 11, -1.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-BL / 2 + 14, 2.4); ctx.lineTo(BL / 2 - 14, 2.4);
    ctx.stroke();
  }

  function acPod(ctx, x, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    rr(ctx, x - w / 2 + 1, -h / 2 + 1.4, w, h, 1.8); ctx.fill();
    ctx.fillStyle = '#49515a';
    rr(ctx, x - w / 2, -h / 2, w, h, 1.8); ctx.fill();
    ctx.fillStyle = '#69727c';
    rr(ctx, x - w / 2 + 1.2, -h / 2 + 1.2, w - 2.4, h - 2.4, 1.2); ctx.fill();
    ctx.strokeStyle = 'rgba(24,28,34,.6)'; ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var k = -h / 2 + 3; k < h / 2 - 1.5; k += 1.9) {
      ctx.moveTo(x - w / 2 + 2, k); ctx.lineTo(x + w / 2 - 2, k);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(x - w / 2, -h / 2, w, 1);
  }

  function roofVent(ctx, x) {
    ctx.fillStyle = '#3d444c';
    ctx.beginPath(); ctx.arc(x, 0, 3.1, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#5d666f';
    ctx.beginPath(); ctx.arc(x, -0.4, 2.1, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(20,24,30,.7)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x - 2, 0); ctx.lineTo(x + 2, 0); ctx.stroke();
  }

  /* Pantograph in plan: the well it sits in, base insulators, folded
     arms and the collector head.  Trailing pans run down, as in service. */
  function pantograph(ctx, raised) {
    var i, sgn, ix, iy, spread = raised ? 12 : 7;

    for (i = 0; i < 4; i++) {
      ix = i < 2 ? -13 : 9; iy = (i % 2 ? 1 : -1) * 9 - 3;
      ctx.fillStyle = '#20252c'; ctx.fillRect(ix - 0.6, iy - 0.6, 5.2, 7.2);
      ctx.fillStyle = '#b6ae9e'; ctx.fillRect(ix, iy, 4, 6);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(ix, iy, 4, 1.4);
    }
    for (i = 0; i < 2; i++) {
      sgn = i ? 1 : -1;
      ctx.strokeStyle = '#2b323a'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sgn * spread, -8.5); ctx.lineTo(sgn * 2.5, -3);
      ctx.moveTo(sgn * spread,  8.5); ctx.lineTo(sgn * 2.5,  3);
      ctx.stroke();
      ctx.strokeStyle = raised ? '#828d9a' : '#4a535d'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sgn * spread, -8.5); ctx.lineTo(sgn * 2.5, -3);
      ctx.moveTo(sgn * spread,  8.5); ctx.lineTo(sgn * 2.5,  3);
      ctx.stroke();
    }
    ctx.fillStyle = '#171c22'; ctx.fillRect(-3.6, -13, 7.2, 26);
    ctx.fillStyle = raised ? '#9ba6b2' : '#59626c'; ctx.fillRect(-2.8, -12.2, 5.6, 24.4);
    if (raised) {
      ctx.fillStyle = '#d2dae2'; ctx.fillRect(-2.8, -12.2, 5.6, 1.3);
      ctx.fillStyle = 'rgba(120,190,255,.35)';
      ctx.fillRect(-1.4, -13.6, 2.8, 1.2);
    }
    ctx.fillStyle = '#242a31';
    ctx.fillRect(-3.6, -14.2, 7.2, 1.8);
    ctx.fillRect(-3.6,  12.4, 7.2, 1.8);
  }

  /* Passenger doors, seen as recesses in the cantrail. */
  function doors(ctx, BL, HW, col, spots) {
    var i, x;
    for (i = 0; i < spots.length; i++) {
      x = BL * spots[i];
      ctx.fillStyle = shade(col, -0.55);
      ctx.fillRect(x - 6.5, -HW + 0.9, 13, 5.2);
      ctx.fillRect(x - 6.5,  HW - 6.1, 13, 5.2);
      ctx.fillStyle = 'rgba(210,228,246,.30)';         // door glass
      ctx.fillRect(x - 5, -HW + 1.8, 10, 2.4);
      ctx.fillRect(x - 5,  HW - 4.2, 10, 2.4);
      ctx.fillStyle = 'rgba(0,0,0,.5)';                // leaf seam
      ctx.fillRect(x - 0.4, -HW + 0.9, 0.8, 5.2);
      ctx.fillRect(x - 0.4,  HW - 6.1, 0.8, 5.2);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(x - 6.5, -HW + 0.9, 13, 0.9);
      ctx.fillRect(x - 6.5,  HW - 6.1, 13, 0.9);
    }
  }

  /* A driving end: raked screen with wipers, lamps, coupler cover. */
  function cabEnd(ctx, BL, HW, cfg, front, lit, warning) {
    var nose = front ? 1 : -1, xe = nose * (BL / 2), i;

    ctx.beginPath();
    ctx.moveTo(xe - nose * 22, -HW + 1.2);
    ctx.lineTo(xe - nose * 5,  -HW + 5.2);
    ctx.lineTo(xe,             -HW + 10);
    ctx.lineTo(xe,              HW - 10);
    ctx.lineTo(xe - nose * 5,   HW - 5.2);
    ctx.lineTo(xe - nose * 22,  HW - 1.2);
    ctx.closePath();
    ctx.fillStyle = warning ? '#d2a828' : shade(cfg.body, -0.26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.9; ctx.stroke();

    // wrapped windscreen
    ctx.beginPath();
    ctx.moveTo(xe - nose * 21, -HW + 4.4);
    ctx.lineTo(xe - nose * 10, -HW + 7.6);
    ctx.lineTo(xe - nose * 10,  HW - 7.6);
    ctx.lineTo(xe - nose * 21,  HW - 4.4);
    ctx.closePath();
    var wg = ctx.createLinearGradient(0, -HW, 0, HW);
    wg.addColorStop(0.00, '#1a2733');
    wg.addColorStop(0.34, '#41647f');
    wg.addColorStop(0.52, '#9cc2dd');
    wg.addColorStop(0.72, '#3c5c76');
    wg.addColorStop(1.00, '#16212c');
    ctx.fillStyle = wg; ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,18,.75)'; ctx.lineWidth = 1.2; ctx.stroke();
    // centre pillar and wipers
    ctx.strokeStyle = 'rgba(255,255,255,.20)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(xe - nose * 15.5, -HW + 6); ctx.lineTo(xe - nose * 15.5, HW - 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(12,16,22,.7)'; ctx.lineWidth = 1;
    for (i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(xe - nose * 12, i * (HW - 9.5));
      ctx.lineTo(xe - nose * 19, i * (HW - 6.5));
      ctx.stroke();
    }

    var lampX = xe - nose * 2.4;
    if (front) {
      ctx.fillStyle = lit ? '#fff7d6' : '#e2e7ec';
      for (i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.arc(lampX, i * (HW - 6.4), 2.7, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = '#cbd0d5';
      ctx.beginPath(); ctx.arc(lampX, 0, 2.1, 0, 6.2832); ctx.fill();
    } else {
      ctx.fillStyle = '#c8382c';
      for (i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.arc(lampX, i * (HW - 6.4), 2.5, 0, 6.2832); ctx.fill();
      }
    }
    ctx.fillStyle = '#20252c';
    ctx.fillRect(xe - nose * 1, -3.2, nose * 5.5, 6.4);
  }

  function gangway(ctx, x, dir) {
    ctx.fillStyle = '#10141a';
    rr(ctx, x - (dir < 0 ? 6 : 0), -9.5, 6, 19, 1.6); ctx.fill();
    ctx.fillStyle = 'rgba(120,132,146,.22)';
    ctx.fillRect(x - (dir < 0 ? 6 : 0), -9.5, 6, 1.3);
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var k = 1; k < 4; k++) {
      ctx.moveTo(x - (dir < 0 ? 6 : 0) + k * 1.5, -9);
      ctx.lineTo(x - (dir < 0 ? 6 : 0) + k * 1.5, 9);
    }
    ctx.stroke();
  }

  function buffers(ctx, x, dir) {
    ctx.fillStyle = '#1d2229';
    ctx.fillRect(x, -7.5, dir * 5.5, 3.6);
    ctx.fillRect(x,  3.9, dir * 5.5, 3.6);
    ctx.fillStyle = '#525b65';
    ctx.fillRect(x + dir * 4, -7.5, dir * 1.6, 3.6);
    ctx.fillRect(x + dir * 4,  3.9, dir * 1.6, 3.6);
    ctx.fillStyle = '#161a20';
    ctx.fillRect(x, -2.2, dir * 6.5, 4.4);
  }

  /* ---------------- vehicle renderers ---------------- */

  function drawEmuCar(ctx, tr, vh) {
    var cfg = tr.cfg, BL = vh.len - 10, HW = 17, RH = HW - 8;

    solebar(ctx, BL, HW);
    ctx.fillStyle = bodyGradient(ctx, HW, cfg.body);
    rr(ctx, -BL / 2, -HW, BL, HW * 2, 6.5); ctx.fill();

    doors(ctx, BL, HW, cfg.body, [-0.30, -0.06, 0.18, 0.40]);

    ctx.fillStyle = cfg.stripe;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-BL / 2 + 2.5, -HW + 6.4, BL - 5, 1.5);
    ctx.fillRect(-BL / 2 + 2.5,  HW - 7.9, BL - 5, 1.5);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rr(ctx, -BL / 2 + 4, -RH - 0.7, BL - 8, RH * 2 + 1.4, 4); ctx.fill();
    ctx.fillStyle = roofGradient(ctx, RH, cfg.roof);
    rr(ctx, -BL / 2 + 4.5, -RH, BL - 9, RH * 2, 4); ctx.fill();
    roofRibs(ctx, BL - 9, RH, 13);
    weather(ctx, BL - 9, RH);
    acPod(ctx, -BL * 0.22, 15, 12);
    acPod(ctx,  BL * 0.20, 15, 12);
    roofVent(ctx, BL * 0.40);

    if (cfg.elec && (vh.idx === 1 || (tr.cars > 3 && vh.idx === tr.cars - 2))) {
      ctx.save(); ctx.translate(BL * 0.16, 0);
      pantograph(ctx, vh.idx === 1);
      ctx.restore();
    }

    specular(ctx, BL, RH);

    if (vh.first) cabEnd(ctx, BL, HW, cfg, true, true, false);
    if (vh.last)  cabEnd(ctx, BL, HW, cfg, false, false, false);
    if (!vh.first) gangway(ctx, -BL / 2 - 0.5, -1);
    if (!vh.last)  gangway(ctx,  BL / 2 + 0.5,  1);
  }

  function drawCoach(ctx, tr, vh) {
    var cfg = tr.cfg, BL = vh.len - 10, HW = 17, RH = HW - 8;

    solebar(ctx, BL, HW);
    ctx.fillStyle = bodyGradient(ctx, HW, cfg.body);
    rr(ctx, -BL / 2, -HW, BL, HW * 2, 6.5); ctx.fill();

    // vestibule doors at the ends only, the way a mk-anything coach has them
    doors(ctx, BL, HW, cfg.body, [-0.38, 0.38]);

    // window band: a paler stripe between the doors
    ctx.fillStyle = 'rgba(226,236,248,.13)';
    ctx.fillRect(-BL * 0.32, -HW + 1.6, BL * 0.64, 3.4);
    ctx.fillRect(-BL * 0.32,  HW - 5.0, BL * 0.64, 3.4);
    ctx.fillStyle = cfg.stripe;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(-BL / 2 + 2.5, -HW + 6.4, BL - 5, 1.7);
    ctx.fillRect(-BL / 2 + 2.5,  HW - 8.1, BL - 5, 1.7);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rr(ctx, -BL / 2 + 4, -RH - 0.7, BL - 8, RH * 2 + 1.4, 4); ctx.fill();
    ctx.fillStyle = roofGradient(ctx, RH, cfg.roof);
    rr(ctx, -BL / 2 + 4.5, -RH, BL - 9, RH * 2, 4); ctx.fill();
    roofRibs(ctx, BL - 9, RH, 11);
    weather(ctx, BL - 9, RH);
    acPod(ctx, 0, 16, 12);
    roofVent(ctx, -BL * 0.30);
    roofVent(ctx,  BL * 0.30);
    specular(ctx, BL, RH);

    if (vh.last) {
      cabEnd(ctx, BL, HW, cfg, false, false, false);
      buffers(ctx, BL / 2 + 0.5, 1);
    } else {
      gangway(ctx, BL / 2 + 0.5, 1);
    }
    gangway(ctx, -BL / 2 - 0.5, -1);
  }

  /* Electric locomotive: heavier than a coach, warning panels at both
     driving ends, and a machine room between them under a raised roof
     with one pantograph up and the trailing one down. */
  function drawElectricLoco(ctx, tr, vh) {
    var cfg = tr.cfg, BL = vh.len - 8, HW = 18.5, RH = HW - 6, x;
    var mr0 = -BL / 2 + 25, mr1 = BL / 2 - 27;      // machine room extent

    solebar(ctx, BL, HW);
    ctx.fillStyle = bodyGradient(ctx, HW, cfg.body);
    rr(ctx, -BL / 2, -HW, BL, HW * 2, 5.5); ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(mr0, -HW + 1.4, mr1 - mr0, 4.8);
    ctx.fillRect(mr0,  HW - 6.2, mr1 - mr0, 4.8);
    ctx.strokeStyle = 'rgba(196,206,218,.24)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (x = mr0 + 2; x < mr1 - 1; x += 3.6) {
      ctx.moveTo(x, -HW + 1.8); ctx.lineTo(x, -HW + 5.8);
      ctx.moveTo(x,  HW - 5.8); ctx.lineTo(x,  HW - 1.8);
    }
    ctx.stroke();

    ctx.fillStyle = cfg.stripe;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-BL / 2 + 4, -HW + 6.8, BL - 8, 1.8);
    ctx.fillRect(-BL / 2 + 4,  HW - 8.6, BL - 8, 1.8);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,.5)';
    rr(ctx, mr0 - 1, -RH - 0.9, mr1 - mr0 + 2, RH * 2 + 1.8, 3.5); ctx.fill();
    ctx.fillStyle = roofGradient(ctx, RH, '#8e959c');
    rr(ctx, mr0, -RH, mr1 - mr0, RH * 2, 3.5); ctx.fill();
    roofRibs(ctx, mr1 - mr0, RH, 10);

    // compact equipment block amidships, clear of both pantograph wells
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    rr(ctx, -9, -RH + 2.6, 19, RH * 2 - 5.2, 2); ctx.fill();
    ctx.fillStyle = '#59626c';
    rr(ctx, -10, -RH + 2, 19, RH * 2 - 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(24,28,34,.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (x = -8; x < 8; x += 3) { ctx.moveTo(x, -RH + 3.4); ctx.lineTo(x, RH - 3.4); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.13)';
    ctx.fillRect(-10, -RH + 2, 19, 1.2);

    weather(ctx, mr1 - mr0, RH);

    ctx.save(); ctx.translate(mr1 - 22, 0); pantograph(ctx, false); ctx.restore();
    ctx.save(); ctx.translate(mr0 + 22, 0); pantograph(ctx, true);  ctx.restore();

    specular(ctx, BL, RH);

    cabEnd(ctx, BL, HW, cfg, true,  true,  true);
    cabEnd(ctx, BL, HW, cfg, false, false, true);
    buffers(ctx, -BL / 2 - 0.5, -1);
  }

  /* Diesel locomotive: long hood, radiator fans, exhaust, walkways. */
  function drawDieselLoco(ctx, tr, vh) {
    var BL = vh.len - 8, HW = 18.5, RH = HW - 5.5, x;

    solebar(ctx, BL, HW);
    ctx.fillStyle = bodyGradient(ctx, HW, '#3c434b');
    rr(ctx, -BL / 2, -HW, BL, HW * 2, 5); ctx.fill();

    // running plate walkways down both sides
    ctx.fillStyle = 'rgba(198,206,216,.13)';
    ctx.fillRect(-BL / 2 + 5, -HW + 1.2, BL - 10, 3.4);
    ctx.fillRect(-BL / 2 + 5,  HW - 4.6, BL - 10, 3.4);

    // the long hood
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rr(ctx, -BL / 2 + 7, -RH - 0.8, BL * 0.56, RH * 2 + 1.6, 3); ctx.fill();
    ctx.fillStyle = roofGradient(ctx, RH, '#5a636c');
    rr(ctx, -BL / 2 + 7.5, -RH, BL * 0.56, RH * 2, 3); ctx.fill();

    // radiator grilles along the hood
    ctx.strokeStyle = 'rgba(18,22,26,.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (x = -BL / 2 + 13; x < -BL / 2 + BL * 0.5; x += 4.5) {
      ctx.moveTo(x, -RH + 3); ctx.lineTo(x, RH - 3);
    }
    ctx.stroke();

    // roof fans
    [-BL * 0.30, -BL * 0.12].forEach(function (fx, i) {
      var r = i ? 7.5 : 8.5;
      ctx.fillStyle = '#22272d';
      ctx.beginPath(); ctx.arc(fx, 0, r, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#454d56';
      ctx.beginPath(); ctx.arc(fx, -0.5, r - 1.4, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(150,162,176,.45)'; ctx.lineWidth = 1;
      for (var k = 0; k < 5; k++) {
        var a = k * 1.2566;
        ctx.beginPath();
        ctx.moveTo(fx, -0.5);
        ctx.lineTo(fx + Math.cos(a) * (r - 2.2), -0.5 + Math.sin(a) * (r - 2.2));
        ctx.stroke();
      }
      ctx.fillStyle = '#20252b';
      ctx.beginPath(); ctx.arc(fx, -0.5, 1.8, 0, 6.2832); ctx.fill();
    });

    // exhaust
    ctx.fillStyle = '#15191e';
    ctx.beginPath(); ctx.arc(-BL * 0.02, 0, 4.4, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(120,130,140,.45)';
    ctx.beginPath(); ctx.arc(-BL * 0.02, -0.4, 2.4, 0, 6.2832); ctx.fill();

    weather(ctx, BL * 0.56, RH);

    // cab block, warning yellow, toward the leading end
    ctx.fillStyle = shade('#c9a227', -0.04);
    rr(ctx, BL * 0.12, -HW + 1.4, BL * 0.38 - 1, HW * 2 - 2.8, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(BL * 0.12, -1.6, BL * 0.38 - 1, 1.4);
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(BL * 0.12, -HW + 1.4, BL * 0.38 - 1, 1.6);

    cabEnd(ctx, BL, HW, { body: '#c9a227' }, true, true, true);
    buffers(ctx, -BL / 2 - 0.5, -1);

    // handrails
    ctx.strokeStyle = 'rgba(232,238,244,.32)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-BL / 2 + 9, -HW + 2.6); ctx.lineTo(BL / 2 - 9, -HW + 2.6);
    ctx.moveTo(-BL / 2 + 9,  HW - 2.6); ctx.lineTo(BL / 2 - 9,  HW - 2.6);
    ctx.stroke();
  }

  function drawWagon(ctx, tr, vh) {
    var BL = vh.len - 11, HW = 16, kind = vh.load;
    var rnd = RY.rng(tr.seed + vh.idx * 977), j, x, y;

    ctx.fillStyle = '#1e232a';
    rr(ctx, -BL / 2 - 2, -HW - 1.4, BL + 4, HW * 2 + 2.8, 3); ctx.fill();

    if (kind === 0) {                       // open hopper, loaded with aggregate
      ctx.fillStyle = '#5b4a3a';
      rr(ctx, -BL / 2, -HW, BL, HW * 2, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(-BL / 2, -HW, BL, 1.6);
      ctx.fillStyle = '#2a241e';
      rr(ctx, -BL / 2 + 4.5, -HW + 4.5, BL - 9, HW * 2 - 9, 2); ctx.fill();
      for (j = 0; j < 120; j++) {
        x = -BL / 2 + 6 + rnd() * (BL - 12);
        y = -HW + 6 + rnd() * (HW * 2 - 12);
        ctx.fillStyle = ['#4a4238', '#5d5548', '#39332b', '#6d6454'][(rnd() * 4) | 0];
        ctx.beginPath(); ctx.arc(x, y, 1 + rnd() * 1.9, 0, 6.2832); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4;
      ctx.strokeRect(-BL / 2 + 4.5, -HW + 4.5, BL - 9, HW * 2 - 9);
      ctx.strokeStyle = 'rgba(120,104,84,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (x = -BL / 2 + 12; x < BL / 2 - 6; x += 12) {
        ctx.moveTo(x, -HW + 1); ctx.lineTo(x, -HW + 4.2);
        ctx.moveTo(x,  HW - 4.2); ctx.lineTo(x,  HW - 1);
      }
      ctx.stroke();
    } else if (kind === 1) {                // tank wagon
      ctx.fillStyle = '#343a41';
      rr(ctx, -BL / 2, -HW, BL, HW * 2, 3); ctx.fill();
      var tg = ctx.createLinearGradient(0, -HW, 0, HW);
      tg.addColorStop(0.00, '#3f464d');
      tg.addColorStop(0.34, '#9aa3ac');
      tg.addColorStop(0.47, '#ccd4dc');
      tg.addColorStop(0.62, '#8e97a0');
      tg.addColorStop(1.00, '#333a41');
      ctx.fillStyle = tg;
      rr(ctx, -BL / 2 + 6, -HW + 2.5, BL - 12, HW * 2 - 5, HW - 3); ctx.fill();
      ctx.strokeStyle = 'rgba(30,36,42,.45)'; ctx.lineWidth = 1;
      ctx.beginPath();
      [-BL * 0.26, BL * 0.26].forEach(function (xx) {
        ctx.moveTo(xx, -HW + 3.4); ctx.lineTo(xx, HW - 3.4);
      });
      ctx.stroke();
      ctx.fillStyle = '#262c33';                       // manhole
      ctx.beginPath(); ctx.arc(0, -1, 4.6, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#5a636c';
      ctx.beginPath(); ctx.arc(0, -1.4, 3, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#8d3a2c';                       // hazard placards
      ctx.fillRect(-BL * 0.40, -3.5, 7, 7);
      ctx.fillRect(BL * 0.40 - 7, -3.5, 7, 7);
    } else {                                // container flat
      ctx.fillStyle = '#373d44';
      rr(ctx, -BL / 2, -HW, BL, HW * 2, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(-BL / 2, -HW, BL, 1.4);
      var cols = ['#b3542f', '#2f6f8f', '#5c8a3a', '#8a8f96', '#a8952f'];
      for (j = 0; j < 2; j++) {
        var c = cols[(rnd() * 5) | 0], cw = BL / 2 - 7;
        var cx = -BL / 2 + 5 + j * (cw + 4);
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        rr(ctx, cx + 1.6, -HW + 5, cw, HW * 2 - 9, 1.5); ctx.fill();
        ctx.fillStyle = c;
        rr(ctx, cx, -HW + 4, cw, HW * 2 - 9, 1.5); ctx.fill();
        ctx.fillStyle = shade(c, 0.30);
        ctx.fillRect(cx, -HW + 4, cw, 2.4);
        ctx.fillStyle = shade(c, -0.35);
        ctx.fillRect(cx, HW - 6.4, cw, 1.4);
        ctx.strokeStyle = 'rgba(0,0,0,.26)'; ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (x = cx + 3; x < cx + cw - 1; x += 4) {
          ctx.moveTo(x, -HW + 6.5); ctx.lineTo(x, HW - 6);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.5)';        // owner marking
        ctx.fillRect(cx + cw * 0.3, -1.6, cw * 0.4, 1.4);
      }
    }
    buffers(ctx, -BL / 2 - 0.5, -1);
    buffers(ctx,  BL / 2 + 0.5,  1);
  }

  var RENDER = {
    emu: drawEmuCar, coach: drawCoach,
    eloco: drawElectricLoco, dloco: drawDieselLoco, wagon: drawWagon
  };

  /* ---------------- consist-level drawing ---------------- */

  /* Two shadow layers: a soft one offset down-right, and a tight contact
     shadow right under the solebar. */
  RY.drawTrainShadow = function (ctx, tr) {
    var i, vh, cs, p, HW;
    ctx.save();
    for (i = 0; i < tr.vehicles.length; i++) {
      vh = tr.vehicles[i];
      cs = tr.s - vh.mid;
      if (cs < 0) continue;
      p = RY.pathAt(tr.path, cs);
      if (p.x < -180 || p.x > RY.W + 180) continue;
      HW = vh.kind === 'wagon' ? 16 : vh.kind === 'dloco' ? 18.5 : vh.kind === 'eloco' ? 18 : 17;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      rr(ctx, -vh.len / 2 + 4, -HW + 6, vh.len - 8, HW * 2, 8); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.34)';
      rr(ctx, -vh.len / 2 + 6, -HW + 2, vh.len - 12, HW * 2, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  RY.drawTrain = function (ctx, tr, night) {
    var i, vh, cs, p, fn;
    for (i = 0; i < tr.vehicles.length; i++) {
      vh = tr.vehicles[i];
      cs = tr.s - vh.mid;
      if (cs < 0) continue;
      p = RY.pathAt(tr.path, cs);
      if (p.x < -180 || p.x > RY.W + 180) continue;
      fn = RENDER[vh.kind];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      fn(ctx, tr, vh, night);
      ctx.restore();
    }
  };

  /* Head- and tail-lamp glow, drawn additively for the night shifts. */
  RY.drawTrainLights = function (ctx, tr, night) {
    if (night < 0.05) return;
    var p = RY.pathAt(tr.path, tr.s), g, r = 130 + tr.v * 0.55;
    if (p.x < -220 || p.x > RY.W + 220) return;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.a);
    g = ctx.createRadialGradient(6, 0, 2, 6, 0, r);
    g.addColorStop(0, 'rgba(255,244,206,' + (0.55 * night + 0.12) + ')');
    g.addColorStop(0.25, 'rgba(255,236,180,' + (0.16 * night) + ')');
    g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(r, -r * 0.32);
    ctx.lineTo(r,  r * 0.32);
    ctx.lineTo(0,  14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    var t = RY.pathAt(tr.path, Math.max(0, tr.s - tr.len));
    ctx.save();
    ctx.translate(t.x, t.y);
    g = ctx.createRadialGradient(0, 0, 1, 0, 0, 26);
    g.addColorStop(0, 'rgba(255,70,50,' + (0.5 * night) + ')');
    g.addColorStop(1, 'rgba(255,60,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, 6.2832); ctx.fill();
    ctx.restore();
  };
})(window);
