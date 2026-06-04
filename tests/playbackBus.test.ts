import { describe, it, expect } from 'vitest';
import { pauseRadio, subscribePauseRadio } from '../app/lib/playbackBus';

describe('playbackBus', () => {
  it('notifies subscribers when pauseRadio is called', () => {
    let calls = 0;
    const unsub = subscribePauseRadio(() => { calls++; });
    pauseRadio();
    pauseRadio();
    expect(calls).toBe(2);
    unsub();
    pauseRadio();
    expect(calls).toBe(2); // no longer notified after unsubscribe
  });
});
