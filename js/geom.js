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
    xEastHome: 0, xEastEnd: 0, mainA: 0, mainB: 0, stopX: 0, maxDiv: 136
  };
  RY.TRACKS = [];
  RY.ISLANDS = [];

  /* A platform is exactly as long as the train it can hold, so the
     capacity of a road is something you can see rather than remember.
     One car pitch is PLAT_UNIT; the extra is the overhang at each end. */
  RY.PLAT_UNIT = 112;
  RY.platSpan = function (t) {
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
    }
  ];

  var CENTER_Y = 555, TRACK_GAP = 130, BAND_HALF = 300, STOP_X = 920;

  /* Every road, whatever the station, connects to both mains through a
     ladder of the same kind — only the road count and the longest
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
    var xThroatW = STOP_X - half - 90, xThroatE = STOP_X + half + 90;
    var xWestHome = xThroatW - 340, xEastHome = xThroatE + 340;
    var lay = {
      xWestEnd: xWestHome - 900, xWestHome: xWestHome,
      xThroatW: xThroatW, xThroatE: xThroatE,
      xEastHome: xEastHome, xEastEnd: xEastHome + 900,
      mainA: CENTER_Y - 50, mainB: CENTER_Y + 50,
      stopX: STOP_X, maxDiv: 136
    };
    var islands = def.islands.map(function (pair) {
      var a = tracks[pair[0]], b = tracks[pair[1]];
      var upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
      return { y0: upper.y + 25, y1: lower.y - 25, upper: upper, lower: lower };
    });
    return { lay: lay, tracks: tracks, islands: islands };
  }

  /* Switch the whole game over to a different station's geometry. LAY,
     TRACKS and ISLANDS are mutated in place — see the comment on LAY
     above — so this is safe to call any time nothing is currently
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

    RY.crossTable = buildCrossTable();
    RY.station = def;
    return def;
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

  /* Full journey: off-stage -> home signal -> throat -> road -> throat
     -> off-stage.  Arc length from the start to the home signal is the
     same on every road, so a waiting train can be re-routed in place. */
  RY.buildPath = function (dir, trackY) {
    var p = [], my = dir > 0 ? LAY.mainB : LAY.mainA;
    var off = RY.divOff(my, trackY);
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
    segs.push(RY.makePath([{ x: LAY.xWestEnd, y: LAY.mainA }, { x: LAY.xWestHome + LAY.maxDiv, y: LAY.mainA }]));
    segs.push(RY.makePath([{ x: LAY.xWestEnd, y: LAY.mainB }, { x: LAY.xWestHome + LAY.maxDiv, y: LAY.mainB }]));
    segs.push(RY.makePath([{ x: LAY.xEastHome - LAY.maxDiv, y: LAY.mainA }, { x: LAY.xEastEnd, y: LAY.mainA }]));
    segs.push(RY.makePath([{ x: LAY.xEastHome - LAY.maxDiv, y: LAY.mainB }, { x: LAY.xEastEnd, y: LAY.mainB }]));

    // Platform roads.
    for (i = 0; i < RY.TRACKS.length; i++) {
      t = RY.TRACKS[i];
      segs.push(RY.makePath([{ x: LAY.xThroatW, y: t.y }, { x: LAY.xThroatE, y: t.y }]));
    }

    // Both throats: every road connected to both mains — the ladder.
    for (i = 0; i < RY.TRACKS.length; i++) {
      t = RY.TRACKS[i];
      offA = RY.divOff(LAY.mainA, t.y);
      offB = RY.divOff(LAY.mainB, t.y);
      segs.push(RY.makePath(RY.sCurve(LAY.xWestHome + offA, LAY.mainA, LAY.xThroatW, t.y, CURVE_N)));
      segs.push(RY.makePath(RY.sCurve(LAY.xWestHome + offB, LAY.mainB, LAY.xThroatW, t.y, CURVE_N)));
      segs.push(RY.makePath(RY.sCurve(LAY.xThroatE, t.y, LAY.xEastHome - offA, LAY.mainA, CURVE_N)));
      segs.push(RY.makePath(RY.sCurve(LAY.xThroatE, t.y, LAY.xEastHome - offB, LAY.mainB, CURVE_N)));
    }
    return segs;
  };

  /* Boot with the default station so every other module's load-time
     reads of LAY/TRACKS see real geometry, not the zeroed placeholder. */
  RY.applyStation(RY.STATIONS[0].id);
})(window);
