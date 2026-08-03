#!/usr/bin/env node
/**
 * check-dashboard.mjs — mechanical pre-build gate for DashboardOverview.tsx.
 *
 * Runs in Step 3 (after parse-formulas.mjs, before `npm run build`). Exits
 * non-zero with actionable messages; fix every ERROR and re-run until green.
 * Text-based on purpose: cheap, deterministic, no AST dependency.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/pages/DashboardOverview.tsx';
let src;
try {
  src = readFileSync(FILE, 'utf8');
} catch {
  console.error(`ERROR: ${FILE} not found — run from the project root.`);
  process.exit(1);
}

const errors = [];
const warnings = [];

// Quote the offending source lines VERBATIM (untrimmed) in every pattern-based
// message: the fix is then a direct Edit with that exact string — the agent
// never has to re-Read the file just to locate a reported line.
const dashLines = src.split('\n');
const quoteLines = (re, max = 6) => {
  const hits = [];
  for (let i = 0; i < dashLines.length && hits.length < max; i++) {
    if (re.test(dashLines[i])) hits.push(`    line ${i + 1}: ${dashLines[i]}`);
  }
  return hits.length ? '\n' + hits.join('\n') : '';
};

// 1. UTC day-shift trap
if (src.includes('toISOString')) {
  errors.push("toISOString() found — day keys MUST use date-fns format(d, 'yyyy-MM-dd') (toISOString is UTC; the day flips at the wrong hour)." + quoteLines(/toISOString/));
}

// 2. Page skeleton: DashboardGrid or a written opt-out
if (!src.includes('<DashboardGrid') && !src.includes('layout-opt-out:')) {
  errors.push("Page layout is hand-rolled — compose <DashboardGrid hero/kpis/aside/primary> (it owns grid, mobile order, entrance). A genuinely different page shape needs a `// layout-opt-out: <reason>` comment.");
}

// 3. Polish layer imported
if (!src.includes("from '@/lib/polish'")) {
  errors.push("No import from '@/lib/polish' — the polish layer (useClock, gruss, namen, undoToast) is mandatory, do not re-derive it by hand.");
}

// 4. Drag/status writes need the undo toast
if (/onCardMove|onEventDrop|onEventResize/.test(src) && !src.includes('undoToast(')) {
  errors.push('Drag/status write handlers found but no undoToast(...) — every write gets feedback + Rückgängig (counter-write).');
}

// 5. Record clicks open the overlay
if (/onCardClick|onEventClick|onMarkerClick/.test(src) && !src.includes('<RecordOverlay')) {
  errors.push('onCardClick/onEventClick/onMarkerClick wired but no <RecordOverlay> — every record click opens the overlay (RecordView HARD RULE).');
}

// 6. Unguarded parseISO on optional record fields — the sandbox build does NOT
// enforce strictNullChecks, so parseISO(undefined) crashes at RUNTIME
// ("Cannot read properties of undefined (reading 'split')"), taking the whole
// dashboard down for one record with a missing date.
// A parseISO(x.fields.FIELD) is safe when the SAME field is guarded — three
// shapes count, so the natural readable patterns don't trip the gate:
//   · inline on the same line:        x.fields.F ? parseISO(x.fields.F) : …   /  x.fields.F && …  /  x.fields.F!
//   · early-return in the callback:   if (!x.fields.F) return …; … parseISO(x.fields.F)
//   · pre-filter up the chain:        .filter(r => !!r.fields.F) … parseISO(r.fields.F!)
// Only a parseISO with NO guard on its field anywhere nearby is a real crash
// risk (the sandbox build has no strictNullChecks → parseISO(undefined) throws
// at runtime and takes the whole page down).
const unguardedParseISO = [];
for (let i = 0; i < dashLines.length; i++) {
  const line = dashLines[i];
  const m = line.match(/parseISO\(\s*[\w$]+\.fields\.(\w+)\s*\)/);
  if (!m) continue;
  const field = m[1];
  // (a) inline guard on the same line (?, !, &&)
  if (/[!?]|&&/.test(line)) continue;
  // (b) a guard on the SAME field within the preceding lines — an early-return
  //     `if (!x.fields.F) …`, a ternary/&&, or a `.filter(… fields.F …)` that
  //     pre-filtered the chain. Require both: the field is referenced AND a
  //     guard token is present, so an unrelated mention doesn't wave it through.
  const back = dashLines.slice(Math.max(0, i - 8), i).join('\n');
  const fieldGuarded =
    new RegExp(`\\.fields\\.${field}\\b`).test(back) && /(!|\?|&&|\breturn\b|\.filter\()/.test(back);
  if (fieldGuarded) continue;
  unguardedParseISO.push(i + 1);
}
for (const n of unguardedParseISO) {
  errors.push(`Line ${n}: parseISO(x.fields.…) without a guard — one record with a missing date crashes the page. Guard inline (r.fields.X ? … : …), early-return (if (!r.fields.X) return …) before the parseISO, or pre-filter the chain (.filter(r => !!r.fields.X)) and assert with r.fields.X!.\n    line ${n}: ${dashLines[n - 1]}`);
}

// 7. Frozen clock
if (!src.includes('useClock(')) {
  warnings.push("useClock() not used — if any 'today'/overdue/greeting derivation exists, it must tick (a Date captured once shows yesterday tomorrow).");
}

// 8. Filler totals
if (/(?:title|description)\s*=\s*["'{][^"'}]*[Gg]esamt/.test(src)) {
  warnings.push("A KPI mentions 'gesamt' — bare totals are filler; every KPI is a clickable filter or a progress toward a limit." + quoteLines(/(?:title|description)\s*=\s*["'{][^"'}]*[Gg]esamt/));
}

// 9. Aside present (or consciously omitted)
if (src.includes('<DashboardGrid') && !/aside\s*=/.test(src)) {
  warnings.push('DashboardGrid without aside — fine ONLY when the app truly has no secondary slice; otherwise add a WorkList on a different axis than the primary widget.');
}

// 10. rail is deprecated — the side column grows with the SUM of its surfaces
if (/variant\s*=\s*["'{]+rail/.test(src)) {
  warnings.push('variant="rail" is deprecated — compose variant="wide" with a slim <StatStrip> above the primary surface instead (the rail column outgrows the board with real data).');
}

// 11. the 2×2 card grid is legacy — StatStrip is the compact KPI presentation
if (/layout\s*=\s*["'{]+grid/.test(src)) {
  warnings.push('<StatCardRow layout="grid"> is legacy — use <StatStrip><StatStripItem …/></StatStrip> (slim segmented bar) when the cards row is too heavy for the page.');
}

// 12. DashboardGrid owns the entrance — an ENTRANCE wrapper inside a slot
// collapses the aside band into one column and glues the surfaces together
if (/(?:hero|kpis|aside|primary)=\{\s*(?:\n\s*)?<div[^>]*(?:ENTRANCE|entranceDelay)/.test(src)) {
  errors.push('ENTRANCE/entranceDelay wrapper inside a DashboardGrid slot — the grid owns the staggered entrance. Pass slot content bare (aside surfaces as fragment siblings: <><WorkList …/><WorkList …/></>); the wrapper div collapses the band into one column with no gap.');
}

// 12b. Unguarded .localeCompare on record fields — same crash family as the
// parseISO trap: one record without the value ("Cannot read properties of
// undefined") takes the whole page down. A live fleet build crashed exactly
// here, sorting a 'zuletzt hinzugefügt' band on a bare `createdat`.
for (let i = 0; i < dashLines.length; i++) {
  const line = dashLines[i];
  if (!/[\w$]\.(?:[\w$]+)\.localeCompare\(/.test(line)) continue;
  if (/String\(|\?\.|\?\?|&&|\|\|/.test(line)) continue;
  errors.push(`Line ${i + 1}: unguarded .localeCompare on a possibly-empty field — one record without the value crashes the page. Sort with (a.f ?? '').localeCompare(b.f ?? '') or wrap both sides in String(...).\n    line ${i + 1}: ${line}`);
}

// 13. The page header comes FIRST — greeting h1 above the grid, always.
// (A live build shipped KPIs as the first visible element and no greeting at all.)
const gridIdx = src.indexOf('<DashboardGrid');
if (gridIdx >= 0) {
  const h1Idx = src.indexOf('<h1');
  if (h1Idx === -1 || h1Idx > gridIdx) {
    errors.push('No <h1> page header before <DashboardGrid> — EVERY dashboard starts with the greeting h1 (gruss()), context line and primary action ABOVE the grid; KPIs are never the first element.');
  }
}

// 14. Widgets bring their own card chrome — wrapping one in your own rounded
// card (+ glued <h2>) inside `primary` is double chrome and makes the same
// widget look different across dashboards.
{
  const widgetTag = /<(CalendarWidget|KanbanWidget|ResourceTimeline|MapWidget)\b/;
  let from = 0;
  while (true) {
    const p = src.indexOf('primary={', from);
    if (p === -1) break;
    const windowSrc = src.slice(p, p + 800);
    const m = windowSrc.match(widgetTag);
    if (m && windowSrc.slice(0, m.index).includes('rounded-[27px]')) {
      errors.push(`primary slot wraps <${m[1]}> in an own rounded card — widgets bring their card chrome themselves; remove the wrapper (and its glued heading), pass the widget bare.`);
    }
    from = p + 9;
  }
}

// 16. One-axis heuristic for charts: the SAME record field driving a clickable
// KPI (StatCard/StatStripItem with onClick) AND a ChartWidget dimension on one
// page is the decorated mirror — the chart's tone carries that state.
{
  const dimFields = new Set();
  const dimRe = /dimension=\{\{[\s\S]{0,300}?\}\}/g;
  let dm;
  while ((dm = dimRe.exec(src)) !== null) {
    for (const f of dm[0].matchAll(/fields\.(\w+)/g)) dimFields.add(f[1]);
  }
  if (dimFields.size) {
    const kpiRe = /<Stat(?:Card|StripItem)[\s\S]{0,500}?\/>/g;
    let km;
    while ((km = kpiRe.exec(src)) !== null) {
      if (!km[0].includes('onClick')) continue;
      for (const f of km[0].matchAll(/fields\.(\w+)/g)) {
        if (dimFields.has(f[1])) {
          warnings.push(`Field '${f[1]}' drives BOTH a clickable KPI and a ChartWidget dimension — the KPI is the decorated mirror of a chart segment; drop the KPI (the chart is that axis's control (drill/filter) or its tone carries that state).`);
        }
      }
    }
  }
}

// 17. A filter-mode chart + a filterable table column on the SAME field is
// two controls on one axis — when the chart filters, the facet must GO
// (SANDBOX_PROMPT: one axis, one control).
{
  const filterDimFields = new Set();
  let fm = 0;
  while (true) {
    const p = src.indexOf("mode: 'filter'", fm);
    if (p === -1) break;
    // the dimension usually precedes the interaction prop inside the same
    // <ChartWidget> — scan a window around the mode marker
    const windowSrc = src.slice(Math.max(0, p - 1200), p + 400);
    const dm = windowSrc.match(/dimension=\{\{[\s\S]{0,300}?\}\}/);
    if (dm) for (const f of dm[0].matchAll(/fields\.(\w+)/g)) filterDimFields.add(f[1]);
    fm = p + 14;
  }
  if (filterDimFields.size) {
    const colRe = /\{[^{}]*filterable\s*:\s*true[^{}]*\}/g;
    let cm;
    while ((cm = colRe.exec(src)) !== null) {
      for (const f of cm[0].matchAll(/fields\.(\w+)/g)) {
        if (filterDimFields.has(f[1])) {
          warnings.push(`Field '${f[1]}' has BOTH a filter-mode ChartWidget and a filterable table column — two controls on one axis; the chart IS the control, remove 'filterable' from that column (or drop the chart's filter mode).`);
        }
      }
    }
  }
}

// 18. Every RecordOverlay body IS the generated {Entity}Details block — a
// hand-built field list silently loses fields and renders relations as dead
// text (live finding: customer shown by name, phone unreachable; photo doc
// present but no path to the image).
{
  // FILE-LEVEL check, deliberately not a lexical window around the shell:
  // two correct structures beat windowing in live runs — long onEdit/footer
  // props pushed the Details past a 2500-char cutoff, and a named render
  // helper (`render={top => renderOverlayContent(top)}`) put them BEFORE the
  // host element. Gate 19 already enforces ONE overlay shell per page, so
  // per-overlay precision buys nothing; any <XyzDetails JSX usage in the file
  // is the overlay body. Imports never match (the pattern requires `<`).
  const overlays = (src.match(/<RecordOverlay/g) || []).length;
  const usesDetails = /<\w+Details\b/.test(src);
  if (overlays > 0 && !usesDetails && !src.includes('details-opt-out:')) {
    errors.push('The <RecordOverlay> body does NOT render the generated <{Entity}Details> block — compose it (record + lists from useDashboardData + onOpenX/onAddX via overlay.push) instead of hand-building fields; a genuinely different body needs a // details-opt-out: <reason> comment.');
  }
}

// 19. ONE overlay shell per page. A <RecordOverlay> per record type (open-flag
// shells) unmounts/remounts backdrop+panel on every drill/back and replays the
// entrance animation — the blink. The Host keeps one shell mounted.
{
  const shells = (src.match(/<RecordOverlay\b/g) || []).length;   // \b excludes RecordOverlayHost
  if (shells >= 2) {
    errors.push(`${shells} <RecordOverlay> shells found — render the WHOLE stack through ONE <RecordOverlayHost overlay={overlay} render={top => switch(top.type){…}}/>; per-type shells replay the entrance animation on every drill (the blink).`);
  }
}

// 20. Loading/error surfaces are pre-generated (incl. the self-repair flow) —
// the overview imports them and keeps the two early-returns; a local rebuild
// drifts from the repair protocol and re-types ~120 lines every build.
{
  if (!/import\s*\{[^}]*\bDashboard(?:Skeleton|Error)\b[^}]*\}\s*from\s*'@\/components\/DashboardStates'/.test(src)) {
    errors.push("DashboardSkeleton/DashboardError not imported from '@/components/DashboardStates' — they are pre-generated; import them, do not rebuild them.");
  }
  if (!src.includes('<DashboardSkeleton')) {
    errors.push("<DashboardSkeleton/> early-return missing — keep `if (loading) return <DashboardSkeleton />;` before any data access.");
  }
  if (!src.includes('<DashboardError')) {
    errors.push("<DashboardError/> early-return missing — keep `if (error) return <DashboardError error={error} onRetry={fetchAll} />;`.");
  }
  if (/(?:function|const)\s+Dashboard(?:Skeleton|Error)\b/.test(src)) {
    errors.push("Local DashboardSkeleton/DashboardError definition found — these ship in '@/components/DashboardStates'; delete the local copy and import them.");
  }
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} error(s) — fix DashboardOverview.tsx and re-run.`);
  process.exit(1);
}
console.log(`check-dashboard: OK (${warnings.length} warning(s))`);
