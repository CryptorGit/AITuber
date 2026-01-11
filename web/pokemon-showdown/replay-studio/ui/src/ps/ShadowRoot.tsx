import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ShadowRoot(props: { stylesheets: string[]; children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const sr = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    // ensure stylesheets are present (idempotent)
    for (const href of props.stylesheets) {
      const id = `ps-link:${href}`;
      if (sr.getElementById(id)) continue;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      sr.appendChild(link);
    }

    setShadow(sr);
  }, [props.stylesheets]);

  const container = useMemo(() => {
    if (!shadow) return null;
    const existing = shadow.getElementById('ps-shadow-container');
    if (existing) return existing as HTMLDivElement;
    const div = document.createElement('div');
    div.id = 'ps-shadow-container';
    shadow.appendChild(div);
    return div;
  }, [shadow]);

  return (
    <>
      <div ref={hostRef} />
      {container ? createPortal(props.children, container) : null}
    </>
  );
}
