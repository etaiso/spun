# Spun Design System

The single source of truth for Spun's look and feel. Every feature should pull
from these tokens and patterns rather than inventing one-off colors or styles.

The system is **adopted incrementally** — components migrate to it feature by
feature. The Saved Songs surfaces are the first adopter; other components still
use the legacy terracotta accents until their turn comes.

---

## 1. Brand identity

Spun's identity is the **logo gradient**: a 135° sweep from indigo through
purple to pink, taken directly from `docs/spun-logo.svg`.

```
indigo  #6366F1  →  purple  #A855F7  →  pink  #EC4899
```

The gradient is the brand. Use it **sparingly**, for moments that should feel
like Spun itself — never as wallpaper.

---

## 2. Color tokens

Defined in `app/globals.css` under `:root`.

### Neutrals — the canvas (unchanged)

The warm cream/ink palette is Spun's surface. It is **not** changing.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#fbf7f3` | App background (warm cream) |
| `--color-bg-2` | `#ffffff` | Cards, dialogs, raised surfaces |
| `--color-ink` | `#1a1410` | Primary text |
| `--color-ink-2` | `#4a3f37` | Secondary text |
| `--color-ink-3` | `#8a7a6e` | Muted text, meta |
| `--color-ink-4` | `#b8a99a` | Faint text, icons, placeholders |
| `--color-line` | `#ece2d8` | Borders, dividers |

### Brand — the accent identity

| Token | Value | Use |
|---|---|---|
| `--grad-brand` | `linear-gradient(135deg, #6366F1, #A855F7, #EC4899)` | Brand moments & primary actions only |
| `--color-brand-indigo` | `#6366F1` | Gradient start; rarely used solo |
| `--color-brand-purple` | `#A855F7` | Secondary accent — play controls, hovers |
| `--color-brand-pink` | `#EC4899` | **Primary interactive accent** — icons, hearts, active text, focus rings |
| `--color-danger` | `#c0392b` | Destructive & error states only |

### Legacy (being phased out)

`--color-warm` (`#d2691e`) and `--color-accent` (`#c0392b`) remain defined so
un-migrated components keep working. **Do not use them in new or migrated
surfaces** — reach for the brand tokens instead. (`--color-danger` carries the
old `--color-accent` red forward under a name that says what it's for.)

---

## 3. Usage rules

**The gradient (`--grad-brand`) — reserved.** Use only for:
- Brand-identity text (the `spun` wordmark, a feature's gradient title)
- Primary actions / primary CTA fills
- The active/"on" state of a selected control (active filter pill, "Saved" state)

**Solid brand colors — everyday accents.** Use `--color-brand-pink` (primary)
or `--color-brand-purple` (secondary) for:
- Icons, hearts, small glyphs
- Hover and focus states, focus rings
- Borders that need to signal "active" without a full fill

**Red is danger, not accent.** `--color-danger` is only for delete/remove and
error states. A delete control never uses brand colors.

**Don't:**
- Don't stack gradients — one gradient element per visual cluster.
- Don't put gradient *fills* behind body text (legibility).
- Don't recolor neutrals; the cream/ink canvas stays warm.

---

## 4. Gradient text

Gradient *text* is achieved with `background-clip: text` over `--grad-brand`,
which makes the text's own `color` transparent. Because the glyphs then have no
intrinsic color, **always set a solid fallback color first** (e.g.
`--color-brand-pink`) so the text is readable if `background-clip` is
unsupported or the gradient fails to paint.

```css
.brand-text {
  color: var(--color-brand-pink);          /* fallback */
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## 5. Typography

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
sans-serif`), prepended with the Twemoji flag font.

| Role | Style |
|---|---|
| Section label | 11px, `letter-spacing: 1.4–1.6px`, uppercase, `font-weight: 800` |
| Display title | `clamp(28px, 5vw, 42px)`, `font-weight: 800`, tight tracking |
| Body | 15px, `--color-ink` / `--color-ink-2` |
| Meta / caption | 11–13px, `--color-ink-3` |

A **section label** may be a brand moment (gradient text) or an everyday label
(solid `--color-brand-pink`/`--color-brand-purple`), per the usage rules.

---

## 6. Component patterns

Shapes are pill-first and soft: pills are fully rounded (`border-radius: 999px`),
cards/dialogs use `rounded-2xl` (~16px).

**Primary button / CTA** — `--grad-brand` fill, white text, pill.

**Secondary button** — white fill, `--color-line` border, `--color-brand-purple`
text; border brightens to brand on hover.

**Filter pill** — default: white, `--color-line` border, `--color-ink-3` text.
Active: `--grad-brand` fill, white text, no border.

**Save affordance** — off: white, `--color-line` border, `--color-brand-pink`
text, `♡`. Saved: `--grad-brand` fill, white text, `♥`.

**List row** — `py` with a `--color-line` bottom divider (`last:border-none`);
title in `--color-ink`, meta in `--color-ink-3`.

**Dialog** — `--color-bg-2` surface, `rounded-2xl`, soft shadow, on a
`bg-black/30` scrim.

---

## 7. Accessibility

- Body and meta text use the ink scale on cream — keep contrast; never put text
  on a gradient fill.
- Gradient text always has a solid fallback color (§4).
- Interactive elements get a visible focus state using `--color-brand-pink`.
- Respect `prefers-reduced-motion` for any animated brand flourishes.
