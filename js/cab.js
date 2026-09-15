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

    // Overhead line: the wire along each electrified path, masts either side.
    (RY.olePaths || []).forEach(function (P) {
      var n = Math.max(1, Math.ceil(P.len / STEP)), i, j, s, p, pts = [], o;
      for (i = 0; i <= n; i++) { p = RY.pathAt(P, P.len * i / n); pts.push({ x: p.x, y: p.y }); }
      for (i = 0; i < n; i += CHUNK) {
        j = Math.min(n, i + CHUNK);
        w.wires.push({ cx: (pts[i].x + pts[j].x) / 2, cy: (pts[i].y + pts[j].y) / 2, pts: pts.slice(i, j + 1) });
      }
      for (s = 40; s < P.len; s += 170) {
        p = RY.pathAt(P, s);
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
      fillPoly([P3(c[0], 0.4), P3(c[1], 0.4), P3(c[2], 0.4), P3(c[3], 0.4)], col(C_SLEEPER, fogK(d), 1));
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
  /* Head- or tail-lamps on an end face. */
  function endLamps(o, u, hw, rgb, k, top, h) {
    var spots = [[-(hw - 5.5), 11.5], [hw - 5.5, 11.5]];
    if (top) spots.push([0, h - 9]);
    spots.forEach(function (q) {
      var P = Vf(o, u, q[0], q[1]);
      if (P.f < NEAR) return;
      var x = sx(P), y = sy(P), r = Math.max(0.8, 1.6 * focal / P.f);
      ctx.fillStyle = 'rgba(' + rgb.join(',') + ',' + (1 - k * 0.7) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      if (night > 0.05) glow(x, y, r * 5, rgb, 0.5 * night * (1 - k));
    });
  }
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

  /* Windows along a passenger side, between the given door spans. */
  function windowRow(o, side, hw, u0, u1, doors, k, lit) {
    var spans = [[u0, u1]], out, i, d, a, b, u, w = 7.2, gap = 2.6;
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
        onSide(o, side, hw, u, u + pitch - gap, 20.5, 30, glassStyle(k, lit));
      }
    }
  }

  function vehicleItem(tr, vh, isFront, isRear) {
    var cs = tr.s - vh.mid;
    if (cs < 0) return null;
    var p = RY.pathAt(tr.path, cs);
    if (!near(p.x, p.y, 70)) return null;
    var d = dist(p.x, p.y), o = { x: p.x, y: p.y, ca: Math.cos(p.a), sa: Math.sin(p.a) };
    return { d: d, fn: function () { drawVehicle(tr, vh, o, fogK(d), isFront, isRear); } };
  }

  /* The diesel, laid out exactly as the map draws it — a grey long hood on
     a dark running plate, and a warning-yellow cab block at the leading end
     whose nose tapers to a point — then stood up as a hood unit: the cab
     rides high behind a short, low nose, the hood carries its radiator
     grilles, fan shrouds and exhaust, and walkways with handrails run down
     both sides above a fuel tank and a pair of three-axle trucks. */
  var D_FRAME = [66, 74, 83], D_HOOD = [122, 132, 142], D_CAB = [201, 162, 39],
      D_WALK = [132, 140, 150], D_DARK = [28, 31, 35], D_RAIL = [214, 222, 230];

  function drawDiesel(tr, vh, o, k, eye, side, isFront, isRear) {
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
        noseLamps(tip + 0.08, [[-3.4, 18.4], [3.4, 18.4]], isFront);
      }
    }
    function noseLamps(u, spots, on, tail) {
      var rgb = on ? (tail ? [255, 62, 44] : [255, 246, 214]) : [196, 202, 208];
      spots.forEach(function (q) {
        var P = Vf(o, u, q[0], q[1]);
        if (P.f < NEAR) return;
        var x = sx(P), y = sy(P), r = Math.max(0.8, 1.55 * focal / P.f);
        ctx.fillStyle = 'rgba(' + rgb.join(',') + ',' + (1 - k * 0.7) + ')';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        if (on && night > 0.05) glow(x, y, r * 5, rgb, 0.5 * night * (1 - k));
      });
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
      noseLamps(tip + 2.3, [[-9, 7.2], [9, 7.2]], isFront);                          // ditch lights
    } else {
      buffersAt(o, -hl, -1, k);
      if (eye.u < hood0) noseLamps(hood0 - 0.08, [[-5.5, 27], [5.5, 27]], isRear, true);   // tail lamps, on the hood's back end
    }
  }

  function drawVehicle(tr, vh, o, k, isFront, isRear) {
    var cfg = tr.cfg, body = rgbOf(cfg.body), stripe = rgbOf(cfg.stripe), roof = rgbOf(cfg.roof);
    var eye = localEye(o), side = eye.v > 0 ? 1 : -1, kind = vh.kind;
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
      secs = sections(hl, prof(hw, h), cabR ? emuNose(hw, h) : null, cabF ? emuNose(hw, h) : null);

      bogies(o, hl, hw, 18, 10, k, eye);
      // whatever sticks out of the far end goes behind the body
      if (eye.u < 0 && gangF) bellowsAt(o, hl, 1, k);
      if (eye.u > 0 && gangR) bellowsAt(o, -hl, -1, k);
      if (kind === 'coach') { if (eye.u < 0) buffersAt(o, hl, 1, k); else buffersAt(o, -hl, -1, k); }
      solid(o, secs, k, paintBody(back));

      // the side we can see
      if (Math.abs(eye.v) > hw) {
        var su0 = -hl + (cabR ? 19 : 1.5), su1 = hl - (cabF ? 19 : 1.5);
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
        windowRow(o, side, hw, su0 + 1, su1 - 1, doorSpans, k, lit);
        if (cabF) onSide(o, side, hw, hl - 17, hl - 11, 21, 30.5, glassStyle(k, lit));
        if (cabR) onSide(o, side, hw, -hl + 11, -hl + 17, 21, 30.5, glassStyle(k, lit));
      }
      // cab ends we can see: windscreen, and lamps if it's the front or rear of the train
      if (cabF && eye.u > hl - 9) {
        windscreen(o, hl, 1, hw, 19.5, 31, 8.5, false, k, lit);
        onEnd(o, hl + 0.05, -2.8, 2.8, 7, 10.5, col([30, 32, 36], k, 1));     // coupler
        endLamps(o, hl + 0.06, hw - 2, isFront ? [255, 246, 214] : [200, 206, 212], k, false, h);
      }
      if (cabR && eye.u < -hl + 9) {
        windscreen(o, -hl, -1, hw, 19.5, 31, 8.5, false, k, lit);
        onEnd(o, -hl - 0.05, -2.8, 2.8, 7, 10.5, col([30, 32, 36], k, 1));
        endLamps(o, -hl - 0.06, hw - 2, isRear ? [255, 62, 44] : [200, 206, 212], k, false, h);
      }
      if (!cabR && isRear && eye.u < -hl) endLamps(o, -hl - 0.06, hw, [255, 62, 44], k, false, h);
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
        if (fc.cap) return C_YWARN;                           // a cab at each end, both in warning yellow
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
        endLamps(o, hl + 0.06, hw, isFront ? [255, 246, 214] : [200, 206, 212], k, true, h);
      }
      if (eye.u < -hl + 7) {
        windscreen(o, -hl, -1, hw, 21.5, 32, 6, true, k, lit);
        endLamps(o, -hl - 0.06, hw, isRear ? [255, 62, 44] : [200, 206, 212], k, true, h);
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
    if (vh.load === 0) {                                          // open hopper of aggregate
      var hp = [[4 - hw, 8], [hw - 4, 8], [hw, 15], [hw, 28], [-hw, 28], [-hw, 15]];
      solid(o, [{ u: -hl, p: hp }, { u: hl, p: hp }], k, function (fc) {
        return fc.edge === 3 ? C_HOPPERLOAD : fc.cap ? shadeRgb(body, -0.15) : body;
      });
      if (Math.abs(eye.v) > hw) {
        for (var hx = -hl + 12; hx < hl - 6; hx += 12) onSide(o, side, hw, hx - 0.7, hx + 0.7, 15, 28, col(shadeRgb(body, -0.3), k, lit));
      }
    } else if (vh.load === 1) {                                   // tank
      solid(o, boxSecs(-hl, hl, 2 - hw, hw - 2, 6, 9), k, function () { return [38, 40, 44]; });
      var ring = function (r) {
        var q = [], a;
        for (a = 0; a < 8; a++) q.push([Math.cos(a * 0.785 + 0.39) * r, 20 + Math.sin(a * 0.785 + 0.39) * r]);
        return q;
      };
      solid(o, [{ u: -hl + 2, p: ring(8.4) }, { u: -hl + 6.5, p: ring(11.6) },
                { u: hl - 6.5, p: ring(11.6) }, { u: hl - 2, p: ring(8.4) }], k, function () { return C_TANK; });
    } else {                                                      // container flat
      solid(o, boxSecs(-hl, hl, -hw, hw, 7, 10.5), k, function () { return [54, 50, 46]; });
      var cw = BL / 2 - 7, c0 = rgbOf(CONTAINERS[(rnd() * 5) | 0]), c1 = rgbOf(CONTAINERS[(rnd() * 5) | 0]);
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
    if (isRear && eye.u < -hl) endLamps(o, -hl - 3.3, hw, [255, 62, 44], k, false, 28);
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
    return { d: d, fn: function () {
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

  function solidItem(so) {
    var cx = (so.c[0].x + so.c[2].x) / 2, cy = (so.c[0].y + so.c[2].y) / 2;
    var r = Math.max(Math.abs(so.c[2].x - so.c[0].x), Math.abs(so.c[2].y - so.c[0].y)) / 2;
    if (!near(cx, cy, r)) return null;
    var d = dist(cx, cy);
    return { d: d, fn: function () {
      if (so.kind === 'plat') {
        drawBox(so.c, so.z0, so.z1, C_PLATSIDE, C_PLAT, d, { top: function (cc, k) {
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
          if (so.edgeT) { strip(a, b, 0, 2.2 / span, C_COPING); strip(a, b, 3 / span, 5.5 / span, C_YELLOW); }
          if (so.edgeB) { strip(a, b, 1 - 2.2 / span, 1, C_COPING); strip(a, b, 1 - 5.5 / span, 1 - 3 / span, C_YELLOW); }
        } });
      } else if (so.kind === 'canopy') drawBox(so.c, so.z0, so.z1, C_CANOPY, C_CANOPY, d);
      else if (so.kind === 'col' || so.kind === 'stair') drawBox(so.c, so.z0, so.z1, C_STEEL, C_STEEL, d);
      else if (so.kind === 'bridge') drawBox(so.c, so.z0, so.z1, C_BRIDGE, C_BRIDGE, d);
      else drawBox(so.c, so.z0, so.z1, so.rgb, [70, 74, 80], d);
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
    return { d: d, fn: function () {
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

  /* A headlamp beam on the line ahead, once the light goes. */
  function headlamp() {
    if (night < 0.05) return;
    var a = P3({ f: 18, l: 0 }, 0), b = P3({ f: 260, l: 0 }, 0);
    var x0 = sx(a), y0 = sy(a), y1 = sy(b);
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(255,240,200,' + (0.34 * night) + ')');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - 26 / 18 * focal, y0); ctx.lineTo(x0 + 26 / 18 * focal, y0);
    ctx.lineTo(sx(P3({ f: 260, l: 40 }, 0)), y1); ctx.lineTo(sx(P3({ f: 260, l: -40 }, 0)), y1);
    ctx.closePath(); ctx.fill();
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

  function keepOut(sigs) {
    var out = [], L = RY.LAY;
    function add(x0, y0, x1, y1) { out.push([x0, y0, x1, y1]); }
    add(650, 40, 1266, 176);   // the concourse and its entrance canopy (scene.js)
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
    var v = RY.view, stage = host.parentNode;
    if (!v || !v.scale) return;
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
    headlamp();

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
    reset: function () { follow(null); worldKey = ''; fitKey = ''; },
    draw: draw,
    drawMarker: drawMarker
  };
})(window);
