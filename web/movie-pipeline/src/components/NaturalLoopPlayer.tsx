import { useEffect, useMemo, useRef, useState } from 'react';

type LoopPoints = { start_sec: number; end_sec: number };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Natural loop preview:
// - Uses two HTMLAudioElements and crossfades at the loop boundary.
// - If loop points are not provided, loops the whole track with a small crossfade.
export default function NaturalLoopPlayer(props: {
  src: string;
  loop?: LoopPoints | null;
  width?: string | number;
}) {
  const { src, loop, width } = props;

  const aRef = useRef<HTMLAudioElement | null>(null);
  const bRef = useRef<HTMLAudioElement | null>(null);
  const crossfadingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);

  const fadeSec = 0.25;

  const loopStart = useMemo(() => {
    const start = Number(loop?.start_sec ?? 0);
    return Number.isFinite(start) && start >= 0 ? start : 0;
  }, [loop?.start_sec]);

  const loopEnd = useMemo(() => {
    const end = Number(loop?.end_sec ?? 0);
    if (Number.isFinite(end) && end > 0) return end;
    return duration > 0 ? duration : 0;
  }, [loop?.end_sec, duration]);

  const loopActive = useMemo(() => {
    if (!duration) return false;
    if (!loopEnd || loopEnd <= 0) return false;
    if (loopEnd <= loopStart) return false;
    // Require at least some room for fade.
    return loopEnd - loopStart > fadeSec * 2;
  }, [duration, loopStart, loopEnd]);

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setDuration(0);
    crossfadingRef.current = false;

    const a = new Audio();
    const b = new Audio();
    a.preload = 'auto';
    b.preload = 'auto';
    a.src = src;
    b.src = src;
    a.volume = 1;
    b.volume = 0;

    aRef.current = a;
    bRef.current = b;

    const onLoaded = () => {
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
      setReady(true);
    };

    const onEnded = (ev: Event) => {
      // Always ensure looping (replay-studio style). Crossfade loop uses interval, but this
      // is a safety-net for cases where it doesn't trigger.
      const el = ev.target as HTMLAudioElement;
      try {
        el.currentTime = loopActive ? clamp(loopStart, 0, Math.max(0, duration - 0.01)) : 0;
        void el.play();
      } catch {
        // ignore
      }
    };

    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('ended', onEnded);
    b.addEventListener('ended', onEnded);

    return () => {
      a.pause();
      b.pause();
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('ended', onEnded);
      b.removeEventListener('ended', onEnded);
      aRef.current = null;
      bRef.current = null;
    };
  }, [src]);

  // Keep the native looping behavior aligned with whether we're doing crossfade looping.
  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    // If we don't have valid loop points for crossfade, force native loop.
    a.loop = !loopActive;
    b.loop = false;
  }, [loopActive]);

  useEffect(() => {
    if (!playing) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let active: HTMLAudioElement = a;
    let shadow: HTMLAudioElement = b;

    // Ensure initial state.
    shadow.pause();
    shadow.volume = 0;

    const tickMs = 50;
    const fadeSteps = 12;

    const startCrossfade = async () => {
      if (!loopActive) return;
      if (crossfadingRef.current) return;
      crossfadingRef.current = true;

      try {
        shadow.currentTime = clamp(loopStart, 0, Math.max(0, duration - 0.01));
        shadow.volume = 0;
        await shadow.play();
      } catch {
        crossfadingRef.current = false;
        return;
      }

      const stepMs = Math.max(10, Math.floor((fadeSec * 1000) / fadeSteps));
      let step = 0;
      const id = window.setInterval(() => {
        step++;
        const t = step / fadeSteps;
        const vIn = clamp(t, 0, 1);
        const vOut = clamp(1 - t, 0, 1);
        shadow.volume = vIn;
        active.volume = vOut;
        if (step >= fadeSteps) {
          window.clearInterval(id);
          active.pause();
          active.volume = 0;
          // Swap roles.
          const tmp = active;
          active = shadow;
          shadow = tmp;
          crossfadingRef.current = false;
        }
      }, stepMs);
    };

    const id = window.setInterval(() => {
      if (!loopActive) return;
      // When we're approaching loopEnd, begin crossfade into loopStart.
      if (active.currentTime >= loopEnd - fadeSec) {
        void startCrossfade();
      }
    }, tickMs);

    return () => window.clearInterval(id);
  }, [playing, loopActive, loopStart, loopEnd, duration]);

  const onToggle = async () => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    if (playing) {
      a.pause();
      b.pause();
      crossfadingRef.current = false;
      setPlaying(false);
      return;
    }

    try {
      // Start from 0 (or loopStart if provided and >0, still play intro if start==0).
      a.currentTime = 0;
      a.volume = 1;
      b.volume = 0;
      await a.play();
      setPlaying(true);
    } catch {
      crossfadingRef.current = false;
      setPlaying(false);
    }
  };

  const label = !ready ? 'loading…' : playing ? 'stop' : 'play (natural loop)';

  return (
    <div style={{ width: width ?? '100%' }}>
      <button className="ghost" type="button" onClick={() => void onToggle()} disabled={!ready}>
        {label}
      </button>
      <div className="hint" style={{ marginTop: 6 }}>
        {loopActive
          ? `loop: ${loopStart.toFixed(2)}s → ${loopEnd.toFixed(2)}s (crossfade ${fadeSec.toFixed(2)}s)`
          : 'loop: auto (track end → start, crossfade)'}
      </div>
    </div>
  );
}
