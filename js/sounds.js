const notes = {
  click:[440], right:[523,659,784], wrong:[300,226], timeout:[275,200],
  fire:[550,240], hit:[130,80], miss:[280,410], sunk:[165,98,65],
  win:[392,523,659,784], lose:[392,330,262], join:[440,659], blocked:[220,330], radar:[640,800]
};
let context;
export const soundSettings = {muted:false, volume:.35};

export function sound(kind) {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio || soundSettings.muted || !soundSettings.volume || !notes[kind]) return;
  try {
    context ||= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
    notes[kind].forEach((frequency, index) => {
      const start = context.currentTime + index * .085;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = ['hit','sunk','fire'].includes(kind) ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(.15 * soundSettings.volume + .001, start + .016);
      gain.gain.exponentialRampToValueAtTime(.001, start + .16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + .17);
    });
  } catch { /* Audio ist optional. */ }
}
