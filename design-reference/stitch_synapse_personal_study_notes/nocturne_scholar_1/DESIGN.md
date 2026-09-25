---
name: Nocturne Scholar
colors:
  surface: '#111418'
  surface-dim: '#111418'
  surface-bright: '#36393e'
  surface-container-lowest: '#0b0e12'
  surface-container-low: '#191c20'
  surface-container: '#1d2024'
  surface-container-high: '#272a2e'
  surface-container-highest: '#323539'
  on-surface: '#e1e2e8'
  on-surface-variant: '#c6c5d5'
  inverse-surface: '#e1e2e8'
  inverse-on-surface: '#2e3135'
  outline: '#908f9e'
  outline-variant: '#454653'
  surface-tint: '#bdc2ff'
  primary: '#bdc2ff'
  on-primary: '#131e8c'
  primary-container: '#818cf8'
  on-primary-container: '#101b8a'
  inverse-primary: '#4953bc'
  secondary: '#4ddcc6'
  on-secondary: '#003730'
  secondary-container: '#00b4a0'
  on-secondary-container: '#003f37'
  tertiary: '#7bd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#00a0d7'
  on-tertiary-container: '#003246'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bdc2ff'
  on-primary-fixed: '#000767'
  on-primary-fixed-variant: '#2f3aa3'
  secondary-fixed: '#6ef9e2'
  secondary-fixed-dim: '#4ddcc6'
  on-secondary-fixed: '#00201b'
  on-secondary-fixed-variant: '#005047'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#111418'
  on-background: '#e1e2e8'
  surface-variant: '#323539'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 2.75rem
    fontWeight: '400'
    lineHeight: 3.5rem
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 2rem
    fontWeight: '400'
    lineHeight: 2.625rem
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 2rem
    fontWeight: '400'
    lineHeight: 2.75rem
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 1.625rem
    fontWeight: '400'
    lineHeight: 2.25rem
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 1.5rem
    fontWeight: '500'
    lineHeight: 2.25rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Newsreader
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: 1.875rem
    letterSpacing: 0em
  body-lg:
    fontFamily: Newsreader
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 2rem
    letterSpacing: 0.01em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.65rem
    letterSpacing: 0.005em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.9375rem
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-mobile: 0.875rem
  margin: 2.5rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.75rem
  space-xl: 2.5rem
---

## Brand & Style

This design system crafts a sanctuary for deep thought, contemplative study, and nonlinear synthesis. Designed for students, researchers, and lifelong thinkers, it rejects the aggressive optimization, dashboard clutter, and sensory overstimulation of enterprise software. The experience mirrors the quiet intimacy of late-night study sessions: an open journal bound in dark linen under the soft pool of a desk lamp.

The design philosophy blends **tactile literary minimalism** with **subtle atmospheric depth**:
- **Personal and Reflective:** Every screen offers breathing room, allowing thoughts, quotes, and research notes to rest naturally without competitive visual noise.
- **Atmospheric Quietude:** Interfaces remain low-contrast and dark-adapted, reducing cognitive fatigue during marathon reading and writing sessions.
- **Physical Memory Digitized:** Text rhythms reference classical book design and scholarly paper editions, while interactions rely on hairline separation, delicate luminous highlights, and weightless tactile transitions.

## Colors

The palette is tuned strictly for sustained nocturnal readability, balancing warm parchment highlights against deep, ink-washed surfaces.

- **Foundational Grounds:**
  - Base canvas: `#0f1115` (Deep ink canvas, foundational backdrop).
  - Raised surfaces: `#171a21` (Resting container, side panels, and document base).
  - High-tier cards: `#1c2029` (Active cards, modal dialogs, and popovers).
  - Subtle borders: `rgba(255, 255, 255, 0.07)` or `#262b36` (Hairline separation with zero harsh contrasts).

- **Typography & Glyphs:**
  - Primary text: `#f3f1ec` (Soft parchment white, eliminating harsh glare).
  - Secondary metadata & subtitles: `#9da5b4` (Muted slate stone).
  - Tertiary / placeholding: `#5d6575` (Low-contrast hints, timestamps, and line numbers).

- **Luminous Accents (Used Sparingly):**
  - **Primary (`#818cf8`)**: Soft luminous indigo reserved for active navigation links, bidirectional references (wikilinks), and cursor beacons.
  - **Secondary (`#5eead4`)**: Pale celadon/sage teal for mastery states, completed flashcard intervals, and deliberate text callouts.
  - **Tertiary (`#38bdf8`)**: Dewdrop cyan used for search query highlights and subtle focus halos.

## Typography

The typographic system creates an interplay between editorial literature and contemporary humanist utility:

- **Editorial Longform (`Newsreader`):** Used for titles, article headlines, chapter designations, and reader mode body copy (`body-lg`). The generous x-height, organic stroke modulation, and soft serifs honor physical literature. Line heights sit deliberately wide between 1.65 and 1.8 to encourage reflective, unhurried reading.
- **Interface & Organization (`Plus Jakarta Sans`):** Powers daily workflow controls, folder hierarchies, note titles, side navigation, and metadata panels. Its soft, modern geometry brings clean scannability without feeling sterile or corporate.
- **Index & Technical References (`JetBrains Mono`):** Used strictly for word counters, flashcard intervals, timestamps, shortcuts, and citation anchors. It gives study metadata an authentic archive ledger feel.

