import { useEffect, useRef } from "react";

function playCompletionSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number, vol = 0.3) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };

    playTone(523.25, 0, 0.15);     // C5
    playTone(659.25, 0.1, 0.15);   // E5
    playTone(783.99, 0.2, 0.25);   // G5
    playTone(1046.5, 0.35, 0.35);  // C6

    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Audio not supported or blocked
  }
}

export function useAudioNotification(trigger: boolean | number): void {
  const prevRef = useRef<boolean | number | null>(null);

  useEffect(() => {
    if (trigger && prevRef.current !== trigger) {
      playCompletionSound();
    }
    prevRef.current = trigger;
  }, [trigger]);
}