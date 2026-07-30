import asyncio
import json
import time
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AgentDefinition, AssistantMessage, UserMessage, ToolUseBlock, ToolResultBlock, TextBlock, ResultMessage, HookMatcher
import os

_t0 = time.time()
_LOG_LEVEL = os.getenv("LOG_LEVEL", "warn").lower()

def _actor_fields(parent_tool_use_id: str | None) -> dict:
    """Build actor/parent_id pair used to distinguish main-agent from sub-agent frames."""
    return {
        "actor": "subagent" if parent_tool_use_id else "main",
        "parent_id": parent_tool_use_id,
    }


async def _on_post_tool_use(input_data: dict, tool_use_id: str | None = None, context: dict | None = None) -> dict:
    """Log tool results after execution (only at debug level)."""
    if _LOG_LEVEL == "debug":
        try:
            tool = input_data.get("tool_name", "?")
            response = input_data.get("tool_response", "")
            output = str(response)[:4000] if response else ""
            elapsed = round(time.time() - _t0, 1)
            parent = input_data.get("parent_tool_use_id") or input_data.get("agent_id")
            print(json.dumps({"type": "tool_result", "tool": tool, "output": output, "t": elapsed, **_actor_fields(parent)}), flush=True)
        except Exception as e:
            elapsed = round(time.time() - _t0, 1)
            print(json.dumps({"type": "tool_result", "tool": input_data.get("tool_name", "?"), "output": f"[hook error: {e}]", "t": elapsed}), flush=True)
    return {"continue_": True}


# Files the main agent must NOT read — they belong exclusively to the form-polish sub-agent.
# Defense-in-depth alongside the form_polish AgentDefinition: even with the prompt
# moved inline, .placeholder-tasks.json still lives on disk as the sub-agent's
# trigger/task-list. If the main agent reads it, it decides the instructions
# apply to itself and duplicates the form-polish edits. Discriminator: sub-agent
# tool_use_data has a non-empty `agent_id` string; main-agent's is absent or empty.
_SUBAGENT_ONLY_FILES = (".placeholder-tasks.json",)

async def _block_subagent_files_for_main_agent(input_data: dict, tool_use_id: str | None = None, context: dict | None = None) -> dict:
    """Deny main-agent Read on files reserved for the form-polish sub-agent."""
    file_path = input_data.get("tool_input", {}).get("file_path", "") or ""
    if not any(marker in file_path for marker in _SUBAGENT_ONLY_FILES):
        return {}

    agent_id = input_data.get("agent_id")
    parent_tool_use_id = input_data.get("parent_tool_use_id")
    is_subagent = bool(
        (isinstance(agent_id, str) and agent_id)
        or (isinstance(parent_tool_use_id, str) and parent_tool_use_id)
    )
    if is_subagent:
        return {}

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "Diese Datei gehört dem Form-Polish Sub-Agent. "
                "Du hast ihn bereits dispatched — gehe direkt zu Step 1 (Dashboard) "
                "und bearbeite KEINE Form-Dateien (Dialoge, form-enhancements/*.ts, Reports)."
            ),
        }
    }

# Environment-specific configuration
LA_API_URL = os.getenv("LA_API_URL", "https://my.living-apps.de/rest")
LA_FRONTEND_URL = os.getenv("LA_FRONTEND_URL", "https://my.living-apps.de")

# ── Subagent prompts (only used in Phase 2 / "all" mode) ───────────

