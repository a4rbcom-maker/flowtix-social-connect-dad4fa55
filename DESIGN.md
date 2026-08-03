---
name: FlowTix Tools
description: Enterprise SaaS for Facebook data extraction, automation, and WhatsApp orchestration — Arabic-first, RTL-aware, calm and trustworthy.
colors:
  primary: "#6d5efc"
  primary-soft: "#8b7dff"
  primary-strong: "#5447e6"
  secondary: "#22d3ee"
  secondary-soft: "#67e8f9"
  success: "#10b981"
  warning: "#f59e0b"
  error: "#f43f5e"
  info: "#38bdf8"
  bg-light: "#f7f7fb"
  bg-elevated-light: "#ffffff"
  surface-light: "#ffffff"
  surface-2-light: "#f3f3f8"
  surface-3-light: "#eaeaef"
  border-light: "#e6e6ee"
  border-strong-light: "#d4d4df"
  fg-light: "#0b0b14"
  fg-muted-light: "#4b4b5e"
  fg-subtle-light: "#8a8a9c"
  bg-dark: "#07070b"
  bg-elevated-dark: "#0c0c14"
  surface-dark: "#111119"
  surface-2-dark: "#15151f"
  surface-3-dark: "#1b1b27"
  border-dark: "#1f1f2e"
  border-strong-dark: "#2a2a3d"
  fg-dark: "#f4f4f7"
  fg-muted-dark: "#a1a1b5"
  fg-subtle-dark: "#6b6b80"
typography:
  display:
    fontFamily: "Inter, Cairo, ui-sans-serif, system-ui, sans-serif"
    fontWeight: "700"
    letterSpacing: "-0.02em"
    lineHeight: "1.1"
  body:
    fontFamily: "Inter, Cairo, ui-sans-serif, system-ui, sans-serif"
    fontWeight: "400"
    lineHeight: "1.55"
  label:
    fontFamily: "Inter, Cairo, ui-sans-serif, system-ui, sans-serif"
    fontWeight: "600"
    letterSpacing: "0.01em"
  arabic:
    fontFamily: "Cairo, Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: "400"
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
spacing:
  page-pad-x: "clamp(16px, 4vw, 40px)"
  page-max: "80rem"
components:
  button-primary:
    backgroundColor: "linear-gradient(120deg, var(--color-primary-strong), var(--color-primary) 55%, var(--color-secondary))"
    textColor: "#ffffff"
    rounded: "var(--radius-md)"
    padding: "12px 20px"
    typography: "Inter 14px 600"
    shadow: "0 8px 24px -8px rgba(109,94,252,0.6)"
  button-secondary:
    backgroundColor: "var(--color-surface-2)"
    textColor: "var(--color-fg)"
    rounded: "var(--radius-md)"
    padding: "12px 20px"
    typography: "Inter 14px 600"
    borderColor: "var(--color-border-strong)"
  button-ghost:
    textColor: "var(--color-fg-muted)"
    rounded: "var(--radius-md)"
    padding: "12px 16px"
  card-default:
    backgroundColor: "var(--color-surface)"
    rounded: "16px"
    padding: "24px"
    borderColor: "var(--color-border)"
    shadow: "var(--shadow-sm)"
  card-elevated:
    backgroundColor: "var(--color-surface)"
    rounded: "16px"
    padding: "24px"
    borderColor: "var(--color-border)"
    shadow: "var(--shadow-md)"
  badge-default:
    backgroundColor: "color-mix(in oklab, var(--color-surface-2) 70%, transparent)"
    textColor: "var(--color-fg)"
    rounded: "9999px"
    padding: "4px 10px"
    typography: "Inter 12px 600"
---

# Design System: FlowTix Tools

## Overview

**Creative North Star: "The Operating Console"**

