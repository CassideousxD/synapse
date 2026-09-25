---
name: Nocturne Scholar
colors:
  surface: '#101319'
  surface-dim: '#101319'
  surface-bright: '#363940'
  surface-container-lowest: '#0b0e14'
  surface-container-low: '#191c22'
  surface-container: '#1d2026'
  surface-container-high: '#272a30'
  surface-container-highest: '#32353b'
  on-surface: '#e1e2eb'
  on-surface-variant: '#c6c5d5'
  inverse-surface: '#e1e2eb'
  inverse-on-surface: '#2d3037'
  outline: '#908f9e'
  outline-variant: '#454653'
  surface-tint: '#bdc2ff'
  primary: '#bdc2ff'
  on-primary: '#131e8c'
  primary-container: '#818cf8'
  on-primary-container: '#101b8a'
  inverse-primary: '#4953bc'
  secondary: '#44e2cd'
  on-secondary: '#003731'
  secondary-container: '#03c6b2'
  on-secondary-container: '#004d44'
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
  secondary-fixed: '#62fae3'
  secondary-fixed-dim: '#3cddc7'
  on-secondary-fixed: '#00201c'
  on-secondary-fixed-variant: '#005047'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#101319'
  on-background: '#e1e2eb'
  surface-variant: '#32353b'
typography:
  headline-xl:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: '400'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 42px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Newsreader
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-xl:
    fontFamily: Newsreader
    fontSize: 19px
    fontWeight: '400'
    lineHeight: 34px
  body-lg:
    fontFamily: Newsreader
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 30px
  body-md:
    fontFamily: Newsreader
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 26px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
  quote-callout:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 32px
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-tablet: 1rem
  gutter-mobile: 0.75rem
  margin: 2.5rem
  margin-tablet: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system embodies an intimate, distraction-free digital sanctum crafted for deep inquiry, synthesis, and long-form study. It rejects the hyperactive utility of enterprise dashboards, metric widgets, and aggressive gamification. Instead, it evokes the physical tactility of an archival scholar’s notebook balanced with the quiet precision of a modern hyperlinked thinking environment.

The visual style is **Subdued Literary Minimalist** paired with subtle **Atmospheric Glows**:
- **Tone:** Contemplative, scholarly, quiet, and timeless.
- **Atmosphere:** Deep near-black environments reminiscent of late-night study desks lit solely by an ambient desk lamp.
- **Interaction Ethos:** Low cognitive load, friction-free transitions, and deliberate restraint. Interactive moments—such as wikilink navigation, folding outlines, or inspecting graph nodes—emit soft, luminescent light rather than sudden mechanical changes.

## Colors

The palette is tuned specifically for low-light legibility and protracted reading sessions without retinal fatigue.

- **Primary (`#818cf8`):** Muted soft indigo. Used for core interactive states, active document nodes, focused breadcrumbs, and selected text blocks.
- **Secondary (`#2dd4bf`):** Gentle luminescent teal. Dedicated to semantic bidirectional links (wikilinks), forward references, and verified study checkpoints.
- **Tertiary (`#38bdf8`):** Ethereal cyan. Reserved for knowledge graph visual connectors, active query highlights, and search filter tags.
- **Neutral Canvas (`#0f1115` to `#14171d`):** Deep charcoal base layers avoiding true OLED black to maintain ocular softness and tonal graduation.
- **Surfaces (`#161920`, `#1c212b`):** Receded background cards and sliding side-drawers delineated by delicate light-leak borders (`rgba(255, 255, 255, 0.06)` to `rgba(255, 255, 255, 0.08)`).
- **Typography Tones:** High-hierarchy text adopts warm ivory (`#f3f1ec`), transitioning to softened parchment (`#e2e0d8`) for body prose, and slate ash (`#8f95a3` / `#6b7280`) for metadata, code block annotations, and folding toggles.

## Typography

The type architecture pairs the editorial warmth of **Newsreader** for primary study content with the crisp structural pragmatism of **JetBrains Mono** for indexing and technical metadata.

- **Editorial Body Prose:** Rendered at 17–19px with a generous 1.75x–1.8x line-height. Newsreader’s optical sizes and humanist italics preserve focus during multi-hour reading sessions.
- **Headlines:** Scaled gently without jarring jumps. Titles remain lyrical and understated rather than punchy or promotional.
- **Technical Accents & Metadata:** Monospaced tags, word counts, backlink statistics, and code snippets use JetBrains Mono at micro scales (11px–13px) with subtle letter spacing to create instantaneous visual delineation between "content" and "catalog."

## Layout & Spacing

The layout philosophy prioritizes **contemplative reading channels** over dense information grids. 

