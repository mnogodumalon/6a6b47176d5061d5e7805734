#!/usr/bin/env node
/**
 * check-lookup-keys.mjs — build gate against INVENTED lookup keys.
 *
 * Real incident: an intent UI shipped `zahlungsstatus: 'offen'` — semantically
 * plausible, but the schema's keys were bezahlt|ausstehend|gemahnt, so every
 * wizard write 400'd in production. This gate embeds the schema's valid keys
 * and scans the agent-written sources for literal assignments to known lookup
 * fields. Runs in Step 3 / before `npm run build`; exit 1 on any unknown
 * literal — read the valid keys from LOOKUP_OPTIONS, never invent one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// field name -> union of valid keys across ALL entities (a literal valid in
// any entity passes — avoids false positives on shared field names).
const VALID_KEYS = {
  "einheit": [
    "kilogramm",
    "liter",
    "meter",
    "paket",
    "rolle",
    "satz",
    "stueck"
  ],
  "einheit_position": [
    "kilogramm",
    "liter",
    "meter",
    "paket",
    "rolle",
    "satz",
    "stueck"
  ],
  "prioritaet": [
    "dringend",
    "hoch",
    "niedrig",
    "normal"
  ],
  "pruefergebnis": [
    "bestanden",
    "bestanden_mit_maengeln",
    "nicht_bestanden"
  ],
  "status": [
    "abgeschlossen",
    "in_bearbeitung",
    "offen",
    "storniert"
  ],
  "verfuegbarkeit": [
    "auf_bestellung",
    "nicht_verfuegbar",
    "verfuegbar"
  ]
};

const ROOTS = ['src/pages', 'src/components'];
// .example.tsx targets a fixed demo schema; src/components/ui are shadcn
// primitives — neither carries Living-Apps writes.
const SKIP = /\.example\.tsx$|[\\/]ui[\\/]/;

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const errors = [];
const files = ROOTS.flatMap(r => walk(r)).filter(f => !SKIP.test(f));
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [field, keys] of Object.entries(VALID_KEYS)) {
      // property-assignment syntax only: `field: 'literal'` / `field: "literal"`
      const re = new RegExp(`[{,\\s]${field}\\s*:\\s*(['"])([^'"]*)\\1`, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        const val = m[2];
        if (!keys.includes(val)) {
          errors.push(
            `${file}:${i + 1}: '${val}' is not a valid key for '${field}' — valid: ${keys.join(' | ')}. ` +
            `(Local UI property sharing the name? Rename it.)`
          );
        }
      }
    }
  });
}

if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} invalid lookup-key literal(s) — keys come from LOOKUP_OPTIONS, never invent one.`);
  process.exit(1);
}
console.log(`check-lookup-keys: OK (${files.length} files scanned)`);
