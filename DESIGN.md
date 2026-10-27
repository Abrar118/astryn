---
name: Astryn
description: A local-first desktop workspace for one engineer's issues, PRs, chat and docs, in four sober matte themes.
colors:
  graphite-background: "oklch(0.205 0.004 255)"
  graphite-sidebar: "oklch(0.18 0.004 255)"
  graphite-card: "oklch(0.228 0.004 255)"
  graphite-popover: "oklch(0.245 0.005 255)"
  graphite-accent: "oklch(0.285 0.006 255)"
  graphite-border: "oklch(0.305 0.005 255)"
  graphite-input: "oklch(0.535 0.006 255)"
  graphite-foreground: "oklch(0.93 0.003 255)"
  graphite-muted-foreground: "oklch(0.735 0.006 255)"
  graphite-primary: "oklch(0.74 0.075 245)"
  graphite-primary-foreground: "oklch(0.2 0.012 250)"
  graphite-destructive: "oklch(0.72 0.13 25)"
  graphite-success: "oklch(0.76 0.1 155)"
  graphite-warning: "oklch(0.8 0.1 80)"
  graphite-info: "oklch(0.76 0.065 230)"
  graphite-merged: "oklch(0.75 0.08 300)"
  charcoal-background: "oklch(0.21 0.006 65)"
  charcoal-sidebar: "oklch(0.185 0.006 65)"
  charcoal-card: "oklch(0.233 0.006 65)"
  charcoal-popover: "oklch(0.25 0.007 65)"
  charcoal-accent: "oklch(0.29 0.008 65)"
  charcoal-border: "oklch(0.31 0.007 65)"
  charcoal-input: "oklch(0.54 0.008 65)"
  charcoal-foreground: "oklch(0.92 0.007 80)"
  charcoal-muted-foreground: "oklch(0.74 0.01 75)"
  charcoal-primary: "oklch(0.76 0.055 170)"
  charcoal-primary-foreground: "oklch(0.2 0.012 170)"
  charcoal-destructive: "oklch(0.73 0.12 30)"
  charcoal-success: "oklch(0.77 0.11 140)"
  charcoal-warning: "oklch(0.81 0.1 78)"
  charcoal-info: "oklch(0.77 0.06 235)"
  charcoal-merged: "oklch(0.76 0.075 310)"
  paper-background: "oklch(0.982 0.003 85)"
  paper-sidebar: "oklch(0.962 0.004 85)"
  paper-card: "oklch(0.995 0.002 85)"
  paper-popover: "oklch(0.998 0.001 85)"
  paper-accent: "oklch(0.935 0.005 85)"
  paper-border: "oklch(0.895 0.005 85)"
  paper-input: "oklch(0.63 0.006 85)"
  paper-foreground: "oklch(0.24 0.006 70)"
  paper-muted-foreground: "oklch(0.47 0.008 70)"
  paper-primary: "oklch(0.47 0.1 258)"
  paper-primary-foreground: "oklch(0.985 0.003 258)"
  paper-destructive: "oklch(0.52 0.15 28)"
  paper-success: "oklch(0.5 0.1 150)"
  paper-warning: "oklch(0.53 0.1 65)"
  paper-info: "oklch(0.5 0.085 240)"
  paper-merged: "oklch(0.5 0.11 305)"
  stone-background: "oklch(0.972 0.003 240)"
  stone-sidebar: "oklch(0.95 0.004 240)"
  stone-card: "oklch(0.99 0.002 240)"
  stone-popover: "oklch(0.995 0.001 240)"
  stone-accent: "oklch(0.925 0.006 240)"
  stone-border: "oklch(0.885 0.006 240)"
  stone-input: "oklch(0.62 0.007 240)"
  stone-foreground: "oklch(0.23 0.008 250)"
  stone-muted-foreground: "oklch(0.465 0.01 250)"
  stone-primary: "oklch(0.46 0.07 215)"
  stone-primary-foreground: "oklch(0.985 0.003 215)"
  stone-destructive: "oklch(0.52 0.15 25)"
  stone-success: "oklch(0.5 0.1 150)"
  stone-warning: "oklch(0.53 0.1 62)"
  stone-info: "oklch(0.5 0.08 245)"
  stone-merged: "oklch(0.5 0.11 305)"
