---
target: Dashboard
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\astryn\\src\\features\\dashboard\\DashboardPage.tsx"
target_fingerprint: "sha256:666d4b2f6ff4019014cf28a07f91d641250206f29f816951c119d6a5ee833ae9"
target_path: "D:\\astryn\\src\\features\\dashboard\\DashboardPage.tsx"
timestamp: 2026-10-29T08-16-41Z
slug: src-features-dashboard-dashboardpage-tsx
---
Method: dual-agent (A: design review · B: detector + live WebView2 CDP scan, sequential: shared desktop window)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Hard-coded "offline ready" pill; Inbox tile always "—" |
| 2 | Match System / Real World | 2 | Jargon ("viewer-assigned issue", "Distinct cached work"); two date formats |
| 3 | User Control and Freedom | 3 | Read-only/navigational |
| 4 | Consistency and Standards | 2 | 40+ text nodes below DESIGN.md's 11px floor; off-ramp 10.5px; Slack rows with Slack off |
| 5 | Error Prevention | 2 | Reviews / PR health show "0" while GitHub isn't set up |
| 6 | Recognition Rather Than Recall | 3 | Everything labelled |
| 7 | Flexibility and Efficiency | 1 | No dashboard shortcuts; 18 tab stops; duplicate stops per attention row |
| 8 | Aesthetic and Minimalist Design | 2 | TASK-1 ×3, reviews ×3, Inbox ×2; nine equal-weight cards |
| 9 | Error Recovery | 2 | "Task cache unavailable." has no action |
| 10 | Help and Documentation | 2 | Setup rows point to Settings; little else |
| Total | | 21/40 | Acceptable |

## Design Specificity Verdict
Stock SaaS analytics-overview template: KPI tiles with corner icon-in-tinted-square (DashboardPage.tsx:143, repeated :256/:577/:200-224), nine equal bordered bento cards with title/grey-subtitle headers, greeting header + static pill (:729-732, :823-828), filler mini-charts and MetricLine grid (:469), "Jump to" bar duplicating the dock (:597-624), GlassCard/dashboard-glass naming (:53, index.css:183). Tokens are disciplined (matte, hue = state, themes hold).
Detector: source scan 8 advisory design-system-font-size (:191,372,388,440,444,588,607,826). Live scan 49: 39 undersized-ui-text (9/9.5/10/10.5px), 9 tiny-text (8 at 11px are false positives vs DESIGN.md label floor), 1 low-contrast 4.2:1 at :590 (text-muted-foreground/80). Source scan misses all text-[10.5px] and :590.

## Priority Issues
- [P1] Attention list broken and starved: table-fixed + sr-only thead ignores w-12/w-32 → 4×210px columns, title truncates ~150px in an 842px card; card stretches leaving ~260px white (:235-243). Fix: list/grid with fixed icon/meta widths; full-width content-sized attention band. Command: /impeccable layout
- [P1] Shows numbers it doesn't have: Reviews/PR health 0 without GitHub (:853-859, :507-510); Communication always renders Slack metrics, arrow "Open Slack" goes to Inbox (:544, :552-554, :943); Inbox KPI never has a value (:659, :868). Fix: setup states, drop rows of off modules. Command: /impeccable clarify then /impeccable harden
- [P1] Template composition. Fix: one counts strip above a ranked attention list; charts behind disclosure; delete Jump to. Command: /impeccable distill
- [P2] Type below floor + contrast: 40 live nodes <11px (to 9px), off-ramp 10.5px, 4.2:1 at :590. Command: /impeccable typeset
- [P3] Header chrome (static pill, radio tile, greeting) → real sync freshness. Command: /impeccable quieter

## Persona Red Flags
Alex: no j/k/Enter on attention; Overdue tile opens This Week not an overdue list (:850); dock covers PR health at 800px.
Sam: KPI aria-label drops the count (:132); two identical tab stops per attention row (:264, :284); 10 role=img bars with no summary; Jump to duplicates nav landmark.

## Minor Observations
Zero due bars render a 5% sliver (:385); attention count pill uses primary (reserved for selection/focus) (:191); In-progress bar in primary makes 0 rows look empty; Overdue caption never explains overdue.

## Questions to Consider
- If attention is the job, why is it one card of nine rather than the page?
- What decision do "Due load" / "Active workload" drive for one person with one in-progress issue?
- What if the screen only showed what changed since you last looked?
