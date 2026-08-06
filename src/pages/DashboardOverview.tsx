import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege, EnrichedAuftragspositionen, EnrichedPruefprotokoll } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
  RecordAttachments,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { MaterialDialog } from '@/components/dialogs/MaterialDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconHourglass,
  IconCircleCheck,
  IconPackage,
} from '@tabler/icons-react';

// ─── Overlay union ───────────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'protokoll'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

// ─── Kanban columns from schema ──────────────────────────────────────────────
const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → needs attention
}

function toneForPrioritaet(prio: string | undefined): KanbanTone {
  if (prio === 'dringend') return 'destructive';
  if (prio === 'hoch') return 'warning';
  return 'default';
}

export default function DashboardOverview() {
  const {
    kunden, setKunden, material, setMaterial,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  const enrichedAuftraege = enrichAuftraege(auftraege, { kundenMap });
  const enrichedAuftragspositionen = enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap });
  const enrichedPruefprotokoll = enrichPruefprotokoll(pruefprotokoll, { auftraegeMap });

  // ─── Overlay stack ───────────────────────────────────────────────────────
  const overlay = useRecordOverlayStack<OverlayItem>();

  // ─── Dialog state ────────────────────────────────────────────────────────
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | undefined>(undefined);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | undefined>(undefined);

  const [protokollDialogOpen, setProtokollDialogOpen] = useState(false);
  const [protokollDefaults, setProtokollDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingProtokoll, setEditingProtokoll] = useState<Pruefprotokoll | undefined>(undefined);

  const [kundeDialogOpen, setKundeDialogOpen] = useState(false);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

  // ─── KPI filter ──────────────────────────────────────────────────────────
  const [kpiFilter, setKpiFilter] = useState<'dringend' | 'ueberfaellig' | null>(null);

  // ─── Derived data ────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');
  const startOfToday = startOfDay(clock);

  const aktiveAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege]
  );

  const offenInBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => {
      const s = lookupKey(a.fields.status);
      return s === 'offen' || s === 'in_bearbeitung';
    }),
    [enrichedAuftraege]
  );

  const dringend = useMemo(
    () => offenInBearbeitung.filter(a => lookupKey(a.fields.prioritaet) === 'dringend'),
    [offenInBearbeitung]
  );

  const ueberfaellig = useMemo(
    () => offenInBearbeitung.filter(a => {
      const wunsch = a.fields.wunschtermin;
      if (!wunsch) return false;
      try { return isBefore(parseISO(wunsch), startOfToday); } catch { return false; }
    }),
    [offenInBearbeitung, startOfToday]
  );

  const niedrigerLagerbestand = useMemo(
    () => material.filter(m => {
      const bestand = m.fields.lagerbestand ?? 0;
      const mind = m.fields.mindestbestand ?? 0;
      return bestand < mind;
    }),
    [material]
  );

  // ─── Cards for KanbanWidget ──────────────────────────────────────────────
  const filteredAuftraege = useMemo(() => {
    if (kpiFilter === 'dringend') return enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');
    if (kpiFilter === 'ueberfaellig') return ueberfaellig;
    return enrichedAuftraege;
  }, [enrichedAuftraege, kpiFilter, ueberfaellig]);

  const cards = useMemo<KanbanCard[]>(
    () =>
      filteredAuftraege
        .sort((a, b) => {
          const prioOrder: Record<string, number> = { dringend: 0, hoch: 1, normal: 2, niedrig: 3 };
          const pa = prioOrder[lookupKey(a.fields.prioritaet) ?? 'normal'] ?? 2;
          const pb = prioOrder[lookupKey(b.fields.prioritaet) ?? 'normal'] ?? 2;
          return pa - pb;
        })
        .map(a => {
          const status = lookupKey(a.fields.status) ?? 'offen';
          const prio = lookupKey(a.fields.prioritaet);
          return {
            id: `auftrag:${a.record_id}`,
            column: status,
            title: a.fields.auftragsnummer ?? 'Auftrag',
            subtitle: (
              <span className="flex flex-col gap-0.5">
                <span className="truncate text-muted-foreground">{a.kundeName || '—'}</span>
                {a.fields.wunschtermin && (
                  <span className={`text-[11px] ${isBefore(parseISO(a.fields.wunschtermin), startOfToday) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    Wunsch: {formatDate(a.fields.wunschtermin)}
                  </span>
                )}
              </span>
            ),
            tone: prio === 'dringend' ? 'destructive' : toneForStatus(status),
          };
        }),
    [filteredAuftraege, startOfToday]
  );

  // ─── Status advance helper ───────────────────────────────────────────────
  const advanceStatus = useCallback(async (a: EnrichedAuftraege) => {
    const cur = lookupKey(a.fields.status) ?? 'offen';
    const next = cur === 'offen' ? 'in_bearbeitung' : cur === 'in_bearbeitung' ? 'abgeschlossen' : null;
    if (!next) return;
    const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
    const prev = a.fields.status;
    setAuftraege(prev_list => prev_list.map(x =>
      x.record_id === a.record_id
        ? { ...x, fields: { ...x.fields, status: { key: next, label: nextLabel } } }
        : x
    ));
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next });
      undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, async () => {
        setAuftraege(prev_list => prev_list.map(x =>
          x.record_id === a.record_id ? { ...x, fields: { ...x.fields, status: prev } } : x
        ));
        await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: prev ? (typeof prev === 'object' && 'key' in prev ? (prev as any).key : String(prev)) : cur });
      });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── Kanban move ─────────────────────────────────────────────────────────
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
      undoToast(`Status → ${newLabel}`);
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── All hooks ABOVE early returns ───────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Overlay helpers (after early returns — plain const, no hooks) ────────
  const auftragById = (id: string) => enrichedAuftraege.find(a => a.record_id === id);
  const positionById = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const protokollById = (id: string) => pruefprotokoll.find(p => p.record_id === id);
  const kundeById = (id: string) => kunden.find(k => k.record_id === id);
  const materialById = (id: string) => material.find(m => m.record_id === id);

  // ─── Context line ────────────────────────────────────────────────────────
  const contextLine = dringend.length > 0
    ? `${namen(dringend.map(a => a.fields.auftragsnummer ?? ''))} dringend — bitte priorisieren.`
    : ueberfaellig.length > 0
      ? `${ueberfaellig.length} Auftrag${ueberfaellig.length > 1 ? 'aufträge überfällig' : ' überfällig'} — Wunschtermine verpast.`
      : offenInBearbeitung.length > 0
        ? `${offenInBearbeitung.length} Aufträge aktiv — alles im Zeitplan.`
        : 'Keine offenen Aufträge — Werkzeuge bereit.';

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          dringend.length > 0 ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: `→ In Bearbeitung`,
                onClick: () => advanceStatus(dringend[0]),
              }}
            >
              <b>{namen(dringend.map(a => a.fields.auftragsnummer ?? ''))}</b>{' '}
              {dringend.length === 1 ? 'ist dringend' : 'sind dringend'} — sofortige Bearbeitung erforderlich.
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title="Gesamt aktiv"
              value={aktiveAuftraege.length}
              icon={<IconClipboardList size={16} />}
              tone="default"
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={16} />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
              onClick={() => setKpiFilter(f => f === 'dringend' ? null : 'dringend')}
              active={kpiFilter === 'dringend'}
            />
            <StatStripItem
              title="Überfällig"
              value={ueberfaellig.length}
              icon={<IconHourglass size={16} />}
              tone={ueberfaellig.length > 0 ? 'warning' : 'default'}
              onClick={() => setKpiFilter(f => f === 'ueberfaellig' ? null : 'ueberfaellig')}
              active={kpiFilter === 'ueberfaellig'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen').length}
              icon={<IconCircleCheck size={16} />}
              tone="success"
            />
            <StatStripItem
              title="Lager-Warnungen"
              value={niedrigerLagerbestand.length}
              icon={<IconPackage size={16} />}
              tone={niedrigerLagerbestand.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert', 'abgeschlossen']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
            onCardMove={moveCard}
            onAddCard={column => {
              setAuftragDefaults({ status: column });
              setEditingAuftrag(undefined);
              setAuftragDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Dringend & überfällig"
              items={[...dringend, ...ueberfaellig.filter(a => lookupKey(a.fields.prioritaet) !== 'dringend')]
                .slice(0, 8)
                .map(a => ({
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? 'Auftrag',
                  secondLine: (
                    <span>
                      <span className={lookupKey(a.fields.prioritaet) === 'dringend' ? 'font-medium text-destructive' : 'font-medium text-warning'}>
                        {lookupKey(a.fields.prioritaet) === 'dringend' ? 'Dringend' : 'Überfällig'}
                      </span>
                      <span className="text-muted-foreground">
                        {' · '}{a.kundeName || '—'}
                        {a.fields.wunschtermin ? ` · ${formatDate(a.fields.wunschtermin)}` : ''}
                      </span>
                    </span>
                  ),
                  action: {
                    label: lookupKey(a.fields.status) === 'offen' ? '→ Bearbeitung' : '→ Abschließen',
                    onClick: () => advanceStatus(a),
                  },
                }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alle Aufträge im Zeitplan — prima!',
                action: { label: 'Auftrag erstellen', onClick: () => { setAuftragDefaults(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Lagerbestand unter Minimum"
              items={niedrigerLagerbestand.slice(0, 6).map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? 'Material',
                secondLine: (
                  <span>
                    <span className="font-medium text-warning">Bestand: {m.fields.lagerbestand ?? 0}</span>
                    <span className="text-muted-foreground"> · Min: {m.fields.mindestbestand ?? 0} {m.fields.einheit?.label ?? ''}</span>
                  </span>
                ),
              }))}
              onItemClick={id => overlay.replace({ type: 'material', id })}
              empty={{
                text: 'Alle Materialien ausreichend bevorratet.',
                action: { label: 'Material hinzufügen', onClick: () => setMaterialDialogOpen(true) },
              }}
            />
          </>
        }
      />

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(undefined); setAuftragDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingAuftrag ? editingAuftrag.fields : auftragDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(undefined); setPositionDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPosition ? editingPosition.fields : positionDefaults}
        recordId={editingPosition?.record_id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={protokollDialogOpen}
        onClose={() => { setProtokollDialogOpen(false); setEditingProtokoll(undefined); setProtokollDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingProtokoll) {
            await LivingAppsService.updatePruefprotokollEntry(editingProtokoll.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingProtokoll ? editingProtokoll.fields : protokollDefaults}
        recordId={editingProtokoll?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundeDialogOpen}
        onClose={() => setKundeDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      <MaterialDialog
        open={materialDialogOpen}
        onClose={() => setMaterialDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createMaterialEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Material']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Material']}
      />

      {/* ─── Overlay stack ───────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = auftragById(top.id);
            if (!a) return null;
            const status = lookupKey(a.fields.status) ?? 'offen';
            const nextLabel = status === 'offen' ? '→ In Bearbeitung' : status === 'in_bearbeitung' ? '→ Abschließen' : null;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[a.fields.status?.label, a.fields.prioritaet?.label].filter(Boolean).join(' · ')}
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: a.record_id });
                    setEditingPosition(undefined);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'protokoll', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setProtokollDefaults({ auftrag_pruef: a.record_id });
                    setEditingProtokoll(undefined);
                    setProtokollDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const p = positionById(top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={`Menge: ${p.fields.menge ?? '—'} ${p.fields.einheit_position?.label ?? ''}`}
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'protokoll') {
            const p = protokollById(top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader
                  title={[p.fields.monteur_name_vorname, p.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={p.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = kundeById(top.id);
            if (!k) return null;
            return (
              <>
                <RecordHeader
                  title={[k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={k.fields.firma}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => {
                    setAuftragDefaults({ kunde: k.record_id });
                    setEditingAuftrag(undefined);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const m = materialById(top.id);
            if (!m) return null;
            return (
              <>
                <RecordHeader
                  title={m.fields.bezeichnung ?? 'Material'}
                  subtitle={`${m.fields.lagerbestand ?? 0} ${m.fields.einheit?.label ?? ''} auf Lager`}
                />
                <MaterialDetails
                  record={m}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ material: m.record_id });
                    setEditingPosition(undefined);
                    setPositionDialogOpen(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = auftragById(top.id);
            if (!a) return undefined;
            const status = lookupKey(a.fields.status) ?? 'offen';
            if (status === 'offen') return { label: '→ In Bearbeitung', onClick: () => { advanceStatus(a); overlay.close(); } };
            if (status === 'in_bearbeitung') return { label: '→ Abschließen', onClick: () => { advanceStatus(a); overlay.close(); } };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = auftragById(top.id);
            if (a) { setEditingAuftrag(a); setAuftragDialogOpen(true); }
          } else if (top.type === 'position') {
            const p = positionById(top.id);
            if (p) { setEditingPosition(p); setPositionDialogOpen(true); }
          } else if (top.type === 'protokoll') {
            const p = protokollById(top.id);
            if (p) { setEditingProtokoll(p); setProtokollDialogOpen(true); }
          }
        }}
      />
    </>
  );
}
