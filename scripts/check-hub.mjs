#!/usr/bin/env node
/**
 * check-hub.mjs — build gate for hub-and-spoke completeness.
 *
 * When the schema has a HUB entity (≥3 other entities applookup onto it), its
 * dashboard overlay MUST surface every satellite as a <SatelliteSection> (which
 * bakes in the "+" and the row-click-opens-detail mechanics). Loop history: the
 * agent repeatedly wired only some satellites ("kann nur Mängel hinzufügen") or
 * none. This gate makes that a build error. Runs before `npm run build`.
 *
 * HUBS is embedded from the schema: hub entity -> satellite entity names.
 */
import { readFileSync } from 'node:fs';

const HUBS = {};

const hubKeys = Object.keys(HUBS);
if (hubKeys.length === 0) {
  console.log('check-hub: no hub entity in schema — skipped');
  process.exit(0);
}

let src;
try {
  src = readFileSync('src/pages/DashboardOverview.tsx', 'utf8');
} catch {
  console.error('ERROR: src/pages/DashboardOverview.tsx not found.');
  process.exit(1);
}

const errors = [];

if (!src.includes('SatelliteSection')) {
  errors.push(
    `This app has a hub entity (${hubKeys.join(', ')}) but DashboardOverview.tsx never uses <SatelliteSection>. ` +
    `The hub's overlay must show every satellite as a SatelliteSection (it bakes in the "+" and detail-on-click). ` +
    `See frontend-impl/SKILL.md → "Multi-Entity Topologies".`
  );
} else {
  // Count rendered <SatelliteSection — must cover the largest hub's satellites.
  const rendered = (src.match(/<SatelliteSection/g) || []).length;
  for (const [hub, sats] of Object.entries(HUBS)) {
    if (rendered < sats.length) {
      errors.push(
        `Hub '${hub}' has ${sats.length} satellites (${sats.join(', ')}) but only ${rendered} <SatelliteSection> rendered. ` +
        `EVERY satellite gets its own section — read-only/missing sections are the #1 hub failure.`
      );
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} hub-completeness error(s) — wire a <SatelliteSection> per satellite.`);
  process.exit(1);
}
console.log('check-hub: OK');