typography:
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  metric:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  body-prose:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.graphite-primary}"
    textColor: "{colors.graphite-primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    textColor: "{colors.graphite-foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.graphite-accent}"
  input:
    textColor: "{colors.graphite-foreground}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.graphite-card}"
    textColor: "{colors.graphite-foreground}"
    rounded: "{rounded.xl}"
    padding: "14px"
  pill:
    textColor: "{colors.graphite-muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  dock:
    backgroundColor: "{colors.graphite-sidebar}"
    rounded: "{rounded.2xl}"
    padding: "6px"
  dock-button:
    textColor: "{colors.graphite-muted-foreground}"
    rounded: "{rounded.xl}"
    size: "44px"
  dock-button-active:
    textColor: "{colors.graphite-primary}"
  tab:
    textColor: "{colors.graphite-muted-foreground}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  tab-active:
    backgroundColor: "{colors.graphite-card}"
    textColor: "{colors.graphite-foreground}"
---

# Design System: Astryn

## Overview

**Creative North Star: "The Matte Workbench"**

Astryn is an all-day instrument for one engineer: dense but calm, read in short check-ins and long planning sessions. The surface is matte. Depth comes from small lightness steps between tinted neutrals (sidebar, background, card, popover), hairline borders, and nothing else at rest. Each theme carries exactly one low-chroma accent, used for selection, focus and the active place in the app.

Color is a signal channel, not decoration. Hue appears only when it reports state (success, warning, destructive, info, merged) or when it is data from Linear (workflow-state and label colors). Navigation, tabs, dock and section icons are monochrome; a screen with nothing wrong is almost colorless.

The system ships as four interchangeable themes that share one token contract: Graphite (dark, steel-blue accent, the default), Charcoal (dark, warm neutrals, sage accent), Paper (light, warm neutrals, ink-blue accent) and Stone (light, cool neutrals, petrol accent). The owner picks a fixed theme or "Match system" with a chosen dark and light pair. Gradients, glows, glass and backdrop blur, and neon or purple-to-blue washes are confirmed rejections (PRODUCT.md brand commitments).

**Key Characteristics:**
- Four themes, one token contract; every component reads roles, never theme names.
- Tinted neutrals stepped by lightness for depth; hairline borders; no gradients.
- One low-chroma accent per theme, reserved for selection, focus and "you are here".
- Hue means state; Linear workflow and label colors pass through as data.
- Geist at small, dense sizes; mono for identifiers, clocks and diff counts.

## Colors

Tinted near-neutrals with one quiet accent per theme and a five-token state vocabulary; all values are OKLCH in `src/styles/themes.css`, selected by `data-theme` on `<html>`.

### Primary
- **Steel Blue** (graphite-primary): Graphite's accent. Active dock item, focused-pane bar, selected theme tile, today marker, primary button, focus ring, links.
- **Sage** (charcoal-primary): Charcoal's accent, same roles.
- **Ink Blue** (paper-primary): Paper's accent, same roles.
- **Petrol** (stone-primary): Stone's accent, same roles.
- **Primary Foreground** (`*-primary-foreground`): text and check marks drawn on a filled accent (near-black on dark themes, near-white on light).

### Secondary
- **State tokens** (`*-success`, `*-warning`, `*-destructive`, `*-info`, `*-merged`): the only non-accent hues in the UI. Success = approved, additions, healthy source. Warning = changes requested, degraded or stale cache, waiting. Destructive = failure, conflict, deletion, overdue, urgent. Info = commented, started, informational. Merged = merged PR state. Badges use the token as text with a 10% fill and 30% border of the same token. Syntax highlighting in code blocks also draws only from these tokens plus primary and muted-foreground.

### Neutral
- **Sidebar** (`*-sidebar`): darkest dark-theme plane (or the slightly dimmer light-theme plane) for the dock and side navigation.
- **Background** (`*-background`): the app canvas and tab strip.
- **Card** (`*-card`): panels, KPI tiles, active tab, code blocks; one step lighter than background.
- **Popover** (`*-popover`): menus, tooltips, dropdowns; one step above card.
- **Accent** (`*-accent`): hover and selected-row fill. Not a hue despite the shadcn name.
- **Border** (`*-border`): hairlines between rows, panels, tabs.
- **Input** (`*-input`): stroke for form fields and outline controls; deliberately darker/lighter than border so fields read as interactive.
- **Foreground / Muted Foreground** (`*-foreground`, `*-muted-foreground`): primary text and secondary text, icons, metadata.
- **Chart ramp** (`--chart-1..5`, not in frontmatter): a monotone ramp from the accent down into the neutrals, for heatmaps and charts. Charts stay single-hue.

