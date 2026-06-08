import type { MouseEvent } from 'react';

// Wire to `onMouseEnter` on a `truncate`d element: shows a native tooltip with
// the element's full text, but only when it's actually clipped (ellipsis).
// Uses the element's own textContent, so it works for any truncated label.
export function showTitleIfTruncated(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.title = el.scrollWidth > el.clientWidth ? (el.textContent ?? '') : '';
}
