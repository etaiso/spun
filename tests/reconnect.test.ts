import { describe, it, expect } from 'vitest';
import { ReconnectPolicy, RECONNECT_DEFAULTS } from '../app/lib/timeshift/reconnect';

describe('ReconnectPolicy', () => {
  it('reconnects with the base delay on the first drop', () => {
    const p = new ReconnectPolicy();
    p.connected(0);
    expect(p.streamEnded(10_000)).toEqual({
      action: 'reconnect',
      delayMs: RECONNECT_DEFAULTS.baseDelayMs,
    });
  });

  it('backs off exponentially across consecutive failures, capped at maxDelayMs', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 1_000, maxDelayMs: 5_000, maxAttempts: 10, healthyMs: 60_000 });
    p.connected(0);
    const delays: number[] = [];
    let now = 1_000;
    for (let i = 0; i < 5; i++) {
      const d = p.streamEnded(now);
      if (d.action !== 'reconnect') throw new Error('expected reconnect');
      delays.push(d.delayMs);
      now += d.delayMs;
      // reopen fails — connected() never fires before the next streamEnded
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('gives up after maxAttempts consecutive failures', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 100, maxDelayMs: 1_000, maxAttempts: 3, healthyMs: 60_000 });
    p.connected(0);
    expect(p.streamEnded(1_000).action).toBe('reconnect');
    expect(p.streamEnded(2_000).action).toBe('reconnect');
    expect(p.streamEnded(3_000).action).toBe('reconnect');
    expect(p.streamEnded(4_000)).toEqual({ action: 'give-up' });
  });

  it('a connection that lived past healthyMs resets the attempt counter', () => {
    // The Glglz pattern: upstream drops every ~3 minutes, each reconnect
    // succeeds. The policy must survive this indefinitely.
    const p = new ReconnectPolicy({ baseDelayMs: 1_000, maxDelayMs: 15_000, maxAttempts: 3, healthyMs: 60_000 });
    let now = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      p.connected(now);
      now += 180_000; // lives ~3 minutes — healthy
      const d = p.streamEnded(now);
      expect(d).toEqual({ action: 'reconnect', delayMs: 1_000 }); // always a fresh outage
      now += 1_000;
    }
  });

  it('a short-lived (flapping) connection does NOT reset the counter', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 1_000, maxDelayMs: 15_000, maxAttempts: 3, healthyMs: 60_000 });
    let now = 0;
    p.connected(now);
    now += 5_000; // dies after 5 s — not healthy
    expect(p.streamEnded(now).action).toBe('reconnect');
    p.connected(now += 1_000);
    now += 5_000;
    expect(p.streamEnded(now).action).toBe('reconnect');
    p.connected(now += 2_000);
    now += 5_000;
    expect(p.streamEnded(now).action).toBe('reconnect');
    p.connected(now += 4_000);
    now += 5_000;
    expect(p.streamEnded(now)).toEqual({ action: 'give-up' });
  });

  it('flapping delays keep growing instead of restarting from base', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 1_000, maxDelayMs: 15_000, maxAttempts: 5, healthyMs: 60_000 });
    let now = 0;
    p.connected(now);
    const first = p.streamEnded(now += 5_000);
    p.connected(now += 1_000);
    const second = p.streamEnded(now += 5_000);
    if (first.action !== 'reconnect' || second.action !== 'reconnect') throw new Error('expected reconnect');
    expect(second.delayMs).toBeGreaterThan(first.delayMs);
  });

  it('recovers the give-up budget after a healthy stretch follows flapping', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 1_000, maxDelayMs: 15_000, maxAttempts: 3, healthyMs: 60_000 });
    let now = 0;
    p.connected(now);
    expect(p.streamEnded(now += 5_000).action).toBe('reconnect'); // flap 1
    p.connected(now += 1_000);
    expect(p.streamEnded(now += 5_000).action).toBe('reconnect'); // flap 2
    p.connected(now += 2_000);
    now += 120_000; // this one sticks for 2 minutes
    expect(p.streamEnded(now)).toEqual({ action: 'reconnect', delayMs: 1_000 }); // counter reset
  });
});
