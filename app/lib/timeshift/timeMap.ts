// Maps the <audio> element's buffer time (seconds since the SourceBuffer was
// (re)built) to wall-clock epoch ms and back. Anchors are added after each MSE
// append: (sourceBuffer.buffered.end, wallClock of the appended chunk).
// Interpolation between anchors gives sub-second behind-live math without ever
// parsing codec frames.
type Anchor = { bufferTime: number; wallClock: number };

export class TimeMap {
  private anchors: Anchor[] = [];
  constructor(private maxAnchors = 4096) {}

  addAnchor(bufferTime: number, wallClock: number): void {
    this.anchors.push({ bufferTime, wallClock });
    if (this.anchors.length > this.maxAnchors) {
      this.anchors.splice(0, this.anchors.length - this.maxAnchors);
    }
  }

  wallClockAt(bufferTime: number): number | null {
    return this.lookup(bufferTime, 'bufferTime', 'wallClock');
  }

  bufferTimeAt(wallClock: number): number | null {
    return this.lookup(wallClock, 'wallClock', 'bufferTime');
  }

  private lookup(x: number, from: keyof Anchor, to: keyof Anchor): number | null {
    const a = this.anchors;
    if (a.length === 0) return null;
    if (x <= a[0][from]) return a[0][to];
    if (x >= a[a.length - 1][from]) return a[a.length - 1][to];
    // binary search for the surrounding pair
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid][from] <= x) lo = mid; else hi = mid;
    }
    const l = a[lo], r = a[hi];
    const t = (x - l[from]) / (r[from] - l[from] || 1);
    return l[to] + t * (r[to] - l[to]);
  }

  reset(): void { this.anchors = []; }
}