- **Primary Study Column:** Set to a strict maximum reading measure of 68ch to 72ch (approx. 720px–780px), centered in the viewport or gently offset when complementary panels are open.
- **Sidebar Architecture:** Left drawer houses an unadorned hierarchical tree; right-hand drawer (collapsible) contains context backlinks, graph thumbnails, and outline toc. Sidebars remain visually secondary with width caps (240px–280px).
- **Responsive Adaptations:**
  - **Desktop (1200px+):** Three-tier layout: slim collapsed tool ribbon or floating drawer, centered reading canvas, floating or docked contextual panel.
  - **Tablet (768px - 1199px):** Off-canvas sidebars triggered via unobtrusive edge tabs or shortcut commands (`Cmd + \`). Reading column maintains its comfortable prose margin.
  - **Mobile (< 768px):** Single-column edge-to-edge reading viewport with minimal 16px lateral padding and floating glass bottom navigation bar for quick capture and search.

## Elevation & Depth

Depth is established strictly through **tonal stratification** and **diffused ambient illumination**, completely avoiding hard drop shadows or opaque multi-layered borders.

- **Base Layer (Canvas):** `#0f1115` base background.
- **Surface Layer (Cards, Sidebars, Panels):** `#161920` background with a subtle border overlay: `1px solid rgba(255, 255, 255, 0.07)`.
- **Raised Interactive Layer (Popovers, Command Palette, Floating Menus):** `#1c212b` background elevated with an ultra-soft atmospheric shadow: `box-shadow: 0 12px 36px -8px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08)`.
- **Luminary Accents:** Active graph points, focused wikilinks, and selected tags carry an understated, localized glow: `box-shadow: 0 0 16px -2px rgba(129, 140, 248, 0.15)`.

## Shapes

The design uses balanced, gentle curvatures (`roundedness: 2`) that soften the digital feel of the tool without making it look bubbly or toy-like.

- **Panels & Container Cards:** Styled with `12px` (`rounded-lg`) corner radii to form smooth, tablet-like parchment surfaces.
- **Inputs, Chips & Micro-elements:** Styled with `6px–8px` radius for structural clarity.
- **Floating Modals & Quick Switchers:** Standardized at `14px–16px` (`rounded-xl`) to feel like suspended leather-bound notebooks.

## Components

### Buttons
- **Subtle / Ghost (Default):** Transparent background, text `#8f95a3`, hover: background `rgba(255, 255, 255, 0.04)`, text `#f3f1ec`. Transition: 150ms ease.
- **Primary Action (New Entry / Commit):** Background `#818cf8` at 15% opacity, border `1px solid rgba(129, 140, 248, 0.3)`, text `#818cf8`. Hover: background `rgba(129, 140, 248, 0.25)`.
- **Destructive:** Transparent background, text `#f87171` at 80% opacity; hover: `rgba(248, 113, 113, 0.1)`.

### Chips & Metadata Tags
- **Tag Structure:** JetBrains Mono 11px, height 24px, padding 2px 8px, radius 6px.
- **Passive Tag:** Background `#161920`, border `1px solid rgba(255, 255, 255, 0.07)`, text `#8f95a3`.
- **Linked Concept Tag:** Background `rgba(45, 212, 191, 0.08)`, border `1px solid rgba(45, 212, 191, 0.2)`, text `#2dd4bf`.

### Lists & Backlink Trees
- **File List Items:** Vertical padding 6px, horizontal padding 8px, border-radius 6px. Indentation marks styled as delicate vertical hairline guides (`1px solid rgba(255, 255, 255, 0.05)`). Hover triggers muted `#1c212b` highlight. Active file uses subtle indigo indicator tab on left edge.
- **Wikilinks:** Highlighted inline via `color: #2dd4bf; text-decoration: none; border-bottom: 1px dotted rgba(45, 212, 191, 0.4); padding: 0 2px;`. Hover elevates to solid underline with faint background bloom (`rgba(45, 212, 191, 0.08)`).

### Input Fields & Search Command Palette
- **Inline Inputs:** Clean transparent background with no outline; focus indicated by bottom accent line in muted teal.
- **Quick Switcher / Command Palette (`Cmd + K`):** Fixed width (580px), centered overlay, surface `#161920`, input area with 16px Newsreader font, search field icon in `#8f95a3`, results rendered in JetBrains Mono with keyboard shortcuts displayed in faint rounded badges (`kbd`).

### Study Cards & Flashcards
- **Card Container:** `#161920` background, border `1px solid rgba(255, 255, 255, 0.06)`, internal padding `24px`.
- **Header:** Date / Topic path in JetBrains Mono 12px uppercase tracking.
- **Prose Content:** Newsreader 17px with 1.75 line-height.
- **Card Footer:** Bidirectional reference count badge and status dot.