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
    terminus: false, ladder: null
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

  /* The stretch of deck both faces share — where the canopy can go. A side
     platform (see layoutStation) has only the one face, so it's all of it. */
  RY.islandCore = function (isl) {
    if (!isl.upper || !isl.lower) return RY.platSpan(isl.upper || isl.lower);
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
  /* Northgate's roads, shared by both versions of the station below so that
     the only thing that differs between them is how the throat is laid. */
  var NORTHGATE_ROADS = [
    { short: 'TL', name: 'Through Road', maxCars: 8, platform: false },
    { short: 'P1', name: 'Platform 1',   maxCars: 6, platform: true  },
    { short: 'P2', name: 'Platform 2',   maxCars: 6, platform: true  },
    { short: 'P3', name: 'Platform 3',   maxCars: 5, platform: true  },
    { short: 'P4', name: 'Platform 4',   maxCars: 5, platform: true  },
    { short: 'P5', name: 'Platform 5',   maxCars: 4, platform: true  },
    { short: 'P6', name: 'Platform 6',   maxCars: 4, platform: true  }
  ];

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
      tracks: NORTHGATE_ROADS,
      islands: [[1, 2], [3, 4], [5, 6]]
    },
    /* The same station with a throat laid the way a real one is. Every other
       station fans each road straight off both mains, so a main splits into
       as many lines as there are roads, all at once. Here a main only ever
       splits one way at a time: a scissors crossover lets either main reach
       either side, then each main steps outward a road at a time, every step
       a single turnout onto the next road along — see planLadder(). The
       interlocking follows the track: two moves conflict when they need the
       same turnout or piece of line, not merely when their curves cross. */
    {
      id: 'northgate-real', name: 'Northgate Junction (Realistic)', difficulty: 'Advanced',
      throat: 'ladder',
      blurb: 'The same seven roads, through a throat laid like a real one: a scissors crossover, then one turnout at a time.',
      tracks: NORTHGATE_ROADS,
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
    /* An Indian junction. Platform 1 is a side platform against the station
       building, the way it is at nearly every station in India; the islands
       beyond are numbered on across the tracks; and the two middle roads are
       platformless sidings for goods trains and expresses that don't stop.
       style: 'india' dresses the platforms, the buildings and the trains
       (see scene.js, cab.js and the services below). band pins the roads
       lower on the map than the others to leave room for the building and
       its forecourt above platform 1. A one-road entry in islands is a side
       platform, on the outside of the outermost road. */
    {
      id: 'kaveripuram', name: 'Kaveripuram Junction', code: 'KVPM', difficulty: 'Advanced',
      style: 'india', nameTamil: 'காவேரிபுரம்',
      nameHindi: 'कावेरीपुरम',
      blurb: 'An Indian junction: platform 1 against the station building, two sidings through the middle, six platforms in all.',
      band: [300, 895],
      tracks: [
        { short: 'PF1', name: 'Platform 1', maxCars: 6, platform: true  },
        { short: 'PF2', name: 'Platform 2', maxCars: 6, platform: true  },
        { short: 'PF3', name: 'Platform 3', maxCars: 5, platform: true  },
        { short: 'S1',  name: 'Siding 1',   maxCars: 8, platform: false },
        { short: 'S2',  name: 'Siding 2',   maxCars: 8, platform: false },
        { short: 'PF4', name: 'Platform 4', maxCars: 5, platform: true  },
        { short: 'PF5', name: 'Platform 5', maxCars: 5, platform: true  },
        { short: 'PF6', name: 'Platform 6', maxCars: 4, platform: true  }
      ],
      islands: [[0], [1, 2], [5, 6], [7]],
      origins: { west: ['Chennai', 'Arakkonam', 'Katpadi', 'Vellore', 'Tirupati'],
                 east: ['Bengaluru', 'Salem', 'Erode', 'Coimbatore', 'Mysuru'] },
      /* The same six kinds of service as everywhere else — same lengths,
         speeds, dwell and stopping pattern, so the game plays the same — but
         run as Indian Railways would: numbered, not coded, and in its
         liveries. loco is the locomotive's own livery where it differs from
         the train it hauls. */
      services: {
        local:     { label: 'MEMU', numbers: [66001, 66099],
                     body: '#e8dcc0', roof: '#8e9296', stripe: '#7a2231' },
        express:   { label: 'Vande Bharat', numbers: [20601, 20699],
                     body: '#f1f3f5', roof: '#b3bac2', stripe: '#1f5fbf' },
        intercity: { label: 'Superfast', numbers: [12601, 12699],
                     body: '#b1352f', roof: '#8e9398', stripe: '#d8d2c4', loco: 'wap7' },
        sleeper:   { label: 'Mail/Express', numbers: [16101, 16399],
                     body: '#2c5ba8', roof: '#80878e', stripe: '#e8e4d8', loco: 'wap7' },
        freight:   { label: 'Goods', codePrefix: 'G',
                     body: '#7a3b25', roof: '#6c6156', stripe: '#8b7b60', wagon: '#7a3b25', load: 'coal', loco: 'wdg4' },
        nonstop:   { label: 'Rajdhani', numbers: [12429, 12454], haulage: 'loco', locoLen: 122,
                     body: '#8e1f28', roof: '#8e9398', stripe: '#e6d3a2', loco: 'wap7' }
      },
      locos: {
        wap7: { body: '#b8282b', stripe: '#f1ebe0', roof: '#8a9096' },     // electric, red with a cream band
        wdg4: { body: '#2d5a98', stripe: '#ece6d6', roof: '#6f767e' }      // diesel hood unit, blue and cream
      }
    },
    /* A terminus, not a through station: every road dead-ends against the
       concourse on the west, so there is no "through" traffic and nothing
       ever exits east — east instead leads to a stabling yard, and every
       working either starts there (a departure being formed and boarded)
       or ends there (an arrival stabled once it's unloaded). See
       layoutStation()'s terminus branch and applyStation() for the yard
       geometry, and game.js's timetable scheduler for how services move
       between the two.

       The shape of this one is measured, not guessed. Taking the platform
       and track geometry out of an OSM-derived survey of the Chennai
       Central–Villivakkam corridor, rotating into a frame aligned with the
       platform bearing (8.9 degrees west of north) and cutting a
       cross-section through the terminus gives, unambiguously: buffer
       stops at the south end with the roads fanning north into one
       throat — which is why this is modelled single-ended — and two
       distinct groups of road, a western suburban one at 13-16m track
       centres carrying short faces (282-368m) and an eastern main-line
       one carrying long ones. Those six long faces measure 522, 549,
       602, 608, 617 and 694 metres, which scaled against the longest is
       5.3, 5.5, 6.1, 6.1, 6.2 and 7.0 game cars — so the maxCars spread
       below is the real length distribution, not a flat guess, and the
       262m bay that becomes 2A is really that much shorter than the rest.

       Two things the survey could NOT settle, so they are conventional:
       it holds about 11 of the complex's ~17-19 roads (there are 28m and
       62m gaps in the cross-section where roads are plainly missing), so
       the count here is the real 12 rather than the 6 long faces it
       actually captured; and its platform numbering interleaves MAS and
       Moore Market Complex refs across the one fan, so which number sits
       on which physical road follows the real station's 1, 2, 2A, 3-11
       rather than anything the file asserts. The day's real service list
       isn't public data either — see the timetable note below. */
    {
      /* hidden: kept out of the station picker while a different style of
         play is worked out for it. Nothing else is switched off — the
         layout, the yard cycle and the timetable all still work, and
         removing this one line puts it back on the menu. */
      id: 'mgrchennai', name: 'MGR Chennai Central', difficulty: 'Advanced', terminus: true, yard: 8,
      hidden: true,
      blurb: 'A real terminus, in miniature — twelve dead-end platforms and a stabling yard.',
      /* maxCars follows the measured face lengths above: two of the 694m
         class, six of the ~600m class, three of the 520-550m class, and
         2A as the short bay. (2A measures 2.6 cars; it is set to 4 — the
         shortest booked service — because a 3-car road would be one no
         train in the timetable could ever use.) */
      tracks: [
        { short: '1',  name: 'Platform 1',  maxCars: 7, platform: true },
        { short: '2',  name: 'Platform 2',  maxCars: 7, platform: true },
        { short: '2A', name: 'Platform 2A', maxCars: 4, platform: true },
        { short: '3',  name: 'Platform 3',  maxCars: 6, platform: true },
        { short: '4',  name: 'Platform 4',  maxCars: 6, platform: true },
        { short: '5',  name: 'Platform 5',  maxCars: 6, platform: true },
        { short: '6',  name: 'Platform 6',  maxCars: 6, platform: true },
        { short: '7',  name: 'Platform 7',  maxCars: 6, platform: true },
        { short: '8',  name: 'Platform 8',  maxCars: 6, platform: true },
        { short: '9',  name: 'Platform 9',  maxCars: 5, platform: true },
        { short: '10', name: 'Platform 10', maxCars: 5, platform: true },
        { short: '11', name: 'Platform 11', maxCars: 5, platform: true }
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

  var CENTER_Y = 555, TRACK_GAP = 130, BAND_HALF = 300, STOP_X = 920, SIDE_DECK = 40;

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

  /* ---- the realistic throat --------------------------------------------
     Worked out once per station in "u", the distance inward from the home
     signal, so the same plan serves both ends (see ladX). In order, going in:

       - a scissors crossover between the mains, so a train on either main
         can reach either side of the station;
       - the road lying between the mains, if there is one, split off both
         mains at once and joined in a Y;
       - then each main becomes a lead: one long curve sweeping out to the
         outermost road on its side, with every road in between peeling off
         it at a turnout of its own, nearest road first.

     So a line only ever splits one way at a time, which is the whole point,
     and the curves stay as long and gentle as the old fan's. (An earlier cut
     stepped road to road instead; every step came out shorter than a coach,
     and trains visibly jerked across the throat.) Roads above main A are
     main A's to serve, roads below main B main B's. */
  var LAD_LEAD = 12,      // home signal to the scissors
      LAD_GAP = 8,        // scissors to where each main becomes its lead
      LAD_MARGIN = 50,    // end of the throat to the longest platform's ramp
      LAD_MIN_HOME = 110, // keep the home signal, and whoever waits at it, on stage
      LAD_GENTLE = 18.5,  // the most room a curve gets: no gentler than the old fan needed
      LAD_BRANCH = 0.6,   // a road's curve off the lead, as a share of the lead's length
      LAD_ALPHA = 2.25;   // how much a branch keeps the lead's heading as it leaves:
                          // above 1.5 it bends away at once, below 3 it never overshoots
  /* Every curve in the throat is laid to one sharpness: a curve moving dy
     across over k*sqrt(dy) keeps dy/len^2 — its curvature — the same
     whatever its offset. k is the most the room allows (see planLadder),
     so the scissors, the leads and the middle road all bend alike and
     none is left short and sharp. */
  function ladCurve(k, dy) { return k * Math.sqrt(Math.abs(dy)); }
  function dsmooth(t) { return 30 * t * t * (1 - t) * (1 - t); }      // d/dt of smooth()
  function invSmooth(v) {
    var lo = 0, hi = 1, m, k;
    for (k = 0; k < 40; k++) { m = (lo + hi) / 2; if (smooth(m) < v) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  /* Where along a lead (W across, L long) a road w out from the main turns
     off, and how long its curve is. Leaving where the lead is still nearly
     level makes a long lazy curve; leaving where it's steep, a short sharp
     one — so search for the spot giving the wanted length, but never before
     the lead has cleared the previous road (tMin), or the two would cross. */
  function ladBranch(W, L, tMin, w) {
    var want = LAD_BRANCH * L, lo = tMin + 1e-4, hi = invSmooth(w / W) - 1e-4, m, k;
    function at(t) {
      var wt = W * smooth(t), sl = W * dsmooth(t) / L;
      return { t: t, wt: wt, s: sl, len: LAD_ALPHA * (w - wt) / sl };
    }
    if (at(lo).len <= want) return at(lo);
    for (k = 0; k < 40; k++) { m = (lo + hi) / 2; if (at(m).len > want) lo = m; else hi = m; }
    return at((lo + hi) / 2);
  }

  function planLadder(tracks, mainA, mainB, room) {
    var upper = [], lower = [], middle = [], i, t, u, id;
    for (i = 0; i < tracks.length; i++) {
      t = tracks[i];
      if (t.y < mainA - 1) upper.push(t);
      else if (t.y > mainB + 1) lower.push(t);
      else middle.push(t);
    }
    // Each main needs a side of its own to fan out into, and there's room
    // between the mains for one road, not a fan of them.
    if (!upper.length || !lower.length || middle.length > 1) return null;
    upper.sort(function (a, b) { return b.y - a.y; });   // nearest main A first
    lower.sort(function (a, b) { return a.y - b.y; });   // nearest main B first

    var p = { groupOf: {}, landing: {}, fans: {}, mid: null };
    var dyMains = mainB - mainA;
    var wMax = Math.max(mainA - upper[upper.length - 1].y, lower[lower.length - 1].y - mainB);
    // The scissors and the longest lead are the only curves laid end to end;
    // everything else runs alongside one of them. Share out what's left.
    var k = Math.min(LAD_GENTLE,
                     (room - LAD_LEAD - LAD_GAP) / (Math.sqrt(dyMains) + Math.sqrt(wMax)));
    p.k = k;
    p.s0 = LAD_LEAD;
    p.s1 = p.s0 + ladCurve(k, dyMains);
    u = p.s1 + LAD_GAP;
    p.fanStart = u;
    [['A', upper, mainA], ['B', lower, mainB]].forEach(function (g) {
      var key = g[0], roads = g[1], yM = g[2], outer = roads[roads.length - 1];
      var sg = outer.y > yM ? 1 : -1, W = Math.abs(outer.y - yM), L = ladCurve(k, W);
      var fan = { outer: outer.id, u0: u, u1: u + L, y0: yM, y1: outer.y, sg: sg, branches: [] };
      var tMin = 0, j, r, w, br;
      for (j = 0; j < roads.length - 1; j++) {
        r = roads[j]; w = Math.abs(r.y - yM);
        br = ladBranch(W, L, tMin, w);
        // m0t is the branch's starting slope in per-curve units, so it stays
        // tangent to the lead however the plan is stretched below.
        fan.branches.push({ road: r.id, t: br.t, u0: u + br.t * L, u1: u + br.t * L + br.len,
                            y0: yM + sg * br.wt, y1: r.y, m0t: sg * br.s * br.len });
        p.groupOf[r.id] = key;
        p.landing[r.id] = u + br.t * L + br.len;
        tMin = invSmooth(w / W);          // the lead passes this road here
      }
      p.groupOf[outer.id] = key;
      p.landing[outer.id] = fan.u1;
      p.fans[key] = fan;
    });
    // The road between the mains leaves each main right where that main
    // becomes its lead — a wye, one turnout, the two legs going opposite ways
    // — and runs alongside the fans rather than ahead of them, so it costs
    // the throat no length and can be as long and gentle as the leads.
    if (middle.length) {
      t = middle[0];
      p.mid = { road: t.id, y: t.y, u0: u,
                u1: u + Math.min(p.fans.A.u1 - u, p.fans.B.u1 - u) };
      p.groupOf[t.id] = 'M';
      p.landing[t.id] = p.mid.u1;
    }
    p.T = 0;
    for (id in p.landing) p.T = Math.max(p.T, p.landing[id]);

    // Too long for the canvas: tighten every length together, which steepens
    // the curves but keeps every turnout in exactly the planned order.
    if (p.T > room) {
      var f = room / p.T;
      p.s0 *= f; p.s1 *= f; p.fanStart *= f; p.T = room;
      if (p.mid) { p.mid.u0 *= f; p.mid.u1 *= f; }
      ['A', 'B'].forEach(function (k) {
        var fan = p.fans[k];
        fan.u0 *= f; fan.u1 *= f;
        fan.branches.forEach(function (br) { br.u0 *= f; br.u1 *= f; });
      });
      for (id in p.landing) p.landing[id] *= f;
    }
    return p;
  }

  /* Every road, whatever the station, connects to its throat/mains through
     a ladder of the same kind — only the road count and the longest
     platform change how far apart things need to be. */
  function layoutStation(def) {
    var n = def.tracks.length;
    var gap = Math.min(TRACK_GAP, (2 * BAND_HALF) / Math.max(1, n - 1));
    var top = CENTER_Y - (n - 1) * gap / 2;
    if (def.band) { top = def.band[0]; gap = (def.band[1] - def.band[0]) / Math.max(1, n - 1); }
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
        stopX: stopX, maxDiv: 136, terminus: true, ladder: null
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
      // A realistic throat is laid longer and stops closer to the platforms,
      // so its length comes out of the plan rather than a fixed gap.
      var plan = null, margin = 90, homeGap = 340;
      if (def.throat === 'ladder') {
        plan = planLadder(tracks, CENTER_Y - 50, CENTER_Y + 50,
                          stopX - half - LAD_MARGIN - LAD_MIN_HOME);
        if (plan) { margin = LAD_MARGIN; homeGap = plan.T; }
        else if (root.console) root.console.warn(def.id + ": road list doesn't suit a realistic throat; using the classic fan");
      }
      var xThroatW = stopX - half - margin, xThroatE = stopX + half + margin;
      var xWestHome = xThroatW - homeGap, xEastHome = xThroatE + homeGap;
      lay = {
        xWestEnd: xWestHome - 900, xWestHome: xWestHome,
        xThroatW: xThroatW, xThroatE: xThroatE,
        xEastHome: xEastHome, xEastEnd: xEastHome + 900,
        mainA: CENTER_Y - 50, mainB: CENTER_Y + 50,
        stopX: stopX, maxDiv: 136, terminus: false, ladder: plan
      };
    }

    var islands = def.islands.map(function (pair) {
      // a side platform: one road, its deck on the outside of the station
      if (pair.length === 1) {
        var t = tracks[pair[0]];
        return pair[0] === 0
          ? { y0: t.y - 25 - SIDE_DECK, y1: t.y - 25, upper: null, lower: t, side: true }
          : { y0: t.y + 25, y1: t.y + 25 + SIDE_DECK, upper: t, lower: null, side: true };
      }
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

  /* What a service of this kind is at the current station: the standard
     type (train.js RY.TYPES), with anything the station runs differently
     laid over it (def.services) and its locomotive's livery looked up.
     Made once per station and kind, so a train's cfg stays one object. */
  RY.serviceCfg = function (key) {
    var def = RY.station, base = RY.TYPES[key], over = def && def.services && def.services[key];
    if (!over) return base;
    if (!over.cfg) {
      over.cfg = {};
      Object.keys(base).forEach(function (k) { over.cfg[k] = base[k]; });
      Object.keys(over).forEach(function (k) { if (k !== 'cfg') over.cfg[k] = over[k]; });
      if (typeof over.loco === 'string') over.cfg.loco = def.locos[over.loco];
    }
    return over.cfg;
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

  /* ---- realistic throat: routes, conflicts, drawing ---------------------
     Both ends are laid from the one plan, mirrored: u runs inward from each
     home signal. A dir>0 train always runs on main B and a dir<0 train on
     main A, at either end, so a route is just "from this main to that road".
     A road on the other main's side is reached over the scissors. */
  function ladX(side, u) { return side === 'W' ? LAY.xWestHome + u : LAY.xEastHome - u; }
  function ladMainY(key) { return key === 'A' ? LAY.mainA : LAY.mainB; }
  function ladOther(key) { return key === 'A' ? 'B' : 'A'; }

  /* The lead, from where its main becomes it out to parameter t1. */
  function ladLeadPts(side, fan, t1) {
    var n = Math.max(6, Math.round(CURVE_N * t1)), L = fan.u1 - fan.u0, pts = [], i, t;
    for (i = 0; i <= n; i++) {
      t = t1 * i / n;
      pts.push({ x: ladX(side, fan.u0 + t * L), y: fan.y0 + (fan.y1 - fan.y0) * smooth(t) });
    }
    return pts;
  }
  /* A road's curve off the lead: leaves tangent to it, lands level on the
     road (a cubic Hermite with that start slope and none at the end). */
  function ladBranchPts(side, br) {
    var n = 64, dy = br.y1 - br.y0, pts = [], i, t;
    for (i = 0; i <= n; i++) {
      t = i / n;
      pts.push({ x: ladX(side, br.u0 + t * (br.u1 - br.u0)),
                 y: br.y0 + dy * (3 * t * t - 2 * t * t * t) + br.m0t * (t - 2 * t * t + t * t * t) });
    }
    return pts;
  }

  /* Points from the home signal inward to where road `id` runs straight. */
  function ladderRoute(side, from, id) {
    var p = LAY.ladder, g = p.groupOf[id], on = from, pts, k, fan, br;
    pts = [{ x: ladX(side, 0), y: ladMainY(from) }];
    if (g !== from && g !== 'M') {
      on = ladOther(from);
      cat(pts, RY.sCurve(ladX(side, p.s0), ladMainY(from),
                         ladX(side, p.s1), ladMainY(on), CURVE_N), false);
    }
    if (g === 'M') {
      pts.push({ x: ladX(side, p.mid.u0), y: ladMainY(on) });
      cat(pts, RY.sCurve(ladX(side, p.mid.u0), ladMainY(on),
                         ladX(side, p.mid.u1), p.mid.y, CURVE_N), true);
      return pts;
    }
    fan = p.fans[on];
    pts.push({ x: ladX(side, fan.u0), y: fan.y0 });
    if (id === fan.outer) { cat(pts, ladLeadPts(side, fan, 1), true); return pts; }
    for (k = 0; k < fan.branches.length; k++) {
      br = fan.branches[k];
      if (br.road !== id) continue;
      cat(pts, ladLeadPts(side, fan, br.t), true);
      cat(pts, ladBranchPts(side, br), true);
      break;
    }
    return pts;
  }

  /* The track a route occupies at one end: every turnout it passes through
     (either leg) and every piece of plain line between them, plus the
     scissors' diamond, which both of its diagonals cross. That's what a real
     interlocking locks, so it's what decides whether two moves can run at
     once. The plan is the same at both ends, so the answer is too. */
  function ladderRes(from, id) {
    var p = LAY.ladder, g = p.groupOf[id], on = from, res = {}, k, fan;
    function add(r) { res[r] = true; }
    add(from + ':approach'); add(from + '@s0');
    if (g !== from && g !== 'M') {
      on = ladOther(from);
      add('X' + from + on); add('diamond'); add(on + '@s1');
    } else {
      add(from + ':scissors'); add(from + '@s1');
    }
    add(on + ':after');
    if (p.mid) add(on + '@mid');
    if (g === 'M') { add('M' + on); add('Y'); return res; }
    fan = p.fans[on];
    for (k = 0; k < fan.branches.length; k++) {
      add(on + ':lead' + k);                     // lead up to the k-th turnout
      add(on + '@b' + k);                        // the turnout itself
      if (fan.branches[k].road === id) { add(on + '>b' + k); return res; }
    }
    add(on + ':lead' + k);                       // the last stretch, to the outermost road
    return res;
  }

  /* Where to draw point blades. Each: position, the heading of the line it
     sits on (pointing the way the diverging leg goes), and which side of
     that heading the leg peels off to — measured off the real curves, so a
     turnout on the sloping lead gets blades that lie along the lead. */
  function ladFrame(at, dx, dy, q) {
    var n = Math.sqrt(dx * dx + dy * dy); dx /= n; dy /= n;
    var cr = dx * (q.y - at.y) - dy * (q.x - at.x);
    return { x: at.x, y: at.y, a: Math.atan2(dy, dx), side: cr > 0 ? 1 : -1 };
  }
  RY.ladderTurnouts = function () {
    var p = LAY.ladder, out = [];
    if (!p) return out;
    ['W', 'E'].forEach(function (side) {
      var inw = side === 'W' ? 1 : -1, yA = LAY.mainA, yB = LAY.mainB, d1, d2, m, pts;
      d1 = RY.sCurve(ladX(side, p.s0), yA, ladX(side, p.s1), yB, CURVE_N);
      d2 = RY.sCurve(ladX(side, p.s0), yB, ladX(side, p.s1), yA, CURVE_N);
      out.push(ladFrame(d1[0], inw, 0, d1[4]));
      out.push(ladFrame(d2[0], inw, 0, d2[4]));
      out.push(ladFrame(d1[d1.length - 1], -inw, 0, d1[d1.length - 5]));
      out.push(ladFrame(d2[d2.length - 1], -inw, 0, d2[d2.length - 5]));
      if (p.mid) {
        [yA, yB].forEach(function (yM) {
          m = RY.sCurve(ladX(side, p.mid.u0), yM, ladX(side, p.mid.u1), p.mid.y, CURVE_N);
          out.push(ladFrame(m[0], inw, 0, m[4]));
        });
      }
      // A main becoming its lead isn't a turnout; every road off the lead is.
      ['A', 'B'].forEach(function (key) {
        var fan = p.fans[key], L = fan.u1 - fan.u0;
        fan.branches.forEach(function (br) {
          pts = ladBranchPts(side, br);
          out.push(ladFrame(pts[0], inw, fan.sg * Math.abs(fan.y1 - fan.y0) * dsmooth(br.t) / L, pts[3]));
        });
      });
    });
    return out;
  };

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
    if (LAY.ladder) {
      var road = trackAtY(trackY), id = road ? road.id : 0, from = dir > 0 ? 'B' : 'A';
      var w = ladderRoute('W', from, id), e = ladderRoute('E', from, id);
      if (dir > 0) {
        p.push({ x: LAY.xWestEnd, y: my });
        cat(p, w, false);
        cat(p, e.slice().reverse(), false);
        p.push({ x: LAY.xEastEnd, y: my });
      } else {
        p.push({ x: LAY.xEastEnd, y: my });
        cat(p, e, false);
        cat(p, w.slice().reverse(), false);
        p.push({ x: LAY.xWestEnd, y: my });
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
  function buildLadderCrossTable() {
    var table = { W: [], E: [] }, n = RY.TRACKS.length, i, j, a, b, key, hit;
    for (i = 0; i < n; i++) {
      table.W[i] = []; table.E[i] = [];
      a = ladderRes('B', i);                    // the dir>0 route, on main B
      for (j = 0; j < n; j++) {
        b = ladderRes('A', j);                  // the dir<0 route, on main A
        hit = false;
        for (key in a) if (b[key]) { hit = true; break; }
        table.W[i][j] = table.E[i][j] = hit;
      }
    }
    return table;
  }
  function buildCrossTable() {
    if (LAY.ladder) return buildLadderCrossTable();
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

    if (LAY.ladder) {
      var p = LAY.ladder, yA = LAY.mainA, yB = LAY.mainB;
      ['W', 'E'].forEach(function (side) {
        var end = side === 'W' ? LAY.xWestEnd : LAY.xEastEnd;
        // each main, from off-stage to where it becomes its lead
        segs.push(RY.makePath([{ x: end, y: yA }, { x: ladX(side, p.fanStart), y: yA }]));
        segs.push(RY.makePath([{ x: end, y: yB }, { x: ladX(side, p.fanStart), y: yB }]));
        // the scissors
        segs.push(RY.makePath(RY.sCurve(ladX(side, p.s0), yA, ladX(side, p.s1), yB, CURVE_N)));
        segs.push(RY.makePath(RY.sCurve(ladX(side, p.s0), yB, ladX(side, p.s1), yA, CURVE_N)));
        // the road between the mains, off both of them
        if (p.mid) {
          segs.push(RY.makePath(RY.sCurve(ladX(side, p.mid.u0), yA, ladX(side, p.mid.u1), p.mid.y, CURVE_N)));
          segs.push(RY.makePath(RY.sCurve(ladX(side, p.mid.u0), yB, ladX(side, p.mid.u1), p.mid.y, CURVE_N)));
        }
        // each lead, and every road's curve off it
        ['A', 'B'].forEach(function (key) {
          var fan = p.fans[key];
          segs.push(RY.makePath(ladLeadPts(side, fan, 1)));
          fan.branches.forEach(function (br) { segs.push(RY.makePath(ladBranchPts(side, br))); });
        });
      });
      // every road straight, from where it leaves one throat to the other
      for (i = 0; i < RY.TRACKS.length; i++) {
        t = RY.TRACKS[i];
        segs.push(RY.makePath([{ x: ladX('W', p.landing[t.id]), y: t.y },
                               { x: ladX('E', p.landing[t.id]), y: t.y }]));
      }
      return segs;
    }

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
