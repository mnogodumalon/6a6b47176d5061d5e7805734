import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import {
  RecordOverlayHost,
  RecordHeader,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format, isAfter, isBefore, addDays, parseISO } from 'date-fns';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconCheck,
  IconHourglass,
  IconX,
} from '@tabler/icons-react';

// ─── Kanban columns from schema ─────────────────────────────────────────────
const AUFTRAG_COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → needs attention
}

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string };

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    setAuftraege,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  const enrichedAuftraege = enrichAuftraege(auftraege, { kundenMap });
  const enrichedAuftragspositionen = enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap });
  const enrichedPruefprotokoll = enrichPruefprotokoll(pruefprotokoll, { auftraegeMap });

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | undefined>(undefined);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | undefined>(undefined);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>(undefined);

  // ─── Derived KPIs ─────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );

  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege],
  );

  const dringend = useMemo(
    () => enrichedAuftraege.filter(
      a => lookupKey(a.fields.prioritaet) === 'dringend' &&
        lookupKey(a.fields.status) !== 'abgeschlossen' &&
        lookupKey(a.fields.status) !== 'storniert',
    ),
    [enrichedAuftraege],
  );

  // Aufträge with Wunschtermin today or in the past (and not yet done/cancelled)
  const faelligHeute = useMemo(
    () => enrichedAuftraege.filter(a => {
      const status = lookupKey(a.fields.status);
      if (status === 'abgeschlossen' || status === 'storniert') return false;
      const wunsch = a.fields.wunschtermin;
      if (!wunsch) return false;
      const wunschDay = wunsch.slice(0, 10);
      return wunschDay <= today;
    }).sort((a, b) => (a.fields.wunschtermin ?? '').localeCompare(b.fields.wunschtermin ?? '')),
    [enrichedAuftraege, today],
  );

  const uberfaellig = useMemo(
    () => faelligHeute.filter(a => {
      const wunsch = a.fields.wunschtermin;
      return wunsch && wunsch.slice(0, 10) < today;
    }),
    [faelligHeute, today],
  );

  // Kanban cards
  const kanbanCards = useMemo<KanbanCard[]>(
    () => enrichedAuftraege.map(a => {
      const status = lookupKey(a.fields.status) ?? AUFTRAG_COLUMNS[0]?.key ?? '';
      const prio = lookupKey(a.fields.prioritaet);
      const prioLabel = a.fields.prioritaet?.label;
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? 'Ohne Nr.',
        subtitle: a.kundeName
          ? `${a.kundeName}${prioLabel ? ` · ${prioLabel}` : ''}`
          : prioLabel ?? '',
        tone: prio === 'dringend' ? 'warning' : toneForStatus(status),
      };
    }),
    [enrichedAuftraege],
  );

  // ─── Advance status helper ─────────────────────────────────────────────────
  const advanceStatus = useCallback((a: EnrichedAuftraege) => {
    const cur = lookupKey(a.fields.status);
    const next = cur === 'offen' ? 'in_bearbeitung' : cur === 'in_bearbeitung' ? 'abgeschlossen' : null;
    if (!next) return;
    const nextLabel = AUFTRAG_COLUMNS.find(c => c.key === next)?.label ?? next;
    const prevStatus = a.fields.status;
    setAuftraege(prev =>
      prev.map(x =>
        x.record_id === a.record_id
          ? { ...x, fields: { ...x.fields, status: { key: next, label: nextLabel } } }
          : x,
      ),
    );
    undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, async () => {
      setAuftraege(prev =>
        prev.map(x =>
          x.record_id === a.record_id
            ? { ...x, fields: { ...x.fields, status: prevStatus } }
            : x,
        ),
      );
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: typeof prevStatus === 'object' ? prevStatus?.key : prevStatus });
    });
    LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next }).catch(() => fetchAll());
  }, [setAuftraege, fetchAll]);

  // ─── Kanban card move ───────────────────────────────────────────────────────
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const newLabel = AUFTRAG_COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    setAuftraege(prev =>
      prev.map(x =>
        x.record_id === rid
          ? { ...x, fields: { ...x.fields, status: { key: newColumn, label: newLabel } } }
          : x,
      ),
    );
    undoToast(`Status → ${newLabel}`);
    LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn }).catch(() => fetchAll());
  }, [setAuftraege, fetchAll]);

  // ─── Helper: lookup by id ─────────────────────────────────────────────────
  const getAuftragById = useCallback(
    (id: string) => auftraege.find(a => a.record_id === id),
    [auftraege],
  );
  const getPositionById = useCallback(
    (id: string) => auftragspositionen.find(p => p.record_id === id),
    [auftragspositionen],
  );
  const getPruefById = useCallback(
    (id: string) => pruefprotokoll.find(p => p.record_id === id),
    [pruefprotokoll],
  );
  const getKundeById = useCallback(
    (id: string) => kunden.find(k => k.record_id === id),
    [kunden],
  );

  // ─── Context line for greeting ───────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (dringend.length > 0) {
      const nms = namen(dringend.map(a => a.kundeName || a.fields.auftragsnummer || ''));
      return `${dringend.length === 1 ? 'Dringender Auftrag' : `${dringend.length} dringende Aufträge`} von ${nms}.`;
    }
    if (faelligHeute.length > 0) {
      const nms = namen(faelligHeute.slice(0, 3).map(a => a.kundeName || a.fields.auftragsnummer || ''));
      return `${faelligHeute.length === 1 ? 'Wunschtermin heute' : `${faelligHeute.length} Aufträge heute fällig`} — ${nms}.`;
    }
    if (inBearbeitung.length > 0) {
      return `${inBearbeitung.length} ${inBearbeitung.length === 1 ? 'Auftrag' : 'Aufträge'} gerade in Bearbeitung.`;
    }
    return 'Alle Aufträge im Griff — guter Start!';
  }, [dringend, faelligHeute, inBearbeitung]);

  // ─── Hero logic: dringende oder überfällige Aufträge ───────────────────────
  const heroAuftrag = dringend[0] ?? uberfaellig[0] ?? null;

  // ─── All hooks above early-returns ────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (auftraege.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <IconClipboardList size={32} className="text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Noch keine Aufträge</h2>
          <p className="text-muted-foreground text-sm">Lege den ersten Auftrag an und starte deinen Handwerksbetrieb.</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} />
          Ersten Auftrag erstellen
        </button>
        <AuftraegeDialog
          open={auftragDialogOpen}
          onClose={() => setAuftragDialogOpen(false)}
          onSubmit={async (fields) => { await LivingAppsService.createAuftraegeEntry(fields); fetchAll(); }}
          defaultValues={auftragDefaults}
          kundenList={kunden}
          enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
        />
      </div>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-3 sm:mt-0"
        >
          <IconPlus size={16} />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroAuftrag ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: lookupKey(heroAuftrag.fields.status) === 'offen' ? 'In Bearbeitung setzen' : 'Abschließen',
                onClick: () => advanceStatus(heroAuftrag),
              }}
            >
              <b>{heroAuftrag.kundeName || heroAuftrag.fields.auftragsnummer}</b>
              {lookupKey(heroAuftrag.fields.prioritaet) === 'dringend' ? ' — Dringend' : ' — Wunschtermin überfällig'}
              {heroAuftrag.fields.wunschtermin && (
                <>, fällig war {formatDateTime(heroAuftrag.fields.wunschtermin)}</>
              )}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              icon={<IconHourglass size={14} className="shrink-0" />}
              tone={offeneAuftraege.length > 5 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              icon={<IconClipboardList size={14} className="shrink-0" />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={14} className="shrink-0" />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Heute fällig"
              value={faelligHeute.length}
              icon={<IconCheck size={14} className="shrink-0" />}
              tone={uberfaellig.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={kanbanCards}
            columns={AUFTRAG_COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1] ?? '';
              overlay.replace({ type: 'auftrag', id });
            }}
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
              title="Heute fällig & überfällig"
              items={faelligHeute.slice(0, 8).map(a => ({
                id: a.record_id,
                title: a.kundeName || a.fields.auftragsnummer || 'Auftrag',
                secondLine: (
                  <>
                    <span className={uberfaellig.some(u => u.record_id === a.record_id) ? 'font-medium text-destructive' : 'font-medium text-warning'}>
                      {uberfaellig.some(u => u.record_id === a.record_id) ? 'Überfällig' : 'Heute'}
                    </span>
                    {a.fields.wunschtermin && (
                      <span className="text-muted-foreground"> · {formatDateTime(a.fields.wunschtermin)}</span>
                    )}
                  </>
                ),
                action: lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'
                  ? {
                    label: lookupKey(a.fields.status) === 'offen' ? '▶ Starten' : '✓ Fertig',
                    onClick: () => advanceStatus(a),
                  }
                  : undefined,
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alles im Zeitplan — keine Aufträge heute fällig.',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftragDefaults(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Zuletzt hinzugefügt"
              items={[...auftraege]
                .sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? ''))
                .slice(0, 5)
                .map(a => {
                  const kunde = a.fields.kunde ? kundenMap.get(extractRecordId(a.fields.kunde) ?? '') : undefined;
                  return {
                    id: a.record_id,
                    title: a.fields.auftragsnummer ?? 'Auftrag',
                    secondLine: (
                      <>
                        <span className="text-muted-foreground">
                          {kunde ? `${kunde.fields.vorname ?? ''} ${kunde.fields.nachname ?? ''}`.trim() : ''}
                        </span>
                        {a.fields.status?.label && (
                          <span className="text-muted-foreground"> · {a.fields.status.label}</span>
                        )}
                      </>
                    ),
                  };
                })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{ text: 'Noch keine Aufträge angelegt.' }}
            />
          </>
        }
      />

      {/* Dialogs */}
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
        open={pruefDialogOpen}
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(undefined); setPruefDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPruef ? editingPruef.fields : pruefDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      {/* Record overlay stack — ONE host for all entity types */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftragById(top.id);
            if (!rec) return null;
            const status = lookupKey(rec.fields.status);
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={
                    rec.fields.prioritaet?.label ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                        {rec.fields.prioritaet.label}
                      </span>
                    ) : undefined
                  }
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: rec.record_id });
                    setEditingPosition(undefined);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: rec.record_id });
                    setEditingPruef(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const rec = getPositionById(top.id);
            if (!rec) return null;
            const auftrag = rec.fields.auftrag ? auftraegeMap.get(extractRecordId(rec.fields.auftrag) ?? '') : undefined;
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={auftrag?.fields.auftragsnummer}
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'kunde', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const rec = getPruefById(top.id);
            if (!rec) return null;
            const auftrag = rec.fields.auftrag_pruef ? auftraegeMap.get(extractRecordId(rec.fields.auftrag_pruef) ?? '') : undefined;
            return (
              <>
                <RecordHeader
                  title={`${rec.fields.monteur_name_vorname ?? ''} ${rec.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={rec.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const rec = getKundeById(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={`${rec.fields.vorname ?? ''} ${rec.fields.nachname ?? ''}`.trim() || 'Kunde'}
                  subtitle={rec.fields.firma}
                />
                <KundenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => {
                    setAuftragDefaults({ kunde: rec.record_id });
                    setEditingAuftrag(undefined);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftragById(top.id);
            if (!rec) return undefined;
            const status = lookupKey(rec.fields.status);
            const nextLabel =
              status === 'offen' ? 'In Bearbeitung setzen'
              : status === 'in_bearbeitung' ? 'Abschließen'
              : undefined;
            if (!nextLabel) return undefined;
            const enriched = enrichedAuftraege.find(a => a.record_id === rec.record_id);
            if (!enriched) return undefined;
            return { label: nextLabel, onClick: () => advanceStatus(enriched) };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftragById(top.id);
            if (rec) { setEditingAuftrag(rec); setAuftragDialogOpen(true); }
          }
          if (top.type === 'position') {
            const rec = getPositionById(top.id);
            if (rec) { setEditingPosition(rec); setPositionDialogOpen(true); }
          }
          if (top.type === 'pruef') {
            const rec = getPruefById(top.id);
            if (rec) { setEditingPruef(rec); setPruefDialogOpen(true); }
          }
        }}
      />
    </>
  );
}