FlowTix is a working surface, not a showcase. Users open it to do work — connect a Facebook page, extract a list of contacts, launch a WhatsApp campaign — and then close it. The design earns trust by being calm, fast, and ruthlessly clear. It does not flirt, does not decorate, and does not perform expertise. Color and motion appear only where they carry information: a status badge that turns green when a job completes, a soft gradient on the primary button so the user knows which action is theirs, a subtle radial glow on a hero card so the page entry point feels intentional.

The interface is Arabic-first and right-to-left by default. Inter handles Latin text; Cairo handles Arabic. Both share the same typographic system and the same color tokens, so the surface reads identically regardless of locale. The interface was built first in Arabic; English is a faithful mirror, not the source.

Density is comfortable, not compact. The platform handles multi-step workflows that can take minutes — the screen never has to fight the user for space. Surfaces are flat at rest; depth arrives only as a response to state (hover, focus, running). Shadows are cool and short. Gradients are reserved for the primary action and for the hero gradient — never for decoration.

**Key Characteristics:**
- **Calm authority.** Color and motion are rationed, never wallpaper.
- **Bilingual identity.** Arabic and Latin share a single typographic system.
- **Status-forward.** Extraction progress, broadcast results, and connection health are the most visible things on the screen at all times.
- **Workflow-shaped.** Cards, modals, and toasts are sized to the operation, not to the chrome.
- **Quiet at rest.** No idle animations, no parallax, no gradient borders on inactive elements.

## Colors

The palette is a small set of brand accents over a near-neutral canvas. The brand accent is a deep violet that reads as professional without feeling cold; the secondary cyan carries the only "freshness" cue the system ever uses. Status colors are saturated and unambiguous — success is green, error is rose, warning is amber, info is sky — and they are reserved for status, never used for decoration.

### Primary
- **Brand Violet** (`#6d5efc`): The principal interactive color. Used for primary buttons, focus rings, active tab indicators, and the live progress gradient. Pairs with white text on solid fills.
- **Brand Violet Soft** (`#8b7dff`): Hover and secondary emphasis. Used for link text and subtle gradient stops.
- **Brand Violet Strong** (`#5447e6`): Gradient start and active-pressed state. Used at the left end of the gradient ramp.

### Secondary
- **Accent Cyan** (`#22d3ee`): The freshness accent. Used in the brand gradient midpoint, live progress indicators, and the messenger theme badge. Never used alone.
- **Accent Cyan Soft** (`#67e8f9`): Hover stop in the gradient. Subtle, mostly read as "live."

### Tertiary
- None. The system does not have a third hue — discipline over expressiveness.

