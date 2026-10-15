# Chaptr — Design System

## Point of view

Chaptr looks like a **reading room at night**, not a SaaS dashboard. Manga is read
in dim light, panel by panel, ink on paper. The UI borrows that: near-black
backgrounds, high-contrast type, a single accent color used sparingly (like a
splash of red ink on a page), and halftone-dot texture as the one decorative motif
— a direct nod to print manga screentone, not a generic gradient or blob.

Avoid: purple-to-blue gradients, glassmorphism, generic rounded-everything cards,
emoji as icons, stock "friendly SaaS" illustrations. If a screen could be mistaken
for a generic AI-generated dashboard template, it's wrong.

## Color

| Token | Hex | Use |
|---|---|---|
| `--ink-950` | `#0B0B0D` | App background |
| `--ink-900` | `#141416` | Card/surface background |
| `--ink-700` | `#2A2A2E` | Borders, dividers |
| `--paper-50` | `#F5F3EE` | Primary text (warm off-white, not pure `#FFF` — reads like paper, not a screen) |
| `--paper-400` | `#9B968C` | Secondary/muted text |
| `--accent-red` | `#E8432E` | Single accent: unread indicators, primary CTA, active states |
| `--accent-red-dim` | `#8C2A1D` | Accent hover/pressed |
| `--status-reading` | `#4A9B7F` | Reading status tag |
| `--status-hold` | `#C9A94B` | On-hold status tag |
| `--status-done` | `#5B6FA8` | Completed status tag |

Rule: **one accent color total.** Status tags are muted, not saturated — they're
metadata, not decoration. The red is reserved for "this needs your attention"
(new chapter, primary action) so it never loses meaning by overuse.

## Typography

- **Display/headings**: `Zodiak` or `Fraunces` (serif with character) — gives
  editorial weight to series titles and dashboard headers, avoids the generic
  Inter-everywhere look.
- **Body/UI**: `Inter` — for legibility in dense list/table UI (chapter numbers,
  metadata). Contrast between serif headers and grotesque body is intentional.
- Scale: `12 / 14 / 16 / 20 / 28 / 40` px. No arbitrary in-between sizes.
- Line height: 1.5 for body, 1.1 for display type.

## Spacing

4px base unit: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Never hand-pick an
off-scale value — if the scale doesn't fit, the layout is wrong, not the scale.

## Texture: the one decoration

A subtle halftone dot pattern (low-opacity radial dots, `--ink-700` at ~8%
opacity) is allowed as a background texture on empty states and section dividers
only. Never on interactive elements, never as a full-page background — it's
seasoning, not the meal.

## Components

- **Cards**: sharp-ish corners (`4px` radius, not `16px` pill-everything),
  1px `--ink-700` border, no drop shadows — flat, like a printed page, not a
  floating glass panel.
- **Buttons**: solid fill for primary (accent red), outline for secondary, text-only
  for tertiary. No gradient fills, ever.
- **Status tags**: small, muted-color pill with a dot, not a loud colored badge.
- **New-chapter indicator**: a small red dot + count, positioned like a
  notification badge — this is the one place saturation and motion are allowed
  to draw the eye.

## Motion (Framer Motion)

Motion should feel like **turning a page**, not "modern app bounce."
- Page/section transitions: horizontal slide + fade, 250-300ms, `ease-out` —
  evokes a page turn, not a spring-bounce.
- List items (library grid): stagger-fade on mount, 40ms stagger, no scale-pop.
- Never use spring physics with visible overshoot/bounce — it reads as playful-app,
  not reading-app.
- Respect `prefers-reduced-motion` — disable slide/stagger, keep opacity-only fades.

## Scroll (Lenis)

Smooth scroll should be subtle — default Lenis easing, no exaggerated lerp values.
The goal is removing scroll jank, not adding a "scroll experience." If a user
notices the smooth scroll as a feature, the value is too high; tune it down.

## Voice

Direct, low-hype. "3 series updated" not "🎉 Awesome news! 3 of your series just
dropped new chapters!" No emoji in UI copy. Manga readers are not a demographic
that needs to be sold enthusiasm — the content is the enthusiasm.
