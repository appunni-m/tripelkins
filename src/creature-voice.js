// Original wordless songs: vowel-like harmonics, pitch slides and a small choir.
// Shared by everyday life and conversation; nothing is downloaded or spoken in English.
let context, output;
const playing = new Set();
const MAX_VOICES = 6;
const MELODIES = {
  greet: [[0, 7, 9, 4, 2], 0.16],
  content: [[4, 9, 7, 4], 0.17],
  eat: [[7, 4, 2], 0.12],
  wash: [[0, 7, 12, 7], 0.14],
  play: [[0, 7, 4, 9, 7], 0.14],
  work: [[0, 0, 7], 0.16],
  need: [[4, 2, -3], 0.24],
  birth: [[4, 7, 12, 9, 12, 7], 0.15],
  reply: [[0, 7, 4, 2, 7, 9, 4], 0.21],
  goal: [[0, 4, 7, 4, 9, 7, 2, 0], 0.21],
  blocked: [[7, 4, 2, 4, 0], 0.23],
};
export function awakenCreatureVoice() {
  try {
    if (!context || context.state === "closed") {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context = new Audio();
      output = context.createDynamicsCompressor();
      output.threshold.value = -18;
      output.knee.value = 18;
      output.ratio.value = 4;
      output.attack.value = 0.006;
      output.release.value = 0.15;
      output.connect(context.destination);
    }
    if (context.state !== "running") context.resume().catch(() => {});
  } catch {
    // Browser audio restrictions must never prevent play or microphone setup.
  }
}
export function stopCreatureVoice() {
  for (const voice of playing) {
    try {
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setValueAtTime(0, context.currentTime);
      voice.oscillator.stop();
    } catch {}
  }
  // Stopped voices are silent immediately; onended disconnects every node.
  playing.clear();
}
function vowelWave(audio, vowel, pitch, fidelity) {
  const formants = [
    [430, 1000, 2300],
    [650, 1250, 2600],
    [320, 2100, 2900],
  ][vowel];
  const real = new Float32Array(33),
    imaginary = new Float32Array(33);
  for (let harmonic = 1; harmonic <= 32; harmonic++) {
    const frequency = harmonic * pitch;
    let strength = 0.04 / harmonic;
    for (const f of formants)
      strength +=
        Math.exp(-(((frequency - f) / (f * 0.2)) ** 2)) / Math.sqrt(harmonic);
    imaginary[harmonic] = Math.round(strength * fidelity) / fidelity;
  }
  return audio.createPeriodicWave(real, imaginary);
}
function voiceSeed(identity) {
  let seed = 0;
  for (const c of String(identity).slice(0, 100))
    seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return seed;
}
export function songPhrase(mood = "greet") {
  const [notes, beat] = MELODIES[mood] || MELODIES.greet;
  return { notes, beat, duration: notes.length * beat + 0.12 };
}
function sing(
  phrase,
  identity,
  population,
  { layers = 1, pan = 0, volume = 0.06 } = {},
) {
  if (!context || context.state !== "running" || population <= 0) return;
  layers = Math.min(layers, MAX_VOICES - playing.size);
  if (layers <= 0) return;
  const seed = voiceSeed(identity),
    intervals = [1, 1.25, 0.875];
  for (let layer = 0; layer < layers; layer++) {
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const lowpass = context.createBiquadFilter(),
      panner = context.createStereoPanner();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2600;
    panner.pan.value = Math.max(
      -1,
      Math.min(1, pan + (layers > 1 ? (layer - 1) * 0.22 : 0)),
    );
    oscillator.connect(lowpass).connect(gain).connect(panner).connect(output);
    const base = (390 + (seed % 47)) * intervals[layer];
    oscillator.setPeriodicWave(
      vowelWave(context, (seed + layer) % 3, base, population < 10 ? 32 : 128),
    );
    const start = context.currentTime + 0.035 + layer * 0.04;
    const level = volume * 0.85 / Math.sqrt(layers);
    gain.gain.setValueAtTime(0, context.currentTime);
    phrase.notes.forEach((note, index) => {
      const t = start + index * phrase.beat;
      const pitch = base * 2 ** (note / 12);
      oscillator.frequency.setValueAtTime(pitch * 0.94, t);
      oscillator.frequency.exponentialRampToValueAtTime(pitch, t + 0.04);
      oscillator.frequency.exponentialRampToValueAtTime(
        pitch * 1.018,
        t + phrase.beat * 0.65,
      );
      oscillator.detune.setValueAtTime(((seed + index * 7) % 15) - 7, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + phrase.beat * 0.88);
    });
    const voice = { oscillator, gain };
    playing.add(voice);
    oscillator.onended = () => {
      playing.delete(voice);
      oscillator.disconnect();
      lowpass.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + phrase.duration);
  }
}
export function chirpCreature(identity, population, mood, options) {
  const phrase = songPhrase(mood);
  sing(phrase, identity, population, options);
  return phrase;
}
export function singReply(
  text,
  population,
  mood = "reply",
  { muted = false } = {},
) {
  stopCreatureVoice();
  const phrase = songPhrase(mood);
  // A new reply takes priority over ambient voices.
  if (!muted && context?.state === "running") {
    sing(phrase, text, population, {
      layers: population < 6 ? 1 : population < 40 ? 2 : 3,
      volume: 0.09,
    });
  }
  return phrase;
}
export function disposeCreatureVoice() {
  stopCreatureVoice();
  context?.close().catch(() => {});
  output?.disconnect();
  context = null;
  output = null;
}