### Status (reserved for status only)
- **Success** (`#10b981`): "Done", "Extracted", "Live." Always on a white-tinted background, never on the brand gradient.
- **Warning** (`#f59e0b`): "Queued", "Limited", "Disconnected." Always carries a label.
- **Error** (`#f43f5e``): "Failed", "Session expired." Carries a stop reason in plain language.
- **Info** (`#38bdf8`): Used sparingly for neutral "FYI" badges (e.g. paused).

### Neutral (light theme)
- **Background** (`#f7f7fb`): The page canvas. Cool, slightly violet-tinted off-white.
- **Background Elevated** (`#ffffff`): Cards, modals, and popovers that need to sit above the canvas.
- **Surface** (`#ffffff`): Same as elevated; semantic alias.
- **Surface 2** (`#f3f3f8`): Secondary surface tone — tab bars, hover rows, skeleton shimmers.
- **Surface 3** (`#eaeaef`): Tertiary surface tone — pressed states, dividers.
- **Border** (`#e6e6ee`): Hairline divider between regions.
- **Border Strong** (`#d4d4df`): Card edges, control borders, hovered dividers.
- **Foreground** (`#0b0b14`): Body and headline text. Near-black with a hint of indigo.
- **Foreground Muted** (`#4b4b5e`): Secondary text, captions.
- **Foreground Subtle** (`#8a8a9c`): Tertiary text, placeholders, disabled text.

### Neutral (dark theme)
- **Background** (`#07070b`): Deep, near-pure black with violet undertone.
- **Background Elevated** (`#0c0c14`): Cards and popovers.
- **Surface** (`#111119`): Semantic alias for elevated.
- **Surface 2** (`#15151f`): Hover rows, tab bars.
- **Surface 3** (`#1b1b27`): Pressed states.
- **Border** (`#1f1f2e`): Hairline divider.
- **Border Strong** (`#2a2a3d`): Card edges, control borders.
- **Foreground** (`#f4f4f7`): Body and headline text on dark.
- **Foreground Muted** (`#a1a1b5`): Secondary text.
- **Foreground Subtle** (`#6b6b80`): Tertiary text.

### Named Rules

**The One Voice Rule.** The brand violet appears on ≤10% of any given screen. Its rarity is the point. If the dashboard feels "purple," the design has lost.

**The Status Carve-Out.** Green, amber, rose, and sky are reserved exclusively for status. Never decorate a hero with success green, never highlight a CTA with error rose. Status colors earn their visual weight only when they carry truthful information.

**The Neutral-First Rule.** Every surface in the system is built from neutrals first. Brand and status accents are applied last and only where they earn attention. The "calm canvas" is the dominant reading.

## Typography

**Display & Body Font:** Inter (with fallback to Cairo for Arabic, then system-ui).
**Arabic Font:** Cairo (with fallback to Inter, then system-ui).
**Label Font:** Inter (or Cairo in RTL contexts), semibold, slight tracking.

**Character:** The pairing is deliberately utilitarian. Inter provides the clean Latin baseline, Cairo provides a warm Arabic counterpart that holds its own at body sizes. Display weights lean bold; body weights stay at regular. Letter-spacing is tightened on headings (`-0.02em`) for a confident read at large sizes; labels get a hairline of tracking (`0.01em`) for legibility at small caps.

### Hierarchy
- **Display** (`700`, `clamp(2rem, 5vw, 3rem)`, `line-height 1.1`): Used for hero section titles and the largest single headline on any given page.
- **Headline** (`700`, `1.5–1.875rem`, `line-height 1.2`): Page titles, dialog headers, prominent section headings.
- **Title** (`700`, `1.125–1.25rem`, `line-height 1.35`): Card titles, list group headings, modal titles.
- **Body** (`400`, `0.875–1rem`, `line-height 1.55`): All long-form text. Maximum line length 65–75ch where space allows.
- **Label** (`600`, `0.75–0.875rem`, `letter-spacing 0.01em`): Button text, badges, form labels, table headers.

### Named Rules

**The Display Discipline.** Display type appears at most once per viewport. If the dashboard has two display-sized headings, the design is loud and needs to be reined in.

**The Label Tracking Rule.** Every label uses `letter-spacing: 0.01em` and `font-weight: 600`. Lighter weights at small sizes feel apologetic.

**The Bilingual Mirror Rule.** Arabic and English share the same type scale, weights, and letter-spacing. The only difference is the font family. Never tune Arabic typography in isolation from the Latin pairing.

## Layout

The layout uses an 80rem (1280px) max-width container with responsive padding that grows from 16px on mobile to 40px on wide screens (`container-page`). Content is centered with `margin-inline: auto`.

The primary dashboard layout uses a sidebar + main area model on desktop, collapsing to a single column on mobile. Cards within sections are arranged in a responsive grid (1 column on mobile, 2 on tablet, 3–4 on desktop) using Tailwind's grid utilities.

Spacing follows the standard Tailwind scale (4, 8, 12, 16, 24, 32, 48, 64px). The extraction and broadcast pages favor generous vertical rhythm — `space-y-6` between sections — because they present information that the user must read and act on, not scan.

The page entry point (idle state of any extraction flow) is rendered as a hero card with a right-side action panel, not a centered card. This communicates "tool" rather than "wizard."

### Named Rules

**The Container-First Rule.** Page-level content lives inside `.container-page`. Sidebars, modals, and tooltips are exempt; everything else is not.

**The Section Breath Rule.** Sections within a page get at least 24px (`space-y-6`) of vertical breathing room. Tighter stacking signals "tutorial", which is not what this product is.

## Elevation & Depth

The system uses a hybrid of soft shadows and tonal layering. Surfaces are flat by default; depth arrives only as a response to state. Cards at rest have the smallest shadow token (`shadow-xs` or `shadow-sm`); cards on hover lift to `shadow-md` or `shadow-lg`. Modals and popovers use a deeper shadow with a violet glow (`shadow-glow`) to communicate that they sit above everything.

Gradients are reserved for two things: the primary button (a 120° violet-to-cyan ramp that gives the action a distinct identity), and the hero card radial glow that says "this is the entry point." No element uses a gradient for decoration.

Backdrop blur (`glass`, `glass-strong`) is used for floating UI that needs to reveal what is behind it (the hero card action panel, floating banners). The blur amount is conservative (16–20px) and the tint is mixed at 70–85% opacity so the layer behind remains legible.

### Shadow Vocabulary
- **Ambient XS** (`box-shadow: 0 1px 2px rgba(0,0,0,0.05)`): Hairline border-replacement shadow. Used on subtle raised elements that need just enough definition to read.
- **Ambient SM** (`box-shadow: 0 2px 6px rgba(0,0,0,0.06)`): Default card at rest.
- **Ambient MD** (`box-shadow: 0 6px 18px rgba(0,0,0,0.08)`): Elevated card or hovered state.
- **Ambient LG** (`box-shadow: 0 14px 40px rgba(0,0,0,0.1)`): Modal, dropdown, or strongly hovered card.
- **Ambient XL** (`box-shadow: 0 28px 70px rgba(0,0,0,0.12)`): Top-of-stack modal or focused popover.
- **Brand Glow** (`box-shadow: 0 0 0 1px rgba(109,94,252,0.12), 0 8px 30px rgba(109,94,252,0.18)`): Hover glow on brand-related interactive elements (CTA, focused tab). Violet, soft, focused.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, elevation, focus).

