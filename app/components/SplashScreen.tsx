'use client';

import { useEffect, useState } from 'react';

// First-paint splash. The Electron window opens on a bare cream background
// while Next.js serves the page and React hydrates — long enough to read as a
// blank white flash. This overlay is part of the server-rendered HTML, so it
// paints with the very first frame; once the app hydrates we fade it out and
// unmount it. Rendering it (vs. a separate splash window) keeps it on the same
// background color so the transition into the app is seamless.
export function SplashScreen() {
  // `false` once hydration runs; the brief delay lets the fade-out play and
  // gives the real UI a frame to lay out underneath before we reveal it.
  const [hidden, setHidden] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setHidden(true), 450);
    const remove = setTimeout(() => setGone(true), 450 + 400);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, []);

  if (gone) return null;

  return (
    <div className="splash" data-hidden={hidden} aria-hidden="true">
      <div className="splash-rings">
        <span />
        <span />
        <span />
      </div>
      <div className="splash-word text-brand-gradient">spun</div>
    </div>
  );
}
