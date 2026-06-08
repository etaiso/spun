# Design-System Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every remaining app surface off the legacy terracotta accents (`--color-warm`, `--color-accent`) onto the brand tokens, completing the design-system rollout.

**Architecture:** Pure accent recolor — className/CSS token swaps only, no layout/behavior/copy changes. Apply a fixed set of transformation rules (R1–R8 below) across grouped components, then remove the dead legacy tokens and update the design-system doc.

**Tech Stack:** Next.js 16 / React 19 / Tailwind CSS v4. No unit tests (pure styling) — verify with `npm run lint`, a `grep` cleanliness check, and visual screenshots from the running dev preview (port 3000).

---

## Recolor rules (apply everywhere)

These are referenced by every task. Tokens: `--color-brand-purple` = `#a855f7`, `--color-brand-pink` = `#ec4899`. The `.bg-brand` class is the gradient fill. All already defined in `globals.css`.

- **R1 — text → purple.** Any `text-[var(--color-warm)]` or `hover:text-[var(--color-warm)]` (section labels, status text, favorite/track toggles, now-playing text) → `var(--color-brand-purple)`. Replace **every** `var(--color-warm)` inside a `text-…` context on the line.
- **R2 — borders / rings / focus / form-accent → pink.** Any `border-[var(--color-warm)]`, `hover:border-[var(--color-warm)]`, `ring-[var(--color-warm)]`, `focus-visible:ring-[var(--color-warm)]`, `accent-[var(--color-warm)]` → `var(--color-brand-pink)`. **Exception:** a *filled* pill whose border matches its fill — see R3a.
- **R3 — solid fills → purple.** Any `bg-[var(--color-warm)]` (toggle "on" states, status dots, meters, progress bars) → `var(--color-brand-purple)`.
  - **R3a — filled status pill:** when an element has BOTH `bg-[var(--color-warm)]` and `border-[var(--color-warm)]` (a filled pill), set BOTH to `var(--color-brand-purple)` (do not split bg→purple / border→pink).
  - **R3b — primary CTA:** the UpdateModal primary action button (Task 6) uses `bg-brand` (gradient), not solid purple — called out explicitly there.
- **R4 — warm rgba tint → purple rgba.** Any `rgba(210, 105, 30, α)` or `rgba(210,105,30,α)` (hover-bg tints, card border, ring, ambient waves, the AUTO-PLAY shadow) → `rgba(168, 85, 247, α)` — **keep the exact alpha / `calc()` unchanged**, only swap the three RGB numbers.
- **R5 — now-playing cover glow.** `rgba(192,57,43,0.28)` (NowPlaying cover shadow) → `rgba(168,85,247,0.28)`. **Do NOT touch other `rgba(192,57,43,…)`** — those are the danger-red error box and the danger hover bg, which stay.
- **R6 — warm-brown shadow.** `rgba(120,60,30,0.08)` (NowPlayingCard) → `rgba(168,85,247,0.12)`.
- **R7 — globals.css ambient.** `border-top-color: var(--color-warm)` and `background: var(--color-warm)` → `var(--color-brand-purple)`; radio-waves `rgba(210, 105, 30, …)` → `rgba(168, 85, 247, …)` (R4, spaced format).
- **R8 — danger.** `text-[var(--color-accent)]` / `hover:text-[var(--color-accent)]` in error/destructive spots → `var(--color-danger)`. Leave any adjacent `rgba(192,57,43,…)` danger-red bg as-is.