**The Glow Carve-Out.** The brand glow is the only shadow that may carry color. Every other shadow is neutral. Colorful shadows are reserved for "this is the primary action right now" signaling.

## Shapes

The system uses a single corner scale: `xs 6px`, `sm 8px`, `md 12px`, `lg 16px`, `xl 20px`, `2xl 24px`, `3xl 32px`. The default component corner is `lg` (16px) — large enough to feel modern, small enough to feel precise. Buttons use `md` (12px); cards use `lg` (16px); pills and badges use full-round (`9999px`).

There are no sharp corners in the system. The smallest radius is 6px; nothing is truly square. This signals "working software" rather than "industrial tool."

Hairline borders (`1px solid var(--color-border)`) are used in addition to shadows for definition at rest. The combination of a hairline border and an `xs` shadow defines the "card at rest" pattern.

## Components

### Buttons

**Character:** Tactile, confident, gradient-led. The primary button is the loudest thing on the page; secondary and ghost buttons recede.

- **Shape:** 12px corner (`var(--radius-md)`), 44px tall by default, 36px small, 48px large.
- **Primary:** Violet-to-cyan gradient (`var(--color-primary-strong) → var(--color-primary) → var(--color-secondary)`), white text, violet glow shadow at rest that intensifies on hover. Active scale: `0.98`.
- **Secondary:** `var(--color-surface-2)` background, `var(--color-fg)` text, `var(--color-border-strong)` border. Hovers to `var(--color-surface-3)`.
- **Outline:** Transparent background, `var(--color-border-strong)` border, hovers to `var(--color-surface-2)`.
- **Ghost:** `var(--color-fg-muted)` text, hovers to `var(--color-fg)` + `var(--color-surface-2)` background.
- **Success / Danger:** Saturated background (`var(--color-success)` / `var(--color-error)`), white text. Used only for destructive or completion confirmations.
- **Loading state:** Loader2 spinner replaces the leading icon; button stays at its label width.