## Layout & Spacing

The layout treats screen real estate as quiet, structured study desks:

- **Desktop (1024px+):** A 3-column asymmetric layout with flexible gutters (`1.25rem`) and broad exterior margins (`2.5rem`).
  - *Left Shelf (Collapsible, 260px):* Notebook hierarchies, tags, and collections.
  - *Central Journal Desk (Max 720px):* Centered writing/reading canvas optimized for 65–75 characters per line to safeguard reading rhythm.
  - *Right Reference Rail (Optional, 320px):* Backlinks, study flashcards, and concept graph connections.
- **Tablet (768px – 1023px):** Side panels fold into clean edge-drawers; margins condense to `1.75rem`; central study page retains strict comfortable line widths.
- **Mobile (< 768px):** Single-column focus canvas with bottom ambient toolbar; outer canvas margins compress to `1.25rem` with `0.875rem` internal component gutters. Content flows sequentially with tactile swipe surfaces.

## Elevation & Depth

Visual hierarchy abandons heavy, opaque drop shadows in favor of **tonal surface stacking** paired with **soft ambient glows** and **whisper-thin hairline boundaries**:

- **Ground Level (Canvas):** Pure `#0f1115` matte background. Zero blur, total silence.
- **Layer 1 (Panels & Sidebar):** `#171a21` bounded by a 1px border of `rgba(255, 255, 255, 0.06)`. No shadow.
- **Layer 2 (Note Cards & Concept Nodes):** `#1c2029` with a 1px border of `rgba(255, 255, 255, 0.08)`. Subtle ambient grounding: `box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.45)`.
- **Layer 3 (Modals, Hover Menus & Command Palettes):** `#1c2029` backed by a 12px backdrop-filter blur and subtle perimeter highlight: `box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 40px -8px rgba(0, 0, 0, 0.75)`.
- **Active Focus Glow:** Interactive elements in active or targeted states emit a quiet light halo: `box-shadow: 0 0 16px -2px rgba(129, 140, 248, 0.25)`.

## Shapes

The design system adopts a restrained **Rounded (0.5rem base / 0.75rem - 1rem for cards / 1.5rem for modals)** aesthetic:

- Buttons, inline tags, and input boxes use `0.5rem` to preserve a structured notebook layout.
- Study cards, flashcard tiles, and contextual reference containers adopt `0.75rem` to `1rem` (`rounded-lg`), producing gentle corners reminiscent of rounded notebook book-blocks and deck cards.
- Floating sheets, command bars, and reading panes implement `1rem` to `1.5rem` (`rounded-xl`), creating an inviting, approachable contour that separates elevated layers from structural grids.
- Avatars, status pips, and graph interaction handles remain full circles (`rounded-full`).

## Components

### Buttons
- **Primary:** Background in semi-translucent indigo tint (`rgba(129, 140, 248, 0.15)`), border `1px solid rgba(129, 140, 248, 0.45)`, text `#f3f1ec`. On hover, background shifts to `rgba(129, 140, 248, 0.25)` with an ambient `0 0 12px rgba(129, 140, 248, 0.2)` glow. Never solid neon.
- **Ghost / Quiet:** Transparent background, text `#9da5b4`. Hover brings a soft surface glow of `#171a21` and text transitions to `#f3f1ec`.

### Chips & Wikilinks
- **Bidirectional Links (`[[Wikilinks]]`):** Rendered inline with subtle background pill padding (`space-xs` vertical, `space-sm` horizontal), colored `#818cf8` with a bottom hairline border `rgba(129, 140, 248, 0.35)`.
- **Knowledge Tags:** Set in `JetBrains Mono` (`label-sm`), background `#171a21`, border `1px solid rgba(255, 255, 255, 0.07)`, text `#9da5b4`.

### Cards & Flashcard Panels
- Background `#171a21` or `#1c2029`, with `space-lg` inner padding.
- Borders use fine hairline `rgba(255, 255, 255, 0.07)`.
- Flashcard flip states feature smooth 3D-perspective rotation with zero jarring scale jumps.

### Lists & Document Outline
- List items feature generous line heights with left-side hover indicator dots (4px `#5eead4` glow).
- Drag-and-drop handles remain invisible until mouse hover, keeping text uncluttered.

### Input Fields & Search Bars
- Transparent or `#171a21` background with 1px border `rgba(255, 255, 255, 0.08)`.
- Focused state eliminates bold high-contrast outlines; uses a smooth transition to border `#818cf8` with a soft 3px diffused outer halo `rgba(129, 140, 248, 0.15)`.
- Placeholder text in `#5d6575`.

### Checkboxes & Spaced-Repetition Review Toggles
- Custom rounded squares (`rounded-sm`, 4px radius).
- Unchecked: 1px border `rgba(255, 255, 255, 0.2)`, background transparent.
- Checked: Soft teal fill (`#5eead4`) with dark ink mark (`#0f1115`).