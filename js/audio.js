/* ------------------------------------------------------------------
   audio.js — everything you hear, synthesised at runtime.  No sample
   files, so the game still runs straight off the filesystem.

   Two voices only:
     · a rolling bed  — rumble plus rail-joint clatter, driven by how
       much stock is actually moving and how fast
     · the horn       — a two-tone air horn, panned to the train
-------------------------------------------------------------------*/
(function (root) {
  'use strict';
  var RY = root.RY = root.RY || {};   // audio.js loads first, so it seeds the namespace

  var A = RY.audio = {
    ctx: null, ready: false, failed: false,
    muted: false, volume: 0.65
  };

  var master, fxBus, bed = null, lastHorn = -99;
  var STORE = 'railyard.audio';

  /* ---------- persistence (best effort; file:// can be fussy) ---------- */
  function load() {
    try {
      var raw = root.localStorage.getItem(STORE);
      if (!raw) return;
      var v = JSON.parse(raw);
      if (typeof v.volume === 'number') A.volume = Math.max(0, Math.min(1, v.volume));
      if (typeof v.muted === 'boolean') A.muted = v.muted;
    } catch (e) { /* no storage — defaults are fine */ }
  }
  function save() {
    try {
      root.localStorage.setItem(STORE, JSON.stringify({ volume: A.volume, muted: A.muted }));
    } catch (e) { /* ignore */ }
  }
  load();

  /* Perceptual taper: a slider at half way should sound half as loud. */
  function gainFor() {
    return A.muted ? 0 : Math.pow(A.volume, 1.8) * 0.9;
  }

  function noiseBuffer(ctx, secs, brown) {
    var len = Math.floor(ctx.sampleRate * secs);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), last = 0, i, w;
    for (i = 0; i < len; i++) {
      w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.019 * w) / 1.019; d[i] = last * 3.4; }
      else d[i] = w * 0.7;
    }
    return buf;
  }

  /* ---------- the rolling bed ---------- */
  function buildBed(ctx) {
    var b = {};

    // low rumble: brown noise under a lowpass
    b.rumbleSrc = ctx.createBufferSource();
    b.rumbleSrc.buffer = noiseBuffer(ctx, 3, true);
    b.rumbleSrc.loop = true;
    b.rumbleLP = ctx.createBiquadFilter();
    b.rumbleLP.type = 'lowpass';
    b.rumbleLP.frequency.value = 150;
    b.rumbleLP.Q.value = 0.6;
    b.rumbleGain = ctx.createGain();
    b.rumbleGain.gain.value = 0.9;

    // rail joints: white noise through a bandpass, amplitude chopped by an LFO
    b.clackSrc = ctx.createBufferSource();
    b.clackSrc.buffer = noiseBuffer(ctx, 3, false);
    b.clackSrc.loop = true;
    b.clackBP = ctx.createBiquadFilter();
    b.clackBP.type = 'bandpass';
    b.clackBP.frequency.value = 700;
    b.clackBP.Q.value = 1.1;
    b.clackGain = ctx.createGain();
    b.clackGain.gain.value = 0.30;

    b.lfo = ctx.createOscillator();
    b.lfo.type = 'triangle';
    b.lfo.frequency.value = 6;
    b.lfoDepth = ctx.createGain();
    b.lfoDepth.gain.value = 0.26;
    b.lfo.connect(b.lfoDepth).connect(b.clackGain.gain);

    b.bus = ctx.createGain();
    b.bus.gain.value = 0;                       // silent until stock moves
    b.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    b.rumbleSrc.connect(b.rumbleLP).connect(b.rumbleGain).connect(b.bus);
    b.clackSrc.connect(b.clackBP).connect(b.clackGain).connect(b.bus);
    if (b.pan) b.bus.connect(b.pan).connect(master); else b.bus.connect(master);

    b.rumbleSrc.start();
    b.clackSrc.start();
    b.lfo.start();
    return b;
  }

  /* ---------- lifecycle ---------- */
  A.init = function () {
    if (A.ready || A.failed) { A.resume(); return; }
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) { A.failed = true; return; }
    try {
      A.ctx = new Ctx();
      master = A.ctx.createGain();
      master.gain.value = gainFor();
      master.connect(A.ctx.destination);
      A.master = master;                 // exposed so the mix can be metered

      // Every horn routes through here too, so a horn mid-flight can be cut
      // instantly by this one node rather than playing out its own release
      // regardless of what the game is doing.
      fxBus = A.ctx.createGain();
      fxBus.gain.value = 1;
      fxBus.connect(master);

      bed = buildBed(A.ctx);
      A.ready = true;
    } catch (e) {
      A.failed = true;
    }
  };

  A.resume = function () {
    if (!A.ready) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    var t = A.ctx.currentTime;
    fxBus.gain.cancelScheduledValues(t);
    fxBus.gain.setTargetAtTime(1, t, 0.05);
    // bed.bus.gain is re-driven continuously by movement() once running
    // again, so it doesn't need restoring here.
  };

  A.setVolume = function (v) {
    A.volume = Math.max(0, Math.min(1, v));
    if (A.volume > 0 && A.muted) A.muted = false;
    if (master) master.gain.setTargetAtTime(gainFor(), A.ctx.currentTime, 0.03);
    save();
  };

  A.setMuted = function (m) {
    A.muted = !!m;
    if (master) master.gain.setTargetAtTime(gainFor(), A.ctx.currentTime, 0.03);
    save();
  };

  A.toggleMute = function () { A.setMuted(!A.muted); return A.muted; };

  /* ---------- per-frame: how much stock is rolling, and where ---------- */
  A.movement = function (trains) {
    if (!A.ready) return;
    var t = A.ctx.currentTime, i, tr, v, w;
    var energy = 0, fastest = 0, cx = 0, cw = 0;

    for (i = 0; i < (trains ? trains.length : 0); i++) {
      tr = trains[i];
      v = tr.v;
      if (v < 1) continue;
      var p = RY.pathAt(tr.path, Math.max(0, tr.s - tr.len / 2));
      if (p.x < -260 || p.x > RY.W + 260) continue;
      // longer, faster consists carry more of the sound
      w = (v / 210) * (0.55 + tr.cars * 0.11);
      energy += w;
      if (v > fastest) fastest = v;
      cx += p.x * w; cw += w;
    }

    var level = Math.min(0.85, energy * 0.42);
    bed.bus.gain.setTargetAtTime(level, t, 0.14);
    bed.clackBP.frequency.setTargetAtTime(480 + fastest * 3.6, t, 0.2);
    bed.rumbleLP.frequency.setTargetAtTime(110 + fastest * 0.75, t, 0.2);
    bed.lfo.frequency.setTargetAtTime(3.2 + fastest * 0.105, t, 0.25);
    if (bed.pan && cw > 0) {
      bed.pan.pan.setTargetAtTime(
        Math.max(-0.8, Math.min(0.8, (cx / cw / RY.W) * 2 - 1)), t, 0.3);
    }
  };

  A.silence = function (hard) {
    if (!A.ready) return;
    var t = A.ctx.currentTime, tc = hard ? 0.015 : 0.08;
    bed.bus.gain.cancelScheduledValues(t);
    bed.bus.gain.setTargetAtTime(0, t, tc);
    fxBus.gain.cancelScheduledValues(t);
    fxBus.gain.setTargetAtTime(0, t, tc);
  };

  /* Called whenever play genuinely stops — pause, game over, or the tab
     going into the background.  A per-frame gain fade isn't enough on its
     own: requestAnimationFrame is throttled or halted entirely for a
     hidden tab, so a fade that depends on "next frame" running may never
     actually happen, and the looping bed would keep playing, unheard by
     the page but very much still audible. Actually suspending the
     AudioContext stops it at the hardware level regardless. */
  A.suspend = function () {
    if (!A.ready) return;
    A.silence(true);
    if (A.ctx.state === 'running') A.ctx.suspend();
  };

  /* ---------- the horn ---------- */
  /* Two tones a fourth apart with a little detune, a lowpassed sawtooth
     stack for body, and a puff of air noise on the attack. */
  A.horn = function (x, heavy) {
    if (!A.ready || A.muted) return;
    var ctx = A.ctx, t = ctx.currentTime;
    if (t - lastHorn < 1.5) return;                 // don't let it become a chorus
    lastHorn = t;

    var dur   = heavy ? 1.15 : 0.6;
    var base  = heavy ? [148, 196] : [370, 494];
    var out   = ctx.createGain();
    var lp    = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = heavy ? 1400 : 2100;
    lp.Q.value = 0.7;

    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.max(-0.85, Math.min(0.85, (x / RY.W) * 2 - 1));
      lp.connect(out).connect(pan).connect(fxBus);
    } else {
      lp.connect(out).connect(fxBus);
    }

    // envelope: quick attack, a touch of sag, then a soft release
    var peak = heavy ? 0.30 : 0.24;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + 0.035);
    out.gain.setTargetAtTime(peak * 0.82, t + 0.05, 0.25);
    out.gain.setTargetAtTime(0.0001, t + dur, 0.09);

    var voices = [];
    base.forEach(function (f) {
      [0, -4, 5].forEach(function (cents, k) {           // slight beating
        var o = ctx.createOscillator();
        o.type = k === 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        var g = ctx.createGain();
        g.gain.value = k === 0 ? 0.5 : 0.2;
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.6);
        voices.push(o);
      });
    });

    // air hiss as the valve opens
    var hs = ctx.createBufferSource();
    hs.buffer = noiseBuffer(ctx, 0.3, false);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.09, t);
    hg.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    hs.connect(hp).connect(hg).connect(out);
    hs.start(t);
    hs.stop(t + 0.3);
  };
})(window);