**Per-task verification** (unless noted): after edits, run `npm run lint` (expect 0 errors; the 2 pre-existing `<img>` warnings are fine), then confirm the touched files are clean:
`grep -nE "color-warm|210, ?105, ?30" <files>` → **no matches**, and `grep -n "color-accent" <files>` → no matches (the legacy `--color-accent` `rgba(192,57,43)` danger-red literals at NowPlaying.tsx error box and TrackingPanel stop-tracking bg are allowed to remain — they're danger, not the token).

---

## Task 1: Ambient animations (globals.css)

**Files:** Modify `app/globals.css` (lines 68, 73, 93, 98, 99, 100)

- [ ] **Step 1: Apply R7**

- Line 68 (`.spin-warm`): change `border-top-color: var(--color-warm);` → `border-top-color: var(--color-brand-purple);`
- Line 73 (`.dots span`): change `background: var(--color-warm);` → `background: var(--color-brand-purple);`
- Lines 93, 98, 99, 100 (`.radio-waves span`): in each, change `rgba(210, 105, 30,` → `rgba(168, 85, 247,` (leave the ` calc(...)` alpha and everything else unchanged).

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: 0 errors.
Run: `grep -nE "210, ?105, ?30|var\(--color-warm\)" app/globals.css`
Expected: matches ONLY on lines 11–13 (the `:root` token definitions, removed in Task 7) — none in `.spin-warm`, `.dots`, or `.radio-waves`.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(brand): recolor ambient animations (spinner, dots, radio waves) to brand purple"
```

---

## Task 2: Sidebar — StationRow

**Files:** Modify `app/components/StationRow.tsx` (lines 40, 42, 45, 62, 78)

(`Sidebar.tsx` and `StationContextMenu.tsx` have no remaining warm/accent usages.)

- [ ] **Step 1: Apply the rules**

- Line 40: `backgroundColor: 'rgba(210, 105, 30, 0.12)'` → `backgroundColor: 'rgba(168, 85, 247, 0.12)'` (R4).
- Line 42: `focus-visible:ring-[var(--color-warm)]` → `focus-visible:ring-[var(--color-brand-pink)]` (R2).
- Line 45: `hover:bg-[rgba(210,105,30,0.12)]` → `hover:bg-[rgba(168,85,247,0.12)]` (R4).
- Line 62 (track toggle): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1). After: `tracked ? 'text-[var(--color-brand-purple)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-brand-purple)]'`.
- Line 78 (favorite ★): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).

- [ ] **Step 2: Verify**

Run: `npm run lint` → 0 errors.
Run: `grep -nE "color-warm|210, ?105, ?30" app/components/StationRow.tsx` → no matches.

- [ ] **Step 3: Commit**

```bash
git add app/components/StationRow.tsx
git commit -m "style(brand): recolor station rows (star/track purple, hovers pink)"
```

---

## Task 3: Now playing — NowPlaying + NowPlayingCard

**Files:** Modify `app/components/NowPlaying.tsx` (239, 353, 406, 416, 463), `app/components/NowPlayingCard.tsx` (23, 24, 25, 33, 52, 68)

- [ ] **Step 1: NowPlaying.tsx**

- Line 239 (section label, "Connecting to X"): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 353 (cover glow): `shadow-[0_16px_48px_rgba(192,57,43,0.28)]` → `shadow-[0_16px_48px_rgba(168,85,247,0.28)]` (R5).
- Line 406 (favorite ★): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).
- Line 416 (refresh control): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 463 (section label, "Now playing on X"): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- **Do NOT change line 223** — its `rgba(192,57,43,…)` bg/border and `text-[var(--color-danger)]` are the danger error box (already correct).

- [ ] **Step 2: NowPlayingCard.tsx**

- Line 23: `border-[rgba(210,105,30,0.35)]` → `border-[rgba(168,85,247,0.35)]` (R4); and `shadow-[0_2px_10px_rgba(120,60,30,0.08)]` → `shadow-[0_2px_10px_rgba(168,85,247,0.12)]` (R6).
- Line 24 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 25 (status dot): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).
- Line 33 (marquee now-playing text): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 52 (track toggle): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).
- Line 68 (favorite toggle): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).

- [ ] **Step 3: Verify**

Run: `npm run lint` → 0 errors.
Run: `grep -nE "color-warm|210, ?105, ?30|120, ?60, ?30" app/components/NowPlaying.tsx app/components/NowPlayingCard.tsx` → no matches.
Run: `grep -n "192,57,43" app/components/NowPlaying.tsx` → only line 223 (the kept danger error box).

- [ ] **Step 4: Commit**

```bash
git add app/components/NowPlaying.tsx app/components/NowPlayingCard.tsx
git commit -m "style(brand): recolor now-playing surfaces (labels purple, glow purple, controls pink)"
```

---

## Task 4: Player + CommandPalette

**Files:** Modify `app/components/Player.tsx` (340, 352, 353), `app/components/CommandPalette.tsx` (145, 185, 200)

- [ ] **Step 1: Player.tsx**

- Line 340 (volume slider): `accent-[var(--color-warm)]` → `accent-[var(--color-brand-pink)]` (R2).
- Line 352 (AUTO-PLAY "on" filled pill — R3a, filled pill: bg + border BOTH purple, shadow purple): replace
  `'bg-[var(--color-warm)] text-white border-[var(--color-warm)] shadow-[0_2px_6px_rgba(210,105,30,0.3)]'`
  with
  `'bg-[var(--color-brand-purple)] text-white border-[var(--color-brand-purple)] shadow-[0_2px_6px_rgba(168,85,247,0.3)]'`.
- Line 353 (AUTO-PLAY "off" hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).

- [ ] **Step 2: CommandPalette.tsx**

- Line 145 (group label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 185 (track toggle): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).
- Line 200 (favorite toggle): replace both `var(--color-warm)` → `var(--color-brand-purple)` (R1).

- [ ] **Step 3: Verify**

Run: `npm run lint` → 0 errors.
Run: `grep -nE "color-warm|210, ?105, ?30" app/components/Player.tsx app/components/CommandPalette.tsx` → no matches.

- [ ] **Step 4: Commit**

```bash
git add app/components/Player.tsx app/components/CommandPalette.tsx
git commit -m "style(brand): recolor player + command palette to brand accents"
```

---

## Task 5: Tracking panel, top bar, page empty-state, playlist-history label

**Files:** Modify `app/components/TrackingPanel.tsx` (31, 147, 149, 150, 158, 165, 176), `app/components/TopBar.tsx` (79, 99, 118, 119), `app/page.tsx` (208), `app/components/PlaylistHistory.tsx` (20)

- [ ] **Step 1: TrackingPanel.tsx**

- Line 31 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 147 (focus ring): `focus-visible:ring-[var(--color-warm)]` → `focus-visible:ring-[var(--color-brand-pink)]` (R2).
- Line 149 (active row): `bg-[rgba(210,105,30,0.12)]` → `bg-[rgba(168,85,247,0.12)]` (R4) and `ring-[var(--color-warm)]` → `ring-[var(--color-brand-pink)]` (R2).
- Line 150 (hover): `hover:bg-[rgba(210,105,30,0.12)]` → `hover:bg-[rgba(168,85,247,0.12)]` (R4).
- Line 158 ("● Playing" status): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 165 (live dot): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).
- Line 176 (stop-tracking hover, danger): `hover:text-[var(--color-accent)]` → `hover:text-[var(--color-danger)]` (R8). **Leave** `hover:bg-[rgba(192,57,43,0.08)]` as-is.

- [ ] **Step 2: TopBar.tsx**

- Line 79 (search button hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 99 (icon button hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 118 (active segment border): `border-[var(--color-warm)]` → `border-[var(--color-brand-pink)]` (R2).
- Line 119 (inactive hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).

- [ ] **Step 3: page.tsx + PlaylistHistory.tsx**

- `app/page.tsx` line 208 (empty-state "Spun" eyebrow): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- `app/components/PlaylistHistory.tsx` line 20 ("▾ Playlist history" label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).

- [ ] **Step 4: Verify**

Run: `npm run lint` → 0 errors.
Run: `grep -nE "color-warm|210, ?105, ?30" app/components/TrackingPanel.tsx app/components/TopBar.tsx app/page.tsx app/components/PlaylistHistory.tsx` → no matches.
Run: `grep -n "color-accent" app/components/TrackingPanel.tsx` → no matches (now `--color-danger`).

- [ ] **Step 5: Commit**

```bash
git add app/components/TrackingPanel.tsx app/components/TopBar.tsx app/page.tsx app/components/PlaylistHistory.tsx
git commit -m "style(brand): recolor tracking panel, top bar, empty-state, history label"
```

---

## Task 6: Dialogs

**Files:** Modify `SettingsDialog.tsx` (161, 192, 226, 243, 269, 291), `ShortcutsHelp.tsx` (27, 45), `UpdateModal.tsx` (33, 35, 69), `HiddenStationsSettings.tsx` (33), `HiddenStationsDialog.tsx` (40), `RegionPicker.tsx` (43, 78), `CollapsibleSection.tsx` (20), `DebugPanel.tsx` (90, 109) — all under `app/components/`.

- [ ] **Step 1: SettingsDialog.tsx**

- Line 161 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).
- Line 192 (toggle on): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).
- Line 226 (toggle on): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).
- Line 243 (secondary button): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1) AND both `hover:border-[var(--color-warm)]` / `disabled:hover:border-[var(--color-line)]` — only the `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2). (Leave the `border-[var(--color-line)]` and `disabled:` line classes.)
- Line 269 (secondary button): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1) and `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 291 (toggle on): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).

- [ ] **Step 2: ShortcutsHelp.tsx**

- Line 27 (floating button hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 45 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).

- [ ] **Step 3: UpdateModal.tsx**

- Line 33 (PRIMARY action button — R3b, gradient): `bg-[var(--color-warm)]` → `bg-brand` (keep `text-white hover:opacity-90`).
- Line 35 (secondary button hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- Line 69 (download progress fill): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).

- [ ] **Step 4: HiddenStationsSettings.tsx + HiddenStationsDialog.tsx**

- `HiddenStationsSettings.tsx` line 33 (secondary button): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1) and `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- `HiddenStationsDialog.tsx` line 40 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).

