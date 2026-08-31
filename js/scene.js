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
  var LAY_MID = L.stopX;

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
    g.addColorStop(0,   '#232a24');
    g.addColorStop(0.35,'#2c332b');
    g.addColorStop(1,   '#1e241f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, RY.W, RY.H);

    // scrubby lineside texture
    var i, x, y, r;
    for (i = 0; i < 5200; i++) {
      x = rnd() * RY.W; y = rnd() * RY.H; r = 0.6 + rnd() * 1.9;
      ctx.fillStyle = ['rgba(70,84,64,.55)','rgba(46,56,44,.6)','rgba(88,100,74,.35)',
                       'rgba(34,42,34,.5)'][(rnd() * 4) | 0];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    // tufts of grass at the top and bottom margins
    for (i = 0; i < 320; i++) {
      x = rnd() * RY.W;
      y = rnd() < 0.5 ? rnd() * 92 : RY.H - rnd() * 110;
      ctx.strokeStyle = 'rgba(96,116,72,' + (0.18 + rnd() * 0.3) + ')';
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
      ctx.fillStyle = shade < 0.18 ? '#4a3b2c'
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
      poly(ctx, pts); ctx.strokeStyle = '#22252a'; ctx.lineWidth = 6.2; ctx.stroke();  // foot + shadow
      poly(ctx, pts); ctx.strokeStyle = '#494e56'; ctx.lineWidth = 4.0; ctx.stroke();  // web
      poly(ctx, pts); ctx.strokeStyle = '#9aa3ae'; ctx.lineWidth = 1.9; ctx.stroke();  // railhead
      poly(ctx, pts); ctx.strokeStyle = 'rgba(233,241,250,.75)'; ctx.lineWidth = .7; ctx.stroke();
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
      ctx.lineWidth = 2.2 - i * 0.2;
      ctx.stroke();
    }
    // point machine beside the blades
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(x + dirSign * 10 - 7, y0 + (y1 > y0 ? -30 : 20), 14, 10);
    ctx.fillStyle = '#4e5a68';
    ctx.fillRect(x + dirSign * 10 - 7, y0 + (y1 > y0 ? -30 : 20), 14, 3);
    ctx.restore();
  }

  /* ---------------- platforms ---------------- */

  /* A hanging sign board, the way a real platform announces itself. */
  function signPlate(ctx, cx, cy, text, accent) {
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
    ctx.fillStyle = '#eef3fa';
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
      signPlate(ctx, LAY_MID + i * 300, y, 'FREIGHT & NON-STOP', '#4a3410');
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

  /* Overhead line equipment — masts either side, contact wire down the middle. */
  function drawOLE(ctx, P) {
    var s, p, o;
    ctx.save();
    poly(ctx, P.pts);
    ctx.strokeStyle = 'rgba(190,200,212,.13)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (s = 40; s < P.len; s += 170) {
      p = RY.pathAt(P, s);
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

  /* ------------- bake everything ------------- */
  RY.bakeScene = function () {
    var cv = document.createElement('canvas');
    cv.width = RY.W * SUP; cv.height = RY.H * SUP;
    var ctx = cv.getContext('2d');
    ctx.scale(SUP, SUP);

    var rnd = RY.rng(20240824);
    var segs = RY.buildTrackwork();
    var i;

    drawGround(ctx, rnd);

    for (i = 0; i < segs.length; i++) drawBallast(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawBallastGrain(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawSleepers(ctx, segs[i], rnd);
    for (i = 0; i < segs.length; i++) drawRails(ctx, segs[i]);

    // turnout blades where the ladders leave the mains — a terminus has
    // no west ladder to draw blades for at all (see buildTrackwork).
    for (i = 0; i < T.length; i++) {
      var oA = RY.divOff(L.mainA, T[i].y), oB = RY.divOff(L.mainB, T[i].y);
      if (!L.terminus) {
        drawBlades(ctx, L.xWestHome + oA, L.mainA, T[i].y,  1);
        drawBlades(ctx, L.xWestHome + oB, L.mainB, T[i].y,  1);
      }
      drawBlades(ctx, L.xEastHome - oA, L.mainA, T[i].y, -1);
      drawBlades(ctx, L.xEastHome - oB, L.mainB, T[i].y, -1);
    }

    // OLE over the running lines
    if (!L.terminus) {
      drawOLE(ctx, RY.makePath([{ x: 0, y: L.mainA }, { x: L.xWestHome + 40, y: L.mainA }]));
      drawOLE(ctx, RY.makePath([{ x: 0, y: L.mainB }, { x: L.xWestHome + 40, y: L.mainB }]));
    }
    drawOLE(ctx, RY.makePath([{ x: L.xEastHome - 40, y: L.mainA }, { x: RY.W, y: L.mainA }]));
    drawOLE(ctx, RY.makePath([{ x: L.xEastHome - 40, y: L.mainB }, { x: RY.W, y: L.mainB }]));
    for (i = 0; i < T.length; i++) {
      var oleWest = L.terminus ? RY.platSpan(T[i]).x0 : L.xThroatW;
      drawOLE(ctx, RY.makePath([{ x: oleWest, y: T[i].y }, { x: L.xThroatE, y: T[i].y }]));
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
    RY.SUP = SUP;
    return cv;
  };
})(window);
