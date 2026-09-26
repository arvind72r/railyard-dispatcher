/* ------------------------------------------------------------------
   cab.js — the driver's-eye view.

   The world is only ever modelled in plan, so the cab view is that plan
   stood up in perspective from a camera riding in the front cab of
   whichever train you last clicked: every rail, sleeper, platform, signal,
   mast and train here is the same data the map is drawn from. It reads the
   simulation and never touches it.

   Coordinates are the map's own (x east, y south, in map pixels) with z
   for height. The camera looks along the lead vehicle's heading, so it
   swings through a crossover exactly as the body on the map does.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY, L = RY.LAY;

  var EYE = 30,              // driver's eye above the rail
      NEAR = 2, FAR = 1250,  // nearest and furthest anything is drawn
      HFOV = 64 * Math.PI / 180,
      PLAT_H = 11, WIRE_Z = 60, MAST_Z = 66,
      SLEEPER_FAR = 520,     // beyond this sleepers are a blur of ballast anyway
      STEP = 10, CHUNK = 6;  // track is resampled every STEP, drawn CHUNK steps at a time
  var LIGHT = { x: -0.45, y: 0.89 };   // faces turned toward the south-west catch the sun

  var host = document.getElementById('cab');
  var cv = document.getElementById('cabcv');
  var ctx = cv.getContext('2d');
  var elName = document.getElementById('cabname');
  var elHint = document.getElementById('cabhint');
  var elToggle = document.getElementById('cabtoggle');

  var W = 0, H = 0, dpr = 1, focal = 1, hz = 0;
  var cam = { x: 0, y: 0, a: 0, ca: 1, sa: 0 };
  var world = null, worldKey = '';
  var target = null, night = 0, haze = [196, 208, 214];
  var shown = true;
  try { shown = root.localStorage.getItem('ry.cab') !== 'off'; } catch (e) { /* private mode */ }

  /* ---------------- colour ---------------- */
  function hex(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  var hexCache = {};
  function rgbOf(h) { return hexCache[h] || (hexCache[h] = hex(h)); }

  /* How much of the haze a thing at distance d is lost in. */
  function fogK(d) {
    var t = (d - 140) / (FAR - 140);
    return t <= 0 ? 0 : Math.min(0.9, t * t * 0.75 + t * 0.3);
  }
  /* A colour lit by `lit`, dimmed for dusk, and faded into the haze by k. */
  function col(c, k, lit) {
    var d = (lit === undefined ? 1 : lit) * (1 - 0.85 * night);
    var r = c[0] * d, g = c[1] * d, b = c[2] * d;
    r += (haze[0] - r) * k; g += (haze[1] - g) * k; b += (haze[2] - b) * k;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  var C_BALLAST = [112, 106, 94], C_SLEEPER = [92, 74, 56], C_RAIL = [70, 74, 80],
      C_RAILTOP = [176, 184, 194], C_PLAT = [150, 150, 141], C_PLATSIDE = [112, 110, 103],
      C_COPING = [196, 191, 176], C_YELLOW = [228, 182, 38], C_CANOPY = [58, 68, 80],
      C_STEEL = [96, 106, 118], C_BRIDGE = [74, 84, 96], C_POST = [58, 62, 68],
      C_HEAD = [46, 50, 57];

  /* ---------------- projection ---------------- */
  function toCam(x, y) {
    var dx = x - cam.x, dy = y - cam.y;
    return { f: dx * cam.ca + dy * cam.sa, l: -dx * cam.sa + dy * cam.ca };
  }
  function P3(c, z) { return { f: c.f, l: c.l, z: z }; }
  function sx(p) { return W / 2 + p.l / p.f * focal; }
  function sy(p) { return hz + (EYE - p.z) / p.f * focal; }

  /* Clip a camera-space polygon to the near plane (Sutherland–Hodgman). */
  function clipPoly(ps) {
    var out = [], n = ps.length, i, a, b, t, ain, bin;
    for (i = 0; i < n; i++) {
      a = ps[i]; b = ps[(i + 1) % n];
      ain = a.f >= NEAR; bin = b.f >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        t = (NEAR - a.f) / (b.f - a.f);
        out.push({ f: NEAR, l: a.l + (b.l - a.l) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    return out.length >= 3 ? out : null;
  }
  function fillPoly(ps, style) {
    var c = clipPoly(ps), i;
    if (!c) return;
    ctx.beginPath();
    ctx.moveTo(sx(c[0]), sy(c[0]));
    for (i = 1; i < c.length; i++) ctx.lineTo(sx(c[i]), sy(c[i]));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }
  /* Stroke a camera-space polyline, clipped to the near plane. */
  function strokeLine(ps, style, width) {
    var i, a, b, t, open = false;
    ctx.beginPath();
    for (i = 1; i < ps.length; i++) {
      a = ps[i - 1]; b = ps[i];
      if (a.f < NEAR && b.f < NEAR) { open = false; continue; }
      if (a.f < NEAR) { t = (NEAR - a.f) / (b.f - a.f); a = { f: NEAR, l: a.l + (b.l - a.l) * t, z: a.z + (b.z - a.z) * t }; open = false; }
      if (b.f < NEAR) { t = (NEAR - a.f) / (b.f - a.f); b = { f: NEAR, l: a.l + (b.l - a.l) * t, z: a.z + (b.z - a.z) * t }; }
      if (!open) { ctx.moveTo(sx(a), sy(a)); open = true; }
      ctx.lineTo(sx(b), sy(b));
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /* A box standing on the plan footprint c (four corners, clockwise on the
     map), from z0 up to z1. Only the faces turned toward the camera are
     drawn, so painting boxes far-to-near is enough to hide what's behind.
     opts.face(i, a, b, k, lit) decorates a side once it's painted. */
  function drawBox(c, z0, z1, side, top, d, opts) {
    var k = fogK(d), cc = [], i, a, b, nx, ny, mx, my, ln, lit;
    for (i = 0; i < 4; i++) cc.push(toCam(c[i].x, c[i].y));
    for (i = 0; i < 4; i++) {
      a = c[i]; b = c[(i + 1) % 4];
      nx = b.y - a.y; ny = -(b.x - a.x);                 // outward normal
      mx = (a.x + b.x) / 2 - cam.x; my = (a.y + b.y) / 2 - cam.y;
      if (nx * mx + ny * my >= 0) continue;              // turned away
      ln = Math.sqrt(nx * nx + ny * ny) || 1;
      lit = 0.66 + 0.34 * Math.max(0, (nx * LIGHT.x + ny * LIGHT.y) / ln);
      fillPoly([P3(cc[i], z0), P3(cc[(i + 1) % 4], z0), P3(cc[(i + 1) % 4], z1), P3(cc[i], z1)],
               col(side, k, lit));
      if (opts && opts.face) opts.face(i, cc[i], cc[(i + 1) % 4], k, lit);
    }
    if (EYE > z1 && top) {
      fillPoly([P3(cc[0], z1), P3(cc[1], z1), P3(cc[2], z1), P3(cc[3], z1)], col(top, k, 1));
      if (opts && opts.top) opts.top(cc, k);
    } else if (EYE < z0) {
      fillPoly([P3(cc[0], z0), P3(cc[1], z0), P3(cc[2], z0), P3(cc[3], z0)], col(side, k, 0.5));
    }
  }
  function rect(x0, y0, x1, y1) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }


  /* Every other station's platforms, footbridge and buildings. */
  function buildStation(w) {
    // Platforms: each island cut into short blocks, so a block can be
    // sorted against the trains either side of it.
    RY.ISLANDS.forEach(function (isl) {
      var u = RY.platSpan(isl.upper), lo = RY.platSpan(isl.lower), midY = (isl.y0 + isl.y1) / 2;
      var x0 = Math.min(u.x0, lo.x0), x1 = Math.max(u.x1, lo.x1), x, xb, mx, hasU, hasL;
      for (x = x0; x < x1 - 0.5; x = xb) {
        xb = Math.min(x1, x + 40); mx = (x + xb) / 2;
        hasU = mx >= u.x0 && mx <= u.x1; hasL = mx >= lo.x0 && mx <= lo.x1;
        w.solids.push({ kind: 'plat', c: rect(x, hasU ? isl.y0 : midY, xb, hasL ? isl.y1 : midY),
                        z0: 0, z1: PLAT_H, edgeT: hasU, edgeB: hasL });
      }
      var core = RY.islandCore(isl), cx0 = core.x0 + 46, cx1 = core.x1 - 46;
      for (x = cx0; x < cx1 - 0.5; x = xb) {
        xb = Math.min(cx1, x + 60);
        w.solids.push({ kind: 'canopy', c: rect(x, midY - 17, xb, midY + 17), z0: 44, z1: 49 });
      }
      for (x = cx0 + 20; x < cx1 - 4; x += 62) {
        w.solids.push({ kind: 'col', c: rect(x - 1.5, midY - 1.5, x + 1.5, midY + 1.5), z0: PLAT_H, z1: 44 });
      }
      w.solids.push({ kind: 'stair', c: rect(L.stopX - 55, midY - 23, L.stopX - 17, midY + 21),
                      z0: PLAT_H, z1: 60 });
    });

    // The footbridge overhead, in blocks across the tracks it spans.
    var y, yb;
    for (y = 268; y < 884; y = yb) {
      yb = Math.min(884, y + 40);
      w.solids.push({ kind: 'bridge', c: rect(L.stopX - 14, y, L.stopX + 14, yb), z0: 60, z1: 70 });
    }
    // The buildings the map draws, as plain blocks.
    w.solids.push({ kind: 'bldg', rgb: [111, 91, 71], c: rect(660, 50, 1252, 142), z0: 0, z1: 96 });
    w.solids.push({ kind: 'bldg', rgb: [125, 90, 60], c: rect(84, 902, 200, 976), z0: 0, z1: 58 });
    w.solids.push({ kind: 'bldg', rgb: [77, 85, 96], c: rect(1492, 912, 1678, 970), z0: 0, z1: 44 });
  }

  /* ---------------- the Indian station ---------------- */
  /* style: 'india' — the same things the map draws for it (scene.js,
     drawIslandIndia and drawBuildingsIndia), stood up: stone-tiled decks
     with a broad band of yellow tactile paving, green corrugated sheds —
     pitched over an island, a lean-to off the building over platform 1 —
     on green columns, stalls and water booths at the open ends, the black-
     on-yellow boards, and the station building with its tiled roof and
     clock tower. Concrete sleepers, as Indian track is laid. */
  var IN_PLAT = [184, 170, 140], IN_PLATSIDE = [132, 120, 98], IN_SHED = [96, 132, 102],
      IN_FASCIA = [62, 84, 66], IN_UNDER = [70, 78, 70], IN_COL = [78, 104, 84], IN_YELLOW = [242, 195, 24],
      IN_WALL = [216, 199, 159], IN_ROOF = [178, 93, 66];
  function prism(w, x0, x1, cy, prof, rgb) {
    // a roof or shed along x, in 60-long blocks so each sorts on its own
    var x, xb, ys = prof.map(function (q) { return q[0]; });
    for (x = x0; x < x1 - 0.5; x = xb) {
      xb = Math.min(x1, x + 60);
      w.solids.push({ kind: 'prism', c: rect(x, cy + Math.min.apply(null, ys), xb, cy + Math.max.apply(null, ys)),
                      o: { x: (x + xb) / 2, y: cy, ca: 1, sa: 0 }, secs: [{ u: (x - xb) / 2, p: prof }, { u: (xb - x) / 2, p: prof }],
                      rgb: rgb });
    }
  }
  function buildIndia(w) {
    w.sleeper = [134, 130, 122];
    RY.ISLANDS.forEach(function (isl) {
      var u = isl.upper && RY.platSpan(isl.upper), lo = isl.lower && RY.platSpan(isl.lower);
      var y0 = isl.y0, y1 = isl.y1, midY = (y0 + y1) / 2, sp = [u, lo].filter(Boolean);
      var x0 = Math.min.apply(null, sp.map(function (q) { return q.x0; })), x1 = Math.max.apply(null, sp.map(function (q) { return q.x1; }));
      var x, xb, mx, hasU, hasL, c;
      for (x = x0; x < x1 - 0.5; x = xb) {
        xb = Math.min(x1, x + 40); mx = (x + xb) / 2;
        hasU = !!u && mx >= u.x0 && mx <= u.x1; hasL = !!lo && mx >= lo.x0 && mx <= lo.x1;
        if (!hasU && !hasL) continue;
        c = isl.side ? rect(x, y0, xb, y1) : rect(x, hasU ? y0 : midY, xb, hasL ? y1 : midY);
        w.solids.push({ kind: 'plat', c: c, z0: 0, z1: PLAT_H, edgeT: hasU, edgeB: hasL,
                        top: IN_PLAT, side: IN_PLATSIDE, tac: [3, 9] });
      }
      var core = RY.islandCore(isl), cl = core.x1 - core.x0, cx0 = core.x0 + cl * 0.17, cx1 = core.x1 - cl * 0.17;
      var hw = (y1 - y0) / 2 + 2, colY = [midY], sheds;
      if (!isl.side) {                                             // pitched, ridge along the middle
        sheds = [[-hw, 41], [hw, 41], [hw, 42.6], [0, 49], [-hw, 42.6]];
      } else if (isl.lower) {                                      // lean-to, high against the building to the north
        sheds = [[-hw, 41], [hw, 41], [hw, 42.6], [-hw, 49]];
        colY = [y1 - 7];
      } else {                                                     // lean-to, high to the south
        sheds = [[-hw, 41], [hw, 41], [hw, 49], [-hw, 42.6]];
        colY = [y0 + 7];
      }
      prism(w, cx0, cx1, midY, sheds, [IN_SHED, IN_FASCIA, IN_UNDER]);
      colY.forEach(function (cy) {
        for (x = cx0 + 20; x < cx1 - 4; x += 62) {
          w.solids.push({ kind: 'box', rgb: IN_COL, top: IN_COL, c: rect(x - 1.5, cy - 1.5, x + 1.5, cy + 1.5), z0: PLAT_H, z1: 41 });
        }
      });
      // a yellow platform-number board hung under each end of the shed, facing along the track
      [cx0 + 3, cx1 - 3].forEach(function (bx) {
        w.solids.push({ kind: 'box', rgb: IN_YELLOW, top: IN_YELLOW, c: rect(bx - 0.6, midY - 6.5, bx + 0.6, midY + 6.5), z0: 31, z1: 38 });
      });
      // the open ends: a stall, a water booth
      var backY = isl.side ? (isl.lower ? y0 + 8 : y1 - 8) : midY;
      [[core.x0 + 22, cx0 - 8], [cx1 + 8, core.x1 - 22]].forEach(function (seg, n) {
        var m = (seg[0] + seg[1]) / 2, sx = m - (n ? -12 : 12), bx = m + (n ? -30 : 30);
        if (seg[1] - seg[0] < 40) return;
        w.solids.push({ kind: 'box', rgb: [107, 90, 69], top: n ? [47, 111, 178] : [200, 65, 45],
                        c: rect(sx - 13, backY - 6, sx + 13, backY + 6), z0: PLAT_H, z1: PLAT_H + 21 });
        w.solids.push({ kind: 'box', rgb: [215, 221, 226], top: [47, 127, 193],
                        c: rect(bx - 5, backY - 4, bx + 5, backY + 4), z0: PLAT_H, z1: PLAT_H + 15 });
      });
      // the station's name boards on the side platforms, on their posts
      if (isl.side) {
        [core.x0 + 170, core.x1 - 170].forEach(function (bx) {
          w.solids.push({ kind: 'box', rgb: IN_YELLOW, top: IN_YELLOW, c: rect(bx - 22, backY - 0.7, bx + 22, backY + 0.7), z0: 26, z1: 35 });
          [-18, 18].forEach(function (d) {
            w.solids.push({ kind: 'box', rgb: [40, 40, 40], top: [40, 40, 40], c: rect(bx + d - 0.6, backY - 0.6, bx + d + 0.6, backY + 0.6), z0: PLAT_H, z1: 26 });
          });
        });
      }
      w.solids.push({ kind: 'stair', c: rect(L.stopX - 55, midY - 20, L.stopX - 17, midY + 20), z0: PLAT_H, z1: 60 });
    });

    // the footbridge, side platform to side platform
    var fy0 = RY.ISLANDS[0].y0 + 6, fy1 = RY.ISLANDS[RY.ISLANDS.length - 1].y1 - 6, y, yb;
    for (y = fy0; y < fy1; y = yb) {
      yb = Math.min(fy1, y + 40);
      w.solids.push({ kind: 'bridge', c: rect(L.stopX - 14, y, L.stopX + 14, yb), z0: 60, z1: 70 });
    }

    // the station building (scene.js drawBuildingsIndia lays it out the same way)
    var p1 = RY.ISLANDS[0], sp1 = RY.platSpan(p1.lower), bx0 = sp1.x0 + 38, bx1 = sp1.x1 - 38, cx = (bx0 + bx1) / 2;
    var by0 = 120, by1 = p1.y0, ridge = (by0 + 6 + by1 - 6) / 2, rw = (by1 - by0) / 2 - 6;
    w.solids.push({ kind: 'box', rgb: IN_WALL, top: IN_WALL, c: rect(bx0, by0, bx1, by1), z0: 0, z1: 44 });
    prism(w, bx0 + 34, bx1 - 34, ridge, [[-rw, 44], [rw, 44], [rw, 46], [0, 64], [-rw, 46]], [IN_ROOF, [150, 76, 52], [120, 60, 42]]);
    w.solids.push({ kind: 'box', rgb: [232, 219, 186], top: [232, 219, 186], c: rect(cx - 32, ridge - 32, cx + 32, ridge + 32), z0: 0, z1: 84 });
    w.solids.push({ kind: 'box', rgb: [206, 190, 150], top: [242, 236, 218], c: rect(cx - 20, ridge - 20, cx + 20, ridge + 20), z0: 84, z1: 96 });
    // the overhead water tank
    var tx = bx0 - 110, ty = by0 + 44;
    w.solids.push({ kind: 'box', rgb: [120, 116, 106], top: [120, 116, 106], c: rect(tx - 4, ty - 4, tx + 4, ty + 4), z0: 0, z1: 52 });
    w.solids.push({ kind: 'box', rgb: [176, 170, 156], top: [186, 180, 166], c: rect(tx - 24, ty - 24, tx + 24, ty + 24), z0: 52, z1: 76 });
    // the cabin and the P-way store
    w.solids.push({ kind: 'bldg', rgb: [201, 180, 138], c: rect(84, 902, 200, 962), z0: 0, z1: 46 });
    w.solids.push({ kind: 'bldg', rgb: [124, 110, 88], c: rect(1492, 912, 1678, 970), z0: 0, z1: 40 });
  }

  /* ---------------- the world, built once per baked scene ---------------- */
  function build() {
    var w = { chunks: [], sleepers: [], solids: [], wires: [], masts: [] };

    // Track: every piece the map draws, resampled and cut into chunks so
    // each can be culled, clipped and fogged on its own.
    RY.buildTrackwork().forEach(function (P) {
      var n = Math.max(1, Math.ceil(P.len / STEP)), i, j, s, p, cl = [], nm = [];
      for (i = 0; i <= n; i++) {
        p = RY.pathAt(P, P.len * i / n);
        cl.push({ x: p.x, y: p.y });
        nm.push({ x: -Math.sin(p.a), y: Math.cos(p.a) });
      }
      for (i = 0; i < n; i += CHUNK) {
        j = Math.min(n, i + CHUNK);
        w.chunks.push({ cx: (cl[i].x + cl[j].x) / 2, cy: (cl[i].y + cl[j].y) / 2,
                        r: STEP * CHUNK / 2 + 30, c: cl.slice(i, j + 1), n: nm.slice(i, j + 1) });
      }
      for (s = 10; s < P.len; s += 20) {
        p = RY.pathAt(P, s);
        w.sleepers.push({ x: p.x, y: p.y, a: p.a });
      }
    });

    if (RY.station.style === 'india') buildIndia(w); else buildStation(w);

    // Overhead line: the wire along each electrified path, masts either side.
    (RY.olePaths || []).forEach(function (P) {
      var n = Math.max(1, Math.ceil(P.len / STEP)), i, j, s, p, pts = [], o;
      for (i = 0; i <= n; i++) { p = RY.pathAt(P, P.len * i / n); pts.push({ x: p.x, y: p.y }); }
      for (i = 0; i < n; i += CHUNK) {
        j = Math.min(n, i + CHUNK);
        w.wires.push({ cx: (pts[i].x + pts[j].x) / 2, cy: (pts[i].y + pts[j].y) / 2, pts: pts.slice(i, j + 1) });
      }
      for (s = 0; s < P.masts.length; s++) {                    // placed by scene.js drawOLE
        p = RY.pathAt(P, P.masts[s]);
        for (o = -1; o <= 1; o += 2) {
          w.masts.push({ x: p.x - Math.sin(p.a) * o * 31, y: p.y + Math.cos(p.a) * o * 31, wx: p.x, wy: p.y });
        }
      }
    });
    return w;
  }

  /* ---------------- camera ---------------- */
  /* In the front cab, looking along the lead vehicle's body — the same
     rigid body the map draws, so the view yaws through a curve with it. */
  function placeCamera(tr) {
    var v0 = tr.vehicles[0], cs = Math.max(0, tr.s - v0.mid);
    var p = RY.pathAt(tr.path, cs), fwd = (v0.len - 8) / 2 - 6;
    cam.a = p.a; cam.ca = Math.cos(p.a); cam.sa = Math.sin(p.a);
    cam.x = p.x + cam.ca * fwd; cam.y = p.y + cam.sa * fwd;
  }
  function near(x, y, r) {
    var dx = x - cam.x, dy = y - cam.y, f = dx * cam.ca + dy * cam.sa;
    return f > -r && dx * dx + dy * dy < (FAR + r) * (FAR + r);
  }
  function dist(x, y) { var dx = x - cam.x, dy = y - cam.y; return Math.sqrt(dx * dx + dy * dy); }

  /* ---------------- drawing ---------------- */
  /* Blend a daytime colour toward its dusk counterpart. */
  function dusk(day, eve) {
    var t = Math.min(1, night * 1.6);
    return 'rgb(' + day.map(function (v, i) { return (v + (eve[i] - v) * t) | 0; }).join(',') + ')';
  }
  function sky() {
    var g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, dusk([88, 128, 172], [14, 20, 40]));
    g.addColorStop(1, dusk([206, 216, 222], [66, 62, 88]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz + 1);
    g = ctx.createLinearGradient(0, hz, 0, H);
    g.addColorStop(0, 'rgb(' + haze.join(',') + ')');
    g.addColorStop(0.18, col([96, 112, 84], 0.45, 1));
    g.addColorStop(1, col([64, 80, 56], 0, 1));
    ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
  }

  /* The strip of ground between lateral offsets o0 and o1 along a chunk of
     track, at height z — ballast, a rail's foot, a rail's running surface.
     Drawn as a polygon, so its width is right at every distance and it
     clips cleanly where it passes under the camera. */
  function strip(ch, o0, o1, z) {
    var a = [], b = [], i, c, n;
    for (i = 0; i < ch.c.length; i++) {
      c = ch.c[i]; n = ch.n[i];
      a.push(P3(toCam(c.x + n.x * o0, c.y + n.y * o0), z));
      b.push(P3(toCam(c.x + n.x * o1, c.y + n.y * o1), z));
    }
    return a.concat(b.reverse());
  }

  function groundLayer(w) {
    var list = [], i, ch, c, k, d, j, o;
    for (i = 0; i < w.chunks.length; i++) {
      ch = w.chunks[i];
      if (near(ch.cx, ch.cy, ch.r)) list.push(ch);
    }
    // ballast
    for (i = 0; i < list.length; i++) {
      ch = list[i];
      fillPoly(strip(ch, -25, 25, 0), col(C_BALLAST, fogK(dist(ch.cx, ch.cy)), 1));
    }
    // sleepers, close in
    for (i = 0; i < w.sleepers.length; i++) {
      var sl = w.sleepers[i];
      if (!near(sl.x, sl.y, 20)) continue;
      d = dist(sl.x, sl.y);
      if (d > SLEEPER_FAR) continue;
      var ca = Math.cos(sl.a), sa = Math.sin(sl.a), hx = ca * 4, hy = sa * 4, px = -sa * 15, py = ca * 15;
      c = [toCam(sl.x + hx - px, sl.y + hy - py), toCam(sl.x + hx + px, sl.y + hy + py),
           toCam(sl.x - hx + px, sl.y - hy + py), toCam(sl.x - hx - px, sl.y - hy - py)];
      fillPoly([P3(c[0], 0.4), P3(c[1], 0.4), P3(c[2], 0.4), P3(c[3], 0.4)], col(w.sleeper || C_SLEEPER, fogK(d), 1));
    }
    // rails: the dark foot and web, and the polished running surface on top
    for (i = 0; i < list.length; i++) {
      ch = list[i]; d = dist(ch.cx, ch.cy); k = fogK(d);
      for (j = -1; j <= 1; j += 2) {
        o = j * 8.6;
        fillPoly(strip(ch, o - 1.1, o + 1.1, 1.0), col(C_RAIL, k, 1));
        fillPoly(strip(ch, o - 0.5, o + 0.5, 1.8), col(C_RAILTOP, k, 1 + 0.3 * night));
      }
    }
  }

  /* ---------------- rolling stock ---------------- */
  /* Each vehicle is modelled in its own frame — u along it (its front is
     +u), v across it (right is +v), z up from the rail — to match what the
     map draws for it: the same cab ends, doors, grilles, pantographs and
     loads, stood up. A body is a loft through a few cross-sections, so a
     cab can taper to a raked nose; being convex, it needs no sorting within
     itself, only the faces that turn toward us. */
  var LC = { f: 0, l: 0, z: 1 };            // the light, in camera space (set per frame)
  function Vf(o, u, v, z) {
    var c = toCam(o.x + u * o.ca - v * o.sa, o.y + u * o.sa + v * o.ca);
    return { f: c.f, l: c.l, z: z };
  }
  function shadeRgb(c, a) {
    return c.map(function (x) { return a > 0 ? x + (255 - x) * a : x * (1 + a); });
  }

  /* The body's cross-section: straight sides, cantrails rolling into a
     flat roof — so an end seen head-on has shoulders, not corners. */
  function prof(hw, h, z0) {
    z0 = z0 || 7;
    return [[-hw, z0], [hw, z0], [hw, h - 9], [hw - 3, h - 3.5], [hw - 8, h], [8 - hw, h],
            [3 - hw, h - 3.5], [-hw, h - 9]];
  }
  /* A multiple unit's streamlined cab: the roof rolls down into a raked
     windscreen and the nose narrows, over its last 20px. du is how far back
     from the very end each section sits. */
  function emuNose(hw, h) {
    return [{ du: 20, p: prof(hw, h) },
            { du: 9, p: [[-hw, 7], [hw, 7], [hw, 24], [hw - 3, 31], [hw - 9, h - 2.5], [9 - hw, h - 2.5], [3 - hw, 31], [-hw, 24]] },
            { du: 0, p: [[2 - hw, 7], [hw - 2, 7], [hw - 2, 18], [hw - 5, 23], [hw - 11, 26.5], [11 - hw, 26.5], [5 - hw, 23], [2 - hw, 18]] }];
  }
  /* Vande Bharat's: a long, low, pointed nose, forty units of it. */
  function aeroNose(hw, h) {
    return [{ du: 40, p: prof(hw, h) },
            { du: 22, p: [[-hw, 7], [hw, 7], [hw, 26], [hw - 4, 33], [hw - 10, h - 3], [10 - hw, h - 3], [4 - hw, 33], [-hw, 26]] },
            { du: 8,  p: [[3 - hw, 7], [hw - 3, 7], [hw - 3, 19], [hw - 7, 24], [hw - 12, 27], [12 - hw, 27], [7 - hw, 24], [3 - hw, 19]] },
            { du: 0,  p: [[-8, 7], [8, 7], [8, 14], [5, 18], [2, 19.5], [-2, 19.5], [-5, 18], [-8, 14]] }];
  }
  /* A locomotive's: flat-fronted, with just the windscreen raked back. */
  function locoNose(hw, h) {
    return [{ du: 7, p: prof(hw, h) },
            { du: 0, p: [[1 - hw, 7], [hw - 1, 7], [hw - 1, 21], [hw - 3, 29], [hw - 8, h - 6], [8 - hw, h - 6], [3 - hw, 29], [1 - hw, 21]] }];
  }
  function sections(hl, base, noseR, noseF) {
    var out = [];
    if (noseR) noseR.slice().reverse().forEach(function (n) { out.push({ u: -hl + n.du, p: n.p }); });
    else out.push({ u: -hl, p: base });
    if (noseF) noseF.forEach(function (n) { out.push({ u: hl - n.du, p: n.p }); });
    else out.push({ u: hl, p: base });
    return out;
  }
  function boxSecs(u0, u1, v0, v1, z0, z1) {
    var p = [[v0, z0], [v1, z0], [v1, z1], [v0, z1]];
    return [{ u: u0, p: p }, { u: u1, p: p }];
  }

  /* Draw a convex solid lofted through `secs`, painting each face that
     faces us. paint(face) gives its colour: face.edge is which side of the
     cross-section it came from, face.cap is -1/+1 for the rear/front end. */
  function solid(o, secs, k, paint) {
    var S = secs.map(function (sc) { return sc.p.map(function (q) { return Vf(o, sc.u, q[0], q[1]); }); });
    var n = secs[0].p.length, faces = [], i, j, m, cen = { f: 0, l: 0, z: 0 }, cnt = 0;
    for (m = 0; m < S.length; m++) for (i = 0; i < n; i++) { cen.f += S[m][i].f; cen.l += S[m][i].l; cen.z += S[m][i].z; cnt++; }
    cen.f /= cnt; cen.l /= cnt; cen.z /= cnt;
    for (m = 0; m < S.length - 1; m++) for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      faces.push({ p: [S[m][i], S[m][j], S[m + 1][j], S[m + 1][i]], edge: i, sec: m });
    }
    faces.push({ p: S[0], cap: -1 });
    faces.push({ p: S[S.length - 1], cap: 1 });
    faces.forEach(function (fc) {
      var p = fc.p, nf = 0, nl = 0, nz = 0, cf = 0, cl = 0, cz = 0, a, b, len;
      for (i = 0; i < p.length; i++) {                       // Newell's normal
        a = p[i]; b = p[(i + 1) % p.length];
        nf += (a.l - b.l) * (a.z + b.z); nl += (a.z - b.z) * (a.f + b.f); nz += (a.f - b.f) * (a.l + b.l);
        cf += a.f; cl += a.l; cz += a.z;
      }
      cf /= p.length; cl /= p.length; cz /= p.length;
      len = Math.sqrt(nf * nf + nl * nl + nz * nz);
      if (len < 1e-6) return;                                // a face squeezed to nothing
      if ((cf - cen.f) * nf + (cl - cen.l) * nl + (cz - cen.z) * nz < 0) { nf = -nf; nl = -nl; nz = -nz; }
      if (cf * nf + cl * nl + (cz - EYE) * nz >= 0) return;  // turned away from us
      var lit = 0.5 + 0.5 * Math.max(0, (nf * LC.f + nl * LC.l + nz * LC.z) / len);
      fillPoly(p, col(paint(fc), k, lit));
    });
  }
  /* Where we are in a vehicle's own frame — which ends and sides we can see. */
  function localEye(o) {
    var dx = cam.x - o.x, dy = cam.y - o.y;
    return { u: dx * o.ca + dy * o.sa, v: -dx * o.sa + dy * o.ca };
  }
  /* A flat panel on a side (v = side*hw) or an end (u = u), laid just proud of it. */
  function onSide(o, side, hw, u0, u1, z0, z1, style) {
    var v = side * (hw + 0.08);
    fillPoly([Vf(o, u0, v, z0), Vf(o, u1, v, z0), Vf(o, u1, v, z1), Vf(o, u0, v, z1)], style);
  }
  function onEnd(o, u, v0, v1, z0, z1, style) {
    fillPoly([Vf(o, u, v0, z0), Vf(o, u, v1, z0), Vf(o, u, v1, z1), Vf(o, u, v0, z1)], style);
  }
  function line3(o, a, b, style, wWorld) {
    var A = Vf(o, a[0], a[1], a[2]), B = Vf(o, b[0], b[1], b[2]);
    strokeLine([A, B], style, Math.max(0.5, wWorld * focal / Math.max(20, (A.f + B.f) / 2)));
  }

  var C_BOGIE = [34, 36, 40], C_WHEEL = [22, 22, 24], C_GLASS = [28, 38, 50], C_YWARN = [210, 168, 40],
      C_BUFFER = [52, 55, 60], C_BELLOWS = [30, 32, 36], C_HOPPERLOAD = [118, 110, 98], C_TANK = [150, 158, 166];
  var CONTAINERS = ['#b3542f', '#2f6f8f', '#5c8a3a', '#8a8f96', '#a8952f'];

  /* Glass: dark by day, lit warm from inside once the light goes. */
  function glassStyle(k, lit) {
    var c = C_GLASS.map(function (x, i) { return x * lit + ([255, 214, 140][i] - x * lit) * night * 0.7; });
    return 'rgb(' + c.map(function (x, i) { return (x + (haze[i] - x) * k) | 0; }).join(',') + ')';
  }

  function bogies(o, hl, hw, inset, bl, k, eye) {
    [-1, 1].forEach(function (e) {
      var bu = e * (hl - inset);
      solid(o, boxSecs(bu - bl, bu + bl, 3 - hw, hw - 3, 1.5, 7.2), k, function () { return C_BOGIE; });
      var side = eye.v > 0 ? 1 : -1, v = side * (hw - 2.2), w;
      [-0.55, 0.55].forEach(function (a) {                   // a wheel, then its axlebox
        var cu = bu + a * bl, pts = [];
        for (w = 0; w < 8; w++) pts.push(Vf(o, cu + Math.cos(w * 0.785) * 3.9, v, 4.3 + Math.sin(w * 0.785) * 3.9));
        fillPoly(pts, col(C_WHEEL, k, 1));
        onSide(o, side, hw - 2.1, cu - 1.4, cu + 1.4, 3.3, 5.3, col([70, 74, 80], k, 1));
      });
    });
  }
  function buffersAt(o, u, dir, k) {
    [-11, 11].forEach(function (v) {
      solid(o, boxSecs(u, u + dir * 3.2, v - 2.2, v + 2.2, 9.2, 13.6), k, function (fc) {
        return fc.cap ? [150, 154, 160] : C_BUFFER;
      });
    });
    solid(o, boxSecs(u, u + dir * 2.4, -2.2, 2.2, 9.8, 12.8), k, function () { return [40, 42, 46]; });
  }
  function bellowsAt(o, u, dir, k) {
    solid(o, boxSecs(u, u + dir * 5, -9, 9, 9, 33), k, function () { return C_BELLOWS; });
  }
  /* A pantograph: base on the roof at u0; raised, its head bears on the wire. */
  function pantograph(o, u0, h, raised, k) {
    var st = col([54, 58, 64], k, 1), head = raised ? WIRE_Z - 0.6 : h + 3.4, i;
    for (i = -1; i <= 1; i += 2) {
      if (raised) {
        line3(o, [u0 - 7, i * 5, h + 1], [u0 + 4, i * 3, (h + head) / 2 + 1], st, 0.8);
        line3(o, [u0 + 4, i * 3, (h + head) / 2 + 1], [u0 - 1, i * 1.2, head], st, 0.7);
      } else {
        line3(o, [u0 - 7, i * 5, h + 1], [u0 + 8, i * 2.5, h + 3], st, 0.8);
      }
    }
    var hu = raised ? u0 - 1 : u0 + 8;
    line3(o, [hu, -9, head], [hu, 9, head], col([34, 36, 40], k, 1), 1.1);
    line3(o, [hu + 1.6, -8, head], [hu + 1.6, 8, head], col([34, 36, 40], k, 1), 0.8);
  }
  /* The lamps on an end face, from the table the map draws them from
     (RY.LAMPS, train.js): at the head of the train all white, at its tail
     the red-capable ones red, and dark anywhere else. */
  var L_WHITE = [255, 246, 214], L_RED = [255, 62, 44], L_OFF = [196, 202, 208];
  function endLamps(o, u, set, mode, k) {
    set.forEach(function (q) {
      var P = Vf(o, u, q[0], q[1]);
      if (P.f < NEAR) return;
      var rgb = mode === 'head' ? L_WHITE : mode === 'tail' && q[3] ? L_RED : L_OFF, on = rgb !== L_OFF;
      var x = sx(P), y = sy(P), r = Math.max(0.8, q[2] * 0.6 * focal / P.f);
      ctx.fillStyle = 'rgba(' + rgb.join(',') + ',' + (1 - k * 0.7) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      if (on && night > 0.05) glow(x, y, r * 5, rgb, 0.5 * night * (1 - k));
    });
  }
  function lampMode(head, tail) { return head ? 'head' : tail ? 'tail' : ''; }
  function windscreen(o, u, dir, hw, zb, zt, rake, twoPane, k, lit) {
    var ub = u - dir * 0.7, ut = u - dir * rake, style = glassStyle(k, lit + 0.15);
    if (twoPane) {
      [-1, 1].forEach(function (sd) {
        fillPoly([Vf(o, ub, sd * 1.2, zb), Vf(o, ub, sd * (hw - 4), zb), Vf(o, ut, sd * (hw - 6.5), zt), Vf(o, ut, sd * 1.2, zt)], style);
      });
    } else {
      fillPoly([Vf(o, ub, -(hw - 4), zb), Vf(o, ub, hw - 4, zb), Vf(o, ut, hw - 6, zt), Vf(o, ut, -(hw - 6), zt)], style);
    }
  }

  /* Windows along a passenger side, between the given door spans. style:
     'bars' for an Indian non-AC coach's barred windows, 'ac' for an AC
     coach's wider, sealed, tinted ones. */
  function windowRow(o, side, hw, u0, u1, doors, k, lit, style) {
    var spans = [[u0, u1]], out, i, d, a, b, u, w = style === 'ac' ? 11 : 7.2, gap = style === 'ac' ? 4.5 : 2.6;
    doors.forEach(function (d0) {
      out = [];
      spans.forEach(function (sp) {
        if (d0[1] <= sp[0] || d0[0] >= sp[1]) { out.push(sp); return; }
        if (d0[0] > sp[0]) out.push([sp[0], d0[0]]);
        if (d0[1] < sp[1]) out.push([d0[1], sp[1]]);
      });
      spans = out;
    });
    for (i = 0; i < spans.length; i++) {
      a = spans[i][0] + 2; b = spans[i][1] - 2;
      var n = Math.max(0, Math.floor((b - a + gap) / (w + gap)));
      if (!n) continue;
      var pitch = (b - a + gap) / n;
      for (d = 0; d < n; d++) {
        u = a + d * pitch;
        onSide(o, side, hw, u, u + pitch - gap, 20.5, 30, glassStyle(k, style === 'ac' ? lit * 0.55 : lit));
        if (style === 'bars') {
          for (var z = 22.4; z < 29.5; z += 2.4) onSide(o, side, hw + 0.05, u, u + pitch - gap, z, z + 0.45, col([150, 156, 162], k, lit));
        }
      }
    }
  }

  function vehicleItem(tr, vh, isFront, isRear) {
    var cs = tr.s - vh.mid;
    if (cs < 0) return null;
    var p = RY.pathAt(tr.path, cs);
    if (!near(p.x, p.y, 70)) return null;
    var d = dist(p.x, p.y), o = { x: p.x, y: p.y, ca: Math.cos(p.a), sa: Math.sin(p.a) };
    var hl = vh.len / 2 - 4, hw = 19, fx = o.ca * hl, fy = o.sa * hl, wx = -o.sa * hw, wy = o.ca * hw;   // its footprint, clear of its neighbours'
    var fp = footprint([{ x: p.x + fx + wx, y: p.y + fy + wy }, { x: p.x + fx - wx, y: p.y + fy - wy },
                      { x: p.x - fx - wx, y: p.y - fy - wy }, { x: p.x - fx + wx, y: p.y - fy + wy }]);
    return { d: d, veh: true, fp: fp, fn: function () { drawVehicle(tr, vh, o, fogK(d), isFront, isRear); } };
  }

  /* The diesel, laid out exactly as the map draws it — a grey long hood on
     a dark running plate, and a warning-yellow cab block at the leading end
     whose nose tapers to a point — then stood up as a hood unit: the cab
     rides high behind a short, low nose, the hood carries its radiator
     grilles, fan shrouds and exhaust, and walkways with handrails run down
     both sides above a fuel tank and a pair of three-axle trucks. */
  var DEF_FRAME = [66, 74, 83], DEF_HOOD = [122, 132, 142], DEF_CAB = [201, 162, 39],
      D_WALK = [132, 140, 150], D_DARK = [28, 31, 35], D_RAIL = [214, 222, 230];

  function drawDiesel(tr, vh, o, k, eye, side, isFront, isRear) {
    // grey hood, warning-yellow cab — or the railway's own livery, as on the map
    var lv = tr.cfg.loco, D_HOOD = lv ? rgbOf(lv.body) : DEF_HOOD;
    var D_FRAME = lv ? shadeRgb(D_HOOD, -0.45) : DEF_FRAME, D_CAB = lv ? shadeRgb(D_HOOD, 0.06) : DEF_CAB;
    var BL = vh.len - 8, hw = 18.5, hl = BL / 2, lit = 0.86;
    var hood0 = -hl + 7, cab0 = BL * 0.12, nose0 = hl - 22, tip = hl - 1;
    var hh = 13, cw = 17.3;

    function truck(bu) {
      solid(o, boxSecs(bu - 12, bu + 12, 2.5 - hw, hw - 2.5, 1.5, 8), k, function () { return [34, 36, 41]; });
      var v = side * (hw - 2.2), w, cu, pts, i;
      for (i = -1; i <= 1; i++) {
        cu = bu + i * 8; pts = [];
        for (w = 0; w < 8; w++) pts.push(Vf(o, cu + Math.cos(w * 0.785) * 3.7, v, 4.2 + Math.sin(w * 0.785) * 3.7));
        fillPoly(pts, col(C_WHEEL, k, 1));
        onSide(o, side, hw - 2.1, cu - 1.3, cu + 1.3, 3.2, 5.2, col([84, 88, 94], k, 1));
      }
      onSide(o, side, hw - 2.1, bu - 11, bu + 11, 6.4, 7.6, col([48, 50, 56], k, 1));   // the side frame's top chord
    }
    function handrail(sd) {
      var v = sd * 15.9, st = col(D_RAIL, k, 1), u;
      line3(o, [hood0 - 5, v, 21], [cab0 - 0.5, v, 21], st, 0.36);
      line3(o, [hood0 - 5, v, 16.5], [cab0 - 0.5, v, 16.5], st, 0.3);
      for (u = hood0 - 5; u <= cab0; u += 9) line3(o, [u, v, 11.5], [u, v, 21], st, 0.32);
    }
    function rearRail() {
      var st = col(D_RAIL, k, 1), u = -hl + 1.4;
      line3(o, [u, -15.9, 21], [u, 15.9, 21], st, 0.36);
      line3(o, [u, -15.9, 16.5], [u, 15.9, 16.5], st, 0.3);
      [-15.9, -5, 5, 15.9].forEach(function (v) { line3(o, [u, v, 11.5], [u, v, 21], st, 0.32); });
      line3(o, [u, -15.9, 21], [hood0 - 5, -15.9, 21], st, 0.36);
      line3(o, [u, 15.9, 21], [hood0 - 5, 15.9, 21], st, 0.36);
    }
    function pilot() {                                     // snowplough and coupler at the leading end
      solid(o, [{ u: tip - 3, p: [[-15, 2.5], [15, 2.5], [15, 8.5], [-15, 8.5]] },
                { u: tip + 2.2, p: [[-10.5, 5], [10.5, 5], [10.5, 8.5], [-10.5, 8.5]] }], k,
            function () { return D_DARK; });
      solid(o, boxSecs(tip + 2.2, tip + 4.4, -2.2, 2.2, 6.2, 9), k, function () { return [44, 46, 50]; });
    }

    function hood() {
      var hp = [[-hh, 11.5], [hh, 11.5], [hh, 31], [hh - 2.5, 33.8], [2.5 - hh, 33.8], [-hh, 31]];
      var hr = [[-hh, 11.5], [hh, 11.5], [hh, 29], [hh - 2.5, 31.4], [2.5 - hh, 31.4], [-hh, 29]];
      solid(o, [{ u: hood0, p: hr }, { u: hood0 + 3, p: hp }, { u: cab0, p: hp }], k, function (fc) {
        return fc.edge >= 2 && fc.edge <= 4 ? shadeRgb(D_HOOD, 0.1) : D_HOOD;
      });
      if (Math.abs(eye.v) > hh) {
        var dk = col(shadeRgb(D_HOOD, -0.42), k, lit), sm = col(shadeRgb(D_HOOD, -0.2), k, lit), u, z;
        onSide(o, side, hh, hood0 + 3, cab0, 11.5, 13, dk);                              // kick plate
        if (lv) onSide(o, side, hh, hood0 + 3, cab0, 15, 17, col(rgbOf(lv.stripe), k, lit));   // the livery's band
        for (u = hood0 + 11; u < cab0 - 2; u += 8) onSide(o, side, hh, u - 0.25, u + 0.25, 13, 30.5, sm);   // door seams
        onSide(o, side, hh, hood0 + 3.5, hood0 + 22, 18.5, 30.5, dk);                     // radiator
        for (z = 19.4; z < 30; z += 1.8) onSide(o, side, hh, hood0 + 4.3, hood0 + 21.2, z, z + 0.6, col(shadeRgb(D_HOOD, -0.1), k, lit));
        onSide(o, side, hh, -BL * 0.12 - 6, -BL * 0.12 + 6, 24, 30.5, dk);                // second fan's grille
        for (z = 24.7; z < 30; z += 1.8) onSide(o, side, hh, -BL * 0.12 - 5.3, -BL * 0.12 + 5.3, z, z + 0.6, col(shadeRgb(D_HOOD, -0.1), k, lit));
      }
      // on the roof: the two fan shrouds and the exhaust stack
      [[-BL * 0.30, 7.2], [-BL * 0.12, 6.2]].forEach(function (fn) {
        // a low drum on the roof, octagonal in plan: narrow, wide, wide, narrow along u
        solid(o, [{ u: fn[0] - fn[1], p: [[-fn[1] * 0.5, 33.8], [fn[1] * 0.5, 33.8], [fn[1] * 0.5, 36], [-fn[1] * 0.5, 36]] },
                  { u: fn[0] - fn[1] * 0.5, p: [[-fn[1], 33.8], [fn[1], 33.8], [fn[1], 36], [-fn[1], 36]] },
                  { u: fn[0] + fn[1] * 0.5, p: [[-fn[1], 33.8], [fn[1], 33.8], [fn[1], 36], [-fn[1], 36]] },
                  { u: fn[0] + fn[1], p: [[-fn[1] * 0.5, 33.8], [fn[1] * 0.5, 33.8], [fn[1] * 0.5, 36], [-fn[1] * 0.5, 36]] }],
              k, function () { return [58, 64, 71]; });
      });
      solid(o, boxSecs(-BL * 0.02 - 3, -BL * 0.02 + 3, -2.4, 2.4, 33.8, 38.8), k, function (fc) {
        return fc.edge === 2 ? [12, 13, 15] : [34, 37, 41];
      });
    }

    function cab() {
      var cp = [[-cw, 11.5], [cw, 11.5], [cw, 32], [cw - 3, 37.5], [cw - 8, 41], [8 - cw, 41], [3 - cw, 37.5], [-cw, 32]];
      solid(o, [{ u: cab0, p: cp }, { u: nose0, p: cp }], k, function (fc) {
        return fc.edge >= 3 && fc.edge <= 5 ? shadeRgb(D_CAB, -0.12) : D_CAB;
      });
      if (Math.abs(eye.v) > cw) {
        var dy = col(shadeRgb(D_CAB, -0.28), k, lit);
        onSide(o, side, cw, cab0 + 1.2, nose0, 11.5, 13, col(D_DARK, k, lit));        // kick plate
        if (lv) onSide(o, side, cw, cab0 + 6.8, nose0, 15, 17, col(rgbOf(lv.stripe), k, lit));
        onSide(o, side, cw, cab0 + 1.3, cab0 + 6.8, 12.8, 37.6, dy);                   // cab door
        onSide(o, side, cw, cab0 + 2, cab0 + 6.1, 29, 36.4, glassStyle(k, lit));
        onSide(o, side, cw, cab0 + 7.8, nose0 - 1.3, 29, 36.4, glassStyle(k, lit));    // side window
      }
      if (eye.u > nose0) {                                                             // the windscreen, above the nose
        var u = nose0 + 0.06;
        [-1, 1].forEach(function (sd) {
          onEnd(o, u, sd * 1.3, sd * (cw - 4.5), 31.4, 39.4, glassStyle(k, lit + 0.12));
          onEnd(o, u, sd * 1.3, sd * (cw - 4.5), 39.4, 40.3, col(D_DARK, k, 1));       // sun visor
        });
      }
    }

    function nose() {
      solid(o, [{ u: nose0, p: [[-cw, 11.5], [cw, 11.5], [cw, 27.5], [cw - 2, 30.2], [2 - cw, 30.2], [-cw, 27.5]] },
                { u: tip - 5, p: [[-13.3, 11.5], [13.3, 11.5], [13.3, 26.5], [11.3, 29], [-11.3, 29], [-13.3, 26.5]] },
                { u: tip, p: [[-8.5, 11.5], [8.5, 11.5], [8.5, 23.5], [6.5, 26], [-6.5, 26], [-8.5, 23.5]] }], k,
            function (fc) { return fc.edge >= 3 && fc.edge <= 4 ? shadeRgb(D_CAB, -0.1) : D_CAB; });
      if (eye.u > tip) {
        onEnd(o, tip + 0.06, -6.2, 6.2, 21.2, 24.2, col(D_DARK, k, 1));               // number board
        onEnd(o, tip + 0.07, -5.2, 5.2, 21.8, 23.6, col([226, 230, 234], k, 1));
        onEnd(o, tip + 0.06, -8.4, 8.4, 11.5, 13.2, col(D_DARK, k, 1));
        endLamps(o, tip + 0.08, RY.LAMPS.dloco.slice(0, 2), lampMode(isFront, false), k);   // twin headlights
      }
    }

    // underneath first — the trucks and the tank are all below the deck
    truck(-(hl - 16)); truck(hl - 16);
    solid(o, [{ u: -14, p: [[-11, 2.5], [11, 2.5], [13.5, 4], [13.5, 5.5], [-13.5, 5.5], [-13.5, 4]] },
              { u: 9, p: [[-11, 2.5], [11, 2.5], [13.5, 4], [13.5, 5.5], [-13.5, 5.5], [-13.5, 4]] }], k,
          function () { return [44, 47, 52]; });
    if (eye.u > 0) buffersAt(o, -hl, -1, k); else pilot();                            // the far end
    solid(o, boxSecs(1 - hl, hl - 1, 0.6 - hw, hw - 0.6, 5.5, 8.5), k, function () { return shadeRgb(D_FRAME, -0.25); });
    solid(o, boxSecs(-hl, hl, -hw, hw, 8.5, 11.5), k, function (fc) {
      return fc.edge === 2 ? D_WALK : D_FRAME;                                       // walkways on top
    });
    // The walkway's rails run alongside the hood, inside the cab's width, so
    // they're painted with the hood: the far one before it, the near one
    // after — and both before the cab whenever the cab is nearer.
    function hoodWithRails() {
      handrail(-side);
      if (eye.u > -hl) rearRail();
      hood();
      handrail(side);
      if (eye.u <= -hl) rearRail();
    }
    // hood, cab and nose are separate blocks: paint the furthest first
    [[hoodWithRails, (hood0 + cab0) / 2], [cab, (cab0 + nose0) / 2], [nose, (nose0 + tip) / 2]]
      .sort(function (a, b) { return Math.abs(eye.u - b[1]) - Math.abs(eye.u - a[1]); })
      .forEach(function (part) { part[0](); });
    if (eye.u > 0) {
      pilot();
      endLamps(o, tip + 2.3, RY.LAMPS.dloco.slice(2), lampMode(isFront, false), k);      // ditch lights
    } else {
      buffersAt(o, -hl, -1, k);
      if (eye.u < hood0) endLamps(o, hood0 - 0.08, RY.LAMPS.dlocoBack, lampMode(false, isRear), k);   // tail lamps, on the hood's back end
    }
  }

  function drawVehicle(tr, vh, o, k, isFront, isRear) {
    var eye = localEye(o), side = eye.v > 0 ? 1 : -1, kind = vh.kind;
    // a locomotive in its own livery, where the railway paints them apart
    var cfg = kind === 'eloco' && tr.cfg.loco ? tr.cfg.loco : tr.cfg;
    var body = rgbOf(cfg.body), stripe = rgbOf(cfg.stripe), roof = rgbOf(cfg.roof || tr.cfg.roof);
    var BL, hw, h, hl, secs, lit = 0.86;
    function paintBody(front) {
      return function (fc) {
        if (fc.cap) return fc.cap > 0 ? front : back;
        if (fc.edge >= 3 && fc.edge <= 5) return roof;          // the rolled roof
        return body;
      };
    }
    var back = shadeRgb(body, -0.26);

    if (kind === 'emu' || kind === 'coach') {
      BL = vh.len - 10; hw = 17; h = 38; hl = BL / 2;
      var cabF = kind === 'emu' && vh.first, cabR = kind === 'emu' && vh.last;
      // a gangway only where this car couples to another passenger car: its
      // front (+u) to the car ahead, its rear to the car behind — and a
      // coach's front meets the loco, which has none
      var gangF = kind === 'emu' ? !vh.first : vh.idx > 1, gangR = !vh.last;
      // an EMU's front: Vande Bharat's long pointed nose, an Indian EMU's flat one, or the raked default
      var noseFn = cfg.nose === 'aero' ? aeroNose : cfg.nose === 'flat' ? locoNose : emuNose;
      var noseLen = cfg.nose === 'aero' ? 40 : cfg.nose === 'flat' ? 7 : 19;
      var vv = vh.variant, ac = /ac$/.test(vv || ''), near_ = Math.sqrt(eye.u * eye.u + eye.v * eye.v) < 420;
      secs = sections(hl, prof(hw, h), cabR ? noseFn(hw, h) : null, cabF ? noseFn(hw, h) : null);

      bogies(o, hl, hw, 18, 10, k, eye);
      // whatever sticks out of the far end goes behind the body
      if (eye.u < 0 && gangF) bellowsAt(o, hl, 1, k);
      if (eye.u > 0 && gangR) bellowsAt(o, -hl, -1, k);
      if (kind === 'coach') { if (eye.u < 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k); }
      // a nose in its own colour (the saffron Vande Bharat's): the faces
      // between the nose's own sections, at whichever end has one
      var nN = noseFn(hw, h).length, nc = cfg.noseColor ? rgbOf(cfg.noseColor) : null, pb = paintBody(nc || back);
      solid(o, secs, k, !nc ? pb : function (fc) {
        if (!fc.cap && ((cabF && fc.sec >= 1) || (cabR && fc.sec <= nN - 2))) return fc.edge >= 3 && fc.edge <= 5 ? shadeRgb(nc, -0.1) : nc;
        return pb(fc);
      });

      // the side we can see
      if (Math.abs(eye.v) > hw) {
        var su0 = -hl + (cabR ? noseLen : 1.5), su1 = hl - (cabF ? noseLen : 1.5);
        // two-tone liveries: Rajdhani's cream upper half, Vande Bharat's skirt
        if (cfg.upper) onSide(o, side, hw, su0, su1, 17, 33, col(rgbOf(cfg.upper), k, lit));
        if (cfg.lower) onSide(o, side, hw, su0, su1, 7.4, 15.5, col(rgbOf(cfg.lower), k, lit));
        onSide(o, side, hw, su0, su1, 12.5, 15, col(stripe, k, lit));
        var doorSpans = [];
        if (kind === 'emu') {
          [-0.30, -0.06, 0.18, 0.40].forEach(function (fr) { doorSpans.push([BL * fr - 5.5, BL * fr + 5.5]); });
        } else {
          doorSpans.push([-hl + 2, -hl + 11], [hl - 11, hl - 2]);
        }
        doorSpans.forEach(function (ds) {
          if (ds[0] < su0 - 1 || ds[1] > su1 + 1) return;
          onSide(o, side, hw, ds[0], ds[1], 7.4, 31.5, col(shadeRgb(body, -0.22), k, lit));
          onSide(o, side, hw, ds[0] + 1.8, ds[1] - 1.8, 20, 29.5, glassStyle(k, lit));
          onSide(o, side, hw, (ds[0] + ds[1]) / 2 - 0.3, (ds[0] + ds[1]) / 2 + 0.3, 7.4, 31.5, col([20, 22, 26], k, lit));
        });
        if (cfg.windowBand) onSide(o, side, hw, su0 + 1, su1 - 1, 20.5, 30, glassStyle(k, lit * 0.5));   // one band of dark glass
        else if (vv === 'power') {                                   // a generator car: louvres, no windows
          onSide(o, side, hw, -hl + 14, hl - 14, 15, 31, col(shadeRgb(body, -0.35), k, lit));
          for (var lx = -hl + 16; lx < hl - 15; lx += 3) onSide(o, side, hw, lx, lx + 1, 16, 30, col(shadeRgb(body, 0.1), k, lit));
        } else if (vv === 'slr') {                                   // luggage-and-guard van: a big parcel door amidships
          onSide(o, side, hw, -9, 9, 8.5, 31, col(shadeRgb(body, -0.3), k, lit));
          onSide(o, side, hw, -0.3, 0.3, 8.5, 31, col([20, 22, 26], k, lit));
          windowRow(o, side, hw, su0 + 1, -12, doorSpans, k, lit, 'bars');
          windowRow(o, side, hw, 12, su1 - 1, doorSpans, k, lit, 'bars');
        } else windowRow(o, side, hw, su0 + 1, su1 - 1, doorSpans, k, lit, vv ? (ac ? 'ac' : 'bars') : null);
        if (cabF) onSide(o, side, hw, hl - noseLen + 2, hl - noseLen + 8, 21, 30.5, glassStyle(k, lit));
        if (cabR) onSide(o, side, hw, -hl + noseLen - 8, -hl + noseLen - 2, 21, 30.5, glassStyle(k, lit));
      }
      // cab ends we can see: windscreen, and lamps if it's the front or rear of the train
      var lampSet = cfg.nose === 'aero' ? RY.LAMPS.aero : RY.LAMPS[kind];
      function screen(dir) {
        if (cfg.nose === 'aero') windscreen(o, dir * (hl - 9), dir, hw - 2, 21, 31.5, 12, false, k, lit);
        else if (cfg.nose === 'flat') windscreen(o, dir * hl, dir, hw, 19, 31, 3.5, true, k, lit);
        else windscreen(o, dir * hl, dir, hw, 19.5, 31, 8.5, false, k, lit);
      }
      if (cabF && eye.u > hl - noseLen / 2) {
        screen(1);
        onEnd(o, hl + 0.05, -2.8, 2.8, 7, 10.5, col([30, 32, 36], k, 1));     // coupler
        endLamps(o, hl + 0.06, lampSet, lampMode(isFront, false), k);
      }
      if (cabR && eye.u < -hl + noseLen / 2) {
        screen(-1);
        onEnd(o, -hl - 0.05, -2.8, 2.8, 7, 10.5, col([30, 32, 36], k, 1));
        endLamps(o, -hl - 0.06, lampSet, lampMode(false, isRear), k);
      }
      // the "X" only on a last vehicle without a driving cab — never on an EMU's
      if (isRear && cfg.lv && !cabR && eye.u < -hl) lvCross(o, -hl - 0.1, 9, 14, 30, k);
      // on the roof: an ordinary Indian coach's rows of ventilators, an AC
      // coach's package units at each end, a power car's radiator and exhausts
      if (vv && near_) roofKit(o, hl, h, vv, k);
      if (!cabR && isRear && eye.u < -hl) endLamps(o, -hl - 0.06, RY.LAMPS[kind], 'tail', k);
      // and whatever sticks out of the near end, in front of it
      if (eye.u >= 0 && gangF) bellowsAt(o, hl, 1, k);
      if (eye.u <= 0 && gangR) bellowsAt(o, -hl, -1, k);
      if (kind === 'coach') { if (eye.u >= 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k); }
      if (cfg.elec && kind === 'emu' && (vh.idx === 1 || (tr.cars > 3 && vh.idx === tr.cars - 2))) {
        pantograph(o, BL * 0.16, h, vh.idx === 1, k);
      }
      return;
    }

    if (kind === 'eloco') {
      BL = vh.len - 8; hw = 18.5; h = 40; hl = BL / 2;
      var mr0 = -hl + 25, mr1 = hl - 27;
      bogies(o, hl, hw, 17, 11, k, eye);
      if (eye.u < 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k);
      solid(o, sections(hl, prof(hw, h), locoNose(hw, h), locoNose(hw, h)), k, function (fc) {
        if (fc.cap) return tr.cfg.loco ? shadeRgb(body, -0.08) : C_YWARN;   // warning-yellow cab ends, unless in livery
        return fc.edge >= 3 && fc.edge <= 5 ? roof : body;
      });
      if (Math.abs(eye.v) > hw) {
        onSide(o, side, hw, -hl + 8, hl - 8, 12, 14.5, col(stripe, k, lit));
        onSide(o, side, hw, mr0, mr1, 16.5, 32, col(shadeRgb(body, -0.3), k, lit));    // machine room grilles
        for (var gx = mr0 + 2; gx < mr1 - 1; gx += 3.6) {
          onSide(o, side, hw, gx, gx + 1.1, 17.5, 31, col(shadeRgb(body, 0.12), k, lit));
        }
        onSide(o, side, hw, hl - 15, hl - 9, 23, 32, glassStyle(k, lit));             // cab side windows
        onSide(o, side, hw, -hl + 9, -hl + 15, 23, 32, glassStyle(k, lit));
        onSide(o, side, hw, hl - 21, hl - 16.5, 9, 31, col(shadeRgb(body, -0.25), k, lit));   // cab doors
        onSide(o, side, hw, -hl + 16.5, -hl + 21, 9, 31, col(shadeRgb(body, -0.25), k, lit));
      }
      if (eye.u > hl - 7) {
        windscreen(o, hl, 1, hw, 21.5, 32, 6, true, k, lit);
        endLamps(o, hl + 0.06, RY.LAMPS.eloco, lampMode(isFront, false), k);
      }
      if (eye.u < -hl + 7) {
        windscreen(o, -hl, -1, hw, 21.5, 32, 6, true, k, lit);
        endLamps(o, -hl - 0.06, RY.LAMPS.eloco, lampMode(false, isRear), k);
      }
      if (eye.u >= 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k);
      pantograph(o, mr1 - 22, h, false, k);                 // leading one down,
      pantograph(o, mr0 + 22, h, true, k);                  // trailing one up
      return;
    }

    if (kind === 'dloco') { drawDiesel(tr, vh, o, k, eye, side, isFront, isRear); return; }

    // freight wagons, loaded as the map shows them
    BL = vh.len - 11; hw = 16; hl = BL / 2;
    bogies(o, hl, hw, 12, 8.5, k, eye);
    if (eye.u < 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k);
    var rnd = RY.rng(tr.seed + vh.idx * 977);
    if (vh.load === 0) {                                          // open hopper of aggregate, or of coal
      var hp = [[4 - hw, 8], [hw - 4, 8], [hw, 15], [hw, 28], [-hw, 28], [-hw, 15]];
      var wb = cfg.wagon ? rgbOf(cfg.wagon) : body, ld = cfg.load === 'coal' ? [30, 29, 28] : C_HOPPERLOAD;
      solid(o, [{ u: -hl, p: hp }, { u: hl, p: hp }], k, function (fc) {
        return fc.edge === 3 ? ld : fc.cap ? shadeRgb(wb, -0.15) : wb;
      });
      if (Math.abs(eye.v) > hw) {
        for (var hx = -hl + 12; hx < hl - 6; hx += 12) onSide(o, side, hw, hx - 0.7, hx + 0.7, 15, 28, col(shadeRgb(wb, -0.3), k, lit));
      }
    } else if (vh.load === 1) {                                   // tank
      solid(o, boxSecs(-hl, hl, 2 - hw, hw - 2, 6, 9), k, function () { return [38, 40, 44]; });
      var ring = function (r) {
        var q = [], a;
        for (a = 0; a < 8; a++) q.push([Math.cos(a * 0.785 + 0.39) * r, 20 + Math.sin(a * 0.785 + 0.39) * r]);
        return q;
      };
      solid(o, [{ u: -hl + 2, p: ring(8.4) }, { u: -hl + 6.5, p: ring(11.6) },
                { u: hl - 6.5, p: ring(11.6) }, { u: hl - 2, p: ring(8.4) }], k, function () { return cfg.tank === 'black' ? [46, 48, 53] : C_TANK; });
    } else if (vh.load === 3) {                                   // covered van, doors amidships
      var cb = rgbOf(cfg.wagon || '#6b3a26');
      solid(o, sections(hl, prof(hw - 0.5, 35, 8)), k, function (fc) { return fc.edge >= 3 && fc.edge <= 5 ? shadeRgb(cb, -0.1) : fc.cap ? shadeRgb(cb, -0.15) : cb; });
      if (Math.abs(eye.v) > hw) {
        onSide(o, side, hw - 0.5, -9, 9, 9, 30, col(shadeRgb(cb, -0.35), k, lit));
        for (var rx = -hl + 6; rx < hl - 3; rx += 8) onSide(o, side, hw - 0.4, rx - 0.4, rx + 0.4, 9, 26, col(shadeRgb(cb, -0.2), k, lit));
      }
    } else if (vh.load === 4) {                                   // the guard's brake van
      var bvc = rgbOf(cfg.wagon || '#6b3a26');
      solid(o, boxSecs(-hl, hl, -hw, hw, 7, 9.5), k, function () { return [42, 46, 52]; });
      solid(o, sections(hl * 0.6, prof(hw - 2, 33, 9.5)), k, function (fc) { return fc.edge >= 3 && fc.edge <= 5 ? shadeRgb(bvc, -0.1) : fc.cap ? shadeRgb(bvc, -0.12) : bvc; });
      if (Math.abs(eye.v) > hw - 2) {
        onSide(o, side, hw - 2, -hl * 0.35, -hl * 0.1, 18, 26, glassStyle(k, lit));
        onSide(o, side, hw - 2, hl * 0.1, hl * 0.35, 18, 26, glassStyle(k, lit));
      }
      [-1, 1].forEach(function (e) {                              // verandah railings
        var u0 = e * hl * 0.6, u1 = e * (hl - 1);
        [-1, 1].forEach(function (sd) { line3(o, [u0, sd * (hw - 1), 18], [u1, sd * (hw - 1), 18], col([190, 196, 202], k, lit), 0.5); });
        line3(o, [u1, -(hw - 1), 18], [u1, hw - 1, 18], col([190, 196, 202], k, lit), 0.5);
      });
    } else {                                                      // container flat
      solid(o, boxSecs(-hl, hl, -hw, hw, 7, 10.5), k, function () { return [54, 50, 46]; });
      var pal = cfg.containers || CONTAINERS;
      var cw = BL / 2 - 7, c0 = rgbOf(pal[(rnd() * pal.length) | 0]), c1 = rgbOf(pal[(rnd() * pal.length) | 0]);
      var box = function (j, cc) {
        var u0 = -hl + 5 + j * (cw + 4);
        solid(o, boxSecs(u0, u0 + cw, 1 - hw, hw - 1, 10.5, 33), k, function (fc) {
          return fc.cap ? shadeRgb(cc, -0.12) : cc;
        });
        if (Math.abs(eye.v) > hw - 1) {
          for (var cx = u0 + 3; cx < u0 + cw - 1; cx += 4) onSide(o, side, hw - 1, cx, cx + 0.8, 11.5, 32, col(shadeRgb(cc, -0.25), k, lit));
        }
      };
      if (eye.u > 0) { box(0, c0); box(1, c1); } else { box(1, c1); box(0, c0); }
    }
    if (eye.u >= 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k);
    if (isRear && eye.u < -hl) endLamps(o, -hl - 3.3, RY.LAMPS.wagon, 'tail', k);
    if (isRear && cfg.lv && eye.u < -hl) {                        // the last vehicle's board, yellow with its X
      var bu = vh.load === 4 ? -hl * 0.6 - 0.1 : -hl - 0.1;
      onEnd(o, bu, -6, 6, 13, 25, col([242, 195, 24], k, 1));
      lvCross(o, bu - 0.05, 4.2, 14.5, 23.5, k, [21, 18, 10]);
    }
  }

  /* The "X" painted on the tail of every Indian train's last vehicle, in
     yellow: two bars crossing on the end face at u, half as wide as w. */
  function lvCross(o, u, w, z0, z1, k, rgb) {
    var t = w * 0.28, c = col(rgb || [242, 195, 24], k, 1);
    fillPoly([Vf(o, u, -w, z0), Vf(o, u, -w + t, z0), Vf(o, u, w, z1), Vf(o, u, w - t, z1)], c);
    fillPoly([Vf(o, u, w, z0), Vf(o, u, w - t, z0), Vf(o, u, -w, z1), Vf(o, u, -w + t, z1)], c);
  }
  function roofKit(o, hl, h, v, k) {
    var u, g = [150, 155, 160];
    if (v === 'power') {
      solid(o, boxSecs(-hl * 0.44, hl * 0.44, -7, 7, h - 0.5, h + 2), k, function (fc) { return fc.edge === 2 ? [40, 44, 49] : [70, 75, 82]; });
      [-hl * 0.68, hl * 0.68].forEach(function (eu) {
        solid(o, boxSecs(eu - 2, eu + 2, -2, 2, h - 0.5, h + 5), k, function (fc) { return fc.edge === 2 ? [14, 15, 17] : [44, 47, 52]; });
      });
      return;
    }
    if (/ac$/.test(v)) {
      [-1, 1].forEach(function (e) {
        var c = e * hl * 0.7;
        solid(o, boxSecs(c - 8, c + 8, -7.5, 7.5, h - 0.5, h + 4), k, function (fc) { return fc.edge === 2 ? [118, 124, 131] : [92, 98, 106]; });
      });
      return;
    }
    for (u = -hl + 13; u < hl - 10; u += 10.5) {
      [-4.5, 4.5].forEach(function (vv) {
        solid(o, boxSecs(u - 1.6, u + 1.6, vv - 1.6, vv + 1.6, h - 0.3, h + 2.2), k, function (fc) { return fc.edge === 2 ? [96, 102, 110] : [70, 76, 84]; });
      });
    }
    if (v === 'pantry') {
      [-hl * 0.2, hl * 0.2].forEach(function (cu) {
        solid(o, boxSecs(cu - 2.5, cu + 2.5, -2.5, 2.5, h - 0.3, h + 4.5), k, function () { return [36, 39, 44]; });
      });
    }
  }
  function glow(x, y, r, rgb, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb.join(',') + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  /* A signal: post, head, and — if it's facing us — its lamps. */
  var ASPECT = [[240, 64, 48], [236, 176, 40], [72, 226, 110]];
  function signalItem(s, dirCam) {
    if (!near(s.x, s.y, 10)) return null;
    var d = dist(s.x, s.y);
    // A platform road's starter is carried on an OLE mast that stands just
    // inboard of it (scene.js roadMasts); sorted on its own distance the
    // mast would come out nearer and paint over the head, so the signal
    // sorts a touch nearer than it is — on the mast's face, not behind it.
    return { d: d - 3, fp: footprint(rect(s.x - 1.8, s.y - 2.4, s.x + 1.8, s.y + 2.4)), fn: function () {
      var k = fogK(d);
      drawBox(rect(s.x - 0.7, s.y - 0.7, s.x + 0.7, s.y + 0.7), 0, 41, C_POST, C_POST, d);
      drawBox(rect(s.x - 1.8, s.y - 2.4, s.x + 1.8, s.y + 2.4), 40, 55, C_HEAD, C_HEAD, d);
      if (s.dirX !== dirCam) return;               // we're seeing it from behind
      var face = toCam(s.x - s.dirX * 1.9, s.y), i, p, x, y, r, on;
      if (face.f < NEAR) return;
      for (i = 0; i < 3; i++) {
        p = { f: face.f, l: face.l, z: 52 - i * 4.4 };
        x = sx(p); y = sy(p); r = Math.max(0.8, 1.35 * focal / p.f);
        on = (i === 0 && s.aspect === 0) || (i === 2 && s.aspect === 2) || (i === 1 && s.aspect === 1);
        ctx.fillStyle = on ? 'rgb(' + ASPECT[i].join(',') + ')' : 'rgba(20,22,26,' + (1 - k) + ')';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        if (on) glow(x, y, r * (4 + 4 * night), ASPECT[i], (0.4 + 0.4 * night) * (1 - k));
      }
    } };
  }

  /* ---------------- painting order ---------------- */
  /* Far to near by distance to each thing's middle is right for small things
     and wrong for long ones side by side: a 100-long carriage and the 40-long
     platform block beyond it swap order as the train moves, depending on
     which middle happens to be nearer, and the platform flickers over the
     train. So every carriage is also settled against everything it could
     overlap on screen, exactly, in plan: along a sight line they share, the
     footprint the line reaches first is in front — at every height, however
     long either is, straight or curved. Those answers are kept, and
     everything else keeps its distance order. (Things whose footprints
     overlap — a column on its platform — are left to distance, as before.) */
  function footprint(pts) {
    var q = [], lo = Infinity, hi = -Infinity, behind = false, i, c, m;
    for (i = 0; i < pts.length; i++) {
      c = toCam(pts[i].x, pts[i].y); q.push({ f: c.f, l: c.l });
      if (c.f <= NEAR) behind = true;
      else { m = c.l / c.f; if (m < lo) lo = m; if (m > hi) hi = m; }
    }
    return { q: q, lo: behind ? -Infinity : lo, hi: behind ? Infinity : hi };
  }
  // distance along the sight line (1, m) to where it enters the quad; Infinity if it misses
  function entry(q, m) {
    var t0 = 0, t1 = Infinity, i, a, b, A, B, area = 0;
    for (i = 0; i < 4; i++) { a = q[i]; b = q[(i + 1) % 4]; area += a.f * b.l - b.f * a.l; }
    var sg = area > 0 ? 1 : -1;
    for (i = 0; i < 4; i++) {
      a = q[i]; b = q[(i + 1) % 4];
      A = sg * ((b.f - a.f) * m - (b.l - a.l)); B = sg * ((b.l - a.l) * a.f - (b.f - a.f) * a.l);
      if (A > 1e-9) t0 = Math.max(t0, -B / A);
      else if (A < -1e-9) t1 = Math.min(t1, -B / A);
      else if (B < 0) return Infinity;
    }
    return t0 <= t1 ? t0 : Infinity;
  }
  function apart(p, q) {                          // separating-axis test, two convex quads
    var polys = [p, q], k, i, a, b, nf, nl, j, v, pmin, pmax, qmin, qmax;
    for (k = 0; k < 2; k++) for (i = 0; i < 4; i++) {
      a = polys[k][i]; b = polys[k][(i + 1) % 4]; nf = b.l - a.l; nl = a.f - b.f;
      pmin = qmin = Infinity; pmax = qmax = -Infinity;
      for (j = 0; j < 4; j++) {
        v = p[j].f * nf + p[j].l * nl; if (v < pmin) pmin = v; if (v > pmax) pmax = v;
        v = q[j].f * nf + q[j].l * nl; if (v < qmin) qmin = v; if (v > qmax) qmax = v;
      }
      if (pmax < qmin || qmax < pmin) return true;
    }
    return false;
  }
  // 1: a is in front of b; -1: b is in front of a; 0: nothing to settle
  function inFront(a, b) {
    var A = a.fp, B = b.fp, lo, hi, tries, i, ta, tb;
    if (!A || !B) return 0;
    lo = Math.max(A.lo, B.lo); hi = Math.min(A.hi, B.hi);
    if (lo > hi) return 0;                                  // never behind one another on screen
    if (!apart(A.q, B.q)) return 0;                         // one stands on or over the other
    tries = isFinite(lo) && isFinite(hi) ? [(lo + hi) / 2]
          : isFinite(hi) ? [hi - 0.02, hi - 0.3] : isFinite(lo) ? [lo + 0.02, lo + 0.3] : [0, 0.6, -0.6, 2, -2];
    for (i = 0; i < tries.length; i++) {
      ta = entry(A.q, tries[i]); tb = entry(B.q, tries[i]);
      if (isFinite(ta) && isFinite(tb)) return ta < tb ? 1 : ta > tb ? -1 : 0;
    }
    return 0;
  }
  /* items come sorted far to near. Each carriage is settled against the
     rest; then the farthest thing with nothing left to go behind is painted
     next, and so on (a rare three-way cycle is broken by distance). */
  function painterOrder(items) {
    var n = items.length, indeg = [], adj = [], i, j, r, out = [], taken = [], k;
    for (i = 0; i < n; i++) { indeg.push(0); adj.push([]); taken.push(false); }
    for (i = 0; i < n; i++) {
      if (!items[i].veh) continue;
      for (j = 0; j < n; j++) {
        if (j === i || (items[j].veh && j < i)) continue;
        r = inFront(items[i], items[j]);
        if (r === 1) { adj[j].push(i); indeg[i]++; }        // j first, then i over it
        else if (r === -1) { adj[i].push(j); indeg[j]++; }
      }
    }
    for (k = 0; k < n; k++) {
      for (i = 0; i < n && (taken[i] || indeg[i] > 0); i++);
      if (i === n) for (i = 0; taken[i]; i++);              // a cycle: fall back to distance
      taken[i] = true; out.push(items[i]);
      for (j = 0; j < adj[i].length; j++) indeg[adj[i][j]]--;
    }
    return out;
  }

  function solidItem(so) {
    var cx = (so.c[0].x + so.c[2].x) / 2, cy = (so.c[0].y + so.c[2].y) / 2;
    var r = Math.max(Math.abs(so.c[2].x - so.c[0].x), Math.abs(so.c[2].y - so.c[0].y)) / 2;
    if (!near(cx, cy, r)) return null;
    var d = dist(cx, cy);
    return { d: d, fp: footprint(so.c), fn: function () {
      if (so.kind === 'plat') {
        var tac = so.tac || [3, 5.5];
        drawBox(so.c, so.z0, so.z1, so.side || C_PLATSIDE, so.top || C_PLAT, d, { top: function (cc, k) {
          // coping and the yellow line along whichever edges are real faces
          var a = cc[0], b = cc[1], c = cc[3], e = cc[2];
          function strip(p, q, t0, t1, rgb) {   // between the edge p–q and the far edge, fractions t0..t1 in
            var z = PLAT_H + 0.2;
            fillPoly([{ f: p.f + (c.f - p.f) * t0, l: p.l + (c.l - p.l) * t0, z: z },
                      { f: q.f + (e.f - q.f) * t0, l: q.l + (e.l - q.l) * t0, z: z },
                      { f: q.f + (e.f - q.f) * t1, l: q.l + (e.l - q.l) * t1, z: z },
                      { f: p.f + (c.f - p.f) * t1, l: p.l + (c.l - p.l) * t1, z: z }], col(rgb, k, 1));
          }
          var span = Math.abs(so.c[2].y - so.c[0].y) || 1;
          if (so.edgeT) { strip(a, b, 0, 2.2 / span, C_COPING); strip(a, b, tac[0] / span, tac[1] / span, C_YELLOW); }
          if (so.edgeB) { strip(a, b, 1 - 2.2 / span, 1, C_COPING); strip(a, b, 1 - tac[1] / span, 1 - tac[0] / span, C_YELLOW); }
        } });
      } else if (so.kind === 'canopy') drawBox(so.c, so.z0, so.z1, C_CANOPY, C_CANOPY, d);
      else if (so.kind === 'col' || so.kind === 'stair') drawBox(so.c, so.z0, so.z1, C_STEEL, C_STEEL, d);
      else if (so.kind === 'bridge') drawBox(so.c, so.z0, so.z1, C_BRIDGE, C_BRIDGE, d);
      else if (so.kind === 'prism') {
        // roof slopes in the first colour, the fascias in the second, the underside in the third
        var n = so.secs[0].p.length;
        solid(so.o, so.secs, fogK(d), function (fc) {
          if (fc.cap) return so.rgb[1];
          if (fc.edge === 0) return so.rgb[2];
          var a = so.secs[0].p[fc.edge], b = so.secs[0].p[(fc.edge + 1) % n];
          return Math.abs(a[1] - b[1]) > 1.8 ? so.rgb[0] : so.rgb[1];
        });
      }
      else drawBox(so.c, so.z0, so.z1, so.rgb, so.top || [70, 74, 80], d);
    } };
  }

  function wireItem(wi) {
    if (!near(wi.cx, wi.cy, 40)) return null;
    var d = dist(wi.cx, wi.cy);
    return { d: d, fn: function () {
      var pts = wi.pts.map(function (p) { return P3(toCam(p.x, p.y), WIRE_Z); });
      // a stroke's width comes from one distance for the whole chunk, so
      // never let that be one that's nearly on top of us, or behind
      var f = Math.max(40, toCam(wi.cx, wi.cy).f);
      strokeLine(pts, col([40, 44, 50], fogK(d), 1), Math.max(0.5, 0.7 * focal / f));
    } };
  }
  function mastItem(m) {
    if (!near(m.x, m.y, 10)) return null;
    var d = dist(m.x, m.y);
    return { d: d, fp: footprint(rect(m.x - 1.6, m.y - 1.6, m.x + 1.6, m.y + 1.6)), fn: function () {
      drawBox(rect(m.x - 1.6, m.y - 1.6, m.x + 1.6, m.y + 1.6), 0, MAST_Z, C_STEEL, C_STEEL, d);
      var a = P3(toCam(m.x, m.y), WIRE_Z + 3), b = P3(toCam(m.wx, m.wy), WIRE_Z + 3);
      strokeLine([a, b], col(C_STEEL, fogK(d), 1), Math.max(0.5, 0.9 * focal / Math.max(40, a.f)));
    } };
  }

  /* The driver's console along the bottom, and the cab's window frame. */
  function console_(tr, sigs, dirCam) {
    var dh = Math.max(26, Math.round(H * 0.17)), y0 = H - dh, i, s, f, best = null, bf = 1e9, c;
    // the window frame: a header bar and two pillars
    ctx.fillStyle = '#0c1016';
    ctx.fillRect(0, 0, W, 5);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 0); ctx.lineTo(4, y0); ctx.lineTo(0, y0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - 9, 0); ctx.lineTo(W - 4, y0); ctx.lineTo(W, y0); ctx.fill();
    var g = ctx.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, '#20262e'); g.addColorStop(1, '#0d1116');
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, dh);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, y0, W, 1);

    // speed
    var kmh = Math.round(tr.v * 0.62), fs = Math.max(11, Math.round(dh * 0.46));
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '700 ' + fs + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#7ee0a0';
    ctx.fillText(String(kmh), 10, y0 + dh * 0.44);
    var wNum = ctx.measureText(String(kmh)).width;
    ctx.font = '600 ' + Math.max(8, Math.round(dh * 0.2)) + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#8b98a8';
    ctx.fillText('KM/H', 13 + wNum, y0 + dh * 0.5);

    // the next signal we're approaching, and what it's showing
    for (i = 0; i < sigs.length; i++) {
      s = sigs[i];
      if (s.dirX !== dirCam) continue;
      c = toCam(s.x, s.y);
      if (c.f > 15 && Math.abs(c.l) < 55 && c.f < bf) { bf = c.f; best = s; }
    }
    var cx = W * 0.5, cy = y0 + dh * 0.5, r = Math.max(2.2, dh * 0.085);
    ctx.fillStyle = '#05070a';
    RY.rr(ctx, cx - r * 1.7, cy - r * 4.6, r * 3.4, r * 9.2, r); ctx.fill();
    for (i = 0; i < 3; i++) {
      var on = best && ((i === 0 && best.aspect === 0) || (i === 2 && best.aspect === 2) || (i === 1 && best.aspect === 1));
      ctx.fillStyle = on ? 'rgb(' + ASPECT[i].join(',') + ')' : '#1a1e24';
      ctx.beginPath(); ctx.arc(cx, cy - r * 2.9 + i * r * 2.9, r, 0, 6.2832); ctx.fill();
    }
    ctx.font = '600 ' + Math.max(8, Math.round(dh * 0.19)) + 'px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left'; ctx.fillStyle = '#8b98a8';
    ctx.fillText(best ? 'NEXT SIGNAL' : 'NO SIGNAL AHEAD', cx + r * 2.6, cy);

    // where it's going
    ctx.textAlign = 'right';
    ctx.font = '700 ' + Math.max(8, Math.round(dh * 0.24)) + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(tr.trackId !== null ? RY.TRACKS[tr.trackId].short : '—', W - 10, y0 + dh * 0.36);
    ctx.font = '600 ' + Math.max(8, Math.round(dh * 0.18)) + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#8b98a8';
    ctx.fillText(STATE[tr.state] || tr.state.toUpperCase(), W - 10, y0 + dh * 0.7);
  }
  var STATE = { approach: 'AT SIGNAL', routed: 'ROUTED', dwell: 'STANDING', awaitDepart: 'HELD',
                depart: 'DEPARTING', toPlatform: 'SHUNTING', awaitYard: 'HELD', toYard: 'SHUNTING',
                parked: 'STABLED' };

  /* Once the light goes, every train's headlamp beam and tail glow on the
     ground — the very shapes the map lays down for it (RY.drawTrainLights,
     train.js): a cone off the nose, 28 across there and opening to 0.64 of
     its length, which runs 130 plus a little for speed; and a red pool 26
     round the tail. Stood up in perspective they're cut into bands, each lit
     as the map's gradient is at that distance, and added on as the map does. */
  var BEAM_STOPS = [[0, [255, 244, 206]], [0.25, [255, 236, 180]], [1, [255, 230, 160]]];
  function groundGlow(pts, rgb, a) {
    if (a < 0.004) return;
    var ps = pts.map(function (q) { return P3(toCam(q[0], q[1]), 0.3); });
    fillPoly(ps, 'rgba(' + rgb.join(',') + ',' + a.toFixed(3) + ')');
  }
  function groundLights(trains) {
    if (night < 0.05) return;
    var a0 = 0.55 * night + 0.12, a1 = 0.16 * night;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    trains.forEach(function (tr) {
      var p = RY.pathAt(tr.path, tr.s), r = 130 + tr.v * 0.55, N = 14, i, j, d0, d1, w0, w1, t, a, rgb, fk;
      if (p.x < -220 || p.x > RY.W + 220 || !near(p.x, p.y, r)) return;
      var ca = Math.cos(p.a), sa = Math.sin(p.a);
      function at(d, w) { return [p.x + ca * d - sa * w, p.y + sa * d + ca * w]; }
      for (i = 0; i < N; i++) {
        d0 = r * i / N; d1 = r * (i + 1) / N;
        w0 = 14 + (0.32 * r - 14) * i / N; w1 = 14 + (0.32 * r - 14) * (i + 1) / N;
        t = Math.max(0, ((d0 + d1) / 2 - 6) / r);
        a = t < 0.25 ? a0 + (a1 - a0) * t / 0.25 : a1 * (1 - (t - 0.25) / 0.75);
        j = t < 0.25 ? 0 : 1;
        rgb = BEAM_STOPS[j][1].map(function (v, n) {
          var lo = BEAM_STOPS[j], hi = BEAM_STOPS[j + 1];
          return Math.round(v + (hi[1][n] - v) * (t - lo[0]) / (hi[0] - lo[0]));
        });
        fk = fogK(dist(p.x + ca * (d0 + d1) / 2, p.y + sa * (d0 + d1) / 2));
        groundGlow([at(d0, -w0), at(d1, -w1), at(d1, w1), at(d0, w0)], rgb, a * (1 - fk));
      }
      // the tail: a pool of red, stacked discs so it fades to its edge
      var q = RY.pathAt(tr.path, Math.max(0, tr.s - tr.len)), K = 5, ring;
      if (!near(q.x, q.y, 26)) return;
      fk = fogK(dist(q.x, q.y));
      for (i = 1; i <= K; i++) {
        ring = [];
        for (j = 0; j < 16; j++) ring.push([q.x + Math.cos(j * 0.3927) * 26 * i / K, q.y + Math.sin(j * 0.3927) * 26 * i / K]);
        groundGlow(ring, [255, 66, 46], 0.5 * night / K * (1 - fk));
      }
    });
    ctx.restore();
  }

  /* ---------------- where the window sits ---------------- */
  /* The top-left corner of the stage: the band above the map (game.js sits
     the map on the bottom edge while this is open), and on down over the
     map's own fence and open ground to whatever there is actually in play —
     every rail (with room for a train on it), every signal, the through-road
     signs, and the station building. Every width is tried, and the one
     showing the most picture wins, kept wide — between 2:1 and 2.4:1 — for
     a wide-angle lens (see resize). Worked out afresh for the window, the
     map's placement and the station. */
  var fitKey = '';
  var CLEAR = 16;   // half a train and some air
  var stageEl = document.getElementById('stage'), dockEl = document.getElementById('cabdock'), docked = false;

  /* On a stage too short for a window over the map (a phone on its side),
     the cab view docks at the top of the side panel instead, and the map
     keeps all of the stage (game.js asks overlays()). */
  function wantDock() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    return !!dockEl && ((h < 420 && w > h * 1.25) || w < 300);
  }
  function place() {
    if (docked) {
      if (host.parentNode !== dockEl) dockEl.appendChild(host);
      host.classList.remove('tight');
      host.style.width = host.style.height = '';
    } else if (host.parentNode !== stageEl) {
      stageEl.insertBefore(host, document.getElementById('toasts'));
    }
    host.classList.toggle('docked', docked);
    W = 0;
    root.dispatchEvent(new Event('resize'));   // the map takes the stage back, or makes room again
  }

  function keepOut(sigs) {
    var out = [], L = RY.LAY;
    function add(x0, y0, x1, y1) { out.push([x0, y0, x1, y1]); }
    if (RY.station.style === 'india') {
      // the name board in the forecourt, the station building and platform 1 along its front
      var sp1 = RY.platSpan(RY.ISLANDS[0].lower), cx = (sp1.x0 + sp1.x1) / 2;
      add(cx - 222, 60, cx + 222, 104);
      add(sp1.x0 + 36, 104, sp1.x1 - 36, RY.ISLANDS[0].y1);
    } else add(650, 40, 1266, 176);   // the concourse and its entrance canopy (scene.js)
    RY.buildTrackwork().forEach(function (P) {
      for (var k = 1; k < P.pts.length; k++) {
        var a = P.pts[k - 1], b = P.pts[k];
        var n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 6));
        for (var m = 0; m <= n; m++) {
          var x = a.x + (b.x - a.x) * m / n, y = a.y + (b.y - a.y) * m / n;
          add(x - CLEAR, y - CLEAR, x + CLEAR, y + CLEAR);
        }
      }
    });
    (sigs || []).forEach(function (s) { add(s.x - 14, s.y - 22, s.x + 14, s.y + 20); });
    // a through road's hatched no-platform strip and its plates (scene.js)
    RY.TRACKS.forEach(function (t) {
      if (t.platform || t.y > RY.H / 2) return;
      var y = t.y - Math.min(48, t.y - 206 - 12);
      add(L.xThroatW + 40, y - 10, L.xThroatE - 40, y + 10);
      add(L.stopX - 300 - 70, y - 10, L.stopX - 300 + 70, y + 10);
    });
    return out;
  }

  function fit(sigs) {
    var v = RY.view, stage = stageEl;
    if (!v || !v.scale) return;
    if (wantDock() !== docked) { docked = !docked; fitKey = ''; place(); }
    if (docked) return;                                          // sized by the panel
    var SW = stage.clientWidth, SH = stage.clientHeight;
    var key = SW + 'x' + SH + ':' + v.scale + ',' + v.ox + ',' + v.oy + ':' + RY.station.id;
    if (key === fitKey) return;
    fitKey = key;
    // everything to keep clear of, in stage pixels
    var boxes = keepOut(sigs).map(function (b) {
      return [v.ox + b[0] * v.scale, v.oy + b[1] * v.scale, v.ox + b[2] * v.scale];
    });
    var best = null, R, B, i, pw, ph;
    for (R = SW - 10; R >= 190; R -= 4) {                       // on a near tie, the wider
      B = SH - 10;
      for (i = 0; i < boxes.length; i++) {
        if (boxes[i][0] < R + 8 && boxes[i][2] > 10 && boxes[i][1] - 6 < B) B = boxes[i][1] - 6;
      }
      pw = R - 10 - 14; ph = B - 10 - 40;                       // less margin, padding, header
      if (ph <= 0) continue;
      // wide: a slot no thinner than 2.4:1, and never squarer than 2:1
      if (pw / ph > 2.4) pw = ph * 2.4;
      if (pw / ph < 2) ph = pw / 2;
      if (!best || pw * ph > best.pw * best.ph * 1.02) best = { pw: pw, ph: ph };
    }
    var tight = !best || best.ph < 88 || best.pw < 150;
    host.classList.toggle('tight', tight);
    if (!tight) {
      host.style.width = Math.round(best.pw + 14) + 'px';
      host.style.height = Math.round(best.ph + 40) + 'px';
    }
    W = 0;                                                       // re-measure the picture
  }

  /* ---------------- the frame ---------------- */
  function resize() {
    var r = cv.getBoundingClientRect();
    if (!r.width) return false;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    if (r.width !== W || r.height !== H || cv.width !== Math.round(r.width * dpr)) {
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      // from the width, but never so long a lens that a wide, short picture
      // loses the track just ahead of the nose — which in the usual 2:1 to
      // 2.4:1 window makes it a wide angle, about 78–88° across
      focal = Math.min((W / 2) / Math.tan(HFOV / 2), (H / 2) / Math.tan(22 * Math.PI / 180));
      hz = H * 0.38;
    }
    return true;
  }

  function draw(G, sigs) {
    fit(sigs);
    if (!shown) return;
    if (target && G.trains.indexOf(target) < 0) follow(null);   // it's left the scene
    if (!target || !resize()) return;

    var key = RY.station.id + ':' + RY.sceneBake;
    if (key !== worldKey) { world = build(); worldKey = key; }

    night = G.night || 0;
    var t = Math.min(1, night * 1.6);   // the haze goes the same way as the horizon it meets
    haze = [(206 + (66 - 206) * t) | 0, (216 + (62 - 216) * t) | 0, (222 + (88 - 222) * t) | 0];
    placeCamera(target);
    var dirCam = cam.ca >= 0 ? 1 : -1;
    // sun from the south-west and well up, turned into the camera's frame
    var lx = -0.45, ly = 0.89, lz = 1.1, ln = Math.sqrt(lx * lx + ly * ly + lz * lz);
    LC.f = (lx * cam.ca + ly * cam.sa) / ln; LC.l = (-lx * cam.sa + ly * cam.ca) / ln; LC.z = lz / ln;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sky();
    groundLayer(world);
    groundLights(G.trains);

    // everything that stands up, painted far to near
    var items = [], i, j, it, tr;
    for (i = 0; i < world.solids.length; i++) if ((it = solidItem(world.solids[i]))) items.push(it);
    for (i = 0; i < world.wires.length; i++) if ((it = wireItem(world.wires[i]))) items.push(it);
    for (i = 0; i < world.masts.length; i++) if ((it = mastItem(world.masts[i]))) items.push(it);
    for (i = 0; i < sigs.length; i++) if ((it = signalItem(sigs[i], dirCam))) items.push(it);
    for (i = 0; i < G.trains.length; i++) {
      tr = G.trains[i];
      if (tr === target) continue;
      for (j = 0; j < tr.vehicles.length; j++) {
        it = vehicleItem(tr, tr.vehicles[j], j === 0, j === tr.vehicles.length - 1);
        if (it) items.push(it);
      }
    }
    items.sort(function (a, b) { return b.d - a.d; });
    items = painterOrder(items);
    for (i = 0; i < items.length; i++) items[i].fn();

    console_(target, sigs, dirCam);
  }

  /* ---------------- who we're riding with ---------------- */
  function follow(tr) {
    target = tr || null;
    elName.textContent = target ? (target.svcName || target.code) : '';
    elHint.hidden = !!target;
    if (!target) { W = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
  }

  /* On the map: a ring at the nose of the train you're riding. */
  function drawMarker(c) {
    if (!shown || !target) return;
    var v0 = target.vehicles[0], p = RY.pathAt(target.path, Math.max(0, target.s - v0.mid));
    var fwd = (v0.len - 8) / 2;
    var x = p.x + Math.cos(p.a) * fwd, y = p.y + Math.sin(p.a) * fwd;
    c.save();
    c.strokeStyle = 'rgba(88,198,255,.95)'; c.lineWidth = 2.2;
    c.beginPath(); c.arc(x, y, 13, 0, 6.2832); c.stroke();
    c.fillStyle = 'rgba(88,198,255,.95)';
    c.beginPath(); c.arc(x, y, 3.2, 0, 6.2832); c.fill();
    c.restore();
  }

  function setShown(v) {
    shown = v;
    host.classList.toggle('off', !shown);
    elToggle.textContent = shown ? '▾' : '▸';
    elToggle.title = shown ? 'Hide the cab view (C)' : 'Show the cab view (C)';
    try { root.localStorage.setItem('ry.cab', shown ? 'on' : 'off'); } catch (e) { /* private mode */ }
    // the map makes room for the window, or takes it back (game.js resize)
    root.dispatchEvent(new Event('resize'));
  }
  elToggle.addEventListener('click', function () { setShown(!shown); });
  setShown(shown);
  root.addEventListener('resize', function () { W = 0; fitKey = ''; });

  RY.cab = {
    follow: follow,
    target: function () { return target; },
    toggle: function () { setShown(!shown); },
    shown: function () { return shown; },
    overlays: function () { return shown && !docked; },
    reset: function () { follow(null); worldKey = ''; fitKey = ''; },
    draw: draw,
    drawMarker: drawMarker
  };
})(window);
