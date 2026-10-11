// Web Audio two-tone chime (ding-dong: 880 Hz then 660 Hz)
let audioCtx = null;

export function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playChime(ctx = getAudioContext()) {
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  const t = ctx.currentTime;
  const tones = [
    { freq: 880, delay: 0 },
    { freq: 660, delay: 0.38 }
  ];

  tones.forEach(({ freq, delay }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t + delay);

    gain.gain.setValueAtTime(0.0001, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.85, t + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t + delay);
    osc.stop(t + delay + 0.6);
  });
}