- [ ] **Step 5: RegionPicker.tsx + CollapsibleSection.tsx**

- `RegionPicker.tsx` line 43 (select hover): `hover:border-[var(--color-warm)]` → `hover:border-[var(--color-brand-pink)]` (R2).
- `RegionPicker.tsx` line 78 (locked toggle on): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).
- `CollapsibleSection.tsx` line 20 (section label): `text-[var(--color-warm)]` → `text-[var(--color-brand-purple)]` (R1).

- [ ] **Step 6: DebugPanel.tsx**

- Line 90 ("○ down" status, danger): `text-[var(--color-accent)]` → `text-[var(--color-danger)]` (R8).
- Line 109 (energy meter fill): `bg-[var(--color-warm)]` → `bg-[var(--color-brand-purple)]` (R3).

- [ ] **Step 7: Verify**

Run: `npm run lint` → 0 errors.
Run: `grep -rnE "color-warm|210, ?105, ?30" app/components/SettingsDialog.tsx app/components/ShortcutsHelp.tsx app/components/UpdateModal.tsx app/components/HiddenStationsSettings.tsx app/components/HiddenStationsDialog.tsx app/components/RegionPicker.tsx app/components/CollapsibleSection.tsx app/components/DebugPanel.tsx` → no matches.
Run: `grep -rn "color-accent" app/components/DebugPanel.tsx` → no matches.

