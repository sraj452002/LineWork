/* Music and sound for the video guides, made with Web Audio: a calm lo-fi loop (Cmaj7, Am7, Fmaj7, G6
   at 88 bpm: pads, a plucked arpeggio, bass and a soft beat) and short sounds (click, pop, whoosh, blip,
   chime, tick). scripts/guide-audio.mjs and scripts/node-videos.mjs render them offline in a browser
   and put them on the recorded videos. */

export const BPM = 88;
const CHORDS = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 64]];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3]; // chord tones, one per eighth note
export const barSeconds = () => (60 / BPM) * 4;
const hz = m => 440 * 2 ** ((m - 69) / 12);

const noiseCache = new WeakMap();
function noise(ctx) {
  if (!noiseCache.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return noiseCache.get(ctx);
}

// One note: oscillators through an envelope (attack, then a fall to nothing).
function tone(ctx, out, t, { f, type = 'sine', gain = 0.2, a = 0.01, d = 0.4, detune = 0, to }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + a + d + 0.05);
}
function hiss(ctx, out, t, { gain = 0.1, d = 0.05, type = 'highpass', f = 7000, to, q = 0.7 }) {
  const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise(ctx); flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t);
  if (to) flt.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, d / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(flt); flt.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
}

// One bar of the music, starting at t.
export function scheduleBar(ctx, out, t, bar) {
  const beat = 60 / BPM, chord = CHORDS[bar % CHORDS.length];
  // Pads: the chord, held, with two slightly detuned voices for width.
  for (const m of chord) for (const dt of [-7, 7]) tone(ctx, out, t, { f: hz(m), type: 'triangle', gain: 0.035, a: 0.6, d: beat * 4 - 0.2, detune: dt });
  // A plucked arpeggio an octave up, a little quieter on the off-beats.
  ARP.forEach((k, n) => tone(ctx, out, t + n * beat / 2, { f: hz(chord[k] + 12), gain: n % 2 ? 0.04 : 0.06, a: 0.005, d: 0.45 }));
  // Bass on beats 1 and 3.
  [0, 2].forEach(b => tone(ctx, out, t + b * beat, { f: hz(chord[0] - 12), gain: 0.16, a: 0.02, d: beat * 1.6 }));
  // A soft kick on 1 and 3, a snare-ish brush on 2 and 4, hats on the off-beats.
  [0, 2].forEach(b => tone(ctx, out, t + b * beat, { f: 110, to: 42, gain: 0.32, a: 0.004, d: 0.22 }));
  [1, 3].forEach(b => hiss(ctx, out, t + b * beat, { gain: 0.05, d: 0.14, type: 'bandpass', f: 1800, q: 0.6 }));
  for (let n = 0; n < 4; n++) hiss(ctx, out, t + (n + 0.5) * beat, { gain: 0.025, d: 0.04 });
}

// The sounds.
export function playSfx(ctx, out, name, t = ctx.currentTime) {
  switch (name) {
    case 'click': hiss(ctx, out, t, { gain: 0.25, d: 0.03, type: 'bandpass', f: 3200, q: 1.5 }); tone(ctx, out, t, { f: 1600, to: 900, gain: 0.08, a: 0.002, d: 0.04 }); break;
    case 'pop': tone(ctx, out, t, { f: 520, to: 880, gain: 0.12, a: 0.005, d: 0.12 }); break;
    case 'whoosh': hiss(ctx, out, t, { gain: 0.12, d: 0.55, type: 'bandpass', f: 400, to: 3600, q: 0.9 }); break;
    case 'blip': tone(ctx, out, t, { f: 660, gain: 0.06, a: 0.005, d: 0.1, type: 'triangle' }); break;
    case 'chime': [72, 76, 79, 84].forEach((m, k) => tone(ctx, out, t + k * 0.07, { f: hz(m), gain: 0.07, a: 0.005, d: 0.9, type: 'triangle' })); break;
    case 'tick': hiss(ctx, out, t, { gain: 0.06, d: 0.02, type: 'bandpass', f: 4500, q: 2 }); break;
    default:
  }
}
