/* ------------------------------------------------------------------
   geom.js — track layout, path construction, arc-length maths
   Everything is expressed in a fixed logical space (W x H) that the
   renderer scales to fit the viewport.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY = root.RY || {};

  RY.W = 1920;
  RY.H = 1080;

  /* Layout constants -------------------------------------------------
     Left-hand running: eastbound trains live on MAIN_B (the lower
     main), westbound trains on MAIN_A (the upper main).  A train's
     whole journey therefore stays on one main throughout.
     Values here are placeholders, overwritten in place by applyStation()
     below — kept as a real object/array (not reassigned wholesale) so
     every other module's `var L = RY.LAY` / `var T = RY.TRACKS`, taken
     once at load, keeps pointing at live data after a station switch. */
  var LAY = RY.LAY = {
    xWestEnd: 0, xWestHome: 0, xThroatW: 0, xThroatE: 0,
    xEastHome: 0, xEastEnd: 0, mainA: 0, mainB: 0, stopX: 0, maxDiv: 136,
    terminus: false
  };
  RY.TRACKS = [];
  RY.ISLANDS = [];
  RY.YARD = [];   /* stabling roads — only populated for a terminus station */

  /* A platform is exactly as long as the train it can hold, so the
     capacity of a road is something you can see rather than remember.
     One car pitch is PLAT_UNIT; the extra is the overhang at each end.
     A terminus platform has nothing symmetric about it — every road's
     rail genuinely ends at the buffer, so its span hangs off the shared
     throat anchor (xThroatE) rather than centring on stopX like a
     through platform does. */
  RY.PLAT_UNIT = 112;
  RY.platSpan = function (t) {
    if (LAY.terminus) {
      var len = t.maxCars * RY.PLAT_UNIT + 44;
      return { x0: LAY.xThroatE - len, x1: LAY.xThroatE, len: len };
    }
    var half = (t.maxCars * RY.PLAT_UNIT + 44) / 2;
    return { x0: LAY.stopX - half, x1: LAY.stopX + half, len: half * 2 };
  };

  /* The stretch of deck both faces share — where the canopy can go. */
  RY.islandCore = function (isl) {
    var u = RY.platSpan(isl.upper), l = RY.platSpan(isl.lower);
    return { x0: Math.max(u.x0, l.x0), x1: Math.min(u.x1, l.x1) };
  };

  /* ---- stations ----------------------------------------------------
     Each entry is just its roads, top to bottom, and which adjacent
     pairs of them share an island deck. Everything geometric — where
     the mains and throats actually sit, how far apart the roads are —
     is worked out fresh for the road count and the longest platform,
     rather than hand-placed per station, so a new one is just a list
     of roads away. */
  RY.STATIONS = [
    {
      id: 'kingsbridge', name: 'Kingsbridge Central', difficulty: 'Standard',
      blurb: 'The mainline hub — one through road, two islands either side.',
      tracks: [
        { short: 'TL', name: 'Through Road', maxCars: 8, platform: false },
        { short: 'P1', name: 'Platform 1',   maxCars: 5, platform: true  },
        { short: 'P2', name: 'Platform 2',   maxCars: 5, platform: true  },
        { short: 'P3', name: 'Platform 3',   maxCars: 4, platform: true  },
        { short: 'P4', name: 'Platform 4',   maxCars: 3, platform: true  }
      ],
      islands: [[1, 2], [3, 4]]
    },
    {
      id: 'bramwell', name: 'Bramwell Halt', difficulty: 'Beginner',
      blurb: 'A quiet branch terminus — one siding, one island. Learn the board here.',
      tracks: [
        { short: 'TL', name: 'Through Siding', maxCars: 6, platform: false },
        { short: 'P1', name: 'Platform 1',     maxCars: 5, platform: true  },
        { short: 'P2', name: 'Platform 2',     maxCars: 4, platform: true  }
      ],
      islands: [[1, 2]]
    },
    {
      id: 'northgate', name: 'Northgate Junction', difficulty: 'Advanced',
      blurb: 'Where three lines meet — three islands flank a busy through road.',
      tracks: [
        { short: 'TL', name: 'Through Road', maxCars: 8, platform: false },
        { short: 'P1', name: 'Platform 1',   maxCars: 6, platform: true  },
        { short: 'P2', name: 'Platform 2',   maxCars: 6, platform: true  },
        { short: 'P3', name: 'Platform 3',   maxCars: 5, platform: true  },
        { short: 'P4', name: 'Platform 4',   maxCars: 5, platform: true  },
        { short: 'P5', name: 'Platform 5',   maxCars: 4, platform: true  },
        { short: 'P6', name: 'Platform 6',   maxCars: 4, platform: true  }
      ],
      islands: [[1, 2], [3, 4], [5, 6]]
    },
    {
      id: 'selby', name: 'Selby Yard', difficulty: 'Standard',
      blurb: 'Heavy freight country — a through road at each end, one island between.',
      tracks: [
        { short: 'TL1', name: 'Up Through',   maxCars: 10, platform: false },
        { short: 'P1',  name: 'Platform 1',   maxCars: 5,  platform: true  },
        { short: 'P2',  name: 'Platform 2',   maxCars: 5,  platform: true  },
        { short: 'TL2', name: 'Down Through', maxCars: 9,  platform: false }
      ],
      islands: [[1, 2]]
    },
    /* A terminus, not a through station: every road dead-ends against the
       concourse on the west, so there is no "through" traffic and nothing
       ever exits east — east instead leads to a stabling yard, and every
       working either starts there (a departure being formed and boarded)
       or ends there (an arrival stabled once it's unloaded). See
       layoutStation()'s terminus branch and applyStation() for the yard
       geometry, and game.js's timetable scheduler for how services move
       between the two. Platform count, relative lengths and names follow
       MGR Chennai Central's real 12 mainline platforms (1, 2, 2A, 3–11);
       the exact pointwork and the day's real service list aren't public
       data, so both are a faithful, clearly-not-authoritative likeness
       rather than a survey-accurate one. */
    {
      id: 'mgrchennai', name: 'MGR Chennai Central', difficulty: 'Advanced', terminus: true, yard: 6,
      blurb: 'A real terminus, in miniature — twelve dead-end platforms and a stabling yard.',
      tracks: [
        { short: '1',  name: 'Platform 1',  maxCars: 7, platform: true },
        { short: '2',  name: 'Platform 2',  maxCars: 7, platform: true },
        { short: '2A', name: 'Platform 2A', maxCars: 5, platform: true },
        { short: '3',  name: 'Platform 3',  maxCars: 7, platform: true },
        { short: '4',  name: 'Platform 4',  maxCars: 7, platform: true },
        { short: '5',  name: 'Platform 5',  maxCars: 7, platform: true },
        { short: '6',  name: 'Platform 6',  maxCars: 7, platform: true },
        { short: '7',  name: 'Platform 7',  maxCars: 7, platform: true },
        { short: '8',  name: 'Platform 8',  maxCars: 7, platform: true },
        { short: '9',  name: 'Platform 9',  maxCars: 7, platform: true },
        { short: '10', name: 'Platform 10', maxCars: 7, platform: true },
        { short: '11', name: 'Platform 11', maxCars: 7, platform: true }
      ],
      islands: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]],
      /* A representative morning service block, not a live or authoritative
         one — Indian Railways doesn't publish a fixed train-to-platform
         pairing (platforms are assigned on the day, which is exactly the
         job here), and transcribing the real current timetable isn't
         something that can be done reliably by hand. Names are real routes
         Chennai Central actually runs; times are illustrative. dir:1 is an
         arrival off the network, into a platform, bound for the yard once
         unloaded; dir:-1 is a departure, forming in the yard `prep`
         minutes ahead of its booked time so there's a real window to call
         it forward and board it. */
      timetable: [
        { t: 372, dir:  1, type: 'sleeper',   name: 'Chennai–Howrah Mail' },
        { t: 390, dir: -1, type: 'intercity', name: 'Chennai–Bengaluru Shatabdi', prep: 30 },
        { t: 405, dir:  1, type: 'express',   name: 'Chennai–Tirupati Express' },
        { t: 420, dir: -1, type: 'sleeper',   name: 'Chennai–Delhi Tamil Nadu Express', prep: 40 },
        { t: 438, dir:  1, type: 'intercity', name: 'Chennai–Coimbatore Kovai Express' },
        { t: 452, dir: -1, type: 'express',   name: 'Chennai–Vijayawada Express', prep: 28 },
        { t: 468, dir:  1, type: 'sleeper',   name: 'Mumbai CST–Chennai Mail' },
        { t: 486, dir: -1, type: 'sleeper',   name: 'Chennai–Delhi GT Express', prep: 42 },
        { t: 502, dir:  1, type: 'express',   name: 'Chennai–Tirupati Express' },
        { t: 518, dir: -1, type: 'intercity', name: 'Chennai–Mysuru Shatabdi', prep: 30 },
        { t: 535, dir:  1, type: 'sleeper',   name: 'Howrah–Chennai Coromandel Express' },
        { t: 552, dir: -1, type: 'express',   name: 'Chennai–Coimbatore Express', prep: 26 },
        { t: 568, dir:  1, type: 'intercity', name: 'Chennai–Hyderabad Charminar Express' },
        { t: 585, dir: -1, type: 'sleeper',   name: 'Chennai–Trivandrum Mail', prep: 38 },
        { t: 602, dir:  1, type: 'express',   name: 'Chennai–Vijayawada Express' },
        { t: 620, dir: -1, type: 'sleeper',   name: 'Chennai–Howrah Mail', prep: 40 },
        { t: 638, dir:  1, type: 'sleeper',   name: 'Delhi–Chennai Tamil Nadu Express' },
        { t: 655, dir: -1, type: 'express',   name: 'Chennai–Tirupati Express', prep: 24 },
        { t: 672, dir:  1, type: 'intercity', name: 'Chennai–Bengaluru Mail' },
        { t: 690, dir: -1, type: 'sleeper',   name: 'Chennai–Mumbai CST Mail', prep: 40 },
        { t: 708, dir:  1, type: 'sleeper',   name: 'Trivandrum–Chennai Mail' },
        { t: 726, dir: -1, type: 'intercity', name: 'Chennai–Coimbatore Kovai Express', prep: 28 }
      ]
    }
  ];

  var CENTER_Y = 555, TRACK_GAP = 130, BAND_HALF = 300, STOP_X = 920;

  /* A terminus is not a reshaped through station: every road dead-ends at
     a buffer stop on the west, and the single throat — on the east —
     carries both the network approach and the stabling yard, exactly as
     a real terminus like MGR Chennai Central does (all access from one
     side). xThroatE is the one anchor every platform's rail actually
     touches; each platform's own length (not a shared symmetric span)
     decides how far west of it the buffer sits — see RY.platSpan. Chosen
     to leave every platform, even the longest, clear of the lineside
     signal box scene.js draws near the west edge. */
  var TERM_THROAT_X = 1120, TERM_HOME_GAP = 170, TERM_YARD_GAP = 96;

  /* Every road, whatever the station, connects to its throat/mains through
     a ladder of the same kind — only the road count and the longest
     platform change how far apart things need to be. */
  function layoutStation(def) {
    var n = def.tracks.length;
    var gap = Math.min(TRACK_GAP, (2 * BAND_HALF) / Math.max(1, n - 1));
    var top = CENTER_Y - (n - 1) * gap / 2;
    var tracks = def.tracks.map(function (t, i) {
      return {
        id: i, y: top + i * gap, name: t.name, label: t.short, short: t.short,
        maxCars: t.maxCars, platform: t.platform
      };
    });
    var maxPlatCars = 4;
    tracks.forEach(function (t) { if (t.platform) maxPlatCars = Math.max(maxPlatCars, t.maxCars); });
    var half = (maxPlatCars * RY.PLAT_UNIT + 44) / 2;
    var stopX = STOP_X;
    var lay, yard = [];

    if (def.terminus) {
      var xThroatE = TERM_THROAT_X;
      var xEastHome = xThroatE + TERM_HOME_GAP;
      // xWestEnd/xWestHome/xThroatW have no physical meaning here — there
      // is no west throat — but every other module keeps a live `var L =
      // RY.LAY` taken once at load, so these still need real values (not
      // undefined) in case anything reads them generically. Mirroring the
      // east side makes any such read a harmless no-op rather than a
      // crash or a stale value left over from a previously-loaded station.
      lay = {
        xWestEnd: xEastHome, xWestHome: xEastHome,
        xThroatW: xThroatE, xThroatE: xThroatE,
        xEastHome: xEastHome, xEastEnd: xEastHome + 900,
        mainA: CENTER_Y - 50, mainB: CENTER_Y + 50,
        stopX: stopX, maxDiv: 136, terminus: true
      };
      lay.yardNear = xEastHome + 40;    // where a shunt move first leaves the main
      lay.yardFar = RY.W - 60;          // how far into the yard a stabled train sits
      var yn = def.yard || 6;
      var ygap = Math.min(TERM_YARD_GAP, (2 * BAND_HALF) / Math.max(1, yn - 1));
      var ytop = CENTER_Y - (yn - 1) * ygap / 2;
      for (var yi = 0; yi < yn; yi++) {
        yard.push({ id: yi, y: ytop + yi * ygap, maxCars: 7, occupant: null });
      }
    } else {
      var homeGap = 340;
      var xThroatW = stopX - half - 90, xThroatE = stopX + half + 90;
      var xWestHome = xThroatW - homeGap, xEastHome = xThroatE + homeGap;
      lay = {
        xWestEnd: xWestHome - 900, xWestHome: xWestHome,
        xThroatW: xThroatW, xThroatE: xThroatE,
        xEastHome: xEastHome, xEastEnd: xEastHome + 900,
        mainA: CENTER_Y - 50, mainB: CENTER_Y + 50,
        stopX: stopX, maxDiv: 136, terminus: false
      };
    }

    var islands = def.islands.map(function (pair) {
      var a = tracks[pair[0]], b = tracks[pair[1]];
      var upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
      return { y0: upper.y + 25, y1: lower.y - 25, upper: upper, lower: lower };
    });

    return { lay: lay, tracks: tracks, islands: islands, yard: yard };
  }

  /* Switch the whole game over to a different station's geometry. LAY,
     TRACKS, ISLANDS and YARD are mutated in place — see the comment on
     LAY above — so this is safe to call any time nothing is currently
     running (the caller re-bakes the scene and resets play state). */
  RY.applyStation = function (id) {
    var def = null, i;
    for (i = 0; i < RY.STATIONS.length; i++) if (RY.STATIONS[i].id === id) def = RY.STATIONS[i];
    if (!def) def = RY.STATIONS[0];
    var geo = layoutStation(def);

    Object.keys(geo.lay).forEach(function (k) { LAY[k] = geo.lay[k]; });
    RY.TRACKS.length = 0;
    geo.tracks.forEach(function (t) { RY.TRACKS.push(t); });
    RY.ISLANDS.length = 0;
    geo.islands.forEach(function (isl) { RY.ISLANDS.push(isl); });
    RY.YARD.length = 0;
    geo.yard.forEach(function (y) { RY.YARD.push(y); });

    RY.crossTable = buildCrossTable();
    RY.station = def;
    return def;
  };

  /* A direct shunt curve between two points a train is stationary at —
     the platform<->yard move at a terminus, in either direction. Both
     ends are always at rest when this is built (an arrival has finished
     dwelling; a departure hasn't moved since it was formed), so unlike
     the mainline paths above this never needs to preserve a train's
     existing position on the curve — it always starts fresh at s=0. */
  RY.shuntCurve = function (x0, y0, x1, y1) {
    return RY.makePath(RY.sCurve(x0, y0, x1, y1, 60));
  };

  /* Transition curves are chorded finely enough that a vehicle never
     crosses more than a fraction of a degree per frame. */
  var CURVE_N = 128;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * t * (t * (t * 6 - 15) + 10); }   // quintic ease
  RY.lerp = lerp;

  /* Turnouts are staggered down the throat, as they are on the ground:
     the road that has furthest to travel leaves the main first, the
     one running almost parallel leaves last. */
  RY.divOff = function (mainY, trackY) {
    var d = Math.abs(trackY - mainY);
    return 12 + (1 - Math.min(1, d / 320)) * 124;
  };

  /* A prototypical turnout plus transition curve. */
  RY.sCurve = function (x0, y0, x1, y1, n) {
    var pts = [], i, t;
    for (i = 0; i <= n; i++) {
      t = i / n;
      pts.push({ x: lerp(x0, x1, t), y: lerp(y0, y1, smooth(t)) });
    }
    return pts;
  };

  /* Wrap a raw point list into a path with cumulative arc length. */
  RY.makePath = function (pts) {
    var cum = [0], i, dx, dy;
    for (i = 1; i < pts.length; i++) {
      dx = pts[i].x - pts[i - 1].x;
      dy = pts[i].y - pts[i - 1].y;
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    return { pts: pts, cum: cum, len: cum[cum.length - 1] };
  };

  function cat(dst, src, skipFirst) {
    for (var i = skipFirst ? 1 : 0; i < src.length; i++) dst.push(src[i]);
  }

  function trackAtY(trackY) {
    for (var i = 0; i < RY.TRACKS.length; i++) if (RY.TRACKS[i].y === trackY) return RY.TRACKS[i];
    return null;
  }

  /* Full journey: off-stage -> home signal -> throat -> road -> throat
     -> off-stage.  Arc length from the start to the home signal is the
     same on every road, so a waiting train can be re-routed in place.

     A terminus has no far side to run out to — every road dead-ends at
     its own buffer (see RY.platSpan) — so both directions here share the
     one east throat instead of using opposite ones: dir>0 (an arrival)
     runs off-stage-east -> home -> throat -> buffer; dir<0 (a departure,
     already sitting at its buffer once routeTo() has shunted it there)
     runs the same points in reverse, buffer -> throat -> home ->
     off-stage-east. Arc length still only ever increases in the
     direction of travel — it's simply increasing x for one stream and
     decreasing x for the other, which every consumer of a path (sAtX,
     posAt, the crossing table) already treats as no more than "a
     monotonic coordinate", never assuming which way it runs. */
  RY.buildPath = function (dir, trackY) {
    var p = [], my = dir > 0 ? LAY.mainB : LAY.mainA;
    var off = RY.divOff(my, trackY);
    if (LAY.terminus) {
      var trk = trackAtY(trackY);
      var bufX = trk ? RY.platSpan(trk).x0 : LAY.xThroatE - 700;
      if (dir > 0) {
        p.push({ x: LAY.xEastEnd, y: my }, { x: LAY.xEastHome, y: my },
               { x: LAY.xEastHome - off, y: my });
        cat(p, RY.sCurve(LAY.xEastHome - off, my, LAY.xThroatE, trackY, CURVE_N), true);
        p.push({ x: bufX, y: trackY });
      } else {
        p.push({ x: bufX, y: trackY }, { x: LAY.xThroatE, y: trackY });
        cat(p, RY.sCurve(LAY.xThroatE, trackY, LAY.xEastHome - off, my, CURVE_N), true);
        p.push({ x: LAY.xEastHome, y: my }, { x: LAY.xEastEnd, y: my });
      }
      return RY.makePath(p);
    }
    if (dir > 0) {
      p.push({ x: LAY.xWestEnd, y: my }, { x: LAY.xWestHome, y: my },
             { x: LAY.xWestHome + off, y: my });
      cat(p, RY.sCurve(LAY.xWestHome + off, my, LAY.xThroatW, trackY, CURVE_N), true);
      p.push({ x: LAY.xThroatE, y: trackY });
      cat(p, RY.sCurve(LAY.xThroatE, trackY, LAY.xEastHome - off, my, CURVE_N), true);
      p.push({ x: LAY.xEastHome, y: my }, { x: LAY.xEastEnd, y: my });
    } else {
      p.push({ x: LAY.xEastEnd, y: my }, { x: LAY.xEastHome, y: my },
             { x: LAY.xEastHome - off, y: my });
      cat(p, RY.sCurve(LAY.xEastHome - off, my, LAY.xThroatE, trackY, CURVE_N), true);
      p.push({ x: LAY.xThroatW, y: trackY });
      cat(p, RY.sCurve(LAY.xThroatW, trackY, LAY.xWestHome + off, my, CURVE_N), true);
      p.push({ x: LAY.xWestHome, y: my }, { x: LAY.xWestEnd, y: my });
    }
    return RY.makePath(p);
  };

  /* Position at arc length s. */
  RY.posAt = function (P, s, out) {
    var cum = P.cum, lo = 0, hi = cum.length - 1, mid, p0, p1, seg, t;
    if (s <= 0) s = 0;
    if (s >= P.len) s = P.len;
    while (lo < hi - 1) {
      mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    p0 = P.pts[lo]; p1 = P.pts[lo + 1];
    seg = cum[lo + 1] - cum[lo];
    t = seg > 0 ? (s - cum[lo]) / seg : 0;
    out = out || {};
    out.x = p0.x + (p1.x - p0.x) * t;
    out.y = p0.y + (p1.y - p0.y) * t;
    return out;
  };

  /* Position plus heading.  The heading comes from a centred difference
     over a short span of the path rather than from the chord the point
     happens to sit on, so it varies continuously as a vehicle runs — a
     chord-angle tangent makes the stock snap round in steps. */
  var TAN_D = 7, _ta = {}, _tb = {};
  RY.pathAt = function (P, s) {
    var p = RY.posAt(P, s);
    var a = RY.posAt(P, Math.max(0, s - TAN_D), _ta);
    var b = RY.posAt(P, Math.min(P.len, s + TAN_D), _tb);
    p.a = Math.atan2(b.y - a.y, b.x - a.x);
    return p;
  };

  /* Arc length at which the path first reaches x = X (paths are x-monotonic). */
  RY.sAtX = function (P, X) {
    var pts = P.pts, i, a, b, t;
    for (i = 1; i < pts.length; i++) {
      a = pts[i - 1]; b = pts[i];
      if ((a.x - X) * (b.x - X) <= 0 && a.x !== b.x) {
        t = (X - a.x) / (b.x - a.x);
        return P.cum[i - 1] + (P.cum[i] - P.cum[i - 1]) * t;
      }
    }
    return (pts[0].x < X) ? P.len : 0;
  };

  RY.xAt = function (P, s) { return RY.pathAt(P, s).x; };

  /* Whether two simultaneous routes through the same throat actually foul
     each other — not merely sweep the same band of y values, which two
     curves can do at entirely different x and never come near each other.
     A dir>0 route and a dir<0 route genuinely collide only if, somewhere
     across the x-span they share inside the throat, one curve is above the
     other at one end and below it at the other — an honest sign change,
     found by sampling both curves rather than approximating them.
     There are only 5x5 road pairings per throat, and none of this moves,
     so it's worked out once, from the real geometry, rather than re-derived
     every time a train asks. */
  function curvesCross(dirA, roadYA, dirB, roadYB, lo, hi) {
    var Pa = RY.buildPath(dirA, roadYA), Pb = RY.buildPath(dirB, roadYB);
    var n = 30, i, x, above, prevAbove = null;
    for (i = 0; i <= n; i++) {
      x = lo + (hi - lo) * i / n;
      above = RY.pathAt(Pa, RY.sAtX(Pa, x)).y > RY.pathAt(Pb, RY.sAtX(Pb, x)).y;
      if (prevAbove !== null && above !== prevAbove) return true;
      prevAbove = above;
    }
    return false;
  }
  function buildCrossTable() {
    var sides = { W: [LAY.xWestHome, LAY.xThroatW], E: [LAY.xThroatE, LAY.xEastHome] };
    var table = {}, side, span, lo, hi, i, j;
    for (side in sides) {
      span = sides[side];
      lo = Math.min(span[0], span[1]); hi = Math.max(span[0], span[1]);
      table[side] = [];
      for (i = 0; i < RY.TRACKS.length; i++) {
        table[side][i] = [];
        for (j = 0; j < RY.TRACKS.length; j++) {
          // table[side][i][j]: does the dir>0 route to road i cross the
          // dir<0 route to road j, within this throat?
          table[side][i][j] = curvesCross(1, RY.TRACKS[i].y, -1, RY.TRACKS[j].y, lo, hi);
        }
      }
    }
    return table;
  }
  RY.crossTable = buildCrossTable();

  /* Offset a path sideways by d (used for the two running rails). */
  RY.offsetPath = function (P, d) {
    var pts = P.pts, out = [], i, nx, ny, ax, ay, bx, by, len;
    for (i = 0; i < pts.length; i++) {
      ax = pts[Math.max(0, i - 1)].x; ay = pts[Math.max(0, i - 1)].y;
      bx = pts[Math.min(pts.length - 1, i + 1)].x; by = pts[Math.min(pts.length - 1, i + 1)].y;
      nx = -(by - ay); ny = (bx - ax);
      len = Math.sqrt(nx * nx + ny * ny) || 1;
      out.push({ x: pts[i].x + nx / len * d, y: pts[i].y + ny / len * d });
    }
    return out;
  };

  /* Deterministic PRNG so the ballast texture never shimmers. */
  RY.rng = function (seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  };

  /* ---- the static segment list used to draw the permanent way ---- */
  RY.buildTrackwork = function () {
    var segs = [], t, i, offA, offB;

    // Main-line tails, running as far as the last turnout in each throat.
    // A terminus has no west throat at all — its roads dead-end at their
    // own buffer (see the platform-roads loop below) rather than tailing
    // off toward an off-stage west.
    if (!LAY.terminus) {
      segs.push(RY.makePath([{ x: LAY.xWestEnd, y: LAY.mainA }, { x: LAY.xWestHome + LAY.maxDiv, y: LAY.mainA }]));
      segs.push(RY.makePath([{ x: LAY.xWestEnd, y: LAY.mainB }, { x: LAY.xWestHome + LAY.maxDiv, y: LAY.mainB }]));
    }
    segs.push(RY.makePath([{ x: LAY.xEastHome - LAY.maxDiv, y: LAY.mainA }, { x: LAY.xEastEnd, y: LAY.mainA }]));
    segs.push(RY.makePath([{ x: LAY.xEastHome - LAY.maxDiv, y: LAY.mainB }, { x: LAY.xEastEnd, y: LAY.mainB }]));

    // Platform roads — a through road's rail runs the full throat-to-throat
    // width regardless of the shorter deck alongside it; a terminus road's
    // rail genuinely ends at its own buffer, so it's only as long as
    // RY.platSpan says this particular platform is.
    for (i = 0; i < RY.TRACKS.length; i++) {
      t = RY.TRACKS[i];
      var west = LAY.terminus ? RY.platSpan(t).x0 : LAY.xThroatW;
      segs.push(RY.makePath([{ x: west, y: t.y }, { x: LAY.xThroatE, y: t.y }]));
    }

    // The throat ladder: every road connected to both mains. A terminus
    // only ever plays the east throat — see buildPath.
    for (i = 0; i < RY.TRACKS.length; i++) {
      t = RY.TRACKS[i];
      offA = RY.divOff(LAY.mainA, t.y);
      offB = RY.divOff(LAY.mainB, t.y);
      if (!LAY.terminus) {
        segs.push(RY.makePath(RY.sCurve(LAY.xWestHome + offA, LAY.mainA, LAY.xThroatW, t.y, CURVE_N)));
        segs.push(RY.makePath(RY.sCurve(LAY.xWestHome + offB, LAY.mainB, LAY.xThroatW, t.y, CURVE_N)));
      }
      segs.push(RY.makePath(RY.sCurve(LAY.xThroatE, t.y, LAY.xEastHome - offA, LAY.mainA, CURVE_N)));
      segs.push(RY.makePath(RY.sCurve(LAY.xThroatE, t.y, LAY.xEastHome - offB, LAY.mainB, CURVE_N)));
    }

    // The stabling yard, terminus stations only: a fan of sidings east of
    // the home signal, each reached off both mains like any other road.
    for (i = 0; i < RY.YARD.length; i++) {
      var yr = RY.YARD[i];
      segs.push(RY.makePath([{ x: LAY.yardNear, y: yr.y }, { x: LAY.yardFar, y: yr.y }]));
      segs.push(RY.makePath(RY.sCurve(LAY.yardNear, LAY.mainA, LAY.yardNear + 90, yr.y, CURVE_N)));
      segs.push(RY.makePath(RY.sCurve(LAY.yardNear, LAY.mainB, LAY.yardNear + 90, yr.y, CURVE_N)));
    }
    return segs;
  };

  /* Boot with the default station so every other module's load-time
     reads of LAY/TRACKS see real geometry, not the zeroed placeholder. */
  RY.applyStation(RY.STATIONS[0].id);
})(window);
