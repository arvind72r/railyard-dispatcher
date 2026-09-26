/* ------------------------------------------------------------------
   scene.js — the permanent way.  Ballast, sleepers, rails, turnouts,
   platforms and lineside furniture, all baked once into an offscreen
   canvas because none of it moves.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY;
  var L = RY.LAY, T = RY.TRACKS;

  var SUP = 2;                       // supersample factor for the baked scene
  /* World units per CSS pixel the scene will be shown at (set by
     bakeScene). On a desktop a pixel is under one unit, so this changes
     nothing; on a phone, where the whole station is squeezed into a few
     hundred pixels, it keeps the rails a visible width instead of a third
     of a pixel. */
  var PX = 0;
  function minW(w, px) { return Math.max(w, px * PX); }
  var LAY_MID = L.stopX;
  function india() { return RY.station && RY.station.style === 'india'; }
  function retro() { return RY.station && RY.station.style === 'retro'; }

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }
  RY.rr = rr;

  /* ---------------- ground ---------------- */
  function drawGround(ctx, rnd) {
    var g = ctx.createLinearGradient(0, 0, 0, RY.H);
    if (india()) {                    // dry red earth rather than green lineside
      g.addColorStop(0,   '#2f2a20');
      g.addColorStop(0.35,'#372f23');
      g.addColorStop(1,   '#29241c');
    } else if (retro()) {             // dusty, and darkened with years of cinders
      g.addColorStop(0,   '#302b24');
      g.addColorStop(0.35,'#37312a');
      g.addColorStop(1,   '#2a2520');
    } else {
      g.addColorStop(0,   '#232a24');
      g.addColorStop(0.35,'#2c332b');
      g.addColorStop(1,   '#1e241f');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, RY.W, RY.H);

    // scrubby lineside texture
    var i, x, y, r;
    for (i = 0; i < 5200; i++) {
      x = rnd() * RY.W; y = rnd() * RY.H; r = 0.6 + rnd() * 1.9;
      ctx.fillStyle = (india() || retro() ? ['rgba(104,74,52,.5)','rgba(66,56,40,.6)','rgba(96,90,62,.35)','rgba(44,38,30,.5)']
                               : ['rgba(70,84,64,.55)','rgba(46,56,44,.6)','rgba(88,100,74,.35)','rgba(34,42,34,.5)'])[(rnd() * 4) | 0];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    // tufts of grass at the top and bottom margins
    for (i = 0; i < 320; i++) {
      x = rnd() * RY.W;
      y = rnd() < 0.5 ? rnd() * 92 : RY.H - rnd() * 110;
      ctx.strokeStyle = (india() ? 'rgba(150,132,80,' : 'rgba(96,116,72,') + (0.18 + rnd() * 0.3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 6, y - 5, x + (rnd() - 0.5) * 11, y - 11);
      ctx.stroke();
    }
  }

  /* ---------------- ballast ---------------- */
  function drawBallast(ctx, P, rnd) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    poly(ctx, P.pts);
    ctx.strokeStyle = '#3d3a33'; ctx.lineWidth = 58; ctx.stroke();   // shoulder shadow
    ctx.strokeStyle = '#5f5a50'; ctx.lineWidth = 50; ctx.stroke();   // ballast body
    ctx.strokeStyle = '#6e6859'; ctx.lineWidth = 38; ctx.stroke();   // crown
  }
  function drawBallastGrain(ctx, P, rnd) {
    var s, p, o, i, n = Math.floor(P.len / 5);
    var pal = ['rgba(133,127,112,.55)','rgba(88,83,73,.6)','rgba(158,152,136,.4)',
               'rgba(64,60,53,.55)','rgba(112,106,94,.5)'];
    for (i = 0; i < n; i++) {
      s = (i + rnd()) * 5;
      p = RY.pathAt(P, s);
      o = (rnd() - 0.5) * 50;
      ctx.fillStyle = pal[(rnd() * pal.length) | 0];
      ctx.beginPath();
      ctx.arc(p.x - Math.sin(p.a) * o, p.y + Math.cos(p.a) * o, 0.6 + rnd() * 1.7, 0, 6.2832);
      ctx.fill();
    }
  }

  /* ---------------- sleepers ---------------- */
  function drawSleepers(ctx, P, rnd) {
    var step = 20, s, p, i, n = Math.floor(P.len / step), shade;
    for (i = 0; i <= n; i++) {
      s = i * step;
      p = RY.pathAt(P, s);
      shade = rnd();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(-4.2, -15, 8.6, 31);                       // seating shadow
      ctx.fillStyle = india()                                   // prestressed concrete, as Indian track is laid
                    ? (shade < 0.3 ? '#77736b' : shade < 0.8 ? '#86827a' : '#6d6a63')
                    : shade < 0.18 ? '#4a3b2c'
                    : shade < 0.62 ? '#5b4835'
                    : shade < 0.86 ? '#6a563f' : '#514334';
      ctx.fillRect(-4, -15.5, 8, 31);
      ctx.fillStyle = 'rgba(255,240,214,.09)';                 // sun-bleached top edge
      ctx.fillRect(-4, -15.5, 8, 1.4);
      ctx.restore();
    }
  }

  /* ---------------- rails ---------------- */
  function drawRails(ctx, P) {
    var d, side, pts;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (side = 0; side < 2; side++) {
      d = side ? 8.6 : -8.6;
      pts = RY.offsetPath(P, d);
      poly(ctx, pts); ctx.strokeStyle = '#22252a'; ctx.lineWidth = minW(6.2, 2.0); ctx.stroke();  // foot + shadow
      poly(ctx, pts); ctx.strokeStyle = '#494e56'; ctx.lineWidth = minW(4.0, 1.4); ctx.stroke();  // web
      poly(ctx, pts); ctx.strokeStyle = '#9aa3ae'; ctx.lineWidth = minW(1.9, 0.8); ctx.stroke();  // railhead
      poly(ctx, pts); ctx.strokeStyle = 'rgba(233,241,250,.75)'; ctx.lineWidth = minW(.7, .3); ctx.stroke();
    }
  }

  /* Point blades: a short tapered rail pair peeling off the main. */
  function drawBlades(ctx, x, y0, y1, dirSign) {
    var len = 66, i, t, yy;
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.beginPath();
      for (t = 0; t <= 1.001; t += 0.1) {
        yy = y0 + (y1 - y0) * (t * t) * 0.12;
        ctx.lineTo(x + dirSign * len * t, yy + (i ? 8.6 : -8.6));
      }
      ctx.strokeStyle = '#7d8794';
      ctx.lineWidth = minW(2.2 - i * 0.2, 0.8);
      ctx.stroke();
    }
    // point machine beside the blades
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(x + dirSign * 10 - 7, y0 + (y1 > y0 ? -30 : 20), 14, 10);
    ctx.fillStyle = '#4e5a68';
    ctx.fillRect(x + dirSign * 10 - 7, y0 + (y1 > y0 ? -30 : 20), 14, 3);
    ctx.restore();
  }

  /* The same, for a realistic throat's turnouts, which can sit on a sloping
     lead rather than a level main: drawn in the frame of the line they're on
     (angle a), with the diverging leg peeling off to `side` of it. */
  function drawBladesAt(ctx, tp) {
    var len = 66, i, t;
    ctx.save();
    ctx.translate(tp.x, tp.y);
    ctx.rotate(tp.a);
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.beginPath();
      for (t = 0; t <= 1.001; t += 0.1) ctx.lineTo(len * t, tp.side * 7 * t * t + (i ? 8.6 : -8.6));
      ctx.strokeStyle = '#7d8794';
      ctx.lineWidth = minW(2.2 - i * 0.2, 0.8);
      ctx.stroke();
    }
    // point machine on the far side from the diverging leg
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(3, tp.side > 0 ? -30 : 20, 14, 10);
    ctx.fillStyle = '#4e5a68';
    ctx.fillRect(3, tp.side > 0 ? -30 : 20, 14, 3);
    ctx.restore();
  }

  /* ---------------- platforms ---------------- */

  /* A hanging sign board, the way a real platform announces itself. */
  function signPlate(ctx, cx, cy, text, accent, ink) {
    ctx.save();
    ctx.font = '700 10px ui-monospace, Menlo, monospace';
    var w = ctx.measureText(text).width + 18, h = 17;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rr(ctx, cx - w / 2 + 1.5, cy - h / 2 + 2, w, h, 3); ctx.fill();
    ctx.fillStyle = accent || '#14294a';
    rr(ctx, cx - w / 2, cy - h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(226,236,248,.55)'; ctx.lineWidth = 1;
    rr(ctx, cx - w / 2, cy - h / 2, w, h, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(cx - w / 2 + 1, cy - h / 2 + 1, w - 2, 2);
    ctx.fillStyle = ink || '#eef3fa';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
    ctx.restore();
    return w;
  }

  /* Outline of one face of an island: a deck with ramped ends, running
     from the platform edge back to the spine.  Always wound clockwise so
     the two faces union cleanly under the nonzero fill rule. */
  function faceOutline(ctx, sp, edgeY, innerY) {
    var R = 26, LIP = 15;
    if (innerY > edgeY) {                       // edge along the top
      ctx.moveTo(sp.x0, edgeY + LIP);
      ctx.lineTo(sp.x0 + R, edgeY);
      ctx.lineTo(sp.x1 - R, edgeY);
      ctx.lineTo(sp.x1, edgeY + LIP);
      ctx.lineTo(sp.x1, innerY);
      ctx.lineTo(sp.x0, innerY);
    } else {                                    // edge along the bottom
      ctx.moveTo(sp.x0, innerY);
      ctx.lineTo(sp.x1, innerY);
      ctx.lineTo(sp.x1, edgeY - LIP);
      ctx.lineTo(sp.x1 - R, edgeY);
      ctx.lineTo(sp.x0 + R, edgeY);
      ctx.lineTo(sp.x0, edgeY - LIP);
    }
    ctx.closePath();
  }

  function islandOutline(ctx, isl) {
    var u = RY.platSpan(isl.upper), l = RY.platSpan(isl.lower);
    var midY = (isl.y0 + isl.y1) / 2;
    ctx.beginPath();
    faceOutline(ctx, u, isl.y0, midY + 3);
    faceOutline(ctx, l, isl.y1, midY - 3);
  }

  /* The edge treatment: coping stones, tactile paving, yellow line. */
  function platformEdge(ctx, sp, edgeY, inward) {
    var x, y = inward > 0 ? edgeY + 3 : edgeY - 11;
    ctx.fillStyle = '#b7b2a4';
    ctx.fillRect(sp.x0, y, sp.len, 8);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    for (x = sp.x0; x < sp.x1; x += 6) ctx.fillRect(x, y + 1.5, 3, 5);
    ctx.fillStyle = '#e3b422';
    ctx.fillRect(sp.x0, inward > 0 ? edgeY : edgeY - 3, sp.len, 3);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fillRect(sp.x0, inward > 0 ? edgeY + 3 : edgeY - 3.6, sp.len, 0.9);
    // ramped ends, painted with hazard chevrons
    [sp.x0, sp.x1 - 26].forEach(function (rx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, edgeY - 15, 26, 30);
      ctx.clip();
      ctx.strokeStyle = 'rgba(228,182,34,.55)'; ctx.lineWidth = 3;
      for (x = rx - 14; x < rx + 30; x += 9) {
        ctx.beginPath();
        ctx.moveTo(x, edgeY + inward * 16); ctx.lineTo(x + 14, edgeY - inward * 4);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawIsland(ctx, isl, rnd) {
    if (india()) { drawIslandIndia(ctx, isl, rnd); return; }
    if (retro()) { drawIslandRetro(ctx, isl, rnd); return; }
    var u = RY.platSpan(isl.upper), l = RY.platSpan(isl.lower);
    var y0 = isl.y0, y1 = isl.y1, midY = (y0 + y1) / 2;
    var core = RY.islandCore(isl);
    var i, x;

    // cast shadow onto the ballast
    ctx.save();
    ctx.translate(2, 5);
    islandOutline(ctx, isl);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fill();
    ctx.restore();

    // concrete deck
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0,   '#a8a89f');
    g.addColorStop(0.13,'#93938a');
    g.addColorStop(0.5, '#88887f');
    g.addColorStop(0.87,'#93938a');
    g.addColorStop(1,   '#a8a89f');
    islandOutline(ctx, isl);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    islandOutline(ctx, isl);
    ctx.clip();

    // slab joints and weathering
    ctx.strokeStyle = 'rgba(58,58,54,.35)'; ctx.lineWidth = 1;
    for (x = u.x0; x < u.x1; x += 44) {
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(l.x0, midY); ctx.lineTo(l.x1, midY); ctx.stroke();
    for (i = 0; i < 1400; i++) {
      x = u.x0 + rnd() * u.len;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.055)' : 'rgba(40,40,38,.085)';
      ctx.fillRect(x, y0 + rnd() * (y1 - y0), 1.5, 1.5);
    }

    // benches and bins first — the canopy shades them
    for (x = core.x0 + 96; x < core.x1 - 80; x += 132) {
      [midY - 24, midY + 14].forEach(function (by) {
        ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(ctx, x - 15, by + 1, 34, 11, 2); ctx.fill();
        ctx.fillStyle = '#6b4f34'; rr(ctx, x - 16, by, 34, 10, 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,232,196,.18)'; ctx.fillRect(x - 16, by, 34, 2.5);
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - 16, by + 4.6, 34, 0.9);
      });
      ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(ctx, x + 56, midY - 6, 13, 14, 2); ctx.fill();
      ctx.fillStyle = '#2c3540'; rr(ctx, x + 55, midY - 7, 13, 14, 2); ctx.fill();
      ctx.fillStyle = '#404b58'; ctx.fillRect(x + 55, midY - 7, 13, 3);
    }

    // canopy over the stretch both faces share
    var cx0 = core.x0 + 46, cx1 = core.x1 - 46, cy0 = midY - 17, cy1 = midY + 17;
    ctx.fillStyle = 'rgba(6,10,15,.4)';
    rr(ctx, cx0 + 5, cy0 + 6, cx1 - cx0, cy1 - cy0, 5); ctx.fill();
    var cg = ctx.createLinearGradient(0, cy0, 0, cy1);
    cg.addColorStop(0.00, 'rgba(88,100,114,.80)');
    cg.addColorStop(0.14, 'rgba(46,55,67,.78)');
    cg.addColorStop(0.34, 'rgba(70,84,99,.58)');
    cg.addColorStop(0.44, 'rgba(158,184,208,.34)');
    cg.addColorStop(0.50, 'rgba(214,234,250,.30)');
    cg.addColorStop(0.56, 'rgba(150,176,200,.34)');
    cg.addColorStop(0.66, 'rgba(66,80,95,.58)');
    cg.addColorStop(0.86, 'rgba(44,53,65,.78)');
    cg.addColorStop(1.00, 'rgba(86,98,112,.80)');
    ctx.fillStyle = cg;
    rr(ctx, cx0, cy0, cx1 - cx0, cy1 - cy0, 5); ctx.fill();
    ctx.save();
    rr(ctx, cx0, midY - 9, cx1 - cx0, 18, 2); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 5;
    for (x = cx0 - 20; x < cx1 + 20; x += 120) {
      ctx.beginPath(); ctx.moveTo(x, midY + 12); ctx.lineTo(x + 26, midY - 12); ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(16,22,30,.42)'; ctx.lineWidth = 1.3;
    for (x = cx0 + 28; x < cx1; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, cy0 + 1); ctx.lineTo(x, cy1 - 1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(226,240,255,.34)'; ctx.lineWidth = 0.9;
    for (x = cx0 + 29; x < cx1; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, midY - 8); ctx.lineTo(x, midY + 8); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(236,248,255,.36)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx0 + 3, midY); ctx.lineTo(cx1 - 3, midY); ctx.stroke();
    ctx.strokeStyle = 'rgba(10,14,20,.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx0, cy0 + 1); ctx.lineTo(cx1, cy0 + 1);
    ctx.moveTo(cx0, cy1 - 1); ctx.lineTo(cx1, cy1 - 1);
    ctx.stroke();

    for (x = cx0 + 20; x < cx1 - 4; x += 62) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 2, midY - 5, 7, 10);
      ctx.fillStyle = '#1e252c'; ctx.fillRect(x - 3, midY - 6, 7, 10);
      ctx.fillStyle = '#4a545f'; ctx.fillRect(x - 3, midY - 6, 7, 2.2);
      ctx.fillStyle = 'rgba(255,238,198,.45)';
      ctx.beginPath(); ctx.arc(x + 31, midY, 3.6, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(255,253,240,.95)';
      ctx.beginPath(); ctx.arc(x + 31, midY, 1.5, 0, 6.2832); ctx.fill();
    }

    platformEdge(ctx, u, y0,  1);
    platformEdge(ctx, l, y1, -1);
    ctx.restore();

    // car-count markers along each face: one board per car length, so you
    // can literally count how long a train the platform will take
    [[u, isl.upper, y0,  1], [l, isl.lower, y1, -1]].forEach(function (f) {
      var sp = f[0], tk = f[1], edgeY = f[2], inw = f[3], k, mx;
      for (k = 1; k < tk.maxCars; k++) {
        mx = sp.x0 + 22 + (sp.len - 44) * k / tk.maxCars;
        ctx.fillStyle = 'rgba(30,34,30,.5)';
        ctx.fillRect(mx - 0.9, edgeY + inw * 13, 1.8, inw * 9);
      }
      signPlate(ctx, sp.x0 + 66, edgeY + inw * 22, tk.short + ' \u00b7 MAX ' + tk.maxCars);
      signPlate(ctx, sp.x1 - 66, edgeY + inw * 22, tk.short + ' \u00b7 MAX ' + tk.maxCars);
    });
  }


  /* ---------------- Indian platforms ---------------- */
  /* style: 'india' (Kaveripuram). A warm stone deck laid in tiles, bright
     yellow tactile paving along each edge, a long shed of green-painted
     corrugated sheet on columns over the middle of the platform — pitched
     over an island, a lean-to over a side platform — and, where it's open to
     the sky at either end, a tea stall, a book stall, a drinking-water booth
     and stone benches. Every sign is black on yellow, as Indian Railways'
     are. A side platform (isl.side) has the one face and no spine. */
  var IN_YELLOW = '#f2c318', IN_INK = '#15120a';
  function drawIslandIndia(ctx, isl, rnd) {
    var faces = [], y0 = isl.y0, y1 = isl.y1, midY = (y0 + y1) / 2, core = RY.islandCore(isl), i, x, y;
    if (isl.upper) faces.push({ sp: RY.platSpan(isl.upper), tk: isl.upper, edgeY: y0, inw: 1 });
    if (isl.lower) faces.push({ sp: RY.platSpan(isl.lower), tk: isl.lower, edgeY: y1, inw: -1 });
    var xa = Math.min.apply(null, faces.map(function (f) { return f.sp.x0; }));
    var xb = Math.max.apply(null, faces.map(function (f) { return f.sp.x1; }));
    function outline() {
      ctx.beginPath();
      faces.forEach(function (f) {
        faceOutline(ctx, f.sp, f.edgeY, isl.side ? (f.inw > 0 ? y1 : y0) : midY + f.inw * 3);
      });
    }

    ctx.save(); ctx.translate(2, 5); outline(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill(); ctx.restore();
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#bcae90'); g.addColorStop(0.5, '#ae9f82'); g.addColorStop(1, '#bcae90');
    outline(); ctx.fillStyle = g; ctx.fill();

    ctx.save(); outline(); ctx.clip();
    // square tiles, and the wear of a great many feet
    ctx.strokeStyle = 'rgba(92,78,58,.26)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (x = xa; x < xb; x += 11) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (y = y0 + 4; y < y1; y += 11) { ctx.moveTo(xa, y); ctx.lineTo(xb, y); }
    ctx.stroke();
    for (i = 0; i < 1100; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,248,230,.06)' : 'rgba(60,44,30,.09)';
      ctx.fillRect(xa + rnd() * (xb - xa), y0 + rnd() * (y1 - y0), 1.6, 1.6);
    }
    // the edge: coping, then yellow tactile paving
    faces.forEach(function (f) {
      var e = f.edgeY, d = f.inw;
      ctx.fillStyle = '#d9d2c0';
      ctx.fillRect(f.sp.x0, d > 0 ? e : e - 3, f.sp.len, 3);
      ctx.fillStyle = '#e4b51c';
      ctx.fillRect(f.sp.x0, d > 0 ? e + 3 : e - 9, f.sp.len, 6);
      ctx.fillStyle = 'rgba(120,86,0,.35)';
      for (x = f.sp.x0 + 1.5; x < f.sp.x1; x += 3) {
        ctx.fillRect(x, d > 0 ? e + 4.2 : e - 7.8, 1, 1); ctx.fillRect(x + 1.5, d > 0 ? e + 6.6 : e - 5.4, 1, 1);
      }
    });
    ctx.restore();

    // the shed spans the middle of the platform; the ends are open
    var cl = core.x1 - core.x0, cx0 = core.x0 + cl * 0.17, cx1 = core.x1 - cl * 0.17;
    var backY = isl.side ? (isl.lower ? y0 : y1) : null;          // a side platform's building side
    var spine = isl.side ? backY + (isl.lower ? 8 : -8) : midY;   // where stalls and benches stand

    // the open ends: stalls, water booth, benches
    [[core.x0 + 22, cx0 - 8], [cx1 + 8, core.x1 - 22]].forEach(function (seg, n) {
      var a = seg[0], b = seg[1], m = (a + b) / 2;
      if (b - a < 40) return;
      stall(ctx, m - (n ? -12 : 12), spine, n ? '#2f6fb2' : '#c8412d');   // a tea stall one end, a book stall the other
      booth(ctx, m + (n ? -30 : 30), spine);
      for (x = a + 6; x < b - 6; x += 44) {
        if (Math.abs(x - m) < 44) continue;
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 1, spine - 3, 22, 7);
        ctx.fillStyle = '#8c8a84'; ctx.fillRect(x, spine - 4, 22, 7);        // stone bench
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, spine - 4, 22, 1.5);
      }
    });

    // the shed
    var sy0, sy1;
    if (isl.side) { sy0 = isl.lower ? y0 - 2 : y0 + 3; sy1 = isl.lower ? y1 - 3 : y1 + 2; }
    else { sy0 = y0 + 2; sy1 = y1 - 2; }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(cx0 + 4, sy0 + 6, cx1 - cx0, sy1 - sy0);
    function slope(ya, yb, base) {
      ctx.fillStyle = base; ctx.fillRect(cx0, ya, cx1 - cx0, yb - ya);
      ctx.strokeStyle = 'rgba(20,32,22,.35)'; ctx.lineWidth = 1;         // corrugations, down the slope
      ctx.beginPath();
      for (x = cx0 + 2; x < cx1; x += 3.4) { ctx.moveTo(x, ya); ctx.lineTo(x, yb); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,228,212,.12)'; ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (x = cx0 + 3.4; x < cx1; x += 3.4) { ctx.moveTo(x, ya); ctx.lineTo(x, yb); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(12,20,14,.28)'; ctx.lineWidth = 1;          // sheet laps across it
      ctx.beginPath();
      for (x = cx0 + 58; x < cx1; x += 58) { ctx.moveTo(x, ya); ctx.lineTo(x, yb); }
      ctx.stroke();
    }
    if (isl.side) {
      // a lean-to off the building, falling toward the track: the sun is to
      // the south, so the one that falls south is lit and the other isn't
      slope(sy0, sy1, isl.lower ? '#6a8c6f' : '#4e6a54');
    } else {
      slope(sy0, midY, '#4e6a54');
      slope(midY, sy1, '#6a8c6f');
      ctx.fillStyle = '#a9bba9'; ctx.fillRect(cx0, midY - 1.2, cx1 - cx0, 2.4);   // ridge cap
    }
    ctx.strokeStyle = 'rgba(10,16,12,.6)'; ctx.lineWidth = 1.4;
    ctx.strokeRect(cx0, sy0, cx1 - cx0, sy1 - sy0);
    // lamps hung under it, seen through the ridge vents
    for (x = cx0 + 30; x < cx1 - 10; x += 62) {
      ctx.fillStyle = 'rgba(255,238,198,.35)';
      ctx.beginPath(); ctx.arc(x, isl.side ? (sy0 + sy1) / 2 : midY, 2.8, 0, 6.2832); ctx.fill();
    }

    // platform numbers, black on yellow, at both ends of every face
    faces.forEach(function (f) {
      var tk = f.tk, k, mx, py = isl.side ? (y0 + y1) / 2 : midY - f.inw * 8.5;
      for (k = 1; k < tk.maxCars; k++) {
        mx = f.sp.x0 + 22 + (f.sp.len - 44) * k / tk.maxCars;
        ctx.fillStyle = 'rgba(30,24,10,.55)';
        ctx.fillRect(mx - 0.9, f.edgeY + f.inw * 10, 1.8, f.inw * 6);
      }
      var txt = tk.short + ' · MAX ' + tk.maxCars;
      signPlate(ctx, f.sp.x0 + 58, py, txt, IN_YELLOW, IN_INK);
      signPlate(ctx, f.sp.x1 - 58, py, txt, IN_YELLOW, IN_INK);
    });
    // and the station's own name boards, on the side platforms
    if (isl.side) {
      var st = RY.station, nm = st.name.replace(' Junction', ' JN.').toUpperCase();
      [core.x0 + 170, core.x1 - 170].forEach(function (bx) {
        signPlate(ctx, bx, (y0 + y1) / 2, nm, IN_YELLOW, IN_INK);
      });
    }
  }
  function stall(ctx, x, y, awning) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x - 12, y - 5, 26, 13);
    ctx.fillStyle = '#6b5a45'; ctx.fillRect(x - 13, y - 6, 26, 12);
    ctx.fillStyle = awning; ctx.fillRect(x - 14, y - 7, 28, 6);             // striped awning
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (var i = 0; i < 4; i++) ctx.fillRect(x - 12 + i * 7, y - 7, 3, 6);
    ctx.fillStyle = '#f2ead8'; ctx.fillRect(x - 10, y + 1, 20, 3);          // counter
  }
  function booth(ctx, x, y) {                                              // drinking water
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x - 4, y - 3, 10, 9);
    ctx.fillStyle = '#d7dde2'; ctx.fillRect(x - 5, y - 4, 10, 9);
    ctx.fillStyle = '#2f7fc1'; ctx.fillRect(x - 5, y - 4, 10, 3);
  }


  /* ---------------- the steam-era station ---------------- */
  /* style: 'retro' (Pazhayapuram). Low platforms of big stone slabs with a
     whitewashed edge, under cast-iron canopies — a roof of corrugated
     sheet in red oxide, fringed all round with the fretted wooden valance
     of the period — kerosene lamp posts along the edge, a water column at
     each end for the engines, and enamel boards, black on cream. */
  var RT_CREAM = '#ece2c6', RT_INK = '#1a1712';
  function drawIslandRetro(ctx, isl, rnd) {
    var faces = [], y0 = isl.y0, y1 = isl.y1, midY = (y0 + y1) / 2, core = RY.islandCore(isl), i, x, y;
    if (isl.upper) faces.push({ sp: RY.platSpan(isl.upper), tk: isl.upper, edgeY: y0, inw: 1 });
    if (isl.lower) faces.push({ sp: RY.platSpan(isl.lower), tk: isl.lower, edgeY: y1, inw: -1 });
    var xa = Math.min.apply(null, faces.map(function (f) { return f.sp.x0; }));
    var xb = Math.max.apply(null, faces.map(function (f) { return f.sp.x1; }));
    function outline() {
      ctx.beginPath();
      faces.forEach(function (f) {
        faceOutline(ctx, f.sp, f.edgeY, isl.side ? (f.inw > 0 ? y1 : y0) : midY + f.inw * 3);
      });
    }
    ctx.save(); ctx.translate(2, 5); outline(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill(); ctx.restore();
    outline(); ctx.fillStyle = '#9d988a'; ctx.fill();
    ctx.save(); outline(); ctx.clip();
    // big stone slabs, laid in courses
    ctx.strokeStyle = 'rgba(58,54,46,.4)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (y = y0 + 8; y < y1; y += 16) { ctx.moveTo(xa, y); ctx.lineTo(xb, y); }
    for (y = y0, i = 0; y < y1; y += 16, i++) {
      for (x = xa + (i % 2) * 14; x < xb; x += 28) { ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y1, y + 16)); }
    }
    ctx.stroke();
    for (i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,250,236,.05)' : 'rgba(40,34,26,.10)';
      ctx.fillRect(xa + rnd() * (xb - xa), y0 + rnd() * (y1 - y0), 1.7, 1.7);
    }
    // the edge: dressed coping, whitewashed
    faces.forEach(function (f) {
      var e = f.edgeY, d = f.inw;
      ctx.fillStyle = '#efece3'; ctx.fillRect(f.sp.x0, d > 0 ? e : e - 4, f.sp.len, 4);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(f.sp.x0, d > 0 ? e + 4 : e - 5, f.sp.len, 1);
    });
    ctx.restore();

    // the canopy: red-oxide corrugated roof, a fretted valance all round
    var cl = core.x1 - core.x0, cx0 = core.x0 + cl * 0.14, cx1 = core.x1 - cl * 0.14, sy0, sy1;
    if (isl.side) { sy0 = isl.lower ? y0 - 2 : y0 + 4; sy1 = isl.lower ? y1 - 4 : y1 + 2; }
    else { sy0 = y0 + 5; sy1 = y1 - 5; }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(cx0 + 4, sy0 + 6, cx1 - cx0, sy1 - sy0);
    ctx.fillStyle = '#7b3b2a'; ctx.fillRect(cx0, sy0, cx1 - cx0, sy1 - sy0);
    ctx.strokeStyle = 'rgba(30,12,8,.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (x = cx0 + 2; x < cx1; x += 3.2) { ctx.moveTo(x, sy0); ctx.lineTo(x, sy1); }
    ctx.stroke();
    if (!isl.side) {                                          // a ridge, and the roof falling away either side
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(cx0, sy0, cx1 - cx0, midY - sy0);
      ctx.fillStyle = '#a7644c'; ctx.fillRect(cx0, midY - 1.2, cx1 - cx0, 2.4);
    }
    ctx.fillStyle = RT_CREAM;                                 // the valance: a fretted fringe
    [sy0, sy1].forEach(function (ey, n) {
      for (x = cx0; x < cx1 - 3; x += 6) {
        ctx.beginPath(); ctx.moveTo(x, ey); ctx.lineTo(x + 3, ey + (n ? 3.2 : -3.2)); ctx.lineTo(x + 6, ey); ctx.closePath(); ctx.fill();
      }
    });
    ctx.fillRect(cx0 - 1, sy0 - 1, 2, sy1 - sy0 + 2); ctx.fillRect(cx1 - 1, sy0 - 1, 2, sy1 - sy0 + 2);

    // kerosene lamp posts along the open ends, and a water column at each end
    [[core.x0 + 20, cx0 - 6], [cx1 + 6, core.x1 - 20]].forEach(function (seg) {
      for (x = seg[0]; x < seg[1]; x += 34) {
        var ly = isl.side ? (isl.lower ? y0 + 7 : y1 - 7) : midY;
        ctx.fillStyle = '#1e2124'; ctx.beginPath(); ctx.arc(x, ly, 2.2, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,140,.55)'; ctx.beginPath(); ctx.arc(x, ly, 1.1, 0, 6.2832); ctx.fill();
      }
    });
    faces.forEach(function (f) {
      [f.sp.x0 + 18, f.sp.x1 - 18].forEach(function (wx) {
        var wy = f.edgeY + f.inw * 9;
        waterColumn(ctx, wx, wy, f.inw);
      });
    });
    // enamel boards: road numbers and the station's name
    faces.forEach(function (f) {
      var tk = f.tk, k, mx, py = isl.side ? (y0 + y1) / 2 : midY - f.inw * 13;
      for (k = 1; k < tk.maxCars; k++) {
        mx = f.sp.x0 + 22 + (f.sp.len - 44) * k / tk.maxCars;
        ctx.fillStyle = 'rgba(30,24,10,.55)';
        ctx.fillRect(mx - 0.9, f.edgeY + f.inw * 5, 1.8, f.inw * 5);
      }
      var txt = tk.short + ' · MAX ' + tk.maxCars;
      signPlate(ctx, f.sp.x0 + 64, py, txt, RT_CREAM, RT_INK);
      signPlate(ctx, f.sp.x1 - 64, py, txt, RT_CREAM, RT_INK);
    });
    if (isl.side) {
      var nm = RY.station.name.replace(' Junction', ' JN.').toUpperCase();
      [core.x0 + 175, core.x1 - 175].forEach(function (bx) { signPlate(ctx, bx, (y0 + y1) / 2, nm, RT_CREAM, RT_INK); });
    }
  }
  /* A water column from above: its base, the pillar, and the arm swung
     along the platform, with its leather hose. */
  function waterColumn(ctx, x, y, inw) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 2, 4.5, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#2c3a30'; ctx.beginPath(); ctx.arc(x, y, 4.2, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#44584a'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#2c3a30'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 14, y); ctx.stroke();
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x + 12, y - 1.5, 4, 3);
  }

  /* A through road carries no platform at all — say so on the ground.
     A station can have one of these at the top, the bottom, or (as at
     Selby Yard) both, so the sign sits on whichever side of the whole
     track band this particular road is on, clamped clear of the fence. */
  function drawThroughRoadSign(ctx, t) {
    var topY = 206, botY = RY.H - 74;
    var below = t.y > (topY + botY) / 2;
    var margin = below ? Math.min(48, botY - t.y - 12) : Math.min(48, t.y - topY - 12);
    var y = below ? t.y + margin : t.y - margin, x, i;
    // hatched no-platform strip beside the road
    ctx.save();
    ctx.beginPath(); ctx.rect(L.xThroatW + 40, y - 9, L.xThroatE - L.xThroatW - 80, 18);
    ctx.clip();
    ctx.fillStyle = 'rgba(30,36,30,.35)';
    ctx.fillRect(L.xThroatW + 40, y - 9, L.xThroatE - L.xThroatW - 80, 18);
    ctx.strokeStyle = 'rgba(216,176,60,.28)'; ctx.lineWidth = 4;
    for (x = L.xThroatW; x < L.xThroatE; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + 16, y - 12); ctx.stroke();
    }
    ctx.restore();
    signPlate(ctx, LAY_MID, y, t.name.toUpperCase() + ' \u00b7 NO PLATFORM \u00b7 MAX ' + t.maxCars, '#4a3410');
    for (i = -1; i <= 1; i += 2) {
      signPlate(ctx, LAY_MID + i * 300, y, india() ? 'GOODS & NON-STOP' : 'FREIGHT & NON-STOP', '#4a3410');
    }
  }

  /* A buffer stop: red-and-white striped block marking where a rail
     genuinely ends. Used both at the end of a stabling road and — at a
     terminus — at the dead end of every platform. */
  function drawBuffer(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(-3, -13, 8, 28);
    ctx.fillStyle = '#3a3f46'; ctx.fillRect(-4, -14, 8, 28);
    ctx.fillStyle = '#c8382c'; ctx.fillRect(-4, -14, 8, 5);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(-4, -8, 8, 2); ctx.fillRect(-4, 2, 8, 2);
    ctx.restore();
  }

  /* The stabling yard, terminus stations only. The sidings themselves are
     already baked as ordinary trackwork (see buildTrackwork) — this adds
     the buffer stops that mark where a shunt has to stop, and a sign
     naming the place, since it's really a whole depot standing in. */
  function drawYard(ctx) {
    var i, yr, x = L.yardFar;
    for (i = 0; i < RY.YARD.length; i++) { yr = RY.YARD[i]; drawBuffer(ctx, x, yr.y); }
    signPlate(ctx, (L.yardNear + L.yardFar) / 2, RY.YARD[0].y - 46, 'BASIN BRIDGE YARD · STABLING', '#233047');
  }

  /* Every terminus platform dead-ends at its own buffer, on the west —
     there is no west throat to draw instead (see buildPath/buildTrackwork). */
  function drawPlatformBuffers(ctx) {
    for (var i = 0; i < T.length; i++) drawBuffer(ctx, RY.platSpan(T[i]).x0, T[i].y);
  }

  /* A lattice footbridge spanning the whole station.  Drawn over the
     trains by the live renderer, since it passes above them. */
  RY.drawFootbridge = function (ctx) {
    var bx = L.stopX, y0 = 268, y1 = 884, i, y, k;   // starts clear of the lineside signs
    if (india() || retro()) { y0 = RY.ISLANDS[0].y0 + 6; y1 = RY.ISLANDS[RY.ISLANDS.length - 1].y1 - 6; }   // side platform to side platform
    ctx.save();
    ctx.globalAlpha = 0.88;               // let the stock read through it
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    rr(ctx, bx - 11, y0 + 7, 34, y1 - y0, 4); ctx.fill();

    var g = ctx.createLinearGradient(bx - 14, 0, bx + 14, 0);
    g.addColorStop(0,   '#2e363f');
    g.addColorStop(0.30,'#49535e');
    g.addColorStop(0.5, '#57626e');
    g.addColorStop(0.74,'#3f4954');
    g.addColorStop(1,   '#2b333c');
    ctx.fillStyle = g;
    rr(ctx, bx - 14, y0, 28, y1 - y0, 4); ctx.fill();

    ctx.strokeStyle = 'rgba(16,20,26,.45)'; ctx.lineWidth = 1;
    for (y = y0 + 6; y < y1; y += 9) {
      ctx.beginPath(); ctx.moveTo(bx - 13, y); ctx.lineTo(bx + 13, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(150,162,175,.85)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 12.5, y0 + 2); ctx.lineTo(bx - 12.5, y1 - 2);
    ctx.moveTo(bx + 12.5, y0 + 2); ctx.lineTo(bx + 12.5, y1 - 2);
    ctx.stroke();

    // stair towers down onto each island
    for (i = 0; i < RY.ISLANDS.length; i++) {
      y = (RY.ISLANDS[i].y0 + RY.ISLANDS[i].y1) / 2;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      rr(ctx, bx - 52, y - 21, 38, 44, 4); ctx.fill();
      ctx.fillStyle = '#3f4a56';
      rr(ctx, bx - 55, y - 23, 38, 44, 4); ctx.fill();
      ctx.fillStyle = '#525d69';
      for (k = 0; k < 7; k++) ctx.fillRect(bx - 52, y - 19 + k * 5.8, 32, 3.9);
      ctx.strokeStyle = 'rgba(16,20,26,.55)'; ctx.lineWidth = 0.8;
      for (k = 0; k < 7; k++) {
        ctx.beginPath(); ctx.moveTo(bx - 52, y - 19 + k * 5.8 + 3.9);
        ctx.lineTo(bx - 20, y - 19 + k * 5.8 + 3.9); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(150,162,175,.7)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(bx - 55, y - 23, 38, 44);
    }
    ctx.restore();
  };

  /* Overhead line equipment — masts either side, contact wire down the middle.
     Every path drawn here is kept in RY.olePaths too, masts and all (P.masts,
     distances along it), so the cab view can put its masts and wire exactly
     where the map does. Masts go every 170 unless the caller has placed
     them (see roadMasts). */
  /* A platform road's masts, as distances along its OLE path (which runs
     from the west throat, or a terminus road's buffer, to xThroatE). The
     road's starter signals stand 30 in from each throat (game.js,
     signalStates: xThroatW + 30 and xThroatE - 30), and on a plain 170 step
     a mast stood 10 short of the west one and 3 nearer the track, squarely
     in front of it from the cab. So a mast stands at each starter, carrying
     it, with the rest spread evenly between; a terminus road has only the
     east starter, and steps back from it. */
  function roadMasts(len) {
    var out = [], s, n, i, a = 30, b = len - 30;
    if (L.terminus) {
      for (s = b; s > 20; s -= 170) out.unshift(s);
      return out;
    }
    n = Math.max(1, Math.round((b - a) / 170));
    for (i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
    return out;
  }

  function drawOLE(ctx, P) {
    var s, p, o, k;
    if (!P.masts) for (P.masts = [], s = 40; s < P.len; s += 170) P.masts.push(s);
    RY.olePaths.push(P);
    ctx.save();
    poly(ctx, P.pts);
    ctx.strokeStyle = 'rgba(190,200,212,.13)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (k = 0; k < P.masts.length; k++) {
      p = RY.pathAt(P, P.masts[k]);
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a);
      for (o = -1; o <= 1; o += 2) {
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillRect(-3, o * 31 - 3, 8, 8);
        ctx.fillStyle = '#5a6673';
        ctx.fillRect(-4, o * 31 - 4, 8, 8);
        ctx.fillStyle = '#7d8b9a';
        ctx.fillRect(-4, o * 31 - 4, 8, 2.5);
        ctx.strokeStyle = 'rgba(150,162,176,.4)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, o * 29); ctx.lineTo(0, 0); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /* Cable troughing runs beside the running lines — small but very "railway". */
  function drawTroughing(ctx, y, x0, x1) {
    var x;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x0, y + 1, x1 - x0, 9);
    for (x = x0; x < x1; x += 15) {
      ctx.fillStyle = (x / 15) % 2 ? '#6d6a63' : '#605d57';
      ctx.fillRect(x, y, 13.5, 8);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(x, y, 13.5, 2);
    }
  }

  /* Signal box, station block, depot, boundary fences. */
  function drawBuildings(ctx, rnd) {
    var i, x;
    if (india()) { drawBuildingsIndia(ctx, rnd); return; }
    if (retro()) { drawBuildingsRetro(ctx, rnd); return; }

    // boundary fences top and bottom
    [206, RY.H - 74].forEach(function (fy) {
      ctx.strokeStyle = 'rgba(150,158,150,.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(RY.W, fy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, fy + 5); ctx.lineTo(RY.W, fy + 5); ctx.stroke();
      ctx.fillStyle = 'rgba(58,64,56,.9)';
      for (x = 0; x < RY.W; x += 26) ctx.fillRect(x, fy - 3, 3, 12);
    });

    // station concourse block, north side
    ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, 664, 54, 592, 92, 6); ctx.fill();
    ctx.fillStyle = '#6f5b47'; rr(ctx, 660, 50, 592, 92, 6); ctx.fill();
    ctx.fillStyle = '#826c55'; rr(ctx, 660, 50, 592, 32, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(660, 50, 592, 5);
    ctx.fillStyle = '#39434f';
    for (x = 684; x < 1230; x += 38) { rr(ctx, x, 92, 24, 34, 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(160,200,235,.35)';
    for (x = 684; x < 1230; x += 38) ctx.fillRect(x + 1, 94, 22, 15);
    ctx.fillStyle = '#e8dcc2';
    ctx.font = '700 17px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(RY.station.name.toUpperCase().replace(' ', '  '), 956, 74);
    // canopy over the entrance, reaching toward the through road
    ctx.fillStyle = 'rgba(40,48,58,.55)';
    rr(ctx, 860, 142, 200, 26, 4); ctx.fill();
    ctx.fillStyle = 'rgba(150,164,180,.28)';
    rr(ctx, 862, 144, 196, 10, 3); ctx.fill();

    // signal box at the west end
    ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, 88, 906, 116, 74, 4); ctx.fill();
    ctx.fillStyle = '#7d5a3c'; rr(ctx, 84, 902, 116, 74, 4); ctx.fill();
    ctx.fillStyle = '#8f6a48'; rr(ctx, 84, 902, 116, 26, 4); ctx.fill();
    ctx.fillStyle = '#3a4450'; rr(ctx, 93, 914, 98, 50, 3); ctx.fill();
    ctx.fillStyle = 'rgba(150,190,225,.4)';
    for (i = 0; i < 5; i++) ctx.fillRect(98 + i * 18, 919, 13, 40);
    ctx.fillStyle = '#e8dcc2';
    ctx.font = '700 10px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(RY.station.name.split(' ')[0].toUpperCase() + ' PSB', 142, 992);

    // permanent-way depot, south east
    ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(ctx, 1496, 916, 186, 58, 4); ctx.fill();
    ctx.fillStyle = '#4d5560'; rr(ctx, 1492, 912, 186, 58, 4); ctx.fill();
    ctx.fillStyle = '#5c6672';
    for (x = 1492; x < 1678; x += 20) ctx.fillRect(x, 912, 10, 58);
    ctx.fillStyle = '#9aa4b0';
    ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillText('P-WAY DEPOT', 1585, 986);

    // sleeper stacks and spoil along the south cess
    for (i = 0; i < 9; i++) {
      x = 250 + i * 74;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 2, 944, 48, 16);
      ctx.fillStyle = '#5b4835'; ctx.fillRect(x, 942, 48, 15);
      ctx.fillStyle = 'rgba(255,240,214,.08)'; ctx.fillRect(x, 942, 48, 3);
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = .8;
      for (var k = 1; k < 4; k++) {
        ctx.beginPath(); ctx.moveTo(x, 942 + k * 3.7); ctx.lineTo(x + 48, 942 + k * 3.7); ctx.stroke();
      }
    }

    // a couple of ground signals / mileposts along the cess
    for (i = 0; i < 6; i++) {
      x = 300 + i * 260;
      ctx.fillStyle = '#39424c'; ctx.fillRect(x, 236, 4, 14);
      ctx.fillStyle = '#c9ced3'; ctx.fillRect(x - 4, 232, 12, 6);
    }
  }


  /* The Indian station's buildings. Platform 1 runs along the front of the
     station building, which sits on the side platform's back edge rather
     than behind a fence: a long block under a terracotta-tiled roof with a
     domed clock tower over the entrance. On the town side, a forecourt with
     the big black-on-yellow name board — Tamil, Hindi and English — auto-
     rickshaws waiting in rank, neem trees and the station's overhead water
     tank; along the south cess, the cabin and stacks of concrete sleepers. */
  function drawBuildingsIndia(ctx, rnd) {
    var st = RY.station, p1 = RY.ISLANDS[0], by1 = p1.y0, by0 = 120, i, x, y;
    var sp = RY.platSpan(p1.lower), bx0 = sp.x0 + 38, bx1 = sp.x1 - 38, cx = (bx0 + bx1) / 2;

    // boundary fence along the south only
    var fy = RY.H - 74;
    ctx.strokeStyle = 'rgba(150,158,150,.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(RY.W, fy); ctx.moveTo(0, fy + 5); ctx.lineTo(RY.W, fy + 5); ctx.stroke();
    ctx.fillStyle = 'rgba(58,64,56,.9)';
    for (x = 0; x < RY.W; x += 26) ctx.fillRect(x, fy - 3, 3, 12);

    // the town road and the forecourt
    ctx.fillStyle = '#34322e'; ctx.fillRect(0, 30, RY.W, 34);
    ctx.fillStyle = 'rgba(230,226,210,.35)';
    for (x = 8; x < RY.W; x += 40) ctx.fillRect(x, 46, 20, 2);
    ctx.fillStyle = '#4a463d'; ctx.fillRect(bx0 - 160, 64, bx1 - bx0 + 320, by0 - 64);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(bx0 - 160, 64, bx1 - bx0 + 320, 2);
    // neem trees along the road
    for (i = 0; i < 16; i++) {
      x = 40 + i * 122 + rnd() * 30; y = 14 + rnd() * 8;
      if (x > bx0 - 170 && x < bx1 + 170) continue;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 4, y + 6, 17, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#35502e'; ctx.beginPath(); ctx.arc(x, y, 17, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(120,150,80,.45)';
      for (var j = 0; j < 7; j++) { ctx.beginPath(); ctx.arc(x - 8 + rnd() * 14, y - 8 + rnd() * 12, 4 + rnd() * 3, 0, 6.2832); ctx.fill(); }
    }
    // auto-rickshaws in rank, both sides of the entrance
    [[bx0 - 150, bx0 + 60], [bx1 - 60, bx1 + 150]].forEach(function (seg) {
      for (x = seg[0]; x < seg[1]; x += 20) auto(ctx, x, 78 + (rnd() < 0.5 ? 0 : 20));
    });

    // the name board, in the forecourt facing the town
    var nw = 440, nh = 38, ny = 64;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(cx - nw / 2 + 3, ny + 4, nw, nh);
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(cx - nw / 2 + 30, ny + nh, 5, 8); ctx.fillRect(cx + nw / 2 - 35, ny + nh, 5, 8);
    ctx.fillStyle = IN_YELLOW; ctx.fillRect(cx - nw / 2, ny, nw, nh);
    ctx.strokeStyle = '#15120a'; ctx.lineWidth = 2; ctx.strokeRect(cx - nw / 2 + 2, ny + 2, nw - 4, nh - 4);
    ctx.fillStyle = IN_INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 12px "Tamil Sangam MN", "Noto Sans Tamil", sans-serif';
    ctx.fillText(st.nameTamil + ' சந்திப்பு', cx - nw / 4, ny + 12);
    ctx.font = '700 12px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText(st.nameHindi + ' जंक्शन', cx + nw / 4, ny + 12);
    ctx.font = '800 15px ui-monospace, Menlo, monospace';
    ctx.fillText(st.name.replace(' Junction', ' JN.').toUpperCase() + '  (' + st.code + ')', cx, ny + 29);

    // the overhead water tank, west of the building
    var tx = bx0 - 110, ty = by0 + 44;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(tx + 8, ty + 12, 30, 0, 6.2832); ctx.fill();
    var tg = ctx.createRadialGradient(tx - 8, ty - 8, 4, tx, ty, 30);
    tg.addColorStop(0, '#c9c4b6'); tg.addColorStop(1, '#8a857a');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(tx, ty, 28, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(40,36,30,.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(tx, ty, 20, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = '#5d584e'; ctx.fillRect(tx - 4, ty - 4, 8, 8);

    // the station building
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx0 + 5, by0 + 6, bx1 - bx0, by1 - by0);
    ctx.fillStyle = '#d8c79f'; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);          // parapet wings
    var rx0 = bx0 + 34, rx1 = bx1 - 34, ry0 = by0 + 6, ry1 = by1 - 6, ridge = (ry0 + ry1) / 2;
    [[ry0, ridge, '#8e4632'], [ridge, ry1, '#b25d42']].forEach(function (sl) {    // tiled roof, two slopes
      ctx.fillStyle = sl[2]; ctx.fillRect(rx0, sl[0], rx1 - rx0, sl[1] - sl[0]);
      ctx.strokeStyle = 'rgba(40,14,8,.32)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (y = sl[0] + 4; y < sl[1]; y += 4.5) { ctx.moveTo(rx0, y); ctx.lineTo(rx1, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,170,.10)';
      ctx.beginPath();
      for (x = rx0 + 5; x < rx1; x += 9) { ctx.moveTo(x, sl[0]); ctx.lineTo(x, sl[1]); }
      ctx.stroke();
    });
    ctx.fillStyle = '#6e3322'; ctx.fillRect(rx0, ridge - 1.6, rx1 - rx0, 3.2);        // ridge tiles
    ctx.strokeStyle = 'rgba(30,16,10,.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(bx0, by0, bx1 - bx0, 3);
    // the entrance porch, and the clock tower over it with its dome
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(cx - 58, by0 - 10, 120, 14);
    ctx.fillStyle = '#e3d5b2'; ctx.fillRect(cx - 60, by0 - 12, 120, 14);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(cx - 60, by0 - 1, 120, 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(cx - 30, ridge - 28, 64, 64);
    ctx.fillStyle = '#e8dbba'; ctx.fillRect(cx - 32, ridge - 32, 64, 64);
    ctx.strokeStyle = 'rgba(120,90,50,.55)'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - 28, ridge - 28, 56, 56);
    var dg = ctx.createRadialGradient(cx - 7, ridge - 8, 2, cx, ridge, 24);
    dg.addColorStop(0, '#f6efdc'); dg.addColorStop(1, '#b9a57c');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, ridge, 23, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#9b7b3c'; ctx.beginPath(); ctx.arc(cx, ridge, 3.2, 0, 6.2832); ctx.fill();   // finial
    // small corner kiosks on the tower
    [[-28, -28], [28, -28], [-28, 28], [28, 28]].forEach(function (c) {
      ctx.fillStyle = '#c9b58a'; ctx.beginPath(); ctx.arc(cx + c[0], ridge + c[1], 6, 0, 6.2832); ctx.fill();
    });

    // the cabin at the west end
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(88, 906, 116, 60);
    ctx.fillStyle = '#c9b48a'; ctx.fillRect(84, 902, 116, 60);
    ctx.fillStyle = '#9a5038'; ctx.fillRect(84, 902, 116, 20);
    ctx.fillStyle = '#3a4450'; ctx.fillRect(93, 928, 98, 26);
    ctx.fillStyle = 'rgba(150,190,225,.4)';
    for (i = 0; i < 5; i++) ctx.fillRect(98 + i * 18, 931, 13, 20);
    ctx.fillStyle = '#e8dcc2'; ctx.font = '700 10px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(st.code + ' CABIN', 142, 980);

    // concrete sleepers stacked along the cess, and the P-way store
    for (i = 0; i < 4; i++) {
      x = 250 + i * 74;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 2, 944, 48, 16);
      ctx.fillStyle = '#8f8b82'; ctx.fillRect(x, 942, 48, 15);
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = .8;
      for (var k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x, 942 + k * 3.7); ctx.lineTo(x + 48, 942 + k * 3.7); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(ctx, 1496, 916, 186, 58, 4); ctx.fill();
    ctx.fillStyle = '#7c6e58'; rr(ctx, 1492, 912, 186, 58, 4); ctx.fill();
    ctx.fillStyle = '#8b7c64';
    for (x = 1492; x < 1678; x += 20) ctx.fillRect(x, 912, 10, 58);
    ctx.fillStyle = '#9aa4b0'; ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillText('P-WAY STORE', 1585, 986);
  }
  /* An auto-rickshaw from above: yellow canopy, green-black body. */
  function auto(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 1.5, y + 2, 11, 16);
    ctx.fillStyle = '#1e2a1f'; ctx.fillRect(x, y, 11, 16);
    ctx.fillStyle = '#e8c31c'; ctx.fillRect(x + 0.5, y + 4, 10, 10);
    ctx.fillStyle = '#2f6b3a'; ctx.fillRect(x + 2, y, 7, 3.5);
  }


  /* The steam-era station's buildings: a red-brick block under a tiled
     roof, an arched verandah along platform 1 and a clock tower with a
     pyramid roof; a riveted water tank on its trestle; in the forecourt the
     name board, black on cream, a couple of Ambassadors and a bullock cart;
     to the south the signal cabin, the coal stage and the loco shed. */
  function drawBuildingsRetro(ctx, rnd) {
    var st = RY.station, p1 = RY.ISLANDS[0], by1 = p1.y0, by0 = 126, i, x, y;
    var sp = RY.platSpan(p1.lower), bx0 = sp.x0 + 30, bx1 = sp.x1 - 30, cx = (bx0 + bx1) / 2;

    var fy = RY.H - 74;                                       // boundary fence, south
    ctx.strokeStyle = 'rgba(150,158,150,.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(RY.W, fy); ctx.moveTo(0, fy + 5); ctx.lineTo(RY.W, fy + 5); ctx.stroke();
    ctx.fillStyle = 'rgba(58,64,56,.9)';
    for (x = 0; x < RY.W; x += 26) ctx.fillRect(x, fy - 3, 3, 12);

    // the road, unmetalled, and the forecourt
    ctx.fillStyle = '#4b4336'; ctx.fillRect(0, 30, RY.W, 34);
    ctx.strokeStyle = 'rgba(30,24,16,.35)'; ctx.lineWidth = 1.2;                 // cart ruts
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(RY.W, 42); ctx.moveTo(0, 54); ctx.lineTo(RY.W, 53); ctx.stroke();
    ctx.fillStyle = '#5a5042'; ctx.fillRect(bx0 - 170, 64, bx1 - bx0 + 340, by0 - 64);
    for (i = 0; i < 14; i++) {                                                   // banyan trees
      x = 60 + i * 140 + rnd() * 30; y = 14 + rnd() * 8;
      if (x > bx0 - 190 && x < bx1 + 190) continue;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 4, y + 6, 20, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#34482a'; ctx.beginPath(); ctx.arc(x, y, 20, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(110,140,70,.4)';
      for (var j = 0; j < 8; j++) { ctx.beginPath(); ctx.arc(x - 10 + rnd() * 18, y - 10 + rnd() * 16, 4 + rnd() * 4, 0, 6.2832); ctx.fill(); }
    }
    ambassador(ctx, bx0 - 140, 76, '#e8e0cc'); ambassador(ctx, bx0 - 108, 78, '#1d1e20');
    ambassador(ctx, bx1 + 70, 80, '#e8e0cc');
    bullockCart(ctx, bx1 + 120, 72);

    // the name board, black on cream
    var nw = 400, nh = 34, ny = 66;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(cx - nw / 2 + 3, ny + 4, nw, nh);
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(cx - nw / 2 + 30, ny + nh, 5, 8); ctx.fillRect(cx + nw / 2 - 35, ny + nh, 5, 8);
    ctx.fillStyle = RT_CREAM; ctx.fillRect(cx - nw / 2, ny, nw, nh);
    ctx.strokeStyle = RT_INK; ctx.lineWidth = 2; ctx.strokeRect(cx - nw / 2 + 2, ny + 2, nw - 4, nh - 4);
    ctx.fillStyle = RT_INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 11px "Tamil Sangam MN", "Noto Sans Tamil", sans-serif';
    ctx.fillText('பழையபுரம் சந்திப்பு', cx, ny + 11);
    ctx.font = '800 14px Georgia, "Times New Roman", serif';
    ctx.fillText(st.name.replace(' Junction', ' JN.').toUpperCase(), cx, ny + 25);

    // the water tank on its trestle, west of the building
    var tx = bx0 - 105, ty = by0 + 40;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(tx - 24, ty - 20, 54, 50);
    ctx.fillStyle = '#4b4f52'; ctx.fillRect(tx - 26, ty - 24, 52, 48);
    ctx.fillStyle = '#5d6266'; ctx.fillRect(tx - 24, ty - 22, 48, 44);
    ctx.fillStyle = 'rgba(20,22,24,.5)';
    for (x = tx - 22; x < tx + 24; x += 8) for (y = ty - 20; y < ty + 22; y += 8) ctx.fillRect(x, y, 1.4, 1.4);   // rivets
    ctx.fillStyle = '#20343a'; ctx.fillRect(tx - 18, ty - 16, 36, 32);                                           // the water

    // the station building: brick walls, a tiled roof, the verandah's arches along the platform
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx0 + 5, by0 + 6, bx1 - bx0, by1 - by0);
    ctx.fillStyle = '#8a3a28'; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.strokeStyle = 'rgba(230,200,170,.18)'; ctx.lineWidth = 0.6;                       // courses of brick
    ctx.beginPath();
    for (y = by0 + 3; y < by1; y += 3) { ctx.moveTo(bx0, y); ctx.lineTo(bx0 + 10, y); ctx.moveTo(bx1 - 10, y); ctx.lineTo(bx1, y); }
    ctx.stroke();
    var vy = by1 - 22, rx0 = bx0 + 12, rx1 = bx1 - 12, ridge = (by0 + 6 + vy) / 2;
    [[by0 + 6, ridge, '#6f3326'], [ridge, vy, '#94503a']].forEach(function (sl) {
      ctx.fillStyle = sl[2]; ctx.fillRect(rx0, sl[0], rx1 - rx0, sl[1] - sl[0]);
      ctx.strokeStyle = 'rgba(40,14,8,.3)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (y = sl[0] + 4; y < sl[1]; y += 4.5) { ctx.moveTo(rx0, y); ctx.lineTo(rx1, y); }
      ctx.stroke();
    });
    ctx.fillStyle = '#58281d'; ctx.fillRect(rx0, ridge - 1.5, rx1 - rx0, 3);
    ctx.fillStyle = '#d9cfb6'; ctx.fillRect(bx0, vy, bx1 - bx0, by1 - vy);                // verandah roof, limewashed
    ctx.fillStyle = '#8a3a28';
    for (x = bx0 + 6; x < bx1 - 10; x += 22) {                                              // its arches, seen as piers
      ctx.fillRect(x, by1 - 5, 4, 5);
      ctx.beginPath(); ctx.arc(x + 13, by1, 8, Math.PI, 0); ctx.fillStyle = 'rgba(40,26,18,.35)'; ctx.fill(); ctx.fillStyle = '#8a3a28';
    }
    // the clock tower, with its pyramid roof
    var tw = 30;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(cx - tw + 4, ridge - tw + 5, tw * 2, tw * 2);
    ctx.fillStyle = '#9b4a34'; ctx.fillRect(cx - tw, ridge - tw, tw * 2, tw * 2);
    [['#7c3a28', [[-1, -1], [1, -1]]], ['#a95b41', [[1, -1], [1, 1]]], ['#b8694e', [[1, 1], [-1, 1]]], ['#8c422f', [[-1, 1], [-1, -1]]]].forEach(function (f) {
      ctx.fillStyle = f[0];
      ctx.beginPath(); ctx.moveTo(cx, ridge);
      ctx.lineTo(cx + f[1][0][0] * (tw - 3), ridge + f[1][0][1] * (tw - 3)); ctx.lineTo(cx + f[1][1][0] * (tw - 3), ridge + f[1][1][1] * (tw - 3));
      ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = '#c9a44a'; ctx.beginPath(); ctx.arc(cx, ridge, 2.4, 0, 6.2832); ctx.fill();   // finial

    // the signal cabin, its lever frame upstairs
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(88, 906, 116, 60);
    ctx.fillStyle = '#8a3a28'; ctx.fillRect(84, 902, 116, 60);
    ctx.fillStyle = '#6f3326'; ctx.fillRect(84, 902, 116, 22);
    ctx.fillStyle = '#2f3a44'; ctx.fillRect(93, 928, 98, 26);
    ctx.fillStyle = 'rgba(150,190,225,.35)';
    for (i = 0; i < 5; i++) ctx.fillRect(98 + i * 18, 931, 13, 20);
    ctx.fillStyle = '#e8dcc2'; ctx.font = '700 10px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(st.code + ' CABIN', 142, 980);

    // the coal stage: a raised platform heaped with coal, and its crane
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(266, 934, 230, 40);
    ctx.fillStyle = '#4a4238'; ctx.fillRect(262, 930, 230, 40);
    for (i = 0; i < 260; i++) {
      ctx.fillStyle = ['#161617', '#232325', '#0d0d0e', '#2f3032'][(rnd() * 4) | 0];
      ctx.beginPath(); ctx.arc(270 + rnd() * 214, 935 + rnd() * 30, 1 + rnd() * 2.2, 0, 6.2832); ctx.fill();
    }
    ctx.strokeStyle = '#2a2c2e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(500, 950); ctx.lineTo(530, 930); ctx.stroke();
    ctx.fillStyle = '#9aa4b0'; ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillText('COAL STAGE', 377, 986);

    // the loco shed, its roof blackened with smoke
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(1496, 916, 186, 58);
    ctx.fillStyle = '#3b3833'; ctx.fillRect(1492, 912, 186, 58);
    ctx.fillStyle = '#2a2724';
    for (x = 1492; x < 1678; x += 20) ctx.fillRect(x, 912, 10, 58);
    ctx.fillStyle = 'rgba(20,18,16,.6)'; ctx.fillRect(1520, 936, 40, 10); ctx.fillRect(1600, 936, 40, 10);   // smoke vents
    ctx.fillStyle = '#9aa4b0'; ctx.font = '700 10px ui-monospace, monospace';
    ctx.fillText('LOCO SHED', 1585, 986);
  }
  /* An Ambassador from above, and a bullock cart with its pair. */
  function ambassador(ctx, x, y, c) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; RY.rr(ctx, x + 2, y + 2, 16, 30, 6); ctx.fill();
    ctx.fillStyle = c; RY.rr(ctx, x, y, 16, 30, 6); ctx.fill();
    ctx.fillStyle = 'rgba(40,60,80,.7)'; RY.rr(ctx, x + 2.5, y + 8, 11, 5, 2); ctx.fill(); RY.rr(ctx, x + 2.5, y + 20, 11, 4, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + 3, y + 14, 10, 5);
  }
  function bullockCart(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 2, y + 16, 18, 22);
    ctx.fillStyle = '#7a5a36'; ctx.fillRect(x, y + 14, 18, 22);                 // the cart
    ctx.fillStyle = '#5a3f24'; ctx.fillRect(x - 2, y + 22, 22, 3);               // its axle and wheels
    ctx.strokeStyle = '#6b4e2e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 9, y + 14); ctx.lineTo(x + 9, y + 2); ctx.stroke();   // the pole
    ['#d9d2c4', '#cfc6b4'].forEach(function (c, n) {                            // the bullocks
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x + 3 + n * 12, y + 2, 4, 7, 0, 0, 6.2832); ctx.fill();
    });
  }
  /* ------------- bake everything ------------- */
  /* shown: screen pixels per world unit the scene will be drawn at (the
     map's scale times the device pixel ratio). It's baked at up to twice
     that — supersampled, as before, on a desktop — but never at more than
     twice, since shrinking a picture much further than half loses lines
     outright on some browsers. css: the map's scale in CSS pixels, for the
     rails' minimum width. */
  RY.bakeScene = function (shown, css) {
    shown = shown || SUP / 2;
    var sup = Math.min(SUP, Math.max(0.4, 2 * shown));
    PX = 1 / (css || 1);
    var cv = document.createElement('canvas');
    cv.width = Math.round(RY.W * sup); cv.height = Math.round(RY.H * sup);
    var ctx = cv.getContext('2d');
    ctx.scale(cv.width / RY.W, cv.height / RY.H);

    var rnd = RY.rng(20240824);
    var segs = RY.buildTrackwork();
    RY.olePaths = [];
    RY.sceneBake = (RY.sceneBake || 0) + 1;   // lets anything built off the scene know it's stale
    var i;

    drawGround(ctx, rnd);

    for (i = 0; i < segs.length; i++) drawBallast(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawBallastGrain(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawSleepers(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawRails(ctx, segs[i]);

    // turnout blades where the ladders leave the mains — a terminus has
    // no west ladder to draw blades for at all (see buildTrackwork). A
    // realistic throat has its own list: one set per real turnout.
    if (L.ladder) {
      RY.ladderTurnouts().forEach(function (tp) { drawBladesAt(ctx, tp); });
    }
    for (i = 0; i < T.length && !L.ladder; i++) {
      var oA = RY.divOff(L.mainA, T[i].y), oB = RY.divOff(L.mainB, T[i].y);
      if (!L.terminus) {
        drawBlades(ctx, L.xWestHome + oA, L.mainA, T[i].y,  1);
        drawBlades(ctx, L.xWestHome + oB, L.mainB, T[i].y,  1);
      }
      drawBlades(ctx, L.xEastHome - oA, L.mainA, T[i].y, -1);
      drawBlades(ctx, L.xEastHome - oB, L.mainB, T[i].y, -1);
    }

    // OLE over the running lines — unless the station isn't electrified
    var wired = RY.station.electric !== false;
    if (wired && !L.terminus) {
      drawOLE(ctx, RY.makePath([{ x: 0, y: L.mainA }, { x: L.xWestHome + 40, y: L.mainA }]));
      drawOLE(ctx, RY.makePath([{ x: 0, y: L.mainB }, { x: L.xWestHome + 40, y: L.mainB }]));
    }
    if (wired) drawOLE(ctx, RY.makePath([{ x: L.xEastHome - 40, y: L.mainA }, { x: RY.W, y: L.mainA }]));
    if (wired) drawOLE(ctx, RY.makePath([{ x: L.xEastHome - 40, y: L.mainB }, { x: RY.W, y: L.mainB }]));
    for (i = 0; i < T.length && wired; i++) {
      var oleWest = L.terminus ? RY.platSpan(T[i]).x0 : L.xThroatW;
      var road = RY.makePath([{ x: oleWest, y: T[i].y }, { x: L.xThroatE, y: T[i].y }]);
      road.masts = roadMasts(road.len);
      drawOLE(ctx, road);
    }

    drawTroughing(ctx, T[0].y - 40, 0, RY.W);
    drawTroughing(ctx, T[T.length - 1].y + 32, 0, RY.W);
    if (!L.terminus) drawTroughing(ctx, L.mainB + 34, 0, L.xWestHome + L.maxDiv);
    drawTroughing(ctx, L.mainB + 34, L.xEastHome - L.maxDiv, RY.W);

    for (i = 0; i < RY.ISLANDS.length; i++) drawIsland(ctx, RY.ISLANDS[i], rnd);
    for (i = 0; i < T.length; i++) if (!T[i].platform) drawThroughRoadSign(ctx, T[i]);
    if (RY.station.terminus) { drawYard(ctx); drawPlatformBuffers(ctx); }

    drawBuildings(ctx, rnd);

    RY.sceneCanvas = cv;
    RY.SUP = sup;
    RY.bakeShown = shown;
    RY.bakeCss = css || 1;
    return cv;
  };
})(window);
