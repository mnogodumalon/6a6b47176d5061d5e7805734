import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { lookupKey, formatDate, formatDateTime } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import {
  KanbanWidget,
  type KanbanCard,
  type KanbanColumn,
  type KanbanTone,
} from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
  RecordAttachments,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import {
  IconAlertTriangle,
  IconClipboardList,
  IconTools,
  IconCircleCheck,
  IconPackage,
} from '@tabler/icons-react';

// ─── Typen für Overlay-Stack ─────────────────────────────────────────────────

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

// ─── Kanban-Spalten aus dem Schema ───────────────────────────────────────────

const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → braucht Aufmerksamkeit
}

// ─── Dialog-Defaults-Typen ───────────────────────────────────────────────────
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';

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

  // Overlay-Stack
  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog-State
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | undefined>();

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>();

  // Filter-State für KPI-Strip
  const [filter, setFilter] = useState<'all' | 'dringend' | 'offen'>('all');

  // ─── Kanban-Karten ────────────────────────────────────────────────────────

  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? 'offen';
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: a.kundeName || a.fields.auftragsnummer || 'Auftrag',
          subtitle: [
            a.fields.auftragsnummer,
            a.fields.monteur ? `Monteur: ${a.fields.monteur}` : undefined,
            a.fields.liefertermin ? `Termin: ${formatDateTime(a.fields.liefertermin)}` : undefined,
          ].filter(Boolean).join(' · '),
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ─── KPIs ────────────────────────────────────────────────────────────────

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
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege],
  );

  const faelligHeute = useMemo(
    () => enrichedAuftraege.filter(a => {
      const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
      if (!termin) return false;
      return termin.slice(0, 10) === today && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert';
    }),
    [enrichedAuftraege, today],
  );

  const ueberfaellig = useMemo(
    () => enrichedAuftraege.filter(a => {
      const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
      if (!termin) return false;
      return termin.slice(0, 10) < today && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert';
    }),
    [enrichedAuftraege, today],
  );

  const materialNiedrig = useMemo(
    () => material.filter(m => {
      const bestand = m.fields.lagerbestand ?? 0;
      const mindest = m.fields.mindestbestand ?? 0;
      return bestand <= mindest && mindest > 0;
    }),
    [material],
  );

  // ─── Filtered WorkList ────────────────────────────────────────────────────

  const workListItems = useMemo(() => {
    let base: EnrichedAuftraege[] = [];
    if (filter === 'dringend') base = dringend;
    else if (filter === 'offen') base = offeneAuftraege;
    else base = [...faelligHeute, ...ueberfaellig.filter(a => !faelligHeute.includes(a))];
    return base.slice(0, 8);
  }, [filter, dringend, offeneAuftraege, faelligHeute, ueberfaellig]);

  // ─── Status-Advance Helper ────────────────────────────────────────────────

  const advanceStatus = useCallback(
    async (auftrag: EnrichedAuftraege) => {
      const current = lookupKey(auftrag.fields.status) ?? 'offen';
      const next = current === 'offen' ? 'in_bearbeitung'
        : current === 'in_bearbeitung' ? 'abgeschlossen'
        : null;
      if (!next) return;

      const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
      const prevStatus = auftrag.fields.status;

      // Optimistisch updaten
      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
            : a,
        ),
      );

      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
        undoToast(
          `${auftrag.kundeName || auftrag.fields.auftragsnummer || 'Auftrag'} → ${nextLabel}`,
          async () => {
            setAuftraege(prev =>
              prev.map(a =>
                a.record_id === auftrag.record_id
                  ? { ...a, fields: { ...a.fields, status: prevStatus } }
                  : a,
              ),
            );
            await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevStatus ? (typeof prevStatus === 'object' ? prevStatus.key : prevStatus) : current });
          },
        );
      } catch {
        fetchAll();
      }
    },
    [setAuftraege, fetchAll],
  );

  // ─── Kanban: onCardMove ───────────────────────────────────────────────────

  const moveCard = useCallback(
    async (cardId: string, newColumn: string) => {
      const rid = cardId.split(':')[1];
      if (!rid) return;

      const auftrag = auftraege.find(a => a.record_id === rid);
      if (!auftrag) return;

      const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
      const prevStatus = auftrag.fields.status;

      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
            : a,
        ),
      );

      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
        undoToast(
          `Status → ${newLabel}`,
          async () => {
            setAuftraege(prev =>
              prev.map(a =>
                a.record_id === rid
                  ? { ...a, fields: { ...a.fields, status: prevStatus } }
                  : a,
              ),
            );
            const prevKey = typeof prevStatus === 'object' && prevStatus ? prevStatus.key : (prevStatus as string | undefined);
            if (prevKey) await LivingAppsService.updateAuftraegeEntry(rid, { status: prevKey });
          },
        );
      } catch {
        fetchAll();
      }
    },
    [auftraege, setAuftraege, fetchAll],
  );

  // ─── Context-Zeile ────────────────────────────────────────────────────────

  const contextLine = useMemo(() => {
    if (ueberfaellig.length > 0) {
      return `${ueberfaellig.length} überfällige Aufträge — u.a. ${namen(ueberfaellig.map(a => a.kundeName || a.fields.auftragsnummer || ''))}`;
    }
    if (faelligHeute.length > 0) {
      return `Heute fällig: ${namen(faelligHeute.map(a => a.kundeName || a.fields.auftragsnummer || ''))}`;
    }
    if (inBearbeitung.length > 0) {
      return `${inBearbeitung.length} Aufträge in Bearbeitung — alles läuft.`;
    }
    return `${auftraege.length} Aufträge — alles im Griff.`;
  }, [ueberfaellig, faelligHeute, inBearbeitung, auftraege]);

  // ─── Early returns NACH allen Hooks ──────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Helfer-Lookups für Overlay ───────────────────────────────────────────

  const getAuftrag = (id: string) => auftraege.find(a => a.record_id === id);
  const getPosition = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const getPruef = (id: string) => pruefprotokoll.find(p => p.record_id === id);
  const getKunde = (id: string) => kunden.find(k => k.record_id === id);
  const getMaterial = (id: string) => material.find(m => m.record_id === id);

  // ─── WorkList-Items ───────────────────────────────────────────────────────

  const workItems = workListItems.map(a => {
    const status = lookupKey(a.fields.status);
    const nextLabel = status === 'offen' ? '▶ Starten'
      : status === 'in_bearbeitung' ? '✓ Abschließen'
      : undefined;

    return {
      id: a.record_id,
      title: a.kundeName || a.fields.auftragsnummer || 'Auftrag',
      secondLine: (
        <span className="flex gap-2 flex-wrap">
          <span className={
            status === 'offen' ? 'font-medium text-warning-foreground' :
            status === 'in_bearbeitung' ? 'font-medium text-primary' : 'text-muted-foreground'
          }>
            {a.fields.status?.label ?? status}
          </span>
          {a.fields.liefertermin && (
            <span className="text-muted-foreground">· {formatDateTime(a.fields.liefertermin)}</span>
          )}
          {a.fields.monteur && (
            <span className="text-muted-foreground">· {a.fields.monteur}</span>
          )}
        </span>
      ),
      action: nextLabel ? {
        label: nextLabel,
        onClick: () => void advanceStatus(a),
      } : undefined,
    };
  });

  const materialItems = materialNiedrig.slice(0, 6).map(m => ({
    id: m.record_id,
    title: m.fields.bezeichnung ?? 'Material',
    secondLine: (
      <span className="flex gap-2">
        <span className="font-medium text-destructive">Bestand: {m.fields.lagerbestand ?? 0}</span>
        <span className="text-muted-foreground">· Mindest: {m.fields.mindestbestand ?? 0} {m.fields.einheit?.label ?? ''}</span>
      </span>
    ),
  }));

  // ─── Hero: überfällige Aufträge ───────────────────────────────────────────

  const ersterUeberfaellig = ueberfaellig[0];

  return (
    <>
      {/* Seitenkopf */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconClipboardList size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={ueberfaellig.length > 0 && ersterUeberfaellig ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: 'Starten',
              onClick: () => void advanceStatus(ersterUeberfaellig),
            }}
          >
            <b>{namen(ueberfaellig.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>{' '}
            {ueberfaellig.length === 1 ? 'ist überfällig' : 'sind überfällig'} —
            {ersterUeberfaellig.fields.liefertermin
              ? ` Termin war ${formatDateTime(ersterUeberfaellig.fields.liefertermin)}.`
              : ' noch kein Termin gesetzt.'}
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              icon={<IconClipboardList size={16} />}
              tone={offeneAuftraege.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilter(f => f === 'offen' ? 'all' : 'offen')}
              active={filter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              icon={<IconTools size={16} />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={16} />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
              onClick={() => setFilter(f => f === 'dringend' ? 'all' : 'dringend')}
              active={filter === 'dringend'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={auftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen').length}
              icon={<IconCircleCheck size={16} />}
              tone="success"
            />
            <StatStripItem
              title="Bestand niedrig"
              value={materialNiedrig.length}
              icon={<IconPackage size={16} />}
              tone={materialNiedrig.length > 0 ? 'destructive' : 'default'}
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
              title={filter === 'dringend' ? 'Dringende Aufträge' : filter === 'offen' ? 'Offene Aufträge' : 'Fällig heute & überfällig'}
              items={workItems}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={
                filter !== 'all'
                  ? { text: 'Keine Aufträge in dieser Kategorie.', action: { label: 'Alle anzeigen', onClick: () => setFilter('all') } }
                  : offeneAuftraege.length > 0
                    ? { text: `Nächster offener Auftrag: ${offeneAuftraege[0].kundeName || offeneAuftraege[0].fields.auftragsnummer || 'Auftrag'}`, action: { label: 'Anzeigen', onClick: () => overlay.replace({ type: 'auftrag', id: offeneAuftraege[0].record_id }) } }
                    : { text: 'Alle Aufträge im Zeitplan — sehr gut!', action: { label: 'Neuer Auftrag', onClick: () => { setAuftragDefaults(undefined); setAuftragDialogOpen(true); } } }
              }
            />
            <WorkList
              title="Bestand niedrig"
              items={materialItems}
              onItemClick={id => overlay.replace({ type: 'material', id })}
              empty={{
                text: 'Alle Materialien ausreichend bevorratet.',
                action: { label: 'Material verwalten', onClick: () => { window.location.hash = '#/material'; } },
              }}
            />
          </>
        }
      />

      {/* ─── Dialoge ─────────────────────────────────────────────────── */}

      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(undefined); setAuftragDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingAuftrag?.fields ?? auftragDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(undefined); setPositionDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPosition?.fields ?? positionDefaults}
        recordId={editingPosition?.record_id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(undefined); setPruefDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPruef?.fields ?? pruefDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      {/* ─── Overlay-Stack (Ein Shell für alle Entitäten) ────────────── */}

      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = getAuftrag(top.id);
            if (!a) return null;
            const enriched = enrichedAuftraege.find(e => e.record_id === top.id) ?? { ...a, kundeName: '' };
            return (
              <>
                <RecordHeader
                  title={enriched.kundeName || a.fields.auftragsnummer || 'Auftrag'}
                  subtitle={a.fields.status?.label}
                  badges={
                    a.fields.prioritaet ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        lookupKey(a.fields.prioritaet) === 'dringend' ? 'bg-destructive/10 text-destructive' :
                        lookupKey(a.fields.prioritaet) === 'hoch' ? 'bg-warning/10 text-warning-foreground' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {a.fields.prioritaet.label}
                      </span>
                    ) : undefined
                  }
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
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruefprotokoll', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: a.record_id });
                    setEditingPruef(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }

          if (top.type === 'position') {
            const p = getPosition(top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung || 'Auftragsposition'}
                  subtitle={`${p.fields.menge ?? ''} ${p.fields.einheit_position?.label ?? ''}`}
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

          if (top.type === 'pruefprotokoll') {
            const pr = getPruef(top.id);
            if (!pr) return null;
            return (
              <>
                <RecordHeader
                  title={[pr.fields.monteur_name_vorname, pr.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={pr.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={pr}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }

          if (top.type === 'kunde') {
            const k = getKunde(top.id);
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
            const m = getMaterial(top.id);
            if (!m) return null;
            return (
              <>
                <RecordHeader
                  title={m.fields.bezeichnung || 'Material'}
                  subtitle={m.fields.artikelnummer}
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
            const a = getAuftrag(top.id);
            const enriched = a ? (enrichedAuftraege.find(e => e.record_id === top.id) ?? { ...a, kundeName: '' }) : null;
            const status = a ? lookupKey(a.fields.status) : null;
            if (!enriched || !status || status === 'abgeschlossen' || status === 'storniert') {
              return {
                label: 'Bearbeiten',
                onClick: () => {
                  if (a) { setEditingAuftrag(a); setAuftragDialogOpen(true); overlay.close(); }
                },
              };
            }
            const nextLabel = status === 'offen' ? 'Starten' : 'Abschließen';
            return {
              label: nextLabel,
              onClick: () => { void advanceStatus(enriched); overlay.close(); },
            };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = getAuftrag(top.id);
            if (a) { setEditingAuftrag(a); setAuftragDialogOpen(true); overlay.close(); }
          }
        }}
      />
    </>
  );
}
