# CartHold Design System: "Night Escrow"

## Direction

**Night Escrow.** A vault ledger read under a desk lamp. The page is graphite ink with a faint green cast, figures are set like a bank statement, and one warm color owns the brand: **amber, the color of money that is held but not taken.** Every other color is a verdict (paid green, blocked coral) and appears only when a decision has been made.

The one thing a viewer should remember: *the money stopped and waited for a human.* Amber is that pause. It breathes while a hold is open and goes still the moment someone approves or rejects.

### Rationale

- **Amber, not purple, not neon.** Payment and security tools default to blue or violet. CartHold's whole story is the authorization hold, so the hold state becomes the brand color. It is also legible as "caution" without reading a word.
- **Ledger, not dashboard.** The product proves itself with ids, amounts and timestamps. Mono figures with tabular numerals, hairline rules and right-aligned money make the evidence look like evidence.
- **Glow is a state, not decoration.** A soft amber glow means "funds held right now". A green flash means "captured". Nothing glows for fun, so when something glows, judges look at it.
- **Dark by scene.** The demo is watched as a screen recording of an agent spending money, often full screen. Dark keeps the verdict colors loud. A light theme exists (`data-theme="light"` on `<html>`) for print and screenshots.

## Color tokens

Defined as CSS variables in `src/app/globals.css` and exposed to Tailwind as `bg-*`, `text-*`, `border-*` (for example `bg-surface-2`, `text-hold`, `border-line`).

| Token | Dark | Light | Use |
|---|---|---|---|
| `canvas` | `#0B0D0C` | `#F4F3EE` | page background |
| `surface-1` | `#111412` | `#FFFFFF` | panels |
| `surface-2` | `#171B19` | `#F8F7F3` | inner cores, inputs |
| `surface-3` | `#1F2421` | `#EEEDE6` | hover, selected rows |
| `line` | `rgb(232 236 226 / 0.08)` | `rgb(20 23 19 / 0.10)` | hairlines |
| `line-strong` | `rgb(232 236 226 / 0.16)` | `rgb(20 23 19 / 0.18)` | focused edges, dividers that matter |
| `ink` | `#ECEEE6` | `#141713` | primary text (16.9:1) |
| `ink-muted` | `#A3A99E` | `#4E554C` | secondary text (8.1:1) |
| `ink-faint` | `#7E857A` | `#6C7369` | metadata, timestamps (4.9:1, large or non-essential only) |
| `hold` | `#F2B33D` | `#9A5F00` | brand, held funds, primary CTA |
| `hold-ink` | `#1A1203` | `#FFFFFF` | text on solid hold |
| `paid` | `#5BD69A` | `#13774A` | allow, captured |
| `paid-ink` | `#04170D` | `#FFFFFF` | text on solid paid |
| `blocked` | `#FF6B5E` | `#C2281B` | refused, injected text, reject |
| `blocked-ink` | `#1F0503` | `#FFFFFF` | text on solid blocked |
| `warning` | `#E3CF6A` | `#7A6400` | flagged page the order did not follow |
| `info` | `#7CC4E6` | `#1F6A8F` | agent and system lines in traces, links |
| `neutral` | `#8C948A` | `#5F665D` | voided, unknown |

Each semantic hue also has a `-soft` variant (12% alpha in dark, 10% in light) for tinted backgrounds: `bg-hold-soft`, `bg-paid-soft`, `bg-blocked-soft`, `bg-warning-soft`, `bg-info-soft`.

Status mapping (used by `StatusPill`):

| Status | Color | Meaning |
|---|---|---|
| `allow` | paid, soft fill | policy passed, under auto-pay limit |
| `hold` | hold, soft fill, breathing dot | PayPal authorization open, waiting for a human |
| `block` | blocked, soft fill | refused, no PayPal order |
| `captured` | paid, solid fill | money moved |
| `voided` | neutral, struck label | authorization released |
| `unknown` | neutral, dashed outline | not decided yet or missing data |

Never encode a status by color alone: every pill carries an icon and a word.

## Typography

All faces load through `next/font/google`, which downloads at build time and self-hosts the files (no runtime request to Google).

