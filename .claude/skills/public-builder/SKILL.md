---
name: public-builder
description: >
  Build or upgrade PUBLIC pages — pages for anonymous visitors without a
  LivingApps account, shared via link/QR. Activate when the user asks for a
  public form, booking page, public list ("freie Termine", Speisekarte,
  offene Stellen), landing/submission page, or wants an existing public
  form to become nicer/custom.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# Public Page Building Skill

Public pages are served at `/#/public/<slug>` to ANONYMOUS visitors. They
talk to a restricted public API through `@/lib/publicClient` — never to
`livingAppsService` (that needs a login and would break for every visitor).

## The contract: you declare, the service grants

You never create permissions yourself. You do exactly three things:

1. **Write the page component** in `src/pages/public/<Pascal>.tsx`.
2. **Register its slug** in `src/pages/public/registry.tsx` (markers only).
3. **Declare its data needs** in `_public/surface.json`.

After the build, the Klar service validates your declaration, creates the
public permissions (as unpublished drafts — the owner publishes with one
click), and serves each page its runtime config in `public-pages.json`.

## Existing pages (upgrade path)

Read `_agent_context/public_pages.json` first. It lists the owner's current
public pages (slug, entity, fields, published). To UPGRADE one (e.g. "make
the registration form a booking page"), reuse its **exact slug** — the
shared link and QR codes keep working. Declaring a changed data policy
automatically un-publishes the page until the owner confirms it again;
that is expected, mention it in your summary.

## Reuse intent flows

`_agent_context/intents.json` (when present) lists the dashboard's internal
workflow pages ("Abläufe"): route, label, a summary docblock, the components
each flow composes and the service methods it writes with. When the requested
public page matches one of these flows — an internal booking wizard and a
requested public booking page are the same flow — mirror its step sequence,
labels, and presentational pieces instead of inventing a new flow. But swap
the data layer completely:

Wrong: copy the intent page keeping `useDashboardData()`,
`LivingAppsService.createBuchungenEntry(...)` or `<BuchungenDialog>` —
every one of these needs a login and dies for anonymous visitors.
Right: same steps and layout; reads become `listPublicRecords` behind a
`scope`, writes become `createPublicRecord`, the form is built from the
page's `fields` config.

## The page component

Compose from `PublicShell` + blocks + widgets; data flows only through
`publicClient`:

```tsx
import { useEffect, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig, listPublicRecords, createPublicRecord,
  prepareChallenge, PageUnavailableError,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';

export default function Booking() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig().then(c => {
      setCfg(c);
      setPage(c?.pages['buchung'] ?? null);
      setLoading(false);
    });
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  // list endpoints: listPublicRecords(cfg, page, { appId, limit, offset })
  // create endpoints: createPublicRecord(cfg, page, fields)
  // page.endpoints tells you which app_id serves which op.
  return <PublicShell title={page.title} description={page.description} wide>…</PublicShell>;
}
```

Layout — pick the shell mode by page type:
- Forms and small booking flows: default column, or `wide` (still only
  672px).
- Landing pages: `<PublicShell fullBleed>` — the shell's form columns are
  FAR too narrow for hero sections and card grids. With `fullBleed`, build
  full-width bands and give each section its own inner container
  (`max-w-5xl mx-auto px-4`).

Wrong: a landing page inside `wide` — the 672px column crushes a 3-column
card grid into ~200px cards and truncates every course name and time.
Right: `fullBleed` + full-width hero band + sections with their own
`max-w-5xl` containers; no `truncate` on names, dates, or prices a
visitor must read.

Rules:
- NEVER import `livingAppsService`, `useDashboardData`, or any dialog/page
  from the dashboard — anonymous visitors have no session.
- Call `prepareChallenge(cfg, page, 'POST', `/apps/${appId}/records`)` on
  the first form interaction so submits feel instant.
- Handle `PageUnavailableError` by rendering `<PublicShell unavailable />`.
- Mobile-first; most visitors open a shared link on a phone.

## registry.tsx — markers only

```tsx
// <public:imports>
import { lazy } from 'react';
// </public:imports>
…
  // <public:pages>
  'buchung': lazy(() => import('@/pages/public/Booking')),
  // </public:pages>
```

Never touch `PublicPage.tsx`, `PublicFormPage.tsx`, or `publicClient.ts`.

## _public/surface.json — the declaration

One file, all your public pages. Ops: `list` (read with a filter) and
`create` (anonymous submit). Field names must exist on the entity
(check `app_metadata.json`).

**One flow = ONE page.** Every page is a separate publish decision for the
owner. Declare ALL data a page needs as endpoints of THAT page — one page
may carry several list/create endpoints across different entities
(`page.endpoints` tells the runtime which app_id serves which op).

Wrong: a booking page plus two component-less "list pages" it reads from —
the owner must publish three things before one link works.
Right: one `buchung` page with three endpoints (list slots, list courses,
create booking); one publish, one link.

```json
{
  "version": 1,
  "pages": [{
    "slug": "buchung",
    "component": "Booking",
    "title": "Termin buchen",
    "endpoints": [
      { "entity": "slots", "op": "list",
        "fields": ["slot_start", "slot_end", "slot_label"],
        "scope": "r.v_available == True",
        "scope_description": "zeigt nur Termine mit verfügbar = ja",
        "max_records": 100 },
      { "entity": "buchungen", "op": "create",
        "fields": ["name", "email", "slot"],
        "preset_fields": { "status": "neu" } }
    ]
  }]
}
```

- `scope` is a vSQL filter over `r`. Two hard syntax rules (the server
  probes the expression and rejects the whole page otherwise): fields are
  ALWAYS accessed with the `v_` prefix (`r.v_status`, never `r.status`),
  and the current time is `now()` (`today` does not exist). Example:
  `r.v_einsatz_beginn >= now()`. Keep scopes simple — one or two
  conditions. ALWAYS pair scope with a plain-language `scope_description`
  — the owner confirms that text when publishing, never the vSQL.
- `preset_fields` are server-owned values the visitor can neither see nor
  override; `fields` is the strict allowlist of what a visitor may submit.
- A `required` control in `app_metadata.json` is an INTERNAL duty for the
  team, not an entry duty for a visitor. Ask what the visitor can actually
  know: a table number, an assigned employee, or a confirmation status is
  the team's job AFTER the submit — leave those out of `fields` entirely and
  the record is created with them empty. Only preset a field when a fixed
  value is genuinely correct for every submission (a status like "neu").
- But a field you DO list in `fields` must have a real input in the form.
  Declaring a required field and never sending it makes every submit fail
  with 400 — `check-public.mjs` rejects that.

Wrong: `preset_fields: { "tisch": "…/records/abc" }` — pinning every
visitor to one hard-coded table just to satisfy an internal duty.
Right: `tisch` appears in neither `fields` nor `preset_fields`; the
reservation arrives without a table and the team assigns one.
- Expose the MINIMUM: every field you list is world-readable (list) or
  world-writable (create).
- applookup fields in a LIST projection return the record's reference URL — a
  foreign key. To show the referenced record's data, declare a second list
  endpoint for the target entity on the SAME page and join client-side
  (extract the record id from the URL). file fields are never allowed on
  public lists.
- WRITING an applookup value (a create endpoint, e.g. linking a registration
  to the participant you just created): the anonymous surface accepts ONLY
  grant-scoped URLs. Build them with `recordRef(cfg, page, appId, recordId)`
  from `@/lib/publicClient`, or pass a reference through exactly as a list
  response returned it. Never assemble a record URL yourself.

Wrong: `teilnehmer: \`https://…/rest/apps/${appId}/records/${id}\`` — the
REST form is rejected with 400 "Unsupported field value", and the page
only fails at the LAST step of a multi-create flow.
Right: `teilnehmer: recordRef(cfg, page, tnEp.app_id, created.id)`.

Wrong: page fetches everything and filters client-side
(`fields: [all 12 fields]`, no scope — leaks the whole table).
Right: `scope` narrows the rows server-side, `fields` lists only the 3
columns the page actually shows.

## Reusable blocks

Extract reusable presentational pieces (slot grid, option tiles, stepper)
to `src/components/blocks/` — props in, callbacks out, NO data-client
imports (`scripts/check-blocks.mjs` enforces this). Blocks are shared with
intent UIs, so keep them auth-agnostic.

Pre-provided flow blocks already live there — compose them instead of
rebuilding steppers: `IntentWizardShell` (wizard container; pass
`back={false}` on public pages — anonymous visitors have no dashboard),
`EntitySelectStep` (searchable pick-an-item list), `BudgetTracker`,
`StatusBadge`.

**One heading per page.** `PublicShell` renders the title and `IntentWizardShell`
renders one too — giving both the same text prints it twice, which is the most
visible flaw a visitor sees.

Wrong: `<PublicShell title="Antrag einreichen"><IntentWizardShell
title="Antrag einreichen" …>` — two identical `<h1>` above each other.
Right: title on `PublicShell`, and `IntentWizardShell` gets only a `subtitle`
(or nothing) — its `title` is optional.

## Before finishing

Run `node scripts/check-public.mjs` and `node scripts/check-blocks.mjs`
(both must be green — check-public verifies the import allowlist and that
every registered slug is declared in surface.json) plus the standard
gates, then `npm run build`. In your summary: name the page's slug, state
that it is a DRAFT until the owner publishes it, and quote the
`scope_description` you declared.