- [ ] **Step 8: Commit**

```bash
git add app/components/SettingsDialog.tsx app/components/ShortcutsHelp.tsx app/components/UpdateModal.tsx app/components/HiddenStationsSettings.tsx app/components/HiddenStationsDialog.tsx app/components/RegionPicker.tsx app/components/CollapsibleSection.tsx app/components/DebugPanel.tsx
git commit -m "style(brand): recolor all dialogs to brand accents"
```

---

## Task 7: Remove legacy tokens, update doc, full verification

**Files:** Modify `app/globals.css` (`:root`), `docs/DESIGN_SYSTEM.md`

- [ ] **Step 1: Confirm nothing references the legacy tokens**

Run: `grep -rn "var(--color-warm)\|var(--color-accent)" app`
Expected: **no matches.** If anything remains, STOP and fix that surface with the R-rules before continuing — do not remove the tokens.

- [ ] **Step 2: Remove the legacy tokens from `globals.css`**

In the `:root` block of `app/globals.css`, delete these three lines:
```css
  --color-accent: #c0392b;
  --color-accent-2: #7a1f15;
  --color-warm: #d2691e;
```
(Keep `--color-danger: #c0392b;` and all neutrals and brand tokens.)

- [ ] **Step 3: Update the design-system doc**

In `docs/DESIGN_SYSTEM.md`, replace the "### Legacy (being phased out)" subsection (the paragraph about `--color-warm`/`--color-accent` remaining defined) with:

```markdown
### Legacy (removed)

The terracotta `--color-warm` and `--color-accent` / `--color-accent-2` tokens
have been fully removed — every surface now uses the brand tokens. Destructive
and error states use `--color-danger`.
```

Also update the intro line under the title — change the sentence that says the system is "adopted incrementally … other components still use the legacy terracotta accents until their turn comes" to state the rollout is complete and all surfaces use the brand tokens.

- [ ] **Step 4: Full verification**

Run: `npm run lint` → 0 errors (2 pre-existing `<img>` warnings OK).
Run: `npx vitest run` → all tests pass (regression safety).
Run: `grep -rnE "color-warm|color-accent" app` → no matches anywhere (token fully gone; `--color-danger` is what remains for danger).
Run: `grep -rnE "210, ?105, ?30" app` → no matches.

- [ ] **Step 5: Visual sweep in the dev preview**

Ensure the dev server is running (`preview_start` "radio", port 3000; the worktree must have a real `node_modules` — if `next dev` errors with a Turbopack "can't find next" message, run `rm -f node_modules && npm install --ignore-scripts` in the worktree first). Then screenshot and confirm brand colors (no terracotta) on:
- Sidebar (section labels purple, ★ purple, row hover purple-tint).
- Now-playing (label purple, cover glow purple, refresh control pink hover, favorite ★ purple).
- Player (AUTO-PLAY ON purple, volume accent pink).
- Command palette (⌘K) — group labels purple, toggles purple.
- Settings dialog — label purple, toggles purple, buttons (text purple / hover pink).
- Tracking panel — label purple, "● Playing" purple, stop-tracking hover red.

Capture at least sidebar + now-playing + one dialog as proof.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css docs/DESIGN_SYSTEM.md
git commit -m "refactor(brand): remove legacy terracotta tokens; mark rollout complete"
```

---

## Self-review notes (for the executor)

- **Color roles:** purple = labels + status + the favorite/track toggles; pink = interactive (hovers, focus rings, active borders, form accents); gradient (`.bg-brand`) only for primary CTAs (UpdateModal) and the (already-gradient) wordmark; `--color-danger` only for destructive/error.
- **Intentionally untouched:** `app/lib/colors.ts` station-logo palette (incl. its `#d2691e` pair), the Shazam badge blue `#0088ff`, and the danger-red `rgba(192,57,43,…)` literals in NowPlaying's error box and TrackingPanel's stop-tracking hover bg.
- **No tests:** styling only; verification is lint + grep-cleanliness + preview screenshots.
