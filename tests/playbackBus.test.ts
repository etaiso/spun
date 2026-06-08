import { describe, it, expect } from 'vitest';
import { pauseRadio, subscribePauseRadio, resumeRadio, subscribeResumeRadio } from '../app/lib/playbackBus';

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

describe('playbackBus — resume', () => {
  it('notifies resume subscribers and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeResumeRadio(() => { calls++; });
    resumeRadio();
    resumeRadio();
    expect(calls).toBe(2);
    unsub();
    resumeRadio();
    expect(calls).toBe(2);
  });

  it('keeps pause and resume channels independent', () => {
    let pause = 0, resume = 0;
    const u1 = subscribePauseRadio(() => { pause++; });
    const u2 = subscribeResumeRadio(() => { resume++; });
    pauseRadio();
    expect([pause, resume]).toEqual([1, 0]);
    resumeRadio();
    expect([pause, resume]).toEqual([1, 1]);
    u1(); u2();
  });
});
