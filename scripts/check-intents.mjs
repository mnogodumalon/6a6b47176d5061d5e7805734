#!/usr/bin/env node
// Gate: intent flows must be reachable and findable.
//
// A flow page is three things at once, and all three have to agree:
//   1. the component in src/pages/intents/<Name>.tsx
//   2. a route in App.tsx (<custom:routes>) so the URL resolves
//   3. an entry in src/config/intents.ts (<custom:intents>) so it appears
//      in the sidebar
// Live-proven: a build shipped a complete 35 KB wizard, routed correctly, but
// with an empty registry — the flow existed and was simply invisible to the
// owner. Nothing failed, nothing warned.
//
// The docblock is checked too: app/services/intent_context.py derives
// _agent_context/intents.json from it, which is how a LATER agent run finds a
// flow worth reusing. Without it a flow is invisible to future runs as well.
//
// And the UTC day-shift trap is checked here as well, because nothing else
// can: the same rule is gate 1 of check-dashboard.mjs, but that script reads
// ONE file (src/pages/DashboardOverview.tsx). A flow step that writes a date
// field with toISOString() was therefore outside every gate — even a run that
// executes all of them.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/pages/intents';
const REGISTRY = 'src/config/intents.ts';
const APP = 'src/App.tsx';

const errors = [];

const pages = existsSync(DIR)
  ? readdirSync(DIR).filter(f => /\.tsx$/.test(f)).map(f => f.replace(/\.tsx$/, ''))
  : [];

// No flows at all is a legitimate state (phase 2 may build none).
if (pages.length > 0) {
  const registrySrc = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : '';
  const appSrc = existsSync(APP) ? readFileSync(APP, 'utf8') : '';

  // Registry paths live inside the <custom:intents> marker; read only that
  // block so the doc comment's example entry above it is not counted.
  const block = /\/\/ <custom:intents>([\s\S]*?)\/\/ <\/custom:intents>/.exec(registrySrc);
  const registryBody = block ? block[1] : '';
  const registryPaths = new Set(
    [...registryBody.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map(m => m[1]),
  );

  // Routes: <Route path="intents/…"> — App.tsx writes them without a leading
  // slash because they are nested; the registry stores the absolute path.
  const routePaths = new Set(
    [...appSrc.matchAll(/<Route\s+path=["'](intents\/[^"']+)["']/g)].map(m => `/${m[1]}`),
  );

  for (const name of pages) {
    const file = join(DIR, `${name}.tsx`);
    const src = readFileSync(file, 'utf8');

    // 1. Imported and routed?
    if (!appSrc.includes(`@/pages/intents/${name}`)) {
      errors.push(`${APP}: no import for '${name}' — add it inside <custom:imports> and route it in <custom:routes>`);
    }

    // 2. Docblock (purpose + steps + reads/writes) at the very top.
    if (!/^\s*\/\*\*/.test(src)) {
      errors.push(`${file}: missing the leading /** … */ docblock (purpose, Steps, Reads, Writes, Composes) — later agent runs find reusable flows through it`);
    }

    // 3. Generic dialogs belong on the CRUD pages, not in a wizard step.
    const dialogImport = /import\s[^;]*?from\s+['"]@\/components\/dialogs\/([^'"]+)['"]/.exec(src);
    if (dialogImport) {
      errors.push(`${file}: imports the generic dialog '${dialogImport[1]}' — a wizard step uses its own small form (the generic dialogs stay on the CRUD pages)`);
    }

    // 4. UTC day-shift trap — same rule as gate 1 of check-dashboard.mjs, which
    //    only ever sees DashboardOverview.tsx. A wizard step writes date fields
    //    DIRECTLY via the service, so this is exactly where the shift lands.
    //    The offending lines are quoted VERBATIM (untrimmed) so the fix is a
    //    direct Edit with that exact string — no re-Read to locate them.
    if (src.includes('toISOString')) {
      const lines = src.split('\n');
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < 6; i++) {
        if (lines[i].includes('toISOString')) hits.push(`    line ${i + 1}: ${lines[i]}`);
      }
      errors.push(
        `${file}: toISOString() found — it is UTC, so the day flips at the wrong hour and the record lands on the neighbouring date. ` +
        `Write date fields with date-fns format(): a date/date field → format(d, 'yyyy-MM-dd'), a date/datetimeminute field → format(d, "yyyy-MM-dd'T'HH:mm").` +
        (hits.length ? '\n' + hits.join('\n') : ''),
      );
    }
  }

  // 5. Every route needs a registry entry, or the flow is invisible in the
  //    sidebar even though its URL works.
  for (const path of routePaths) {
    if (!registryPaths.has(path)) {
      errors.push(`${REGISTRY}: route '${path}' has no entry inside <custom:intents> — the flow works by URL but never appears in the sidebar; add { path: '${path}', label: …, icon: …, description: … }`);
    }
  }

  // 6. …and the other way round: a registry entry without a route is a dead
  //    sidebar link.
  for (const path of registryPaths) {
    if (!routePaths.has(path)) {
      errors.push(`${APP}: registry lists '${path}' but no <Route path="${path.replace(/^\//, '')}"> exists — the sidebar link leads nowhere`);
    }
  }

  // 7. Flows exist, so the Phase-1 ghost rows must be gone. INTENTS_PENDING
  //    lives outside the markers and is flipped by the orchestrator, not by
  //    any file this gate already checks — leave it true and the sidebar
  //    shows "werden erstellt…" forever next to the finished flows.
  if (/export const INTENTS_PENDING = true/.test(registrySrc)) {
    errors.push(`${REGISTRY}: INTENTS_PENDING is still true although ${pages.length} flow(s) exist — set it to false, the sidebar keeps showing ghost rows otherwise`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log(`check-intents: OK (${pages.length} flows)`);