### Named Rules
**The Color Means State Rule.** A hue may appear only to report state (the five state tokens), to mark selection/focus (primary), or to render Linear-provided workflow-state and label colors. Never color an icon, tab or section by category.

**The Priority Mapping Rule.** Urgent = destructive, High = warning, Medium = info, Low and No priority = muted-foreground. The bar glyph fills in muted-foreground and turns destructive only for Urgent.

**The One Contract Rule.** Every theme defines the identical token set. Components reference roles (`bg-card`, `text-success`), never literal colors; a new theme is a new `[data-theme]` block and nothing else.

**The Contrast Floor Rule.** Text and state tokens hold at least 4.5:1 against both background and card in every theme; primary-foreground holds at least 4.5:1 on primary. A new or edited token must pass before it ships.

## Typography

**Display Font:** none (no display face; headings are Geist)
**Body Font:** Geist Variable (with sans-serif)
**Label/Mono Font:** the platform monospace stack (`font-mono`)

**Character:** One neutral grotesque at small sizes carries everything; hierarchy comes from weight (500/600/650) and tight tracking on headings rather than size jumps. Mono is reserved for things that are read as codes or numbers.

### Hierarchy
- **Headline** (600, 18px, tracking -0.025em): page titles such as "Your workspace", "Pull Requests".
- **Metric** (600, 28px, line-height 1, tabular numerals): dashboard KPI values only.
- **Title** (600, 13px, tight tracking): panel and card headings.
- **Body** (400, 14px; 13px inside the calendar): rows, settings labels, buttons.
- **Body Prose** (400, 15px, line-height 1.65; headings 650 at 24/20/17px): issue descriptions, comments, rendered markdown; scales with the editor font-size setting.
- **Label** (500, 11px): pills, badges, row timestamps, tooltips, card subtitles. 11px is the functional-text floor.
- **Mono** (400, 12px): issue identifiers, the Dhaka/Germany clock, diff counts.

### Named Rules
**The 11px Floor Rule.** No functional text renders below 11px. Weight and color, not shrinking, create the quiet tier.

## Layout

A full-bleed desktop canvas: a top tab strip per pane (with the dual clock at the right), optional two-pane split, and content that runs edge to edge. Navigation is a floating dock centered 16px above the bottom edge. Spacing follows Tailwind's 4px grid; observed rhythm is 4/6/8px inside controls, 12px between row elements, 14–16px card padding, 24px for settings cards. Rows are dense (8px vertical padding at 14px text; 12px for the agenda's larger variant) and scroll horizontally per row when a narrow split pane cannot hold the metadata cluster.

The dashboard reflows by container queries on its own pane width, not the window: single column, then two columns at 520px, then a 4-up KPI row and a 1.8fr/0.8fr main split at 900px. App-wide zoom, icon scale and editor font scale are owner settings and must not be fought with fixed pixel layouts.

## Elevation & Depth

Flat by default with tonal layering. Resting surfaces never cast shadows; a card differs from the background by one lightness step and a hairline (or a 10% foreground ring on shadcn cards). Shadows appear only on things that float above the layout: the dock, context menus, popovers, tooltips and editor menus. Their color comes from the theme's `--overlay-shadow` (40% black on dark themes, a 14% cool ink on light themes) so floating layers stay soft on Paper and Stone.

### Shadow Vocabulary
- **Overlay small** (`box-shadow: 0 2px 10px var(--overlay-shadow)`): inline editor tooltip.
- **Overlay medium** (`box-shadow: 0 4px 16px var(--overlay-shadow)`): slash-command menu.
- **Overlay large** (`box-shadow: 0 8px 24px var(--overlay-shadow)`): calendar overflow popover.
- **Floating chrome** (Tailwind `shadow-2xl`): the dock and its context menu.

### Named Rules
**The Float-Only Shadow Rule.** If it sits in the layout, it has no shadow. Only overlays and the dock lift.

