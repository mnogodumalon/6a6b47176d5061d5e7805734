import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import { LOOKUP_OPTIONS, APP_IDS } from '@/types/app';
import type { Auftraege, Kunden, Material, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconAlertTriangle, IconPlus, IconCheck } from '@tabler/icons-react';

// ── Overlay type union ──────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'kunde'; record: Kunden }
  | { type: 'material'; record: Material }
  | { type: 'position'; record: Auftragspositionen }
  | { type: 'protokoll'; record: Pruefprotokoll };

// ── Kanban columns from schema ──────────────────────────────────────────────
const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(key: string | undefined): KanbanTone {
  if (key === 'in_bearbeitung') return 'primary';
  if (key === 'abgeschlossen') return 'success';
  if (key === 'storniert') return 'default';
  return 'warning'; // offen → needs attention
}

function prioritaetLabel(key: string | undefined): string {
  if (!key) return '';
  const map: Record<string, string> = { dringend: '🔴', hoch: '🟠', normal: '', niedrig: '🔵' };
  return map[key] ?? '';
}

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    setAuftraege,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  // ── Dialog state ────────────────────────────────────────────────────────
  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<EnrichedAuftraege | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();

  const [protokollDialogOpen, setProtokollDialogOpen] = useState(false);
  const [protokollDefaults, setProtokollDefaults] = useState<PruefprotokollDialogDefaults | undefined>();

  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);

  // ── Every hook ABOVE early returns ──────────────────────────────────────
  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap],
  );
  const enrichedAuftragspositionen = useMemo(
    () => enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap }),
    [auftragspositionen, auftraegeMap, materialMap],
  );
  const enrichedPruefprotokoll = useMemo(
    () => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }),
    [pruefprotokoll, auftraegeMap],
  );

  // ── Derived data ─────────────────────────────────────────────────────────
  const offene = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );
  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege],
  );
  const dringend = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend'),
    [enrichedAuftraege],
  );
  const nichtBestanden = useMemo(
    () => pruefprotokoll.filter(p => lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden'),
    [pruefprotokoll],
  );

  // ── Kanban cards ─────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
        const prio = lookupKey(a.fields.prioritaet);
        const prioSign = prioritaetLabel(prio);
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: prioSign
            ? <span>{prioSign} {a.fields.auftragsnummer ?? 'Auftrag'}</span>
            : (a.fields.auftragsnummer ?? 'Auftrag'),
          subtitle: a.kundeName || (a.fields.wunschtermin ? formatDate(a.fields.wunschtermin) : undefined),
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ── Status-Advance helper ─────────────────────────────────────────────────
  const advanceStatus = useCallback(
    async (a: EnrichedAuftraege) => {
      const cur = lookupKey(a.fields.status);
      const next = cur === 'offen' ? 'in_bearbeitung' : cur === 'in_bearbeitung' ? 'abgeschlossen' : null;
      if (!next) return;
      const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
      const prev = a.fields.status;
      // optimistic
      setAuftraege(list =>
        list.map(x =>
          x.record_id === a.record_id
            ? { ...x, fields: { ...x.fields, status: { key: next, label: nextLabel } } }
            : x,
        ),
      );
      undoToast(`${a.fields.auftragsnummer} → ${nextLabel}`, async () => {
        setAuftraege(list =>
          list.map(x =>
            x.record_id === a.record_id
              ? { ...x, fields: { ...x.fields, status: prev } }
              : x,
          ),
        );
        await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: lookupKey(prev) ?? cur! });
      });
      try {
        await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next });
      } catch {
        await fetchAll();
      }
    },
    [setAuftraege, fetchAll],
  );

  // ── onCardMove ───────────────────────────────────────────────────────────
  const moveCard = useCallback(
    async (cardId: string, newColumn: string) => {
      const rid = cardId.split(':')[1];
      if (!rid) return;
      const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
      const prev = auftraege.find(a => a.record_id === rid)?.fields.status;
      setAuftraege(list =>
        list.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
            : a,
        ),
      );
      undoToast(`Status → ${newLabel}`, async () => {
        setAuftraege(list =>
          list.map(a =>
            a.record_id === rid
              ? { ...a, fields: { ...a.fields, status: prev } }
              : a,
          ),
        );
        await LivingAppsService.updateAuftraegeEntry(rid, { status: lookupKey(prev) ?? newColumn });
      });
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
      } catch {
        await fetchAll();
      }
    },
    [auftraege, setAuftraege, fetchAll],
  );

  // ── Context line ─────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (enrichedAuftraege.length === 0) return 'Noch keine Aufträge angelegt.';
    const aktive = inBearbeitung.map(a => a.fields.auftragsnummer ?? a.kundeName);
    if (aktive.length > 0) return `In Bearbeitung: ${namen(aktive)} — ${offene.length} weitere offen.`;
    if (offene.length > 0) return `${offene.length} offene Aufträge warten auf Bearbeitung.`;
    return `Alle ${enrichedAuftraege.length} Aufträge abgeschlossen oder storniert.`;
  }, [enrichedAuftraege, inBearbeitung, offene]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ── plain derivations only below ─────────────────────────────────────────
  const heroAuftraege = dringend.filter(a =>
    ['offen', 'in_bearbeitung'].includes(lookupKey(a.fields.status) ?? ''),
  );

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {gruss(clock)} Handwerk Pro
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => {
            setEditingAuftrag(undefined);
            setAuftraegeDefaults(undefined);
            setAuftraegeDialogOpen(true);
          }}
          className="mt-3 sm:mt-0 flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroAuftraege.length > 0 ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: 'Weiterbearbeiten',
                onClick: () => advanceStatus(heroAuftraege[0]),
              }}
            >
              <b>{namen(heroAuftraege.map(a => a.fields.auftragsnummer ?? a.kundeName ?? ''))}</b>{' '}
              {heroAuftraege.length === 1 ? 'ist' : 'sind'} dringend und warten auf Bearbeitung.
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              tone={offene.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.filter(a => lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert').length}
              tone={dringend.filter(a => lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert').length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Prüfungen nicht bestanden"
              value={nichtBestanden.length}
              tone={nichtBestanden.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['abgeschlossen', 'storniert']}
            onCardClick={card => {
              const rid = card.id.split(':')[1] ?? '';
              const a = enrichedAuftraege.find(x => x.record_id === rid);
              if (a) overlay.replace({ type: 'auftrag', record: a });
            }}
            onCardMove={moveCard}
            onAddCard={column => {
              setEditingAuftrag(undefined);
              setAuftraegeDefaults({ status: column });
              setAuftraegeDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Offene & dringende Aufträge"
              items={[
                ...dringend.filter(a => ['offen', 'in_bearbeitung'].includes(lookupKey(a.fields.status) ?? '')),
                ...offene.filter(a => lookupKey(a.fields.prioritaet) !== 'dringend'),
              ].slice(0, 8).map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? 'Auftrag',
                secondLine: (
                  <>
                    <span className={lookupKey(a.fields.prioritaet) === 'dringend' ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                      {a.fields.status?.label ?? '—'}
                    </span>
                    {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
                  </>
                ),
                action: lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'
                  ? { label: '✓ Weiter', onClick: () => advanceStatus(a) }
                  : undefined,
              }))}
              onItemClick={id => {
                const a = enrichedAuftraege.find(x => x.record_id === id);
                if (a) overlay.replace({ type: 'auftrag', record: a });
              }}
              empty={{
                text: 'Alle Aufträge im Plan — super!',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftraegeDefaults(undefined); setAuftraegeDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Letzte Prüfprotokolle"
              items={enrichedPruefprotokoll.slice(-6).reverse().map(p => ({
                id: p.record_id,
                title: `${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll',
                secondLine: (
                  <>
                    <span className={
                      lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden'
                        ? 'font-medium text-destructive'
                        : lookupKey(p.fields.pruefergebnis) === 'bestanden_mit_maengeln'
                        ? 'font-medium text-warning'
                        : 'text-success font-medium'
                    }>
                      {p.fields.pruefergebnis?.label ?? '—'}
                    </span>
                    <span className="text-muted-foreground"> · {p.auftrag_pruefName || '—'}</span>
                  </>
                ),
                action: lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden'
                  ? { label: 'Maßnahmen', onClick: () => {
                      const full = pruefprotokoll.find(x => x.record_id === p.record_id);
                      if (full) overlay.replace({ type: 'protokoll', record: full });
                    }}
                  : undefined,
              }))}
              onItemClick={id => {
                const p = pruefprotokoll.find(x => x.record_id === id);
                if (p) overlay.replace({ type: 'protokoll', record: p });
              }}
              empty={{
                text: 'Noch keine Prüfprotokolle vorhanden.',
                action: { label: 'Protokoll anlegen', onClick: () => setProtokollDialogOpen(true) },
              }}
            />
          </>
        }
      />

      {/* ── Overlay host ─────────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[a.kundeName, a.fields.status?.label].filter(Boolean).join(' · ')}
                  actions={
                    lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert' ? (
                      <button
                        onClick={() => {
                          setEditingAuftrag(a);
                          setAuftraegeDefaults(a.fields as AuftraegeDialogDefaults);
                          setAuftraegeDialogOpen(true);
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                      >
                        Bearbeiten
                      </button>
                    ) : undefined
                  }
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', record: k })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', record: p })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: a.record_id });
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'protokoll', record: p })}
                  onAddPruefprotokoll={() => {
                    setProtokollDefaults({ auftrag_pruef: a.record_id });
                    setProtokollDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = top.record;
            return (
              <>
                <RecordHeader
                  title={`${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() || 'Kunde'}
                  subtitle={k.fields.firma ?? k.fields.ort}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(x => x.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  onAddAuftraege={() => {
                    setAuftraegeDefaults({ kunde: k.record_id });
                    setAuftraegeDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const m = top.record;
            return (
              <>
                <RecordHeader
                  title={m.fields.bezeichnung ?? 'Material'}
                  subtitle={m.fields.artikelnummer}
                />
                <MaterialDetails
                  record={m}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', record: p })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ material: m.record_id });
                    setPositionDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const p = top.record;
            const enriched = enrichedAuftragspositionen.find(x => x.record_id === p.record_id);
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enriched ? `${enriched.auftragName} · ${enriched.materialName}` : undefined}
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enrichedA = enrichedAuftraege.find(x => x.record_id === a.record_id);
                    if (enrichedA) overlay.push({ type: 'auftrag', record: enrichedA });
                  }}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', record: m })}
                />
              </>
            );
          }
          if (top.type === 'protokoll') {
            const p = top.record;
            const enrichedP = enrichedPruefprotokoll.find(x => x.record_id === p.record_id);
            return (
              <>
                <RecordHeader
                  title={`${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={enrichedP?.auftrag_pruefName}
                />
                <PruefprotokollDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enrichedA = enrichedAuftraege.find(x => x.record_id === a.record_id);
                    if (enrichedA) overlay.push({ type: 'auftrag', record: enrichedA });
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            const cur = lookupKey(a.fields.status);
            const next = cur === 'offen' ? 'In Bearbeitung' : cur === 'in_bearbeitung' ? 'Abschließen' : null;
            if (!next) return undefined;
            return {
              label: `✓ ${next}`,
              onClick: () => {
                void advanceStatus(a);
                overlay.close();
              },
            };
          }
          return undefined;
        }}
      />

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => { setAuftraegeDialogOpen(false); setEditingAuftrag(undefined); }}
        onSubmit={async fields => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields as any);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={auftraegeDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => setPositionDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createAuftragspositionenEntry(fields as any);
          fetchAll();
        }}
        defaultValues={positionDefaults}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={protokollDialogOpen}
        onClose={() => setProtokollDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createPruefprotokollEntry(fields as any);
          fetchAll();
        }}
        defaultValues={protokollDefaults}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => setKundenDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createKundenEntry(fields as any);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