INTENT_BUILDER_PROMPT = """\
You build a single INTENT UI page — a task-oriented workflow that guides the user through a multi-step process.

LANGUAGE & TONE: All UI text (labels, buttons, headings, descriptions, empty states, tooltips) MUST be in German. \
Always use "du/dein/dir" — NEVER "Sie/Ihr/Ihnen".

## WHAT AN INTENT UI IS (vs what it is NOT)

An intent UI is NOT a fancy CRUD page. CRUD pages already exist for every entity — they have tables, search, \
create/edit/delete dialogs. Do NOT rebuild that.

An intent UI is a WORKFLOW that:
- Spans MULTIPLE entities (e.g., selecting a record from entity A, then creating linked records in entity B and C)
- Has STEPS or PHASES (e.g., Step 1: pick event → Step 2: invite guests → Step 3: book vendors → Step 4: confirm)
- Creates MULTIPLE records in a single flow (e.g., inviting 20 guests = creating 20 invitation records)
- Has a clear START state and END state (user begins the task → user completes the task)
- Shows live context as the user progresses (e.g., running budget total, guest count, progress indicator)

EXAMPLES of good intent UIs:
- "Prepare Event": Wizard — choose event → bulk-invite guests (creates Einladung records) → book vendors (creates Buchung records) → see budget summary → confirm
- "Schedule Lesson": Pick student + instructor + vehicle + timeslot in ONE focused view → creates Fahrstunde record with all relationships pre-filled
- "Record Exam Results": Select exam from pending list → set result → auto-update student status → show next pending exam

EXAMPLES of what is NOT an intent UI (just CRUD with lipstick):
- ❌ A table of events with filters and a create button
- ❌ A kanban board showing records grouped by status (that's a dashboard widget)
- ❌ A single-entity form with some extra styling

## IMPLEMENTATION

You will be given an intent description and the file path to create. Create the COMPLETE file from scratch.

Use useState to manage wizard steps, selections, and running totals.

RECORD CREATION & SELECTION — THIS IS THE #1 RULE:

🚨 NEVER use the pre-generated {Entity}Dialog inside an intent UI — not as a step, not behind \
"Neu erstellen". It is the generic CRUD modal (every field, photo scan) and defeats the wizard: \
the user came here to be guided, not to face the full form. Build a task-tailored mini-form \
instead — only the 2–4 fields that matter for this step's decision — and call \
LivingAppsService.create<X>Entry() directly with correctly formatted values (see the API rules \
below; scripts/check-lookup-keys.mjs catches invented lookup keys before the build).

For EVERY step where the user needs to pick or add a record:

1. SHOW EXISTING RECORDS FIRST — fetch from useDashboardData(), display as a searchable list \
(use EntitySelectStep or a custom card list). The user picks from what already exists.

2. OFFER "Neu erstellen" — a button that reveals YOUR OWN mini-form (inline panel or a small \
Dialog composed from ui/ primitives). After a successful create and fetchAll(), auto-select \
the newly created record.

3. CONCRETE EXAMPLE:
```tsx
const [showCreate, setShowCreate] = useState(false);
const [name, setName] = useState('');
<EntitySelectStep items={artikel.map(a => ({...}))} onSelect={handleSelect}
  createLabel="Neuen Artikel anlegen" onCreateNew={() => setShowCreate(true)} />
{showCreate && (
  <div className="rounded-2xl border p-4 space-y-3">  {/* mini-form: ONLY this step's fields */}
    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Artikelname" />
    <Button onClick={async () => {
      await LivingAppsService.createArtikelEntry({ name });
      await fetchAll(); setShowCreate(false);          // then auto-select the new record
    }}>Anlegen</Button>
  </div>
)}
```

This applies to ALL entities in EVERY step. The full CRUD form stays on the CRUD page — \
fields not relevant to this step can be filled there later.

MANDATORY RULES:
- BEFORE writing any code, Read src/types/app.ts to learn the EXACT field names for each entity type. \
Use ONLY these field names when calling LivingAppsService methods. NEVER invent or guess field names.
- Use ONLY the pre-generated LivingAppsService methods (createXEntry, updateXEntry, deleteXEntry) \
from '@/services/livingAppsService'. Do NOT build custom API calls or service functions.
- Create the file with Write tool — one shot, no read-back.
- The file must be a valid React component with a default export.
- The file MUST START with a /** … */ docblock (above the imports): purpose in one line, \
the ordered steps, which entities it reads and writes, which shared components it composes. \
Follow-up agent sessions read this block to find and reuse the flow (e.g. to mirror it as a \
public page) — a page without it is invisible to them. Example:
  /**
   * Neue Buchung — 3-Schritt-Wizard.
   * Steps: 1) Kurs wählen → 2) Teilnehmer erfassen → 3) Bestätigen & anlegen.
   * Reads: kurse, teilnehmer. Writes: buchungen (createBuchungenEntry).
   * Composes: IntentWizardShell, EntitySelectStep.
   */
- Import useDashboardData from '@/hooks/useDashboardData' for data access.
- Import types from '@/types/app', services from '@/services/livingAppsService'.
- Import enrichment functions from '@/lib/enrich' and enriched types from '@/types/enriched' if needed.
- NEVER use Bash for file operations — use Read/Write/Edit tools only.
- Rules of Hooks: ALL hooks MUST be BEFORE any early returns (loading/error).
- IMPORT HYGIENE: Only import what you use.
- No {Entity}Dialog — see THE #1 RULE above. Each step owns a tailored inline UI with the most \
ergonomic input method (date-range picker, tile-style multi-select with prices, live total card, \
search-as-you-type). Full examples: .claude/skills/intent-ui/SKILL.md section \
"NEVER use the pre-generated {Entity}Dialog inside an intent UI".
- TOUCH-FRIENDLY: NEVER hide buttons behind hover.
- MANDATORY FIRST STEP: Before writing any code, Read `.claude/skills/intent-ui/SKILL.md` \
in full. It is the authoritative source for design patterns AND critical API write rules \
(lookup keys, applookup URLs, multipleapplookup arrays). Skipping it produces wrong code.
- Do NOT run npm run build — the orchestrator handles that.
- Do NOT touch any other files — only create the file you were given.
- DEEP-LINKING: Use useSearchParams to read ?step= parameter. Initialize the wizard step from the URL \
param so the dashboard can link directly to specific steps (e.g., ?eventId=xxx&step=2 skips to step 2). \
When the user navigates between steps, update the URL params to keep them in sync.
- NAVIGATION OUT: Never link the user from an intent UI to a CRUD subpage \
(`#/buchungen`, `#/kunden`, `#/katzen`, …). Allowed link targets are ONLY: `#/` (dashboard) \
or `#/intents/<other-slug>` (follow-up intent). On success, offer "Neue Buchung anlegen" \
(reset wizard) and "Zurück zum Dashboard" — not "Zur Buchungsübersicht".

CRITICAL API RULE — lookup fields when writing:
When READING, lookups are objects: { key: 'x', label: 'X' }.
When WRITING (create/update via LivingAppsService), send ONLY the plain key string!
  ❌ status: { key: 'eingeladen', label: 'Eingeladen' }  → 400 error
  ✅ status: 'eingeladen'                                 → works
For multiplelookup, send string array: ['a', 'b'], NOT [{key,label}, ...].

CRITICAL API RULE — multipleapplookup fields when writing:
The API expects null or an ARRAY of full record URLs (string[]). NEVER join, stringify,
or send a single URL where a list is expected.
  ✅ extras: ids.map(id => createRecordUrl(APP_IDS.X, id))   // string[]
  ✅ extras: urls.length > 0 ? urls : undefined
  ❌ extras: urls.join(',')                → 422 "type none or list expected, not str"
  ❌ extras: createRecordUrl(APP_IDS.X, oneId)   // singular URL when list expected
  ❌ extras: JSON.stringify(urls)
Rule: if the form-state is a Set<id> or id[], map to URLs first, then pass the ARRAY directly.
"""