**The No Glass Rule.** No backdrop blur, translucency-as-material, gradients or glows on any surface, in any theme.

## Shapes

Softly rounded, consistent corners derived from one base radius (10px): 6px for small chips and day cells, 8px for pills, tabs and menu items, 10px for buttons and inputs, 14px for cards, panels and dock buttons, 18px for the dock itself. Full circles for avatars, status dots and the today marker. Borders are 1px hairlines; the focused pane is marked by a 2px accent bar, not a heavier border.

## Components

### Buttons
Quiet and compact.
- **Shape:** 10px radius; 32px default height (24/28/36px for xs/sm/lg).
- **Primary:** accent fill with primary-foreground text; hover drops the fill to 80%.
- **Ghost / Outline:** transparent or input-tinted; hover fills with muted or accent. Most in-app actions are ghost icon buttons in muted-foreground that brighten to foreground on hover.
- **Destructive:** destructive text on a 10% (20% on dark) destructive fill, never a solid red block.
- **Focus:** border becomes ring color plus a 3px ring at 50% ring opacity. Pressed buttons shift down 1px.

### Chips
- **Pill:** 1px border, 8px radius, 11px muted-foreground text, optional 12px icon. Carries status, project, cycle, estimate, counts and due date.
- **Label chip:** a pill with a 6px dot in the Linear label color; the text stays neutral.
- **State badge:** text in a state token, 10% fill and 30% border of the same token (Approved, Changes requested, You commented). Overdue due dates switch the pill border and text to destructive.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** card token on the background canvas.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px border token; interactive dashboard tiles brighten the border to 20% foreground on hover.
- **Internal Padding:** 14px for dashboard tiles, 24px for settings cards.

### Inputs / Fields
- **Style:** 32px tall, 10px radius, 1px input-token stroke, transparent fill (30% input tint on dark themes), 14px text.
- **Focus:** stroke switches to ring color with a 3px 50% ring.
- **Error / Disabled:** destructive stroke and 20% destructive ring; disabled at 50% opacity.

### Navigation
- **Dock:** floating sidebar-colored bar, 18px radius, 6px padding, 44px icon buttons with 20px monochrome Lucide icons. Default muted-foreground; hover accent fill and foreground; active is a 20% accent fill with the icon in primary. Labels appear as 11px popover tooltips; right-click offers "Open in new tab".
- **Tab strip:** 12px text tabs with 14px monochrome icons; the active tab sits on card, inactive tabs are muted. Issue tabs show the Linear workflow-state glyph in its API color.

### Theme Picker (signature)
Five radio tiles (four themes plus "Match system"), each a miniature of the theme drawn with that theme's own tokens through a scoped `data-theme`: sidebar strip, two text bars, an accent chip and success/warning/destructive dots. Selected tile gets a primary border; keyboard focus a 2px ring. "Match system" reveals two radio rows to choose the dark and light theme.

### Issue Row
Status glyph (Linear color), mono identifier, truncating title, then a right-aligned metadata cluster of pills, priority bars and assignee avatar. Rows separate by a 40% border hairline and hover to a 50% accent fill.

## Do's and Don'ts

### Do:
- **Do** reference role tokens (`background`, `card`, `primary`, `success`...) so every component works in all four themes unchanged.
- **Do** keep icons in navigation, tabs, dock and section headers monochrome (muted-foreground, foreground on hover, primary only when active).
- **Do** map priority as Urgent = destructive, High = warning, Medium = info, Low/None = muted-foreground.
- **Do** render Linear workflow-state and label colors exactly as the API supplies them.
- **Do** build state badges as state-token text over a 10% fill and 30% border of the same token.
- **Do** check any new or edited token for 4.5:1 text contrast on background and card, and 3:1 for input strokes and the focus ring, in every theme.
- **Do** take overlay shadows from `--overlay-shadow`, never a hard-coded black.

### Don't:
- **Don't** use gradients, glows, glass, backdrop blur, neon accents or purple-to-blue washes.
- **Don't** color an icon, tab or section to tell categories apart.
- **Don't** add a second accent hue to a theme; reach for a state token or for neutrals.
- **Don't** put shadows on resting cards, panels or rows.
- **Don't** set functional text below 11px.
- **Don't** hard-code a hex or a theme name inside a component.
