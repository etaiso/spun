'use client';

import { Fragment, useCallback, useState } from 'react';
import type { Station } from './lib/stations';
import { useRecent } from './lib/recent';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import type { PlayState } from './components/Player';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const { add: addRecent } = useRecent();

  // Wrap selection so every station pick also lands in "Recently played",
  // and reset playState so the new station doesn't inherit the previous
  // station's terminal state (e.g. 'connecting' would render a stale splash).
  const handleSelect = useCallback((s: Station) => {
    setSelected(s);
    setPlayState('idle');
    addRecent(s);
  }, [addRecent]);

  return (
    <div className="flex min-h-screen">
      <Sidebar selectedId={selected?.id ?? null} onSelect={handleSelect} />
      <main className="flex-1 p-10 flex flex-col gap-6 bg-[var(--color-bg)] overflow-y-auto">
        {selected ? (
          // Single key on the Fragment so both children remount together when
          // the station changes. Short `<>` can't carry a key, and putting the
          // same key on both children produces React's duplicate-key error.
          <Fragment key={selected.id}>
            <NowPlaying station={selected} playState={playState} />
            <Player station={selected} onPlayStateChange={setPlayState} />
          </Fragment>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3">
                Radio
              </div>
              <div className="text-[32px] font-bold tracking-tight">Pick a station to begin</div>
              <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                Browse the sidebar — start with the popular list, or search for something specific. Star what you love to pin it to the top.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