FORM_POLISH_PROMPT = """\
# Form-Polish Sub-Agent — Aufgabenbeschreibung

Du läufst im Sandbox-Build parallel zum Hauptagent. Der Hauptagent baut das
Dashboard, du polierst die Formulare.

Read `.placeholder-tasks.json` im Projekt-Root und befolge die folgenden Schritte
für jede Entity im `tasks`-Array.

---

## SCHRITT 0 — Analyse pro Entity (VOR jedem Write, laut denken)

Schreibe für jede Entity 3–6 Sätze deutsche Analyse, beginnend mit
"Analyse <Entity>:". Inhalt:

- welche Number-Felder es gibt (Kandidaten für computed)
- welche Lookup-/Applookup-Felder es gibt (Kandidaten für defaults + applookup())
- welche Felder wirken berechenbar — z. B.
  - "menge × preis_pro_einheit"
  - "arbeitsstunden × stundensatz" (über applookup auf den Mitarbeiter)
  - "tage × tagespreis" → `dateDiff(anreise, abreise, days) * applookup(zimmer, tagespreis)`
  - "stunden × stundensatz" → `dateDiff(start, ende, hours) * applookup(mitarbeiter, stundensatz)`
  - "summe + nebenkosten"

**PFLICHT-CHECK bei zwei Datumsfeldern als Paar** (anreise/abreise, von/bis,
start/ende, eingang/ausgang, ankunft/abreise).

`a`, `b`, `c` sind UNABHÄNGIGE computed-Einträge — jeder bekommt seine eigene
Zeile in `computed: { … }`. NIEMALS zusammenfassen, nie weglassen weil "der
dateDiff steckt ja schon in der Gesamtkosten-Formel". Beispiel für eine
Aufenthalts-Entity am Ende dieses Blocks zeigt alle drei gleichzeitig.

### a) PFLICHT — Dauer-Berechnung (immer setzen, auch ohne Preis)

Zwei mögliche Varianten — beide ggf. PARALLEL setzen, NICHT entweder/oder:

**a.1) Wenn ein echtes Number-Feld für die Dauer existiert** (key/label enthält
`naechte|nights|dauer|tage|days|anzahl_naechte|anzahl_tage|anzahl_stunden`):
setze computed direkt auf diesen ECHTEN Key. Beispiel mit Feld `anzahl_naechte`:

```
'anzahl_naechte': 'dateDiff(checkin_datum, checkout_datum, days)'
```

Damit füllt sich der existierende Input automatisch — User sieht die Dauer
DIREKT im richtigen Eingabefeld und kann notfalls überschreiben.

**a.2) ZUSÄTZLICH (immer) — Virtueller Dauer-Key** für die Aggregat-Anzeige
unten im Dialog. Key beginnt mit `_` und kommt NICHT in `fields` vor.
**Schreibe Umlaute direkt im Key** (JS/TS/Vite unterstützen Unicode-Identifier
nativ — `'_aufenthalt_dauer_nächte'` statt `'_aufenthalt_dauer_naechte'`).
Der Label im Dialog wird aus dem Key abgeleitet, daher landen ASCII-Codings
wie `ae`/`oe`/`ue` wörtlich in der UI ("Naechte" statt "Nächte"). Wert:
gleicher dateDiff wie in (a.1):

```
'_aufenthalt_dauer_nächte': 'dateDiff(aufenthalt_ankunft, aufenthalt_abreise, days)'
```

Wenn KEIN echtes Dauer-Feld in (a.1) existiert, ist nur (a.2) Pflicht.
Wenn ein echtes Dauer-Feld existiert, sind BEIDE Pflicht — sie zeigen den
gleichen Wert an zwei Stellen (Input + Aggregat). Das ist gewollte
Redundanz: das Aggregat erinnert den User auch dann an die Dauer, wenn er
den Input bereits manuell überschrieben hat.

### b) Wenn die Entity ZUSÄTZLICH einen applookup auf eine "preis"-/"satz"-Spalte hat

(tagespreis, stundensatz, kosten_pro_tag), ist `dateDiff(from, to, unit) * applookup(...)`
fast immer die richtige computed-Formel für ein Gesamtkosten-Feld. Das ist ein
SEPARATER Eintrag — der virtuelle Dauer-Key aus (a) bleibt zusätzlich bestehen.

### c) AUFENTHALTS-ENTITY-HEURISTIK (überstimmt Punkt b bei Namens-Match)

Wenn der ENTITY-Name eines dieser Wörter enthält (case-insensitive) —
`aufenthalt`, `buchung`, `reservierung`, `booking`, `stay`, `mietzeit`,
`vermietung`, `kursteilnahme`, `teilnahme`, `anmeldung` — UND ein Datumspaar
vorhanden ist UND ein Gesamtkosten-/Preis-Number-Feld existiert (key/label
enthält "gesamt", "kosten", "preis", "summe", "betrag") UND ein applookup auf
irgendein numerisches Preis-/Kosten-Feld existiert (Spalte muss NICHT
"tagespreis" heißen — `preis`, `kosten`, `betrag`, `gebuehr` reichen) → setze
IMMER:

```
'gesamtkosten_key': 'dateDiff(from, to, days) * applookup(lookup_key, preis_key)'
```

Begründung: Bei Aufenthalten/Buchungen ist die User-Erwartung IMMER Tage × Preis
— auch wenn die Preis-Spalte semantisch mehrdeutig ist (Einzelpreis vs.
Tagespreis). Lieber falsch multiplizieren als leere Berechnung. Der User
korrigiert das Ergebnis im Number-Input manuell, falls nötig (clearing →
restore computed).

Schwache Begründungen wie "Leistungen optional", "Preis ist Einzelpreis" oder
"nicht eindeutig" sind bei Aufenthalts-Entities VERBOTEN — die Formel wird
trotzdem gesetzt.

### VOLLSTÄNDIGES BEISPIEL für eine Buchungs-Entity mit echtem `anzahl_naechte`-Feld

```ts
computed: {
  // (a.1) Echtes Anzahl-Nächte-Feld — füllt den Input automatisch
  'anzahl_naechte':
    'dateDiff(checkin_datum, checkout_datum, days)',
  // (a.2) Virtueller Dauer-Key — Aggregat-Hinweis unten im Dialog
  // (Umlaut DIREKT im Key — kein `naechte`, sondern `nächte`)
  '_buchung_dauer_nächte':
    'dateDiff(checkin_datum, checkout_datum, days)',
  // (c) Gesamtpreis — Tage × Tagespreis (über applookup auf Zimmer)
  'gesamtpreis':
    'dateDiff(checkin_datum, checkout_datum, days) * applookup(zimmer, preis_pro_nacht)',
}
```

Wenn keine echtes Dauer-Feld existiert (z. B. Aufenthalt ohne `anzahl_naechte`),
entfällt nur (a.1) — (a.2) und (c) bleiben Pflicht.

Alle drei Einträge sind unabhängig — der dateDiff in (c) ersetzt NICHT (a.1)/(a.2).

### Abschluss der Analyse

Liste am Ende: welche computed-Formeln du daraus planst — ODER warum du keine
setzt (z. B. "reine Stammdaten, nichts berechenbar"). Erst NACH dieser Analyse
mit Edits/Writes fortfahren. Ohne diese Analyse gilt die Entity als nicht
bearbeitet.

---

## AUFGABE 1 — Placeholders (für jedes Feld in `fields`)

**WICHTIG: Du editierst KEINE Dialog-Dateien.** Du schreibst EINE einzige
JSON-Datei mit deinen Placeholder-Vorschlägen; ein Node-Skript trägt sie nach
deinem Lauf deterministisch in die Dialoge ein. Das ist schneller (1× Write
statt 30× Edit) und robuster (keine Patch-Fehler durch TSX-Quote-Escaping).

1. Für JEDES Feld in den `tasks[*].fields` einen kurzen, hilfreichen deutschen
   Placeholder erfinden. Nutze `entity`, `entity_context`, `label` und ggf.
   `target_entity` / `options` aus dem Feld-Objekt für Domain-Kontext. Max
   4 Wörter (Textarea darf länger sein), kein Punkt am Ende, NIE das Label
   wiederholen. Pflicht: applookup-Felder (Combobox) und date-Felder
   (DatePicker) NIEMALS überspringen — sonst sehen User leere Slots.

   Beispiele:
   - input "Buchungsnummer" → `"z. B. BU-2026-001"`
   - applookup mit target_entity "Mitarbeiter" → `"Mitarbeiter wählen"` oder
     `"Aus 22 Mitarbeitern wählen"` wenn 'aus N' Sinn macht
   - select mit options `["Vollzeit","Teilzeit","Minijob",…]` →
     `"z. B. Vollzeit, Teilzeit"`
   - date "Anreisedatum" → `"Wann kommt die Katze?"`
   - textarea "Notizen" → `"Besonderheiten, Wünsche, Allergien..."`

2. **EIN Write-Aufruf** auf `/home/user/app/.placeholder-suggestions.json`
   mit ALLEN Vorschlägen. Format: Pro Eintrag in `tasks` ein Top-Level-Key
   mit dem `file`-Basename (z. B. `"AufenthalteDialog.tsx"`), darunter ein
   Map `{ key → placeholder-text }`.

   Beispiel-Skelett (zeigt alle Feldtypen):
   ```json
   {
     "ZimmerDialog.tsx": {
       "zimmer_nummer":       "z. B. Z-101",
       "zimmer_bezeichnung":  "z. B. Ruheraum Ost",
       "zimmer_typ":          "Wähle einen Zimmertyp",
       "zimmer_kapazitaet":   "z. B. 2",
       "zimmer_beschreibung": "Ausstattung, Besonderheiten..."
     },
     "AufenthalteDialog.tsx": {
       "aufenthalt_tier":         "Welches Tier kommt?",
       "aufenthalt_zimmer":       "Welches Zimmer zuweisen?",
       "aufenthalt_leistungen":   "Welche Leistung?",
       "aufenthalt_ankunft":      "Wann kommt das Tier?",
       "aufenthalt_abreise":      "Wann reist es ab?",
       "aufenthalt_behandlung":   "Behandlung, Fütterung, Verhalten...",
       "aufenthalt_gesamtkosten": "z. B. 234,50",
       "aufenthalt_notizen":      "Spezielle Wünsche, Notizen..."
     }
   }
   ```

   Quote-Hinweis: Wert ist ein JSON-String. Verwende einfache Anführungszeichen
   ('), keine doppelten ("). Der Apply-Script strippt doppelte Quotes
   trotzdem als Sicherheit — kein Build-Bruch möglich.

---

## AUFGABE 2 — Form-Enhancements (nur wenn `formEnhancements`-Feld vorhanden)

Befolge die Heuristik unten für fieldOrder, defaults UND computed. Sei bei
defaults großzügig (Datum=heute, Anzahl=1, Status=erster offener Eintrag, …).
Schreibe die Datei unter `formEnhancements.configPath` mit Write vollständig
neu. Format:

```ts
import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  // fieldOrder-Einträge sind ENTWEDER Strings ODER { row: [...], cols?: '...' }-
  // Objekte für Spalten-Layouts (PLZ+Ort, Vorname+Nachname, etc.). Der Python-
  // Generator hat row-Pairs im Skeleton vorgesetzt — behandle sie als unteilbare
  // Atoms: umsortieren OK, in einzelne Strings auflösen verboten.
  fieldOrder: ['key1', { row: ['plz','ort'], cols: '1fr 2fr' }, 'key2', ...],
  defaults: {
    // type 'date/date' → ohne withTime
    'datum':   { kind: 'today' },
    // type 'date/datetimeminute' → withTime: true (sonst falsches Format!)
    'anreise': { kind: 'today',       withTime: true },
    'abreise': { kind: 'todayOffset', days: 3, withTime: true },
    // KEIN literal-Default für `naechte` o.ä., wenn der Key in `computed` als
    // dateDiff vorkommt — siehe Regel unten "computed schlägt default NICHT".
    // 'naechte': { kind: 'literal', value: 1 },  ← FALSCH bei dateDiff-computed
    'status':  { kind: 'lookup', key: 'offen', label: 'Offen' },
  },
  computed: {                                         // sei großzügig — lieber produzieren als weglassen
    // MODUS 1: Formel als String — Standard, immer bevorzugen.
    // Erlaubte Bausteine: field(key), applookup(ownKey, lookupKey),
    // dateDiff(from, to, days|hours), bare Zahlen, + - * /, Klammern.
    // Ein Build-Step parst die Strings vor `npm run build` zu Trees.
    'mwst':        'field(netto) * 0.19',
    'gesamtpreis': 'applookup(zimmer, tagespreis) * dateDiff(anreise, abreise, days) + applookup(zusatzleistung, preis)',
    // MODUS 2: Inline-Funktion — NUR wenn Formel nicht reicht (Conditionals,
    // Schleifen, Multi-Lookup-Summen, Lookup-Switches). Pure Funktion mit ctx-API.
    // NUR ZAHLEN: computed berechnet Beträge/Anzahlen/Dauern, NIE ein Datum und
    // nie einen Text — ein String-Return ist TS2322. Datums-Vorbelegung gehört
    // in defaults ({ kind: 'todayOffset', days: n }).
    //   FALSCH: 'faelligkeitsdatum': (_f, ctx) => `${y}-${m}-${d}`
    //   RICHTIG: defaults: { 'faelligkeitsdatum': { kind: 'todayOffset', days: 30 } }
    // Eigene Formularfelder IMMER über ctx.num(key) lesen — liefert number
    // (fehlend/leer → 0). ctx.field(key) ist der Rohwert für String-Vergleiche;
    // damit zu rechnen bricht den Build.
    //   FALSCH: const netto = ctx.field('preis') ?? 0; return netto * 0.19;
    //   RICHTIG: return ctx.num('preis') * 0.19;
    // ctx.num/ctx.field lesen NUR echte Felder, KEINE anderen computed-Keys
    // (die liefern 0) — Zwischenwerte in der Funktion selbst berechnen.
    'gesamtpreis_mit_einheit': (fields, ctx) => {
      const basis  = (ctx.applookup('zimmer','tagespreis') ?? 0)
                   * (ctx.dateDiff('anreise','abreise') ?? 0);
      const zPreis = ctx.applookup('zusatzleistung','preis') ?? 0;
      const e      = ctx.applookupAny('zusatzleistung','preiseinheit');
      const k      = (e && typeof e === 'object' && 'key' in e) ? (e as {key:string}).key : (typeof e === 'string' ? e : null);
      const n      = ctx.dateDiff('anreise','abreise') ?? 0;
      const zusatz = k === 'pro_tag'   ? zPreis * n
                   : k === 'pro_woche' ? zPreis * (n / 7)
                   :                     zPreis;     // einmalig / sonst
      return basis + zusatz;
    },
  },
};
```

Im Formel-Modus normale Mathematik: `*` und `/` binden stärker als `+` und `-`,
Klammern zum Gruppieren erlaubt. Im Funktions-Modus DARF NUR `ctx.*` aufgerufen
werden — kein fetch, kein localStorage, kein eval. Bei fehlenden Operanden
returne `null` oder behandle als 0 — niemals NaN durchreichen.

---

## GANZ AM ENDE (zwei Schritte, in dieser Reihenfolge)

1. Schreibe `.form-polish-report.json` (mit Write-Tool, nicht Bash) im Format:

```json
{
  "entities": {
    "Auftraege": {
      "placeholders_set":  9,
      "defaults_keys":    ["auftragsdatum", "status", "arbeitsstunden"],
      "computed_keys":    ["arbeitskosten", "summe_arbeiten", "gesamt"],
      "reason":           "Stunden × Stundensatz (Applookup Mitarbeiter) + Material × Preis"
    },
    "Kunden": {
      "placeholders_set":  9,
      "defaults_keys":    [],
      "computed_keys":    [],
      "reason":           "Reine Stammdaten, nichts berechenbar"
    }
  }
}
```

Eine Zeile pro Entity. `reason` ist Pflicht — bei leerem `computed_keys` MUSST
du erklären warum (nichts berechenbar / keine Applookup-Kette / kein
Numerikfeld …).

2. ERST DANACH: `rm /home/user/app/.placeholder-tasks.json`

Kurze Status-Antwort. Keine Re-Reads.
"""

