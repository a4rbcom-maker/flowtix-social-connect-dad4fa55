let ctx: AudioContext | null = null;

// WhatsApp-style double "ding" notification — two soft marimba-like tones
export function playMessageSound() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    const ding = (t: number, freq: number, vol: number) => {
      const gain = ctx!.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      gain.connect(ctx!.destination);
      [freq, freq * 2.01].forEach((f, i) => {
        const osc = ctx!.createOscillator();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.setValueAtTime(f, t);
        const g2 = ctx!.createGain();
        g2.gain.setValueAtTime(i === 0 ? 1 : 0.25, t);
        osc.connect(g2);
        g2.connect(gain);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    };

    // "ding-dong" — like WhatsApp's notification
    ding(now, 987.77, 0.14);        // B5
    ding(now + 0.16, 783.99, 0.12); // G5
  } catch {
  }
}
