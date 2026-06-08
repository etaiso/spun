# Design-system rollout — migrate the rest of the app off terracotta

**Date:** 2026-06-08
**Status:** Approved design

## Summary

Complete the incremental design-system rollout started with Saved Songs:
migrate every remaining surface off the legacy terracotta accents
(`--color-warm`, `--color-accent`) onto the brand tokens defined in
`docs/DESIGN_SYSTEM.md`. One cohesive sweep across the whole app. Neutrals
(cream/ink) are unchanged; this is purely an accent recolor.

## Decisions (from brainstorming)

- **Favorites ★** → `--color-brand-purple` (`#A855F7`) — on-brand and distinct
  from the pink ♥ save affordance.
- **Gradient sparingly** — full `--grad-brand` only for the `spun` wordmark
  (already done), primary CTA fills, and the now-playing cover glow. Uppercase
  **section labels** become solid `--color-brand-purple`; interactive accents
  become solid `--color-brand-pink`.
- **Scope** — whole app in one sweep.

## Token-mapping rules

Apply consistently everywhere:

1. Uppercase **section labels** (`text-[var(--color-warm)]`) → `text-[var(--color-brand-purple)]`.
2. **Favorites ★** (warm) → `--color-brand-purple`.
3. **Interactive accents** — hover text/borders, focus rings, active borders,
   selected-row highlight, the ⌘K hint, refresh & preview controls (warm) →
   `--color-brand-pink`.
4. Warm **hover-background tints** `rgba(210,105,30,α)` (station rows, tracking
   rows, now-playing card border) → purple tint `rgba(168,85,247,α)` (same α).
5. **Ambient animations** — `.spin-warm` border-top, `.dots` background,
   `.radio-waves` ring `border-color` `rgba(210,105,30,…)` → brand purple
   (`#A855F7` / `rgba(168,85,247,…)`), preserving the existing alpha/`calc()`.
6. **Now-playing cover glow** `shadow-[0_16px_48px_rgba(192,57,43,0.28)]` →
   `rgba(168,85,247,0.28)`.
7. **Primary CTA fills** → `.bg-brand` gradient + `text-white`.
8. **Small status pills** (e.g. Player "AUTO-PLAY ON") → solid purple accent,
   not gradient (keep the gradient sparing).
9. **Danger/error** currently on `--color-accent` →
   `--color-danger`: `TrackingPanel.tsx:176` (stop-tracking hover, incl. its
   `rgba(192,57,43,0.08)` bg — leave the rgba as-is, it is the danger red) and
   `DebugPanel.tsx:90` ("○ down" status).

**Out of scope (unchanged):**
- `app/lib/colors.ts` — the `['#d2691e','#8b3a0f']` pair is one of many
  procedural station-logo color pairs, not a design token. Leave it.
- The Shazam badge blue `#0088ff` in `NowPlaying.tsx` — intentional third-party
  identity. Leave it.
- Neutrals (`--color-bg`, ink scale, `--color-line`) — unchanged.

## Components covered

Grouped for implementation:

- **globals.css** — ambient classes (`.spin-warm`, `.dots`, `.radio-waves`).
- **Sidebar surfaces** — `Sidebar.tsx`, `StationRow.tsx`, `StationContextMenu.tsx`.
- **Now playing** — `NowPlaying.tsx` (remaining labels, refresh control,
  favorites ★, cover glow, loading/connecting states), `NowPlayingCard.tsx`.
- **Player & palette** — `Player.tsx`, `CommandPalette.tsx`.
- **Tracking & top bar** — `TrackingPanel.tsx`, `TopBar.tsx`, `page.tsx`
  empty-state label + ⌘K kbd, `PlaylistHistory.tsx` section label.
- **Dialogs** — `SettingsDialog.tsx`, `ShortcutsHelp.tsx`, `UpdateModal.tsx`,
  `HiddenStationsSettings.tsx`, `HiddenStationsDialog.tsx`, `RegionPicker.tsx`,
  `CollapsibleSection.tsx`, `DebugPanel.tsx`.

## Cleanup

After all surfaces are migrated and `grep -r "var(--color-warm)\|var(--color-accent)" app`
returns nothing:

- Remove `--color-warm` and `--color-accent` (and `--color-accent-2` if unused)
  from `globals.css :root`.
- Update the "Legacy (being phased out)" section of `docs/DESIGN_SYSTEM.md` to
  record that the rollout is complete and the terracotta tokens are gone.

If any `var(--color-warm)`/`var(--color-accent)` reference remains (e.g. an
overlooked surface), do NOT remove the token — fix the surface first.

## Verification

No unit tests (pure styling/className changes). Per migrated group:

- `npm run lint` — 0 errors.
- Visual check in the running dev preview (`npm run dev`, port 3000): screenshot
  the affected surface and confirm no terracotta remains and brand colors render
  (sidebar labels purple, ★ purple, hovers/controls pink, ambient animations
  purple, primary CTAs gradient).
- Final: full-app pass — `npx vitest run` (regression safety) + a sweep
  confirming `grep` finds no remaining warm/accent token usage.

## Out of scope

- Any layout, spacing, copy, or behavior change — accent color only.
- Backend, persistence, or recognizer changes.