### Cards

**Character:** Calm, neutral, content-shaped. Cards are containers, not statements.

- **Shape:** 16px corner (`var(--radius-lg)`), `var(--color-surface)` background, `var(--color-border)` hairline border, `var(--shadow-sm)` at rest.
- **Variants:** `default` (rest), `elevated` (deeper shadow), `glass` (frosted), `gradient` (subtle brand-tinted overlay), `flat` (borderless, surface-2 background).
- **Hover behaviors:** `lift` (translate -2px, deeper shadow, stronger border), `glow` (brand glow + stronger border), `border` (brand-colored border only).
- **Internal padding:** 24px default. Cards used as compact list rows reduce to 16px vertical, 20px horizontal.

### Badges

**Character:** Small, informative, color-coded for status.

- **Shape:** Full-round (`9999px`), 4–10px vertical padding, 12px horizontal padding.
- **Variants:** `default`, `primary`, `success`, `warning`, `error`, `outline`. The color comes from `color-mix` against `surface-2` at 14% opacity for the fill, plus the status color at full strength for text.
- **Status badges are the only place the status colors appear in the UI.** A green badge means "running" or "completed"; an amber badge means "queued" or "limited."

### Inputs

**Character:** Quiet at rest, clear when focused. Inputs defer to the user's content.

- **Shape:** `var(--radius-md)` (12px), 1px `var(--color-border)` border, `var(--color-surface)` background.
- **Focus:** 2px `var(--color-ring)` ring with 2px offset. No shadow.
- **Error:** Border shifts to `var(--color-error)`; supporting text below in same color.
- **Disabled:** `var(--color-fg-subtle)` text; background unchanged.

### Navigation

- **Sidebar:** Fixed-width, `var(--color-surface-2)` background, 1px right border, `var(--color-fg)` text with `var(--color-fg-muted)` for inactive items.
- **Top bar:** Transparent over the page background, sticky, with a subtle backdrop blur.
- **Active route:** `var(--color-primary)` text + left-aligned violet bar (3px wide).
- **Hover:** `var(--color-surface-3)` background with text color shift to `var(--color-fg)`.

### Skeleton (loading state)

- **Shape:** Full round, `var(--color-surface-2)` to `var(--color-surface-3)` linear gradient.
- **Animation:** Shimmer (background-position sweep) over 2 seconds, linear, infinite.
- **Usage:** Only during fetch-induced loading. Skeletons are never used for placeholder or empty-state UI — those use the proper empty-state component.

## Do's and Don'ts

### Do
- **Do** use the brand gradient only on primary actions and the hero card radial glow. Nowhere else.
- **Do** give every status indicator a real label. "running", "completed", "failed", "queued", "disconnected" — not just a color.
- **Do** make errors self-explanatory. Every error message must answer "what stopped, why, and what now?" in one or two lines of plain language.
- **Do** give every long-running operation a visible progress signal and a clearly logged stop reason.
- **Do** treat Arabic as the source language. English is a faithful mirror. Never translate a label that was written only in English.

### Don't
- **Don't** use shadow on a static element that has no state. Flat surfaces stay flat.
- **Don't** use status colors (green/amber/rose/sky) as decoration. They are status only.
- **Don't** add new colors. The palette is closed. Reach for typography or spacing first when something needs emphasis.
- **Don't** use emoji in production UI. The interface is professional, not chat-like.
- **Don't** make the interface react on hover with motion the user can't predict. State changes are visible; surprise animations are not.
- **Don't** ship a feature without a failure state, an empty state, and a stop-reason log entry.