| Role | Face | Variable | Why |
|---|---|---|---|
| Display | **Bricolage Grotesque** (variable, opsz) | `--font-display` / `font-display` | A grotesk with ink traps and a slightly hand-cut feel at large optical sizes. Distinct from the Inter/Geist default without being a costume. |
| Body / UI | **Instrument Sans** | `--font-sans` / `font-sans` | Narrow-ish, calm, very readable at 14-16px on an operate surface. Body only, never display. |
| Figures / ids | **JetBrains Mono** | `--font-mono` / `font-mono` | Money, PayPal ids, timestamps, trace lines. Always `tabular-nums`. |

Scale (rem, about 1.25 ratio, display steps wider):

| Token | Size / line | Use |
|---|---|---|
| `text-2xs` | 0.6875 / 1rem | pill labels, micro meta |
| `text-xs` | 0.75 / 1.1rem | timestamps, captions |
| `text-sm` | 0.875 / 1.35rem | UI, table cells |
| `text-base` | 1 / 1.6rem | body |
| `text-lg` | 1.125 / 1.6rem | lead paragraphs |
| `text-xl` | 1.375 / 1.4 | panel titles (display) |
| `text-2xl` | 1.75 / 1.25 | section titles (display) |
| `text-3xl` | 2.5 / 1.1 | page titles (display) |
| `text-4xl` | 3.5 / 1.02 | landing hero (display) |
| `text-money` | 3rem / 1, mono | the held amount |

Rules: headings use `font-display` with `tracking-tight`; the hero never exceeds `text-4xl` on desktop. Emphasis is weight, never gradient text. Money is always mono, right-aligned in tables, with the currency sign at 60% opacity.

## Space, radius, depth

- **Spacing:** Tailwind's 4px base. Section rhythm `py-20 md:py-28`; panel padding `p-5 md:p-6`; stack gaps 8 / 12 / 16 / 24.
- **Radius:** `--radius-xs` 6px (kbd, tiny chips), `--radius-sm` 10px (inputs, buttons sm), `--radius-md` 14px (inner cores), `--radius-lg` 20px (panel shells), `--radius-pill` 999px (pills, primary buttons). Inner radius = outer radius minus shell padding, so curves stay concentric.
- **Shadows** (offset, soft, never a hard dark drop):
  - `shadow-raise`: `0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px -16px rgb(0 0 0 / 0.6)`
  - `shadow-float`: `0 24px 60px -24px rgb(0 0 0 / 0.7)` (dialogs)
- **Glow** (state only): `glow-hold`, `glow-paid`, `glow-blocked` utilities. Offset downward, wide blur, low alpha. Applied to the element whose state it describes, never to the page.
- **Textures:** `bg-grid` (ledger grid, 32px, 4% line) for hero and the flow diagram only; `noise` (fixed, pointer-events-none overlay, 3.5% opacity) once per page at most.
- **Glass:** `glass` utility for sticky/fixed layers only (nav, dialog). Scrolling content never blurs.
- **Gradient border:** `edge-hold` puts a 1px amber-to-transparent border on a bezel shell for the single most important panel on a screen (the open hold).

## Motion

Library: `motion` (`motion/react`). CSS transitions for hover and press. Every animation uses transform and opacity only.

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 140ms | hover, press |
| `--duration-base` | 240ms | pill and state swaps |
| `--duration-slow` | 480ms | reveals, verdict |
| `--duration-slower` | 900ms | flow diagram packet, number tickers |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | entrances (out-expo) |
| `--ease-snap` | `cubic-bezier(0.32, 0.72, 0, 1)` | state changes, buttons |
| `--ease-in` | `cubic-bezier(0.5, 0, 0.75, 0)` | exits |

What moves and why:

