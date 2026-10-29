---
version: 1
slug: "src-features-dashboard-dashboardpage-tsx"
primary_target: "src/features/dashboard/DashboardPage.tsx"
related_targets: ["src/styles/themes.css","src/styles/index.css"]
---

# Dashboard surface brief

Scope: the Dashboard (default destination), first surface of the replacement visual world. Mode: Operate. Code-led (Operate surface; no image generation round).
Audience and job: the owner opens Astryn all day; the Dashboard answers "what needs me now, and what is coming" across every active tracker, code host and chat module, then hands off to the right screen.
Constraints: PRODUCT.md brand commitments (sober, matte, no gradients/glows/glass, multiple themes, WCAG 2.2 AA, Geist); shell (tab strip, split panes, bottom dock) stays the app's standard navigation; numbers shown only when the source module is on and configured.
Critique backlog (2026-10-29, 21/40): broken attention table, fake zeros for unconfigured modules, template composition, sub-11px type and a 4.2:1 contrast miss, decorative header chrome.

## Direction contract
THESIS: The Dashboard is a well-made instrument face: one ranked attention queue read straight off the panel, with the week set as a tuning-dial scale. It refuses the SaaS overview of equal KPI cards, icon tiles and filler charts.
OWN-WORLD: Rams-era Braun appliance body and faceplate: a two-tone matte shell (darker body for tab strip and dock, lighter faceplate for content) stepped by lightness only; one functional colour key per theme for "now" and selection; round indicator lamps for state; lowercase small-sans control labels; light-weight tabular numerals; consistent small corner radius, hairline rules, no shadows at rest.
STORY: The owner sees at a glance what is overdue and what is next, trusts every number because unconfigured sources say "set up" rather than 0, acts on the top item with Enter, and leaves.
FIRST VIEWPORT: Readout bar across the top: the Dhaka date as the page heading and a row of source indicator lamps (one per active source, live status, set-up prompts inline) — no clocks, the owner removed the dual clock on 2026-10-27; full-width dial scale below it (overdue zone left of a single accent needle at now, seven day ticks with due counts); a compact readout strip of live counts for active modules only; then the full-width ranked attention queue with lamp, source, identifier, title and due, keyboard navigable (j/k, Enter). Week agenda and source health follow below the fold.
FORM: Braun/Rams industrial-design instrument face, position 4 of 7 on the ordered grounded list; seed:746f9f02522e7554
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
