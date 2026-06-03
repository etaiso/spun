'use client';

import { useState } from 'react';
import type { Station } from './lib/stations';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import type { PlayState } from './components/Player';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');

  return (
    <div className="flex min-h-screen">
      <Sidebar selectedId={selected?.id ?? null} onSelect={setSelected} />
      <main className="flex-1 p-10 flex flex-col gap-6 bg-[var(--color-bg)] overflow-y-auto">
        {selected ? (
          <>
            <NowPlaying key={selected.id} station={selected} playState={playState} />
            <Player key={selected.id} station={selected} onPlayStateChange={setPlayState} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3">
                Radio
              </div>
              <div className="text-[32px] font-bold tracking-tight">Search for a station to begin</div>
              <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                Find a station in the sidebar. Star the ones you love — they&apos;ll be pinned at the top next time.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
