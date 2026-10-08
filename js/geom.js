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
    terminus: false, ladder: null, cascade: null
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

  /* Where an Indian or steam-era station's building stands: y, its front
     edge (it runs up the map from there); sp, the span it's laid along; and
     deck, where the ground in front of it ends. Usually platform 1 is a side
     platform against it, and then that platform is all three. Where road 1
     is a goods line instead, the building stands back across a strip of
     concourse — as deep as a side platform's deck — behind that line, with
     the footbridge reaching over it, along the longest platform. */
  RY.frontage = function () {
    var p = RY.ISLANDS[0], t0 = RY.TRACKS[0], best = null;
    if (p && p.side && p.lower === t0) return { y: p.y0, sp: RY.platSpan(t0), deck: p.y1, concourse: false };
    RY.TRACKS.forEach(function (t) { if (t.platform && (!best || t.maxCars > best.maxCars)) best = t; });
    return { y: t0.y - 25 - SIDE_DECK, sp: RY.platSpan(best || t0), deck: t0.y - 30, concourse: true };
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
    /* An Indian junction. The outermost roads, 1 and 8, are platformless
       goods lines, taking freight and the expresses that don't stop; the
       six platforms between them stand in three islands, numbered across
       the tracks from the station building, which stands back across a
       strip of concourse behind goods line 1, the footbridge reaching over
       it (RY.frontage). style: 'india' dresses the platforms, the
       buildings and the trains (see scene.js, cab.js and the services
       below). band pins the roads lower on the map than the others to leave
       room for the building and its forecourt above road 1. A one-road
       entry in islands would be a side platform, on the outside of the
       outermost road. */
    {
      id: 'kaveripuram', name: 'Kaveripuram Junction', code: 'KVPM', difficulty: 'Advanced',
      style: 'india', nameTamil: 'காவேரிபுரம்',
      nameHindi: 'कावेरीपुरम',
      blurb: 'An Indian junction: goods lines along both edges, six platforms on three islands between them.',
      band: [300, 895],
      tracks: [
        { short: 'GL1', name: 'Goods Line 1', maxCars: 8, platform: false },
        { short: 'PF1', name: 'Platform 1',   maxCars: 6, platform: true  },
        { short: 'PF2', name: 'Platform 2',   maxCars: 5, platform: true  },
        { short: 'PF3', name: 'Platform 3',   maxCars: 6, platform: true  },
        { short: 'PF4', name: 'Platform 4',   maxCars: 6, platform: true  },
        { short: 'PF5', name: 'Platform 5',   maxCars: 5, platform: true  },
        { short: 'PF6', name: 'Platform 6',   maxCars: 4, platform: true  },
        { short: 'GL2', name: 'Goods Line 2', maxCars: 8, platform: false }
      ],
      islands: [[1, 2], [3, 4], [5, 6]],
      origins: { west: ['Chennai', 'Arakkonam', 'Katpadi', 'Vellore', 'Tirupati'],
                 east: ['Bengaluru', 'Salem', 'Erode', 'Coimbatore', 'Mysuru'] },
      /* The same six kinds of service as everywhere else — same lengths,
         speeds, dwell and stopping pattern, so the game plays the same — but
         run as Indian Railways would: numbered, not coded, and in its
         liveries. loco is the locomotive's own livery where it differs from
         the train it hauls. rake is what each vehicle behind it is: luggage-
         and-guard vans (slr) at both ends of an ICF train, general and
         sleeper coaches, AC coaches, an LHB train's pantry and power cars;
         a goods train is one kind of wagon throughout (rakes, one chosen per
         train) with the guard's brake van last. lv: the last vehicle carries
         its "X" — only on loco-hauled trains, since a multiple unit ends in a
         driving cab, which never does. nose: an EMU's front — Vande
         Bharat's is 'aero'. tag: the service's colour in the Train Register,
         one clearly apart from every other's. */
      services: {
        local:     { label: 'MEMU', numbers: [66001, 66099], nose: 'flat',
                     // short local hops either side of the junction
                     routes: [['Arakkonam', 'Jolarpettai'], ['Katpadi', 'Jolarpettai'], ['Chennai Beach', 'Vellore Cantt'],
                              ['Arakkonam', 'Katpadi'], ['Katpadi', 'Bangarapet']],
                     // a suburban unit's two-tone, purple below and white above, so it
                     // can't be taken for a Vande Bharat at a glance
                     body: '#6a2d8c', roof: '#8e9296', stripe: '#f2c318', upper: '#eeebf2', tag: '#a066d3' },
        express:   { label: 'Vande Bharat', numbers: [20601, 20699], nose: 'aero', windowBand: true,
                     // the two that run this line
                     routes: [['Chennai', 'Mysuru', [20607, 20608]], ['Chennai', 'Coimbatore', [20643, 20644]]],
                     body: '#ffffff', roof: '#eceef1', stripe: '#1d4f9f',
                     // the fleet runs in both: the original white with a blue band
                     // and skirt, and the saffron-and-grey of the later rakes
                     liveries: [{ body: '#ffffff', roof: '#eceef1', stripe: '#1d4f9f', lower: '#1d4f9f', noseColor: '#fbfcfd', tag: '#eef1f4' },
                                { body: '#aeb4ba', roof: '#8f969d', stripe: '#f07b1c', lower: '#f07b1c', noseColor: '#f07b1c', tag: '#f28a2e' }] },
        intercity: { label: 'Superfast', numbers: [12601, 12699], loco: 'wap7', lv: true,
                     routes: [['Chennai', 'Bengaluru', [12607, 12608]], ['Chennai', 'Bengaluru', [12639, 12640]],
                              ['Chennai', 'Coimbatore', [12675, 12676]], ['Chennai', 'Mangaluru', [22637, 22638]]],
                     // LHB red and grey: silver-grey above, red below and a red line —
                     // grey where the Rajdhani is cream, bright red where it's maroon
                     body: '#bfc4c9', roof: '#8e9398', stripe: '#c8342b', lower: '#c8342b', tag: '#e14b3b',
                     rake: ['lhb-sl', 'lhb-ac', 'lhb-ac', 'power'] },
        sleeper:   { label: 'Mail/Express', numbers: [16101, 16399], loco: 'wap4', lv: true,
                     routes: [['Chennai', 'Mangaluru', [12601, 12602]], ['Chennai', 'Thiruvananthapuram', [12623, 12624]],
                              ['Chennai', 'Mysuru', [16021, 16022]], ['Chennai', 'Erode', [22649, 22650]]],
                     body: '#2c5ba8', roof: '#80878e', stripe: '#e8e4d8',
                     rake: ['slr', 'gen', 'sl', 'ac', 'slr'], tag: '#3d7fe0' },
        freight:   { label: 'Goods', codePrefix: 'G', loco: 'wdg4', lv: true, tank: 'black', tag: '#5fae5a',
                     // one list per rake below, in the same order: coal from the
                     // port to the power station, grain to the depot, fuel from
                     // the refinery, containers to the inland container depot
                     rakeRoutes: [[['Ennore Port', 'Mettur Dam']], [['Tondiarpet', 'Salem']],
                                  [['Manali Refinery', 'Devangonthi']], [['Chennai Port', 'Whitefield ICD']]],
                     body: '#7a3b25', roof: '#6c6156', stripe: '#8b7b60', wagon: '#7a3b25', load: 'coal',
                     containers: ['#ecebe6', '#1f4e9c', '#9b2d25', '#2f6b3a', '#d9d4c7'],
                     rakes: [['boxn', 'boxn', 'boxn', 'boxn', 'brakevan'],
                             ['bcn', 'bcn', 'bcn', 'bcn', 'brakevan'],
                             ['tank', 'tank', 'tank', 'tank', 'brakevan'],
                             ['flat', 'flat', 'flat', 'flat', 'brakevan']] },
        nonstop:   { label: 'Rajdhani', numbers: [12429, 12454], haulage: 'loco', locoLen: 122, loco: 'wap7raj', lv: true,
                     // a Rajdhani always runs to or from the national capital: from
                     // New Delhi (north, off the Chennai end) to Bengaluru, and back
                     routes: [['New Delhi', 'Bengaluru', [22692, 22691]]],
                     // Rajdhani's own: deep maroon below, cream above, a gold line between
                     body: '#7a1520', roof: '#8e9398', stripe: '#c9a23a', upper: '#ecd9a8', tag: '#d9b44a',
                     rake: ['lhb-ac', 'pantry', 'power'] }
      },
      locos: {
        wap7: { body: '#b8282b', stripe: '#f1ebe0', roof: '#8a9096' },     // electric, red with a cream band
        wap7raj: { body: '#d9ab35', stripe: '#7a1520', roof: '#8a9096' },  // the Rajdhani's: gold with a maroon band, its register colour, unlike any other engine here
        wap4: { body: '#2f78c4', stripe: '#f4f2ec', roof: '#7e868e' },     // the Mail's WAP-4, blue with white bands
        wdg4: { body: '#2f7a45', stripe: '#ece6d6', roof: '#6f767e' }      // diesel hood unit, green and cream — goods' colour
      }
    },
    /* The same country forty years earlier, in the age of steam. No wires
       overhead, semaphore signals, low stone platforms under cast-iron
       canopies, a red-brick building with an arched verandah, and a water
       column at the end of each platform. The trains are steam-hauled — WP
       Pacifics on the passenger trains, WG Mikados on the goods — behind
       maroon coaches, and now and then a WDM-2 diesel turns up instead
       (dieselShare). Places carry their names of the time, and trains their
       Up and Down numbers. style: 'retro' dresses it (scene.js, cab.js);
       electric: false leaves the overhead line out; signals: 'semaphore'. */
    {
      id: 'pazhayapuram', name: 'Pazhayapuram Junction', code: 'PZM', difficulty: 'Standard',
      style: 'retro', electric: false, signals: 'semaphore',
      blurb: 'The age of steam: WP and WG engines, semaphore signals, and a diesel now and then.',
      band: [320, 840],
      tracks: [
        { short: 'PF1', name: 'Platform 1',  maxCars: 6, platform: true  },
        { short: 'PF2', name: 'Platform 2',  maxCars: 6, platform: true  },
        { short: 'PF3', name: 'Platform 3',  maxCars: 5, platform: true  },
        { short: 'GL',  name: 'Goods Loop',  maxCars: 8, platform: false },
        { short: 'PF4', name: 'Platform 4',  maxCars: 5, platform: true  }
      ],
      islands: [[0], [1, 2], [4]],
      origins: { west: ['Madras', 'Arkonam', 'Katpadi', 'Villupuram'],
                 east: ['Bangalore', 'Salem', 'Erode', 'Coimbatore', 'Mysore'] },
      services: {
        local:     { label: 'Passenger', numbers: [101, 199], upDown: true, haulage: 'steam', steamClass: 'wp', locoLen: 150,
                     stock: 'coach', elec: false, lv: true, dieselShare: 0.15, diesel: 'wdm2', tag: '#c49a6c',
                     body: '#6b2a1e', roof: '#55585c', stripe: '#d8c79b', rake: ['slr', 'gen'], liveries: 'wp' },
        express:   { label: 'Express', numbers: [21, 49], upDown: true, haulage: 'steam', steamClass: 'wp', locoLen: 150,
                     stock: 'coach', elec: false, lv: true, dieselShare: 0.15, diesel: 'wdm2', tag: '#d9534f',
                     body: '#6b2a1e', roof: '#55585c', stripe: '#d8c79b', rake: ['slr', 'gen', 'first'], liveries: 'wp' },
        intercity: { label: 'Mail', numbers: [1, 12], upDown: true, haulage: 'steam', steamClass: 'wp', locoLen: 150,
                     stock: 'coach', elec: false, lv: true, dieselShare: 0.15, diesel: 'wdm2', tag: '#5b8fd6',
                     body: '#6b2a1e', roof: '#55585c', stripe: '#d8c79b', rake: ['slr', 'gen', 'sl', 'first'], liveries: 'wp' },
        sleeper:   { label: 'Janata Express', numbers: [51, 79], upDown: true, haulage: 'steam', steamClass: 'wp', locoLen: 150,
                     stock: 'coach', elec: false, lv: true, dieselShare: 0.15, diesel: 'wdm2', tag: '#9b7fd1',
                     body: '#6b2a1e', roof: '#55585c', stripe: '#d8c79b', rake: ['slr', 'gen', 'gen', 'sl', 'slr'], liveries: 'wp' },
        freight:   { label: 'Goods', codePrefix: 'G', haulage: 'steam', steamClass: 'wg', locoLen: 146, vehLen: 90,
                     stock: 'wagon', elec: false, lv: true, dieselShare: 0.25, diesel: 'wdm2', tag: '#6fae5a',
                     body: '#5a3322', roof: '#6c6156', stripe: '#8b7b60', wagon: '#5a3322', load: 'coal', tank: 'black',
                     engine: { boiler: '#1c1c1d', beam: '#b3261e', bands: '#8f8c82' },
                     rakes: [['boxn', 'boxn', 'boxn', 'boxn', 'brakevan'],
                             ['bcn', 'bcn', 'bcn', 'bcn', 'brakevan'],
                             ['tank', 'tank', 'tank', 'tank', 'brakevan']] },
        nonstop:   { label: 'Deluxe Express', numbers: [13, 19], upDown: true, haulage: 'steam', steamClass: 'wp', locoLen: 150,
                     stock: 'coach', vehLen: 108, elec: false, lv: true, dieselShare: 0.35, diesel: 'wdm2', tag: '#e0b040',
                     body: '#6b2a1e', roof: '#55585c', stripe: '#e8c21e', rake: ['first', 'first', 'slr'], liveries: 'wp' }
      },
      /* the WP as the 1970s knew it: mostly plain black with silver bands and
         a red buffer beam, some with the bullet nose painted silver; now and then one of the green engines with brass
         bands that some sheds turned out */
      engines: {
        wp: [{ engine: { boiler: '#1b1c1e', beam: '#b3261e', bands: '#c9c6b8' } },
             { engine: { boiler: '#1b1c1e', beam: '#b3261e', bands: '#c9c6b8' } },
             { engine: { boiler: '#1b1c1e', beam: '#b3261e', bands: '#c9c6b8', nose: '#c4c7cb' } },   // a silver bullet nose
             { engine: { boiler: '#1f5b3a', tender: '#1f5b3a', cab: '#1f5b3a', beam: '#b3261e', bands: '#d4b24c' } }]
      },
      locos: {
        wdm2: { body: '#8a2a1f', stripe: '#e9dcc0', roof: '#5f6368' }   // the ALCo diesel, maroon with a cream band
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

  /* Kaveripuram (Realistic): the same station, roads and trains, through
     the cascade throat (see planCascade) — every road stepped onto the
     next by crossovers instead of curved straight off the mains. Its
     throats need the length, so it's laid in a world a third wider than
     the others and the map shows it a little smaller. Listed right after
     the plain one. */
  (function () {
    var i, kv;
    for (i = 0; i < RY.STATIONS.length; i++) if (RY.STATIONS[i].id === 'kaveripuram') kv = i;
    var real = {};
    Object.keys(RY.STATIONS[kv]).forEach(function (k) { real[k] = RY.STATIONS[kv][k]; });
    real.id = 'kaveripuram-real';
    real.name = 'Kaveripuram Junction (Realistic)';
    real.blurb = 'The same junction through a throat laid like a real one: every road stepped onto the next by crossovers.';
    real.throat = 'cascade';
    real.worldW = 2560;
    RY.STATIONS.splice(kv + 1, 0, real);
  })();

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
  /* ---- the cascade throat ----------------------------------------------
     Kaveripuram (Realistic)'s, laid out as a dispatcher sketched it. At
     each end one main runs in and one runs out (at the west, B in and A
     out; at the east, A in and B out). Each divides right by the home
     signal: one leg bends onto the road beside it and carries on as that
     road, the other runs to the middle road (4), between the mains. Every
     other road is reached by stepping road to road, through crossovers
     between neighbours, the way a train actually threads a busy throat:

       - departures cascade toward the out main: road 1 runs onto road 2,
         road 2 onto road 3, and road 3's line becomes the main; those
         from beyond the mains step onto road 4 and out off it;
       - arrivals come off the in main onto the road beside it and step
         outward road by road; those for beyond the mains go in across
         road 4 and then outward, one crossover at a time.

     Where an arrival's crossover and a departure's share the gap between
     two roads, the departure's lies nearer the signal. That keeps an
     arrival into a road clear of the track a departure from any road
     beyond it uses: as many moves at once as any layout allows (see
     buildCascadeCrossTable).

     The longest runs of steps set how steep the crossovers must be: off
     the far side of the mains, through road 4, and on to the outermost
     road. Each is laid end to end, every crossover as long as it can be:
     each must have joined its road before that road's platform begins,
     and a road with no platform (a goods line) lets its last crossover
     run on in toward the station, so long as a through freight held at
     its far starter still fits clear of the throat it came in by. Every
     other crossover is stretched to fill the gap it has to itself.
     Positions run in u, inward from the home signal, mirrored at the two
     ends like the ladder's. */
  var CASC_LEAD = 26,      // home signal to where each main divides
      CASC_BEND = 80,      // a main's bend onto the road beside it
      CASC_WYE = 110,      // a main's other leg, onto the middle road
      CASC_EDGE = 10,      // a bend's end to the first crossover off its road
      CASC_MARGIN = 16,    // end of the throat to the longest platform's ramp
      CASC_MIN_HOME = 110, // keep the home signal, and whoever waits at it, on stage
      CASC_MIN_STEP = 80,  // shorter than this and a coach would be on two crossovers at once
      CASC_FIT = 700,      // the longest through train, held at a starter, must stand clear of the throats
      CASC_FOUL = 80;      // a crossover's legs are a vehicle's width apart this far from its points
  function planCascade(tracks, mainA, mainB, room) {
    var upper = [], lower = [], middle = [];
    tracks.forEach(function (t) {
      if (t.y < mainA - 1) upper.push(t); else if (t.y > mainB + 1) lower.push(t); else middle.push(t);
    });
    if (!upper.length || !lower.length || middle.length !== 1) return null;
    upper.sort(function (a, b) { return b.y - a.y; });   // nearest main A first
    lower.sort(function (a, b) { return a.y - b.y; });   // nearest main B first
    var us = CASC_LEAD + CASC_WYE + 6;                   // where the middle road's crossovers start
    if ((room - us) / Math.max(upper.length, lower.length) < CASC_MIN_STEP) return null;
    return { upper: upper, lower: lower, mid: middle[0], us: us, T: room };
  }

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
    var stopX = def.worldW ? def.worldW / 2 - 40 : STOP_X;
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
        stopX: stopX, maxDiv: 136, terminus: true, ladder: null, cascade: null
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
      var casc = null;
      if (def.throat === 'cascade') {
        casc = planCascade(tracks, CENTER_Y - 50, CENTER_Y + 50,
                           stopX - half - CASC_MARGIN - CASC_MIN_HOME);
        if (casc) { margin = CASC_MARGIN; homeGap = casc.T; }
        else if (root.console) root.console.warn(def.id + ": road list doesn't suit a cascade throat; using the classic fan");
      }
      var xThroatW = stopX - half - margin, xThroatE = stopX + half + margin;
      var xWestHome = xThroatW - homeGap, xEastHome = xThroatE + homeGap;
      lay = {
        xWestEnd: xWestHome - 900, xWestHome: xWestHome,
        xThroatW: xThroatW, xThroatE: xThroatE,
        xEastHome: xEastHome, xEastEnd: xEastHome + 900,
        mainA: CENTER_Y - 50, mainB: CENTER_Y + 50,
        stopX: stopX, maxDiv: casc ? CASC_LEAD : 136, terminus: false, ladder: plan, cascade: casc
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
    RY.W = def.worldW || 1920;          // a station with longer throats is laid in a wider world, shown smaller
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
      if (typeof over.diesel === 'string') over.cfg.diesel = def.locos[over.diesel];
      if (typeof over.liveries === 'string') over.cfg.liveries = def.engines[over.liveries];
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
  /* One end of a cascade throat, in u: which main runs in here and which
     out, the roads beyond each (nearest first), every crossover, and where
     each road's own line begins. */
  function cascadeEnd(side) {
    var p = LAY.cascade, key = side;
    if (p._ends && p._ends[key]) return p._ends[key];
    var inA = side === 'E';
    var inG = inA ? p.upper : p.lower, outG = inA ? p.lower : p.upper, mid = p.mid;
    var yIn = inA ? LAY.mainA : LAY.mainB, yOut = inA ? LAY.mainB : LAY.mainA;
    var pc = {}, start = {}, k, u0 = CASC_LEAD, bendEnd = u0 + CASC_BEND, us = p.us, T = p.T;
    var m0 = bendEnd + CASC_EDGE, nIn = inG.length, nOut = outG.length;
    // the two long chains, laid end to end from us: departures from the in
    // side's roads (Q, then E1..) and arrivals to the out side's (R, then
    // C1..). The k-th crossover of a chain lands on the k-th road out, and
    // must have done so by where that road's platform starts; a goods line
    // has none, so only the fit of a held through train limits it. The
    // other crossover in each gap is stretched to fill what's left nearer
    // the signal.
    var span = LAY.xEastHome - LAY.xWestHome;
    function lim(r) {
      if (!r.platform) return Infinity;
      var sp = RY.platSpan(r);
      return side === 'W' ? sp.x0 - CASC_MARGIN - LAY.xWestHome : LAY.xEastHome - sp.x1 - CASC_MARGIN;
    }
    function chainL(roads) {
      var l = Infinity, k, n = roads.length;
      for (k = 1; k <= n; k++) l = Math.min(l, (lim(roads[k - 1]) - us) / k);
      // ending on a goods line: its starter here, and where a train coming
      // in on it at the far end is clear, must leave room for a train between
      if (!roads[n - 1].platform) l = Math.min(l, (span - 2 * us - 30 - CASC_FOUL - CASC_FIT) / (2 * n - 1));
      return Math.max(CASC_MIN_STEP, l);
    }
    var l1 = chainL(inG), l2 = chainL(outG);
    function piece(id, a, b, ya, yb) { pc[id] = { id: id, u0: a, u1: b, y0: ya, y1: yb }; }
    pc.bendIn = { id: 'bendIn', u0: u0, u1: bendEnd, y0: yIn, y1: inG[0].y, bend: true };
    pc.bendOut = { id: 'bendOut', u0: u0, u1: bendEnd, y0: yOut, y1: outG[0].y, bend: true };
    piece('PmOut', u0, u0 + CASC_WYE - 4, yOut, mid.y);      // departures from road 4, onto the out main
    piece('PmIn', u0, u0 + CASC_WYE, yIn, mid.y);            // arrivals to road 4, off the in main
    piece('R', us, us + l2, mid.y, outG[0].y);
    piece('Q', us + 4, us + l1, mid.y, inG[0].y);
    for (k = 1; k < nOut; k++) {
      piece('C' + k, us + k * l2, us + (k + 1) * l2, outG[k - 1].y, outG[k].y);
      piece('M' + k, k === 1 ? m0 : us + (k - 1) * l2, us + k * l2, outG[k - 1].y, outG[k].y);
    }
    for (k = 1; k < nIn; k++) {
      piece('E' + k, us + k * l1, us + (k + 1) * l1, inG[k - 1].y, inG[k].y);
      piece('D' + k, k === 1 ? m0 : us + (k - 1) * l1, us + k * l1, inG[k - 1].y, inG[k].y);
    }
    start[outG[0].id] = bendEnd; start[inG[0].id] = bendEnd; start[mid.id] = Math.min(pc.PmOut.u1, pc.PmIn.u1);
    for (k = 1; k < outG.length; k++) start[outG[k].id] = pc['M' + k].u1;
    for (k = 1; k < inG.length; k++) start[inG[k].id] = pc['D' + k].u1;
    var e = { side: side, pc: pc, start: start, inG: inG, outG: outG, mid: mid, yIn: yIn, yOut: yOut, end: p.T };
    (p._ends = p._ends || {})[key] = e;
    return e;
  }
  /* A route through one end, from its home signal in to where road `id`
     runs on alone: 'in' off the main that runs in here, 'out' onto the one
     that runs out (laid from the main inward either way, like
     ladderRoute's). Points to run it, and the track it holds: every
     crossover and every stretch of each road's line it uses. */
  function cascadeRoute(side, way, id) {
    var e = cascadeEnd(side), pc = e.pc, p = LAY.cascade, ck = side + way + id;
    if (p._routes && p._routes[ck]) return p._routes[ck];
    var steps = [], at, k, j;
    var ki = -1, ko = -1;
    for (j = 0; j < e.inG.length; j++) if (e.inG[j].id === id) ki = j;
    for (j = 0; j < e.outG.length; j++) if (e.outG[j].id === id) ko = j;
    function run(road, to) { steps.push({ road: road, a: at, b: to }); at = to; }
    function take(pid) { steps.push({ piece: pid }); at = pc[pid].u1; }
    // the in side's roads are the in main's bend and what steps off it; the
    // middle road and everything beyond it come off the main's other leg
    if (way === 'in') {
      if (ki >= 0) {
        take('bendIn');
        for (j = 1; j <= ki; j++) { run(e.inG[j - 1].id, pc['D' + j].u0); take('D' + j); }
      } else {
        take('PmIn');
        if (ko >= 0) {
          run(e.mid.id, pc.R.u0); take('R');
          for (j = 1; j <= ko; j++) { run(e.outG[j - 1].id, pc['C' + j].u0); take('C' + j); }
        }
      }
    } else {
      if (ko >= 0) {
        take('bendOut');
        for (j = 1; j <= ko; j++) { run(e.outG[j - 1].id, pc['M' + j].u0); take('M' + j); }
      } else {
        take('PmOut');
        if (ki >= 0) {
          run(e.mid.id, pc.Q.u0); take('Q');
          for (j = 1; j <= ki; j++) { run(e.inG[j - 1].id, pc['E' + j].u0); take('E' + j); }
        }
      }
    }
    run(id, Math.max(e.end, at));
    var y0 = way === 'in' ? e.yIn : e.yOut, pts = [{ x: ladX(side, 0), y: y0 }], yOf = {};
    RY.TRACKS.forEach(function (t) { yOf[t.id] = t.y; });
    steps.forEach(function (st) {
      if (st.piece) {
        var q = pc[st.piece];
        cat(pts, RY.sCurve(ladX(side, q.u0), q.y0, ladX(side, q.u1), q.y1, CURVE_N), false);
      } else if (st.b > st.a) {
        pts.push({ x: ladX(side, st.a), y: yOf[st.road] }, { x: ladX(side, st.b), y: yOf[st.road] });
      }
    });
    // the train carries on along its road toward the platforms: as track
    // it holds, that last stretch has no inner end
    steps[steps.length - 1].b = Infinity;
    var r = { pts: pts, steps: steps };
    (p._routes = p._routes || {})[ck] = r;
    return r;
  }
  /* Two routes through the same end clash if they share a crossover, or
     any part of a road's line — a turnout included, which is a point both
     stretches touch. */
  function cascadeClash(r1, r2) {
    var i, j, a, b;
    for (i = 0; i < r1.steps.length; i++) {
      a = r1.steps[i];
      for (j = 0; j < r2.steps.length; j++) {
        b = r2.steps[j];
        if (a.piece && a.piece === b.piece) return true;
        if (!a.piece && !b.piece && a.road === b.road && a.a <= b.b + 0.5 && b.a <= a.b + 0.5) return true;
      }
    }
    return false;
  }
  /* Where road id's starter signal stands at one end — the signal a train
     leaving that way waits at, and where a through train holds if the
     throat beyond is busy (train.js sFarGate). Usually 30 in from the
     throat. In a cascade throat a road's own line runs on out past that,
     so its starter goes as close as it safely can to where its departures
     branch off: just past the branch, but past the fouling point of every
     other route that touches the line too, so a train standing at it
     stands on track that's its road's alone. */
  RY.starterX = function (side, id) {
    var dflt = side === 'W' ? LAY.xThroatW + 30 : LAY.xThroatE - 30;
    if (!LAY.cascade) return dflt;
    var p = LAY.cascade, key = side + id;
    if (p._starter && p._starter[key] !== undefined) return p._starter[key];
    var e = cascadeEnd(side), dep = cascadeRoute(side, 'out', id).steps;
    var u = dep[dep.length - 1].a + 30;        // just past where its own departures leave it
    RY.TRACKS.forEach(function (t) {
      if (t.id === id) return;
      ['in', 'out'].forEach(function (way) {
        cascadeRoute(side, way, t.id).steps.forEach(function (st) {
          if (!st.piece && st.road === id) u = Math.max(u, st.b + CASC_FOUL);
        });
      });
    });
    var x = ladX(side, u);
    (p._starter = p._starter || {})[key] = x;
    return x;
  };

  /* Where a train coming in at `side` to road id has finished with the
     throat: its tail past the fouling point of its own last crossover, and
     past that of every other route touching the road's line — but not the
     road's own departure crossover, which nothing can be using while a
     train is coming in on that road. */
  RY.entryClearX = function (side, id) {
    var p = LAY.cascade, key = side + id;
    if (p._entry && p._entry[key] !== undefined) return p._entry[key];
    var e = cascadeEnd(side), arr = cascadeRoute(side, 'in', id).steps, u = 0, i;
    for (i = 0; i < arr.length; i++) if (arr[i].piece) u = Math.max(u, e.pc[arr[i].piece].u0 + CASC_FOUL);
    RY.TRACKS.forEach(function (t) {
      if (t.id === id) return;
      ['in', 'out'].forEach(function (way) {
        cascadeRoute(side, way, t.id).steps.forEach(function (st) {
          if (!st.piece && st.road === id) u = Math.max(u, st.b + CASC_FOUL);
        });
      });
    });
    var x = ladX(side, u);
    (p._entry = p._entry || {})[key] = x;
    return x;
  };

  /* Two trains coming in at the same end, one behind the other: where
     the one in front (bound for road lead) must have its tail past before
     the one behind (bound for road follow) can be let in. That's just past
     the last of the track their two routes share — the fouling point of
     the turnout where they part — and never further in than the leader's
     own entry clearance (RY.entryClearX), past which it's on its own road anyway. */
  RY.followClearX = function (side, lead, follow) {
    var p = LAY.cascade;
    if (!p) return null;
    var key = side + lead + '>' + follow;
    if (p._follow && p._follow[key] !== undefined) return p._follow[key];
    var a = cascadeRoute(side, 'in', lead).steps, b = cascadeRoute(side, 'in', follow).steps, pc = cascadeEnd(side).pc, u = 0;
    a.forEach(function (sa) {
      b.forEach(function (sb) {
        if (sa.piece && sa.piece === sb.piece) u = Math.max(u, pc[sa.piece].u1);
        else if (!sa.piece && !sb.piece && sa.road === sb.road && sa.a <= sb.b + 0.5 && sb.a <= sa.b + 0.5) {
          u = Math.max(u, Math.min(sa.b, sb.b));
        }
      });
    });
    var clear = RY.entryClearX(side, lead), x = ladX(side, u + CASC_FOUL);
    x = side === 'W' ? Math.min(x, clear) : Math.max(x, clear);
    (p._follow = p._follow || {})[key] = x;
    return x;
  };

  /* Where to draw point blades in a cascade throat: wherever a crossover
     leaves a line that also carries on — the line running on past it, or
     another crossover landing there to join it. */
  RY.cascadeTurnouts = function () {
    var out = [];
    if (!LAY.cascade) return out;
    ['W', 'E'].forEach(function (side) {
      var e = cascadeEnd(side), pc = e.pc, inw = side === 'W' ? 1 : -1, id, q, pts, rd, lands;
      var roadAt = function (y) { for (var i = 0; i < RY.TRACKS.length; i++) if (Math.abs(RY.TRACKS[i].y - y) < 1) return RY.TRACKS[i].id; return -1; };
      for (id in pc) {
        q = pc[id];
        if (q.bend) continue;
        pts = RY.sCurve(ladX(side, q.u0), q.y0, ladX(side, q.u1), q.y1, CURVE_N);
        // its outer end, leaving inward
        rd = roadAt(q.y0);
        if (rd < 0 && (Math.abs(q.y0 - e.yIn) < 1 || Math.abs(q.y0 - e.yOut) < 1)) {   // a main dividing
          out.push(ladFrame(pts[0], inw, 0, pts[4]));
          continue;
        }
        lands = Object.keys(pc).some(function (o) { return !pc[o].bend && Math.abs(pc[o].u1 - q.u0) < 0.5 && Math.abs(pc[o].y1 - q.y0) < 1; });
        if (rd >= 0 && (q.u0 > e.start[rd] + 0.5 || lands)) out.push(ladFrame(pts[0], inw, 0, pts[4]));
        // its inner end, leaving outward, where the line runs on outward of it
        rd = roadAt(q.y1);
        if (rd >= 0 && q.u1 > e.start[rd] + 0.5) out.push(ladFrame(pts[pts.length - 1], -inw, 0, pts[pts.length - 5]));
      }
    });
    return out;
  };

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
    if (LAY.cascade) {
      var croad = trackAtY(trackY), cid = croad ? croad.id : 0;
      var cw = cascadeRoute('W', dir > 0 ? 'in' : 'out', cid).pts, ce = cascadeRoute('E', dir > 0 ? 'out' : 'in', cid).pts;
      if (dir > 0) {
        p.push({ x: LAY.xWestEnd, y: my });
        cat(p, cw, false);
        cat(p, ce.slice().reverse(), false);
        p.push({ x: LAY.xEastEnd, y: my });
      } else {
        p.push({ x: LAY.xEastEnd, y: my });
        cat(p, ce, false);
        cat(p, cw.slice().reverse(), false);
        p.push({ x: LAY.xWestEnd, y: my });
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
  /* table[side][i][j]: does the dir>0 route through `side` to road i
     clash with the dir<0 one to road j? A dir>0 train comes in at the
     west and goes out at the east; a dir<0 one the other way about. */
  function buildCascadeCrossTable() {
    var table = { W: [], E: [] }, n = RY.TRACKS.length;
    ['W', 'E'].forEach(function (side) {
      var posWay = side === 'W' ? 'in' : 'out', negWay = side === 'W' ? 'out' : 'in', i, j;
      for (i = 0; i < n; i++) {
        table[side][i] = [];
        for (j = 0; j < n; j++) table[side][i][j] = cascadeClash(cascadeRoute(side, posWay, i), cascadeRoute(side, negWay, j));
      }
    });
    return table;
  }
  function buildCrossTable() {
    if (LAY.cascade) return buildCascadeCrossTable();
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

    if (LAY.cascade) {
      var cends = {};
      ['W', 'E'].forEach(function (side) {
        var e = cascadeEnd(side), end = side === 'W' ? LAY.xWestEnd : LAY.xEastEnd, id, q;
        cends[side] = e;
        // each main, from off-stage to where it bends onto the road beside it
        segs.push(RY.makePath([{ x: end, y: e.yIn }, { x: ladX(side, CASC_LEAD), y: e.yIn }]));
        segs.push(RY.makePath([{ x: end, y: e.yOut }, { x: ladX(side, CASC_LEAD), y: e.yOut }]));
        for (id in e.pc) {
          q = e.pc[id];
          segs.push(RY.makePath(RY.sCurve(ladX(side, q.u0), q.y0, ladX(side, q.u1), q.y1, CURVE_N)));
        }
      });
      // every road, from where its line begins at one end to the other
      for (i = 0; i < RY.TRACKS.length; i++) {
        t = RY.TRACKS[i];
        segs.push(RY.makePath([{ x: ladX('W', cends.W.start[t.id]), y: t.y },
                               { x: ladX('E', cends.E.start[t.id]), y: t.y }]));
      }
      return segs;
    }

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