SUBAGENT_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep"]

# ── System prompt variants ──────────────────────────────────────────

# Phase 1 (dashboard): identical to actions branch — full detailed rules
SYSTEM_APPEND_DASHBOARD = (
    "MANDATORY RULES (highest priority):\n"
    "- No design_brief.md — analyze data in 1-2 sentences, then implement directly\n"
    "- DashboardOverview.tsx: Call Read('src/pages/DashboardOverview.tsx') FIRST, then Write ONCE with complete content. Never read back after writing. Keep the DashboardSkeleton/DashboardError import (@/components/DashboardStates) and the two early-returns — never re-implement them.\n"
    "- NEVER use Bash for file operations (no cat, echo, heredoc, >, >>). ALWAYS use Read/Write/Edit tools. If a tool fails, retry with the SAME tool — never fall back to Bash.\n"
    "- index.css: NEVER touch — pre-generated design system (font, colors, sidebar). Use existing tokens.\n"
    "- Layout.tsx: APP_TITLE is pre-set to the appgroup name. Do NOT edit unless you need a different title.\n"
    "- CRUD pages/dialogs: NEVER touch — complete with all logic\n"
    "- App.tsx, PageShell.tsx, StatCard.tsx, ConfirmDialog.tsx: NEVER touch\n"
    "- No Read-back after Write/Edit\n"
    "- No Read of files whose contents are in .scaffold_context or the .scaffold_files_p* parts\n"
    "- Read .scaffold_context FIRST, then each .scaffold_files_p* part it lists (one Read each) to understand all generated files\n"
    "- useDashboardData.ts, enriched.ts, enrich.ts, formatters.ts, ai.ts, ChatWidget.tsx: NEVER touch — use as-is\n"
    "- src/config/ai-features.ts: MAY edit — set AI_PHOTO_SCAN['Entity'] = true to enable photo scan in dialogs\n"
    "- Rules of Hooks: ALL hooks (useState, useEffect, useMemo, useCallback) MUST be BEFORE any early returns (loading/error). Never place a hook after 'if (loading) return' or 'if (error) return'.\n"
    "- IMPORT HYGIENE: Only import what you actually use. TypeScript strict mode errors on unused imports. BEFORE calling Write, mentally trace every import — if it doesn't appear in the JSX/logic body, remove it.\n"
    "- Dashboard is the PRIMARY WORKSPACE — build interactive domain-specific UI, not an info page\n"
    "- ALWAYS reuse pre-generated {Entity}Dialog from '@/components/dialogs/{Entity}Dialog' for create/edit forms in the dashboard — never build custom forms\n"
    "- TOUCH-FRIENDLY: NEVER hide action buttons/icons behind hover (no opacity-0 group-hover:opacity-100). All interactive elements must be visible without hovering.\n"
    "- After 'npm run build' succeeds, STOP immediately. Do not write summaries."
)

