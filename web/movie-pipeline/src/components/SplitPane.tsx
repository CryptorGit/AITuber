import { useEffect, useMemo, useRef, useState } from 'react';

export type SplitPaneProps = {
  storageKey: string;
  leftMinPx?: number;
  rightMinPx?: number;
  defaultLeftPx?: number;
  left: React.ReactNode;
  right: React.ReactNode;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function SplitPane(props: SplitPaneProps) {
  const leftMinPx = props.leftMinPx ?? 280;
  const rightMinPx = props.rightMinPx ?? 520;
  const defaultLeftPx = props.defaultLeftPx ?? 520;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const [leftPx, setLeftPx] = useState<number>(() => {
    const raw = localStorage.getItem(props.storageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : defaultLeftPx;
  });

  const constraints = useMemo(() => {
    const w = rootRef.current?.getBoundingClientRect().width ?? 0;
    const min = leftMinPx;
    const max = Math.max(min, w - rightMinPx);
    return { min, max, w };
  }, [leftMinPx, rightMinPx, props.storageKey]);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const next = clamp(ev.clientX - rect.left, leftMinPx, rect.width - rightMinPx);
      setLeftPx(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove('split-dragging');
      localStorage.setItem(props.storageKey, String(leftPx));
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [leftPx, leftMinPx, rightMinPx, props.storageKey]);

  useEffect(() => {
    // Clamp on resize.
    const onResize = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const clamped = clamp(leftPx, leftMinPx, rect.width - rightMinPx);
      if (clamped !== leftPx) setLeftPx(clamped);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [leftPx, leftMinPx, rightMinPx]);

  const safeLeftPx = useMemo(() => {
    if (!constraints.w) return leftPx;
    return clamp(leftPx, constraints.min, constraints.max);
  }, [leftPx, constraints.min, constraints.max, constraints.w]);

  return (
    <div ref={rootRef} className="split-root">
      <div className="split-pane split-left" style={{ width: safeLeftPx }}>
        {props.left}
      </div>
      <div
        className="split-handle"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.classList.add('split-dragging');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            const next = safeLeftPx - 20;
            setLeftPx((prev) => clamp(prev - 20, leftMinPx, (rootRef.current?.getBoundingClientRect().width ?? 0) - rightMinPx));
            localStorage.setItem(props.storageKey, String(next));
          } else if (e.key === 'ArrowRight') {
            const next = safeLeftPx + 20;
            setLeftPx((prev) => clamp(prev + 20, leftMinPx, (rootRef.current?.getBoundingClientRect().width ?? 0) - rightMinPx));
            localStorage.setItem(props.storageKey, String(next));
          }
        }}
        title="Drag to resize"
      />
      <div className="split-pane split-right">{props.right}</div>
    </div>
  );
}
