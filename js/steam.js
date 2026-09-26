/* ------------------------------------------------------------------
   steam.js — steam locomotives: how one is laid out, how it's drawn on
   the map, and the smoke and steam that come off it.

   A steam locomotive is one vehicle, engine and tender together, facing
   +u. The same layout (geo) serves the map here and the cab view (cab.js),
   so the chimney the smoke leaves by, the cylinders the steam blows from
   and the wheels the rods turn are in the same place in both. The wheels
   turn with the distance the train has actually run (tr.s), so the rods
   and pistons move exactly as fast as the train does, and stand still
   with it.
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY;
  var TAU = Math.PI * 2;

  /* ---------------- the layout ---------------- */
  /* Everything in u, forward from the vehicle's middle, for a vehicle of
     length len. 'wp' is the bullet-nosed WP Pacific (4-6-2) of the express
     trains; 'wg' the WG Mikado (2-8-2) of the goods. */
  var GEO = {};
  RY.steamGeo = function (cls, len) {
    var key = cls + len;
    if (GEO[key]) return GEO[key];
    var hl = (len - 8) / 2, g;
    if (cls === 'wg') {
      g = { cls: cls, hl: hl, nose: hl - 3, smokeRear: hl - 16, boilerRear: 8, cabRear: -14, tenderFront: -18,
            chimney: hl - 9, chimH: 4.5, dome: 30, valve: 14, rB: 11.5, zB: 31, bullet: false,
            cyl: [hl - 22, hl - 9], lead: [hl - 15], rLead: 4.4,
            drivers: [40, 25, 10, -5], rD: 7, main: 2, trail: [-12], rTrail: 4.8,
            tender: [-31, -hl + 14], rT: 4.4 };
    } else {
      g = { cls: 'wp', hl: hl, nose: hl - 2, smokeRear: hl - 17, boilerRear: 12, cabRear: -10, tenderFront: -14,
            chimney: hl - 16, chimH: 2.4, dome: 34, valve: 16, rB: 12.5, zB: 31, bullet: true,
            cyl: [hl - 21, hl - 8], lead: [hl - 14, hl - 24], rLead: 4.4,
            drivers: [37, 19.5, 2], rD: 8.2, main: 1, trail: [-7], rTrail: 5,
            tender: [-28, -hl + 14], rT: 4.4 };
    }
    g.rc = g.rD * 0.42;                                 // crank radius: half the stroke
    g.rodLen = g.cyl[0] - g.drivers[g.main] - g.rc - 1; // connecting rod, crosshead to crankpin
    GEO[key] = g;
    return g;
  };
  /* The crank angle of one side's driving wheels. A wheel turns through
     s / r as it rolls s, and the top of a wheel rolling forward goes
     forward, so the angle falls. The two sides are "quartered", a quarter
     turn apart, so the engine can always start. */
  RY.steamCrank = function (tr, g, side) {
    return -tr.s / g.rD + (side > 0 ? 0 : Math.PI / 2);
  };
  /* Where the crosshead is, and the main crankpin, for a crank angle a. */
  RY.steamMotion = function (g, a) {
    var um = g.drivers[g.main], pu = um + g.rc * Math.cos(a), pz = g.rD + g.rc * Math.sin(a);
    var dz = pz - g.rD, ch = pu + Math.sqrt(Math.max(1, g.rodLen * g.rodLen - dz * dz));
    return { pinU: pu, pinZ: pz, crossU: ch };
  };

  /* ---------------- on the map ---------------- */
  function rr(ctx, x, y, w, h, r) { RY.rr(ctx, x, y, w, h, r); }
  RY.drawSteamLoco = function (ctx, tr, vh) {
    var cfg = tr.cfg, e = cfg.engine || {}, g = RY.steamGeo(cfg.steamClass || 'wp', vh.len);
    var hl = g.hl, body = e.boiler || '#1d1e20', frame = e.frame || '#26282b', band = e.bands || '#b9b6a8';
    var i, x, side;

    // tender: sides, then the coal heaped in it
    ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(ctx, -hl + 1, -15, g.tenderFront + hl, 32, 3); ctx.fill();
    ctx.fillStyle = e.tender || body; rr(ctx, -hl, -16, g.tenderFront + hl, 32, 3); ctx.fill();
    ctx.fillStyle = '#121212'; rr(ctx, -hl + 4, -12.5, g.tenderFront + hl - 14, 25, 2); ctx.fill();
    var rnd = RY.rng(tr.seed + 31);
    for (i = 0; i < 70; i++) {
      ctx.fillStyle = ['#1f1f20', '#2c2c2e', '#101011', '#393a3c'][(rnd() * 4) | 0];
      ctx.beginPath(); ctx.arc(-hl + 6 + rnd() * (g.tenderFront + hl - 18), -11 + rnd() * 22, 0.9 + rnd() * 1.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#3a3c40'; ctx.beginPath(); ctx.arc(-hl + 8, 0, 3.4, 0, TAU); ctx.fill();   // water filler

    // frame and running boards, with the cylinders at the front
    ctx.fillStyle = frame; rr(ctx, g.cabRear - 2, -16, hl - g.cabRear + 2, 32, 2); ctx.fill();
    ctx.fillStyle = 'rgba(232,228,218,.85)';                     // the running board's white lining
    ctx.fillRect(g.cabRear, -16, hl - g.cabRear - 2, 1.1); ctx.fillRect(g.cabRear, 14.9, hl - g.cabRear - 2, 1.1);
    [-1, 1].forEach(function (sd) {
      ctx.fillStyle = '#2f3134'; rr(ctx, g.cyl[0], sd > 0 ? 12 : -18, g.cyl[1] - g.cyl[0], 6, 1.5); ctx.fill();
      ctx.fillStyle = 'rgba(210,214,220,.22)'; ctx.fillRect(g.cyl[0], sd > 0 ? 12 : -18, g.cyl[1] - g.cyl[0], 1);
    });
    // the motion, outside the frames: coupling rod and connecting rod, each
    // side a quarter turn apart, sliding back and forth as the wheels turn
    [-1, 1].forEach(function (sd) {
      var a = RY.steamCrank(tr, g, sd), m = RY.steamMotion(g, a), v = sd * 17.6, d0 = g.drivers[0], dn = g.drivers[g.drivers.length - 1];
      var off = g.rc * Math.cos(a);
      ctx.strokeStyle = '#c9ccd0'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dn + off, v); ctx.lineTo(d0 + off, v); ctx.stroke();      // coupling rod
      ctx.strokeStyle = '#e1e4e8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(m.pinU, v + sd * 0.8); ctx.lineTo(m.crossU, v + sd * 0.4); ctx.stroke();   // connecting rod
      ctx.fillStyle = '#e9ebee'; ctx.fillRect(m.crossU - 1.5, v - 1.2, 3, 2.4);           // crosshead
    });

    // the boiler: a long cylinder seen from above, lit along its top
    var bg = ctx.createLinearGradient(0, -g.rB, 0, g.rB);
    bg.addColorStop(0, RY.shade(body, -0.5)); bg.addColorStop(0.38, RY.shade(body, 0.1));
    bg.addColorStop(0.5, RY.shade(body, 0.35)); bg.addColorStop(0.62, RY.shade(body, 0.05)); bg.addColorStop(1, RY.shade(body, -0.55));
    ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(ctx, g.boilerRear + 1, -g.rB + 1.5, g.smokeRear - g.boilerRear, g.rB * 2, g.rB * 0.6); ctx.fill();
    ctx.fillStyle = bg; rr(ctx, g.boilerRear - 2, -g.rB, g.smokeRear - g.boilerRear + 4, g.rB * 2, g.rB * 0.6); ctx.fill();
    ctx.strokeStyle = band; ctx.lineWidth = 1.1;                                              // boiler bands
    [g.boilerRear + 2, (g.boilerRear + g.smokeRear) / 2, g.smokeRear - 2].forEach(function (bx) {
      ctx.beginPath(); ctx.moveTo(bx, -g.rB + 1); ctx.lineTo(bx, g.rB - 1); ctx.stroke();
    });
    // the smokebox, black, with a WP's bullet nose and its silver ring
    function smokeGrad(c) {
      var sg = ctx.createLinearGradient(0, -g.rB, 0, g.rB);
      sg.addColorStop(0, RY.shade(c, -0.7)); sg.addColorStop(0.5, RY.shade(c, 0.25)); sg.addColorStop(1, RY.shade(c, -0.7));
      return sg;
    }
    ctx.fillStyle = smokeGrad('#141416');
    ctx.fillRect(g.smokeRear, -g.rB, (g.bullet ? g.nose - 12 : g.nose) - g.smokeRear, g.rB * 2);
    if (g.bullet) {
      // the WP's bullet nose, a dome (silver on some), with the star's rays
      // running out from the headlamp in its middle: from above we see the
      // three along the top and the two to each side
      ctx.fillStyle = smokeGrad(e.nose || '#141416');
      ctx.beginPath(); ctx.moveTo(g.nose - 12.5, -g.rB);
      ctx.bezierCurveTo(g.nose - 4, -g.rB, g.nose, -g.rB * 0.55, g.nose, 0);
      ctx.bezierCurveTo(g.nose, g.rB * 0.55, g.nose - 4, g.rB, g.nose - 12.5, g.rB);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = e.nose ? '#17181a' : '#d7d9dc';
      [[0, 1], [-0.62, 0.8], [0.62, 0.8], [-0.97, 0.55], [0.97, 0.55]].forEach(function (r) {
        var tu = g.nose - 7.5 - (1 - r[1]) * 3, tv = r[0] * g.rB * 0.97;
        ctx.beginPath(); ctx.moveTo(g.nose - 0.6, r[0] * 2.4 - 1.1); ctx.lineTo(tu, tv); ctx.lineTo(g.nose - 0.6, r[0] * 2.4 + 1.1); ctx.closePath(); ctx.fill();
      });
      // the headlamp, standing out of the dome's middle
      ctx.fillStyle = '#b2b6bc'; rr(ctx, g.nose - 1.5, -2.8, 4.1, 5.6, 1); ctx.fill();
      ctx.fillStyle = '#e4e6e9'; ctx.fillRect(g.nose + 1.8, -2.4, 0.8, 4.8);
    } else {
      ctx.fillStyle = '#8a8c90'; ctx.fillRect(g.nose - 0.9, -g.rB * 0.86, 1.2, g.rB * 1.72);   // a WG's grey door
    }
    // on top: chimney, dome, safety valves, and the headlamp over the nose
    ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(g.chimney, 0, 4.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2d2e30'; ctx.beginPath(); ctx.arc(g.chimney, 0, 2.6, 0, TAU); ctx.fill();
    var dg = ctx.createRadialGradient(g.dome - 1.5, -1.5, 0.5, g.dome, 0, 5.4);
    dg.addColorStop(0, RY.shade(body, 0.45)); dg.addColorStop(1, RY.shade(body, -0.2));
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(g.dome, 0, 5.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b8912f';
    ctx.beginPath(); ctx.arc(g.valve, -2.2, 1.6, 0, TAU); ctx.arc(g.valve, 2.2, 1.6, 0, TAU); ctx.fill();
    if (!g.bullet) {                              // a WG's big headlamp, on top of the smokebox
      ctx.fillStyle = '#2a2c2f'; ctx.beginPath(); ctx.arc(g.nose - 3, 0, 3.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9ccd0'; ctx.beginPath(); ctx.arc(g.nose - 1.8, 0, 2.2, 0, TAU); ctx.fill();
    }
    // handrails, up from the beam's corners round the smokebox and along the boiler
    ctx.strokeStyle = 'rgba(214,217,222,.9)'; ctx.lineWidth = 0.8;
    [-1, 1].forEach(function (sd) {
      ctx.beginPath(); ctx.moveTo(hl - 2.5, sd * 15);
      if (g.bullet) ctx.quadraticCurveTo(hl - 4, sd * 14.6, g.nose - 6, sd * (g.rB + 0.6));
      else ctx.lineTo(g.nose - 0.6, sd * (g.rB + 0.9));
      ctx.lineTo(g.boilerRear + 2, sd * (g.rB + 0.9)); ctx.stroke();
    });

    // the cab, behind the firebox
    ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(ctx, g.cabRear + 1, -16, g.boilerRear - g.cabRear + 1, 33, 2.5); ctx.fill();
    ctx.fillStyle = e.cab || body; rr(ctx, g.cabRear, -17, g.boilerRear - g.cabRear, 34, 2.5); ctx.fill();
    ctx.fillStyle = e.roof || '#2b2c2e'; rr(ctx, g.cabRear + 1.5, -14.5, g.boilerRear - g.cabRear - 3, 29, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(g.cabRear + 1.5, -14.5, g.boilerRear - g.cabRear - 3, 1.3);

    // the cowcatcher ahead of the beam, slatted
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.moveTo(hl, -15); ctx.lineTo(hl + 7, -5); ctx.lineTo(hl + 7, 5); ctx.lineTo(hl, 15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2d2f33';
    ctx.beginPath(); ctx.moveTo(hl - 0.5, -15.5); ctx.lineTo(hl + 6.5, -5); ctx.lineTo(hl + 6.5, 5); ctx.lineTo(hl - 0.5, 15.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,154,160,.55)'; ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var sl = -12; sl <= 12; sl += 4) { ctx.moveTo(hl, sl); ctx.lineTo(hl + 6, sl * 0.4); }
    ctx.stroke();
    // the buffer beam, in red, and the lamps
    ctx.fillStyle = e.beam || '#b3261e'; ctx.fillRect(hl - 2.6, -15.5, 2.6, 31);
    [-11, 11].forEach(function (v) {                 // the buffers: long stocks, big round silver heads
      ctx.fillStyle = '#1d2229'; ctx.fillRect(hl, v - 1.6, 3, 3.2);
      ctx.fillStyle = '#cdd0d5'; ctx.fillRect(hl + 3, v - 3.3, 0.9, 6.6);
    });
    RY.lampsAt(ctx, hl - 1, RY.LAMPS.steam, vh.first ? 'head' : '');
  };

  /* ---------------- smoke and steam ---------------- */
  /* One list of puffs, in the world: x, y, height z. Coal smoke pours from
     the chimney on every exhaust beat — four to a turn of the driving
     wheels, so a train getting away barks slow and heavy and one running
     fast gives a quick, light trail — darker and fatter when the engine's
     working hard. Standing, it simmers: a thin wisp from the chimney and,
     every so often, the safety valves lifting in a white roar. Starting
     away, the cylinder cocks are open and white steam blows out sideways
     low down. The wind carries all of it off a little, and it thins and
     spreads as it goes. */
  var MAX = 900, WIND = { x: 9, y: -5 };
  var S = RY.steam = { list: [] };
  S.reset = function () { S.list.length = 0; };

  function puff(x, y, z, vx, vy, vz, r, dr, life, kind, dark) {
    if (S.list.length >= MAX) S.list.shift();
    S.list.push({ x: x, y: y, z: z, vx: vx, vy: vy, vz: vz, r: r, dr: dr, life: life, age: 0, kind: kind, dark: dark });
  }
  function at(tr, vh, u, v) {
    var p = RY.pathAt(tr.path, Math.max(0, tr.s - vh.mid)), ca = Math.cos(p.a), sa = Math.sin(p.a);
    return { x: p.x + ca * u - sa * v, y: p.y + sa * u + ca * v, ca: ca, sa: sa };
  }

  S.step = function (dt, trains) {
    var i, tr, vh, g, p, beat, acc, working, n, sd, q;
    for (i = 0; i < trains.length; i++) {
      tr = trains[i]; vh = tr.vehicles[0];
      if (tr.state === 'gone' || vh.kind !== 'steam') continue;
      g = RY.steamGeo(tr.cfg.steamClass || 'wp', vh.len);
      var head = RY.pathAt(tr.path, tr.s);
      if (head.x < -300 || head.x > RY.W + 300) { tr._pv = tr.v; continue; }
      acc = tr._pv === undefined ? 0 : (tr.v - tr._pv) / Math.max(dt, 1e-3);
      tr._pv = tr.v;
      working = acc > 1.5 || (tr.v > 2 && tr.v < 60 && acc > -1);
      p = at(tr, vh, g.chimney, 0);

      if (tr.v > 0.6) {
        // exhaust beats: four to a turn of the driving wheels
        beat = TAU * g.rD / 4;
        tr._beat = (tr._beat || 0) + tr.v * dt;
        n = 0;
        while (tr._beat >= beat && n < 4) {
          tr._beat -= beat; n++;
          var hard = working ? 1 : 0.35;
          puff(p.x, p.y, 44, p.ca * tr.v * 0.15 + (Math.random() - 0.5) * 6, p.sa * tr.v * 0.15 + (Math.random() - 0.5) * 6,
               26 + 20 * hard, 3.5 + 3 * hard, 5 + 5 * hard, 2.4 + 1.6 * hard, 0, 0.35 + 0.6 * hard);
          if (RY.audio && RY.audio.chuff) RY.audio.chuff(p.x, hard, tr.v);
        }
        // cylinder cocks open while getting away
        if (tr.v < 32 && acc > 0.8 && Math.random() < dt * 14) {
          for (sd = -1; sd <= 1; sd += 2) {
            q = at(tr, vh, g.cyl[1], sd * 18);
            puff(q.x, q.y, 9, -q.sa * sd * 26 + (Math.random() - 0.5) * 6, q.ca * sd * 26 + (Math.random() - 0.5) * 6, 6,
                 2.2, 9, 0.9 + Math.random() * 0.4, 1, 0);
          }
        }
      } else {
        // simmering at a stand
        tr._idle = (tr._idle || 0) + dt;
        if (tr._idle > 0.45) {
          tr._idle = 0;
          puff(p.x, p.y, 44, 0, 0, 14, 2.4, 3.2, 3.2, 0, 0.12);
        }
        tr._sv = (tr._sv === undefined ? 6 + Math.random() * 8 : tr._sv) - dt;
        if (tr._sv < 0) {
          // the safety valves lift for a couple of seconds
          q = at(tr, vh, g.valve, 0);
          puff(q.x, q.y, 45, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 42, 2, 7, 1.5, 1, 0);
          if (tr._sv < -2) tr._sv = 9 + Math.random() * 12;
        }
      }
    }
    // everything drifts, rises, spreads and thins
    var L = S.list;
    for (i = L.length - 1; i >= 0; i--) {
      q = L[i];
      q.age += dt;
      if (q.age >= q.life) { L.splice(i, 1); continue; }
      q.vx += (WIND.x - q.vx) * Math.min(1, dt * 0.9);
      q.vy += (WIND.y - q.vy) * Math.min(1, dt * 0.9);
      q.vz *= Math.max(0, 1 - dt * 0.7);
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.r += q.dr * dt;
    }
  };

  /* Seen from above: soft round puffs, a touch north the higher they are. */
  S.drawMap = function (ctx) {
    var L = S.list, i, q, t, a, c;
    if (!L.length) return;
    ctx.save();
    for (i = 0; i < L.length; i++) {
      q = L[i]; t = q.age / q.life;
      a = Math.pow(1 - t, 1.4) * (q.kind ? 0.55 : 0.5 + 0.25 * q.dark);
      if (q.kind) c = '236,239,242';
      else {
        var d = q.dark * (1 - t * 0.7), k = (54 + (170 - 54) * (1 - d)) | 0;
        c = k + ',' + (k - 2) + ',' + (k - 5);
      }
      ctx.fillStyle = 'rgba(' + c + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y - q.z * 0.18, q.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };
})(window);
