"""Standalone intent page builder — bypasses the MCP tool validation issue."""
import asyncio
import json
import sys
import dataclasses
from contextlib import aclosing

from claude_agent_sdk import (
    ClaudeAgentOptions, AssistantMessage, ToolUseBlock, TextBlock,
    HookMatcher,
)
from claude_agent_sdk import query as sdk_query

AGENT_MODEL = "claude-sonnet-4-6"
SUBAGENT_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep"]
_INTENT_FLOW_TIMEOUT_S = 600

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
- NO toISOString() ANYWHERE in the file — not even for local display state that never reaches \
the API. The check-intents gate is file-wide and context-free. Use date-fns format() instead.
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
Scope: createRecordUrl builds the AUTHENTICATED /rest form. On public pages use
recordRef(cfg, page, appId, recordId) from '@/lib/publicClient' instead — never createRecordUrl.
"""


def _agent_options(**kwargs) -> ClaudeAgentOptions:
    supported = {f.name for f in dataclasses.fields(ClaudeAgentOptions)}
    return ClaudeAgentOptions(**{k: v for k, v in kwargs.items() if k in supported})


async def build_one(flow: dict, index: int) -> dict:
    file_path = flow["file"]
    brief = flow["brief"]
    print(f"[BUILD] Starting {file_path}", flush=True)

    options = _agent_options(
        system_prompt={"type": "preset", "preset": "claude_code",
                       "append": INTENT_BUILDER_PROMPT},
        allowed_tools=SUBAGENT_TOOLS,
        thinking={"type": "disabled"},
        setting_sources=["project"],
        permission_mode="bypassPermissions",
        cwd="/home/user/app",
        model=AGENT_MODEL,
    )

    texts = []
    import time
    started = time.time()
    try:
        async with asyncio.timeout(_INTENT_FLOW_TIMEOUT_S), aclosing(
            sdk_query(prompt=f"Build the file `{file_path}`.\n\n{brief}", options=options)
        ) as session:
            async for message in session:
                if not isinstance(message, AssistantMessage):
                    continue
                for block in message.content:
                    if isinstance(block, ToolUseBlock):
                        print(f"[BUILD] {file_path}: tool {block.name}", flush=True)
                    elif isinstance(block, TextBlock):
                        texts.append(block.text)
    except TimeoutError:
        return {"file": file_path, "ok": False, "error": f"timed out after {_INTENT_FLOW_TIMEOUT_S}s"}
    except Exception as e:
        return {"file": file_path, "ok": False, "error": f"{type(e).__name__}: {e}"}

    seconds = round(time.time() - started, 1)
    print(f"[BUILD] Done {file_path} in {seconds}s", flush=True)
    return {"file": file_path, "ok": True, "seconds": seconds}


async def main():
    flows = json.loads(sys.argv[1])
    print(f"[BUILD] Fan-out: {len(flows)} pages in parallel", flush=True)
    results = await asyncio.gather(*(build_one(f, i) for i, f in enumerate(flows)))
    for r in results:
        if r["ok"]:
            print(f"OK  {r['file']}", flush=True)
        else:
            print(f"FAILED  {r['file']}: {r['error']}", flush=True)
    return results


if __name__ == "__main__":
    asyncio.run(main())