1. **Money held pulse.** An open hold breathes: a ring scales 1 to 1.9 and fades, 2.4s loop. It says "this is live and waiting on you". It stops the instant the hold resolves. Reduced motion: a static ring.
2. **Verdict reveal.** A decision lands like a stamp: scale 1.06 to 1, opacity 0 to 1, 480ms snap, with a single glow flash in the verdict color. It marks the moment the guard decided. Reduced motion: a 120ms fade.
3. **Trace stream-in.** Each trace line enters 8px below with opacity 0, 320ms out-expo, staggered 50ms per item. Reads like a log being written in real time. Reduced motion: instant.
4. **Number tickers.** Amounts spring from the previous value (stiffness 140, damping 24), so a judge sees money accumulate or drop. Screen readers get the final value only.
5. **Flow packet.** In `FlowDiagram`, a dot travels Agent to CartHold to PayPal hold, then branches to Approve or Reject. The active node lights up. It teaches the product in four seconds.
6. **Section reveal.** Content fades up 16px with a 4px blur clearing, once, on entering the viewport.

Rules: nothing loops except the hold pulse and the landing flow packet. No `linear` easing except progress. `prefers-reduced-motion: reduce` is honored in every primitive via `useReducedMotion` and in CSS via a global override.

## Iconography

`lucide-react`, `strokeWidth={1.5}`, sized 16 (inline) / 20 (buttons) / 24 (diagram). Icons sit beside labels, never in a colored tile above a heading. Fixed vocabulary:

| Concept | Icon |
|---|---|
| agent | `Bot` |
| CartHold guard | `ShieldCheck` |
| hold | `Hourglass` |
| captured / approve | `CircleCheck` / `Check` |
| block / reject | `Ban` / `X` |
| voided | `CircleSlash` |
| warning / injected text | `TriangleAlert` / `ScanEye` |
| unknown | `CircleDashed` |
| PayPal | `CreditCard` (no brand marks) |

## Layout

- Content max width 1200px (`max-w-6xl`), 16px gutters on mobile, 24px from `md`.
- 12-column grid from `lg`. The demo screen splits 7 / 5: trace and decision log left, the hold panel right and sticky. Below `lg` everything stacks in reading order: request, verdict, hold, trace.
- Landing: an asymmetric hero (copy 7 columns, `FlowDiagram` 5 columns on a `bg-grid` field), then numbered steps (01 to 04) as a vertical ledger, not a three-card grid.
- One bezel panel per region. Never put a panel inside a panel; inside a panel, separate groups with `border-line` rules.

## Components (`src/components/ui`)

Import from `@/components/ui`.

- **Button** `variant: primary | approve | reject | ghost | subtle`, `size: sm | md | lg`, `icon` (trailing icon in its own nested circle, which nudges up-right on hover), `loading`. Primary is solid amber pill. Press scales to 0.98. Focus: 2px `hold` outline, 2px offset. `buttonClasses()` styles a `Link` the same way.
- **StatusPill** `status: allow | hold | block | captured | voided | unknown`, optional `label`, `size`. Icon plus word, hold dot breathes.
- **Badge** `tone: neutral | hold | paid | blocked | warning | info`. Static metadata chip (store name, "Simulated", "Live").
- **Panel** double-bezel: an outer shell (hairline, 6px padding, `radius-lg`) around an inner core (`surface-1`, inset highlight, `radius-md`). Props `tone` (adds the state glow and tinted edge), `as`, `padded`. `PanelHeader` gives title, description and an action slot.
- **AnimatedNumber** `value`, `format: currency | integer`, `currency`. Spring ticker, mono, tabular.
- **Reveal** `delay`, `y`, `as`, `inView`. Fade and slide in once.
- **StreamItem** `tone`, `time`, `title`, `index`, children. One trace line with a tone rail dot; parent is an `<ol>`.
- **Kbd** keyboard key.
- **SectionHeader** `index` (for example "01"), `title`, `description`, `action`, `as`.
- **FlowDiagram** `step: agent | carthold | hold | approve | reject | null`, `autoplay`, `outcome`. Horizontal SVG from `md`, vertical below. Labeled with `role="img"` and a text description.

### States every page must design

Empty (honest copy plus the next action), loading (skeleton rows using `surface-2` with a slow opacity shimmer, off under reduced motion), error (blocked tone panel with the real error text), long content (ids truncate in the middle with full value in `title`).

### Accessibility

Text contrast at least 4.5:1 for body, 3:1 for large text and UI edges in both themes. Visible focus ring on every interactive element (`focus-visible:outline-hold`). Status never by color alone. Motion off under `prefers-reduced-motion`. Hit targets at least 40px tall for primary actions.