# Phase 2 (intents) / "all" mode: lighter orchestrator rules
SYSTEM_APPEND_ORCHESTRATOR = (
    "MANDATORY RULES (highest priority):\n"
    "- NEVER use Bash for file operations (no cat, echo, heredoc, >, >>). ALWAYS use Read/Write/Edit tools.\n"
    "- index.css: NEVER touch — pre-generated design system. CRUD pages/dialogs: NEVER touch.\n"
    "- Layout.tsx: NEVER touch — sidebar navigation is pre-generated.\n"
    "- useDashboardData.ts, enriched.ts, enrich.ts, formatters.ts, ai.ts, ChatWidget.tsx: NEVER touch\n"
    "- Rules of Hooks: ALL hooks MUST be BEFORE any early returns.\n"
    "- IMPORT HYGIENE: Only import what you actually use.\n"
    "- After 'npm run build' succeeds, STOP immediately."
)


async def main():
    # Build phase support for two-phase builds
    build_phase = os.getenv('BUILD_PHASE', 'all')  # "dashboard", "intents", or "all"

    # Subagent definitions. form_polish is registered in every phase (also
    # "dashboard") so the main-agent can dispatch it via subagent_type="form_polish"
    # without having to read a prompt file from disk. intent_builder is only
    # needed when the build includes the intents phase.
    agents = {
        "form_polish": AgentDefinition(
            description="Polishes generated CRUD forms: fills placeholder=\"\" with helpful hints, writes per-entity formEnhancements configs (fieldOrder, defaults, computed formulas), and produces .form-polish-report.json. Runs from .placeholder-tasks.json as task list.",
            prompt=FORM_POLISH_PROMPT,
            tools=SUBAGENT_TOOLS,
            model="haiku",
        ),
    }
    if build_phase in ("intents", "all"):
        agents["intent_builder"] = AgentDefinition(
            description="Builds one intent-specific UI page from scratch. Give it the file path to create and the intent description.",
            prompt=INTENT_BUILDER_PROMPT,
            tools=SUBAGENT_TOOLS,
            model="inherit",
        )

    # Select system prompt based on build phase
    if build_phase == "dashboard":
        system_append = SYSTEM_APPEND_DASHBOARD
    else:
        system_append = SYSTEM_APPEND_ORCHESTRATOR

    options = ClaudeAgentOptions(
        hooks={
            "PreToolUse": [HookMatcher(matcher="Read", hooks=[_block_subagent_files_for_main_agent], timeout=10)],
            "PostToolUse": [HookMatcher(matcher=None, hooks=[_on_post_tool_use], timeout=60)],
        },
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
            "append": system_append,
        },
        thinking={"type": "disabled"},
        setting_sources=["project"],
        permission_mode="bypassPermissions",
        disallowed_tools=["TodoWrite", "NotebookEdit", "WebFetch", "ExitPlanMode", "SlashCommand"],
        cwd="/home/user/app",
        model="claude-sonnet-4-6",
    )

    options.agents = agents

    # Session-Resume Unterstützung
    # BUG: agents + resume crashes the Claude CLI (tested SDK 0.1.50 + 0.1.58).
    # When `form_polish` runs as a formal AgentDefinition in Phase 1, the JSONL
    # contains `subagent_type="form_polish"` tool-use blocks. On resume the CLI
    # replays those blocks and tries to resolve the agent — if we drop `agents`,
    # the type lookup fails inside __aenter__ and the SDK crashes before any of
    # our code runs.
    #
    # The reverse trade-off works: keep agents registered, drop the resume.
    # Phase 2 then starts as a fresh session (no Phase-1 conversation history),
    # but the agent registry stays consistent and `intent_builder` can still run.
    resume_session_id = os.getenv('RESUME_SESSION_ID')
    if agents and resume_session_id:
        print(f"[KLAR] Skipping resume (agents + resume = SDK crash)")
        resume_session_id = None
    if resume_session_id:
        options.resume = resume_session_id
        print(f"[KLAR] Resuming session: {resume_session_id}")

    # User Prompt - prefer file over env var (handles special chars better)
    user_prompt = None

    prompt_file = "/home/user/app/.user_prompt"
    if os.path.exists(prompt_file):
        try:
            with open(prompt_file, 'r') as f:
                user_prompt = f.read().strip()
            if user_prompt:
                print(f"[KLAR] Prompt aus Datei gelesen: {len(user_prompt)} Zeichen")
        except Exception as e:
            print(f"[KLAR] Fehler beim Lesen der Prompt-Datei: {e}")

    if not user_prompt:
        user_prompt = os.getenv('USER_PROMPT')
        if user_prompt:
            print(f"[KLAR] Prompt aus ENV gelesen")

    # Build instructions — optional user notes for fresh builds (NOT continue mode)
    user_instructions = None
    instructions_file = "/home/user/app/.user_instructions"
    if os.path.exists(instructions_file):
        try:
            with open(instructions_file, 'r') as f:
                user_instructions = f.read().strip()
            if user_instructions:
                print(f"[KLAR] User instructions aus Datei gelesen: {len(user_instructions)} Zeichen")
        except Exception as e:
            print(f"[KLAR] Fehler beim Lesen der User-Instructions-Datei: {e}")

    if not user_instructions:
        user_instructions = os.getenv('USER_INSTRUCTIONS')
        if user_instructions:
            print(f"[KLAR] User instructions aus ENV gelesen")

    if user_prompt:
        # Continue/Resume-Mode: Custom prompt vom User (no subagents, direct editing)
        query = f"""🚨 AUFGABE: Du MUSST das existierende Dashboard ändern!

User-Anfrage: "{user_prompt}"

PFLICHT-SCHRITTE (alle müssen ausgeführt werden):

1. LESEN: Lies src/pages/DashboardOverview.tsx um die aktuelle Struktur zu verstehen
2. ÄNDERN: Implementiere die User-Anfrage mit dem Edit-Tool
3. TESTEN: Führe 'npm run build' aus um sicherzustellen dass es kompiliert
4. BAUEN: Führe 'npm run build' aus. Bei Fehler: fixen und erneut bauen bis es klappt.

⚠️ KRITISCH:
- Du MUSST Änderungen am Code machen (Edit-Tool verwenden!)
- Analysieren alleine reicht NICHT - du musst HANDELN!
- Deployment passiert automatisch nach deiner Arbeit — deploye NICHT manuell!

Das Dashboard existiert bereits. Mache NUR die angeforderten Änderungen, nicht mehr.
Starte JETZT mit Schritt 1!"""
        print(f"[KLAR] Continue-Mode mit User-Prompt: {user_prompt}")

    elif build_phase == "dashboard":
        # Phase 1: Identical to actions branch — direct agent, no orchestrator overhead
        query = (
            "Read .scaffold_context (plus the .scaffold_files_p* parts it lists, one Read each) and app_metadata.json. "
            "Analyze data, decide UI paradigm in 1-2 sentences, then implement directly. "
            "Follow .claude/skills/frontend-impl/SKILL.md. "
            "Use existing types and services from src/types/ and src/services/. "
            "Only import what you actually use — TypeScript strict mode errors on unused imports. "
            "Run 'npm run build' when done. Deployment is automatic."
        )

        if user_instructions:
            query += (
                f"\n\nADDITIONAL user instructions (treat as MINIMUM requirements, not as limits):\n"
                f"<user-instructions>\n{user_instructions}\n</user-instructions>\n"
                f"You MUST still build the full dashboard with all features you think are useful for the users — "
                f"analyze the data, decide the best UI paradigm, and implement everything you normally would. "
                f"The user instructions above are ADDITIONS on top of your normal work, not replacements. "
                f"Implement both: everything you would build anyway PLUS what the user asked for."
            )
            print(f"[KLAR] Phase 1: Dashboard build MIT User Instructions: {user_instructions}")
        else:
            print(f"[KLAR] Phase 1: Dashboard build (direct, no subagent)")

    elif build_phase == "intents":
        # Phase 2: Only intent builders — dashboard already deployed
        query = """\
You are the BUILD ORCHESTRATOR (Phase 2 — Intent UIs only). \
Read .entity_summary (short, ~30 lines) for entity info. Do NOT read .scaffold_context or app_metadata.json.

## WHAT ARE INTENT UIs?

Every entity ALREADY has a full CRUD page (table + search + create/edit/delete). Intent UIs are NOT more CRUD pages \
with different styling. They are TASK WORKFLOWS.

An intent UI is a MULTI-STEP WIZARD that:
- Spans MULTIPLE entities in one flow (selecting from entity A → creating linked records in entity B and C)
- Has STEPS (wizard/stepper pattern with clear step progression)
- Often creates MULTIPLE records in a single flow (e.g., inviting 20 guests = 20 invitation records)
- Shows LIVE FEEDBACK as the user progresses (running totals, counts, progress bar, budget remaining)
- Has a clear START → END (user begins task → user completes task with a result)
- Supports deep-linking to specific steps via URL params (e.g., ?eventId=xxx&step=2)

## CRITICAL: NO REDUNDANT INTENTS

Each intent MUST be a UNIQUE workflow that does NOT overlap with other intents. \
If one wizard has steps A→B→C, do NOT create separate intent pages for step B and step C — \
instead, make the wizard support deep-linking to specific steps via URL query params.

EXAMPLE — WRONG (redundant):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
- "Manage RSVPs" page: pick event → update guest statuses  ← THIS IS JUST STEP 2 OF THE WIZARD!
- "Book Vendors" page: pick event → browse vendors → book them  ← THIS IS JUST STEP 3 OF THE WIZARD!

EXAMPLE — CORRECT (each intent is unique):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
  - Dashboard links to specific steps: ?eventId=xxx&step=2 for guest management
- "Close Event" wizard: pick event → review payment statuses → finalize RSVPs → set event to completed → generate report
  - This is a DIFFERENT lifecycle phase, not a subset of "Prepare"

RULE: Before finalizing your intent list, check each pair — if intent B is a subset of intent A's steps, \
DELETE intent B and add deep-link support to intent A instead.

BAD (these are just CRUD with lipstick — DO NOT BUILD THESE):
- ❌ A table of records with nicer filters (= the CRUD page already does this)
- ❌ A kanban board showing one entity grouped by status (= a dashboard widget, not a workflow)
- ❌ A single-entity form with extra styling (= that's just the existing dialog)
- ❌ A read-only status overview (= belongs on the dashboard, not a separate page)

## YOUR JOB (INTENT PHASE ONLY)

The DashboardOverview.tsx is ALREADY BUILT and deployed. Do NOT rebuild it from scratch.

1. ANALYZE entities, fields, relationships. Identify 2-3 DISTINCT multi-entity workflow phases.

**DECISION GATE — MOST WORKFLOWS BELONG IN THE DASHBOARD, NOT IN INTENT UIs:** \
The dashboard already has interactive, domain-specific UIs with full CRUD. \
Intent UIs are separate pages — they are ONLY justified when a workflow is SO COMPLEX \
that it would overload the dashboard (5+ steps, 3+ entities in a single flow, \
branching logic, or heavy state tracking like budgets/progress across steps). \
\
Ask yourself: "Can this workflow be handled by the dashboard + existing CRUD dialogs?" \
If YES → skip intent UIs, just run 'npm run build' and STOP. \
\
SKIP intent UIs when: \
- The app has fewer than 4 entities \
- Workflows can be handled by the dashboard + existing CRUD dialogs \
- There are no workflows spanning 3+ entities in a single multi-step sequence \
\
Only proceed if there is at least ONE workflow that genuinely \
cannot fit in the dashboard because of its complexity. \
\
**IF SKIPPING:** The sidebar currently shows ghost rows ("Abläufe — werden erstellt …"). \
You MUST clean them up before stopping: \
1. Edit src/config/intents.ts — change `export const INTENTS_PENDING = true;` \
   to `export const INTENTS_PENDING = false;` (one-line Edit, nothing else) \
2. Run 'npm run build' and STOP.

2. IF intent UIs are justified, DISPATCH 'intent_builder' subagents IN PARALLEL (in a single response) for each intent:
   - File path: src/pages/intents/{PascalCaseName}Page.tsx
   - DETAILED step-by-step description: what are the STEPS of the workflow, which entities are touched \
in each step, what records get created/updated, what live feedback to show between steps
   - Tell it to USE these pre-generated shared components (already available, no need to rebuild):
     * IntentWizardShell from '@/components/blocks/IntentWizardShell' — wizard container with step indicator, \
deep-linking (?step=N), loading/error. Props: steps, currentStep, onStepChange, loading, error, children. \
Each step must provide its own action/navigation buttons — the shell does NOT render back/next buttons.
     * EntitySelectStep from '@/components/blocks/EntitySelectStep' — reusable "pick an item" step with search. \
Props: items (id, title, subtitle, status, stats), onSelect
     * BudgetTracker from '@/components/blocks/BudgetTracker' — budget progress bar. Props: budget, booked
     * StatusBadge from '@/components/blocks/StatusBadge' — universal status badge. Props: statusKey, label
   - Tell it to import types, APP_IDS, LivingAppsService, extractRecordId, createRecordUrl from the scaffold
   - Remind: lookup fields when WRITING use plain string keys, NOT {key, label} objects
   - CRITICAL — do NOT use any pre-generated {Entity}Dialog inside the intent UI. \
The {Entity}Dialog components are the generic CRUD forms with every field and a photo-scan modal — \
they break the intent flow. The intent builder MUST build a task-tailored inline UI per step, \
showing only the fields relevant for that step's decision and the most ergonomic input method \
(date-range picker, tile-style multi-select, live total card, etc.). Submit calls \
LivingAppsService.create<X>Entry() directly with correctly formatted fields (lookup = plain key string, \
applookup = full URL via createRecordUrl, multipleapplookup = string[] of URLs).

DO NOT dispatch 'dashboard_builder'.

3. After ALL intent_builder subagents complete:
   - Edit src/App.tsx to add lazy imports and routes for the new intent pages.
     CRITICAL: imports ONLY inside the `// <custom:imports>` markers, routes ONLY
     inside the `{/* <custom:routes> */}` markers; keep everything else intact.
   - Edit src/config/intents.ts to REGISTER every intent page — that puts it into
     the SIDEBAR ("Abläufe" section renders from this registry; do NOT add any
     navigation cards to the dashboard):
     * icon imports inside `// <custom:intent-imports>`, entries inside `// <custom:intents>`
     * entry shape: { path: '/intents/{slug}', label: '1-3 German words', icon: IconX, description: 'one line' }
     * `path` must equal the App.tsx route; pick a fitting Tabler icon (COMPONENT reference, not JSX)
     * Also change `export const INTENTS_PENDING = true;` to `false` — this swaps the
       sidebar's ghost rows for your real entries
   - Run 'npm run build', fix any TypeScript errors, keep fixing until build succeeds

4. After 'npm run build' succeeds, STOP immediately.

CRITICAL: Dispatch ALL intent_builder subagents in a SINGLE response for maximum parallelism."""

        print(f"[KLAR] Phase 2: Intents-only build")

    else:
        # Build-Mode (all): Orchestrator dispatches subagents for dashboard + intent UIs
        query = """\
You are the BUILD ORCHESTRATOR. Read .entity_summary (short, ~30 lines) for entity info. Do NOT read .scaffold_context or app_metadata.json — they are too large and waste time.

## WHAT ARE INTENT UIs?

Every entity ALREADY has a full CRUD page (table + search + create/edit/delete). Intent UIs are NOT more CRUD pages \
with different styling. They are TASK WORKFLOWS.

An intent UI is a MULTI-STEP WIZARD that:
- Spans MULTIPLE entities in one flow (selecting from entity A → creating linked records in entity B and C)
- Has STEPS (wizard/stepper pattern with clear step progression)
- Often creates MULTIPLE records in a single flow (e.g., inviting 20 guests = 20 invitation records)
- Shows LIVE FEEDBACK as the user progresses (running totals, counts, progress bar, budget remaining)
- Has a clear START → END (user begins task → user completes task with a result)
- Supports deep-linking to specific steps via URL params (e.g., ?eventId=xxx&step=2)

## CRITICAL: NO REDUNDANT INTENTS

Each intent MUST be a UNIQUE workflow that does NOT overlap with other intents. \
If one wizard has steps A→B→C, do NOT create separate intent pages for step B and step C — \
instead, make the wizard support deep-linking to specific steps via URL query params.

EXAMPLE — WRONG (redundant):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
- "Manage RSVPs" page: pick event → update guest statuses  ← THIS IS JUST STEP 2 OF THE WIZARD!
- "Book Vendors" page: pick event → browse vendors → book them  ← THIS IS JUST STEP 3 OF THE WIZARD!

EXAMPLE — CORRECT (each intent is unique):
- "Prepare Event" wizard: pick event → invite guests → book vendors → summary
  - Dashboard links to specific steps: ?eventId=xxx&step=2 for guest management
- "Close Event" wizard: pick event → review payment statuses → finalize RSVPs → set event to completed → generate report
  - This is a DIFFERENT lifecycle phase, not a subset of "Prepare"

RULE: Before finalizing your intent list, check each pair — if intent B is a subset of intent A's steps, \
DELETE intent B and add deep-link support to intent A instead. Only keep intents that represent \
DIFFERENT phases or completely different multi-entity workflows.

BAD (these are just CRUD with lipstick — DO NOT BUILD THESE):
- ❌ A table of records with nicer filters (= the CRUD page already does this)
- ❌ A kanban board showing one entity grouped by status (= a dashboard widget, not a workflow)
- ❌ A single-entity form with extra styling (= that's just the existing dialog)
- ❌ A read-only status overview (= belongs on the dashboard, not a separate page)

## YOUR JOB

1. ANALYZE entities, fields, relationships. Think: what real-world MULTI-ENTITY WORKFLOWS do users perform? \
A workflow always involves creating/updating records across 2+ entities in a sequence of steps. \
Identify 2-3 DISTINCT workflow phases (e.g., preparation phase vs. closing phase vs. reporting phase). \
Check for redundancy — if two workflows share most steps, merge them into one wizard with deep-linking.

**DECISION GATE — MOST WORKFLOWS BELONG IN THE DASHBOARD, NOT IN INTENT UIs:** \
The dashboard agent already builds interactive, domain-specific UIs with full CRUD. \
Intent UIs are separate pages — they are ONLY justified when a workflow is SO COMPLEX \
that it would overload the dashboard (5+ steps, 3+ entities in a single flow, \
branching logic, or heavy state tracking like budgets/progress across steps). \
\
Ask yourself: "Can the dashboard agent build this as a section or interactive widget \
on the main page?" If YES → it belongs in the dashboard, NOT in an intent UI. \
\
SKIP intent UIs when: \
- The app has fewer than 4 entities \
- Workflows can be handled by the dashboard + existing CRUD dialogs \
- There are no workflows spanning 3+ entities in a single multi-step sequence \
\
Only proceed with intent UIs if there is at least ONE workflow that genuinely \
cannot fit in the dashboard because of its complexity. \
\
**IF SKIPPING:** The sidebar currently shows ghost rows ("Abläufe — werden erstellt …"). \
You MUST clean them up before stopping: \
1. Edit src/config/intents.ts — change `export const INTENTS_PENDING = true;` \
   to `export const INTENTS_PENDING = false;` (one-line Edit, nothing else) \
2. Run 'npm run build' and STOP.

2. IF intent UIs are justified, DISPATCH ALL SUBAGENTS IN PARALLEL (in a single response):
   a) For EACH intent, dispatch 'intent_builder' with:
      - File path: src/pages/intents/{PascalCaseName}Page.tsx
      - DETAILED step-by-step description: what are the STEPS of the workflow, which entities are touched \
in each step, what records get created/updated, what live feedback to show between steps
      - Tell it to USE these pre-generated shared components (already available, no need to rebuild):
        * IntentWizardShell from '@/components/blocks/IntentWizardShell' — wizard container with step indicator, \
deep-linking (?step=N), loading/error. Props: steps, currentStep, onStepChange, loading, error, children. \
Each step must provide its own action/navigation buttons — the shell does NOT render back/next buttons.
        * EntitySelectStep from '@/components/blocks/EntitySelectStep' — reusable "pick an item" step with search. \
Props: items (id, title, subtitle, status, stats), onSelect
        * BudgetTracker from '@/components/blocks/BudgetTracker' — budget progress bar. Props: budget, booked
        * StatusBadge from '@/components/blocks/StatusBadge' — universal status badge. Props: statusKey, label
      - Tell it to import types, APP_IDS, LivingAppsService, extractRecordId, createRecordUrl from the scaffold
      - Remind: lookup fields when WRITING use plain string keys, NOT {key, label} objects
      - CRITICAL — do NOT use any pre-generated {Entity}Dialog inside the intent UI. \
The {Entity}Dialog components are the generic CRUD forms with every field and a photo-scan modal — \
they break the intent flow. The intent builder MUST build a task-tailored inline UI per step, \
showing only the fields relevant for that step's decision and the most ergonomic input method \
(date-range picker, tile-style multi-select, live total card, etc.). Submit calls \
LivingAppsService.create<X>Entry() directly with correctly formatted fields (lookup = plain key string, \
applookup = full URL via createRecordUrl, multipleapplookup = string[] of URLs).

3. After ALL subagents complete:
   - Edit src/App.tsx to add lazy imports and routes for the new intent pages.
     CRITICAL: imports ONLY inside the `// <custom:imports>` markers, routes ONLY
     inside the `{/* <custom:routes> */}` markers; keep everything else intact.
   - Edit src/config/intents.ts to REGISTER every intent page — that puts it into
     the SIDEBAR ("Abläufe" section renders from this registry; do NOT add any
     navigation cards to the dashboard):
     * icon imports inside `// <custom:intent-imports>`, entries inside `// <custom:intents>`
     * entry shape: { path: '/intents/{slug}', label: '1-3 German words', icon: IconX, description: 'one line' }
     * `path` must equal the App.tsx route; pick a fitting Tabler icon (COMPONENT reference, not JSX)
     * Also change `export const INTENTS_PENDING = true;` to `false` — this swaps the
       sidebar's ghost rows for your real entries
   - Run 'npm run build', fix any TypeScript errors, keep fixing until build succeeds

4. After 'npm run build' succeeds, STOP immediately.

CRITICAL: Dispatch ALL subagents in a SINGLE response for maximum parallelism."""

        if user_instructions:
            query += (
                f"\n\nADDITIONAL user instructions:\n"
                f"<user-instructions>\n{user_instructions}\n</user-instructions>"
            )
            print(f"[KLAR] Orchestrator-Mode MIT User Instructions: {user_instructions}")
        else:
            print(f"[KLAR] Orchestrator-Mode: Dashboard + Intent UIs")

    t_agent_total_start = time.time()
    print(f"[KLAR] Initialisiere Client")

    async with ClaudeSDKClient(options=options) as client:

        await client.query(query)

        t_last_step = t_agent_total_start

        # Stall watchdog: the SDK retries rate-limited API calls silently, so
        # a 429-backoff looks like a multi-minute hole in the stream. One
        # line per 30s of silence makes the wait visible as it happens.
        last_event = {"t": time.time()}

        async def _stall_watchdog():
            reported = 0.0
            while True:
                await asyncio.sleep(15)
                silent = time.time() - last_event["t"]
                if silent >= 30 and silent >= reported + 30:
                    reported = silent
                    print(
                        f"[WAIT] {round(silent)}s ohne Modell-Event "
                        f"(Rate-Limit-Backoff oder lange Generierung)",
                        flush=True,
                    )
                elif silent < 30:
                    reported = 0.0

        watchdog = asyncio.create_task(_stall_watchdog())

        async for message in client.receive_response():
            now = time.time()
            last_event["t"] = now
            elapsed = round(now - t_agent_total_start, 1)
            dt = round(now - t_last_step, 1)
            t_last_step = now

            if isinstance(message, AssistantMessage):
                actor = _actor_fields(message.parent_tool_use_id)
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(json.dumps({"type": "think", "content": block.text, "t": elapsed, "dt": dt, "model": message.model, **actor}), flush=True)

                    elif isinstance(block, ToolUseBlock):
                        print(json.dumps({"type": "tool", "tool": block.name, "tool_use_id": block.id, "input": str(block.input), "t": elapsed, "dt": dt, "model": message.model, **actor}), flush=True)

            elif isinstance(message, UserMessage):
                if isinstance(message.content, list):
                    actor = _actor_fields(message.parent_tool_use_id)
                    for block in message.content:
                        if isinstance(block, ToolResultBlock) and _LOG_LEVEL == "debug":
                            content = str(block.content)[:4000] if block.content else ""
                            print(json.dumps({"type": "tool_result", "tool_use_id": block.tool_use_id, "output": content, "is_error": block.is_error, "t": elapsed, **actor}), flush=True)

            elif isinstance(message, ResultMessage):
                status = "success" if not message.is_error else "error"
                print(f"[KLAR] Session ID: {message.session_id}")

                if message.session_id:
                    try:
                        with open("/home/user/app/.claude_session_id", "w") as f:
                            f.write(message.session_id)
                        print(f"[KLAR] ✅ Session ID in Datei gespeichert")
                    except Exception as e:
                        print(f"[KLAR] ⚠️ Fehler beim Speichern der Session ID: {e}")

                t_agent_total = time.time() - t_agent_total_start
                print(json.dumps({
                    "type": "result",
                    "status": status,
                    "cost": message.total_cost_usd,
                    "session_id": message.session_id,
                    "duration_s": round(t_agent_total, 1),
                    # cache_read vs cache_creation vs input tells whether prompt
                    # caching carried the resumed history or every turn paid full
                    "usage": getattr(message, "usage", None)
                }), flush=True)

        watchdog.cancel()

if __name__ == "__main__":
    import sys
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n[KLAR] FATAL ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
