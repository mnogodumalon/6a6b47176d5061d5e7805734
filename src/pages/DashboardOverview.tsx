import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import {
  KanbanWidget,
} from '@/components/widgets/KanbanWidget';
import type { KanbanCard, KanbanColumn } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import { IconAlertTriangle, IconPlus, IconCheck, IconClipboardList } from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'auftragspositionen'; record: Auftragspositionen }
  | { type: 'kunde'; record: Kunden }
  | { type: 'material'; record: Material }
  | { type: 'pruefprotokoll'; record: Pruefprotokoll };

export default function DashboardOverview() {
  const clock = useClock();

  const {
    kunden, setKunden,
    material, setMaterial,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog states
  const [auftragDialog, setAuftragDialog] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftrag, setEditingAuftrag] = useState<EnrichedAuftraege | null>(null);

  const [positionDialog, setPositionDialog] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | null>(null);

  const [kundeDialog, setKundeDialog] = useState(false);

  const [pruefDialog, setPruefDialog] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | null>(null);

  const enrichedAuftraege = useMemo(() => enrichAuftraege(auftraege, { kundenMap }), [auftraege, kundenMap]);
  const enrichedAuftragspositionen = useMemo(() => enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap }), [auftragspositionen, auftraegeMap, materialMap]);
  const enrichedPruefprotokoll = useMemo(() => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }), [pruefprotokoll, auftraegeMap]);

  // Status filter for the strip
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Derived data
  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(() => enrichedAuftraege.filter(a => a.fields.status?.key === 'offen'), [enrichedAuftraege]);
  const inBearbeitungAuftraege = useMemo(() => enrichedAuftraege.filter(a => a.fields.status?.key === 'in_bearbeitung'), [enrichedAuftraege]);
  const dringendeAuftraege = useMemo(() => enrichedAuftraege.filter(a => a.fields.prioritaet?.key === 'dringend' && a.fields.status?.key !== 'abgeschlossen' && a.fields.status?.key !== 'storniert'), [enrichedAuftraege]);

  // Material with stock below minimum
  const unterMindestbestandMaterial = useMemo(() =>
    material.filter(m => (m.fields.lagerbestand ?? 0) < (m.fields.mindestbestand ?? 0)),
    [material]
  );

  // Orders due today or with wunschtermin today
  const heuteFaellig = useMemo(() =>
    enrichedAuftraege.filter(a => {
      const wunsch = a.fields.wunschtermin?.slice(0, 10);
      const lieferung = a.fields.liefertermin?.slice(0, 10);
      return (wunsch === today || lieferung === today) && a.fields.status?.key !== 'abgeschlossen' && a.fields.status?.key !== 'storniert';
    }),
    [enrichedAuftraege, today]
  );

  // Filtered kanban cards
  const filteredAuftraege = useMemo(() =>
    statusFilter ? enrichedAuftraege.filter(a => a.fields.status?.key === statusFilter) : enrichedAuftraege,
    [enrichedAuftraege, statusFilter]
  );

  // Advance status helper (shared)
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const current = auftrag.fields.status?.key;
    const nextMap: Record<string, string> = {
      offen: 'in_bearbeitung',
      in_bearbeitung: 'abgeschlossen',
    };
    const next = nextMap[current ?? ''];
    if (!next) return;
    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
    const prevStatus = auftrag.fields.status;
    // Optimistic
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
        : a
    ));
    undoToast(`Status → ${nextLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevStatus?.key }).catch(fetchAll);
    });
    await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next }).catch(fetchAll);
  }, [setAuftraege, fetchAll]);

  // Kanban columns
  const kanbanColumns: KanbanColumn[] = useMemo(() =>
    (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
      key: o.key,
      label: o.label,
      tone: o.key === 'offen' ? 'warning' : o.key === 'in_bearbeitung' ? 'primary' : o.key === 'abgeschlossen' ? 'success' : 'default',
    } as KanbanColumn)),
    []
  );

  // Kanban cards
  const kanbanCards: KanbanCard[] = useMemo(() =>
    filteredAuftraege.map(a => ({
      id: `auftrag:${a.record_id}`,
      column: a.fields.status?.key ?? '',
      title: a.fields.auftragsnummer ?? 'Auftrag',
      subtitle: a.kundeName
        ? `${a.kundeName}${a.fields.prioritaet?.key === 'dringend' ? ' · 🔴 Dringend' : a.fields.prioritaet?.key === 'hoch' ? ' · Hoch' : ''}${a.fields.wunschtermin ? ` · ${formatDate(a.fields.wunschtermin)}` : ''}`
        : undefined,
      tone: a.fields.prioritaet?.key === 'dringend' ? 'destructive' : a.fields.prioritaet?.key === 'hoch' ? 'warning' : 'default',
    } as KanbanCard)),
    [filteredAuftraege]
  );

  const handleCardClick = useCallback((card: KanbanCard) => {
    const id = card.id.split(':')[1];
    const auftrag = enrichedAuftraege.find(a => a.record_id === id);
    if (auftrag) overlay.replace({ type: 'auftrag', record: auftrag });
  }, [enrichedAuftraege, overlay]);

  const handleCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1];
    const auftrag = auftraege.find(a => a.record_id === id);
    if (!auftrag) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const prevStatus = auftrag.fields.status;
    setAuftraege(prev => prev.map(a =>
      a.record_id === id
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${newLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(id, { status: prevStatus?.key }).catch(fetchAll);
    });
    await LivingAppsService.updateAuftraegeEntry(id, { status: newColumn }).catch(fetchAll);
  }, [auftraege, setAuftraege, fetchAll]);

  const handleAddCard = useCallback((column: string) => {
    setAuftragDefaults({ status: column });
    setEditingAuftrag(null);
    setAuftragDialog(true);
  }, []);

  // Context line
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (dringendeAuftraege.length > 0) {
      parts.push(`${dringendeAuftraege.length} dringende${dringendeAuftraege.length === 1 ? 'r' : ''} Auftrag${dringendeAuftraege.length > 1 ? 'träge' : ''}`);
    }
    if (heuteFaellig.length > 0) {
      parts.push(`${heuteFaellig.length} heute fällig`);
    }
    if (offeneAuftraege.length > 0) {
      const names = namen(offeneAuftraege.map(a => a.kundeName ?? '').filter(Boolean));
      if (names) parts.push(`Offen: ${names}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Alles im Zeitplan.';
  }, [dringendeAuftraege, heuteFaellig, offeneAuftraege]);

  // ─── Every hook goes ABOVE this line ───
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only ───

  const heroAuftrag = dringendeAuftraege[0];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(null); setAuftragDialog(true); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 shrink-0"
        >
          <IconPlus size={16} className="shrink-0" />
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
                label: 'In Bearbeitung setzen',
                onClick: () => advanceStatus(heroAuftrag),
              }}
            >
              <b>{namen(dringendeAuftraege.map(a => a.fields.auftragsnummer ?? '').filter(Boolean))}</b>
              {' '}– {dringendeAuftraege.length === 1 ? 'dringender Auftrag wartet' : `${dringendeAuftraege.length} dringende Aufträge warten`}
              {heroAuftrag.kundeName ? ` · Kunde: ${heroAuftrag.kundeName}` : ''}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone={offeneAuftraege.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitungAuftraege.length}
              tone={inBearbeitungAuftraege.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Gesamt"
              value={auftraege.length}
              tone="default"
              onClick={() => setStatusFilter(null)}
              active={statusFilter === null}
            />
            <StatStripItem
              title="Material unter Mindestbestand"
              value={unterMindestbestandMaterial.length}
              tone={unterMindestbestandMaterial.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={kanbanColumns}
            cards={kanbanCards}
            defaultCollapsed={['storniert']}
            onCardClick={handleCardClick}
            onCardMove={handleCardMove}
            onAddCard={handleAddCard}
          />
        }
        aside={
          <>
            <WorkList
              title="Heute fällig & dringend"
              items={[
                ...heuteFaellig.map(a => ({
                  id: `faellig:${a.record_id}`,
                  title: a.fields.auftragsnummer ?? 'Auftrag',
                  secondLine: (
                    <>
                      <span className="font-medium text-warning-foreground">{a.kundeName || 'Kein Kunde'}</span>
                      {a.fields.wunschtermin && (
                        <span className="text-muted-foreground"> · {formatDate(a.fields.wunschtermin)}</span>
                      )}
                    </>
                  ),
                  action: a.fields.status?.key !== 'abgeschlossen' ? {
                    label: a.fields.status?.key === 'offen' ? '▶ Starten' : '✓ Abschließen',
                    onClick: () => advanceStatus(a),
                  } : undefined,
                })),
                ...dringendeAuftraege
                  .filter(a => !heuteFaellig.some(f => f.record_id === a.record_id))
                  .map(a => ({
                    id: `dringend:${a.record_id}`,
                    title: a.fields.auftragsnummer ?? 'Auftrag',
                    secondLine: (
                      <>
                        <span className="font-medium text-destructive">Dringend</span>
                        {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
                      </>
                    ),
                    action: a.fields.status?.key !== 'abgeschlossen' ? {
                      label: a.fields.status?.key === 'offen' ? '▶ Starten' : '✓ Fertig',
                      onClick: () => advanceStatus(a),
                    } : undefined,
                  })),
              ]}
              onItemClick={id => {
                const realId = id.split(':')[1];
                const auftrag = enrichedAuftraege.find(a => a.record_id === realId);
                if (auftrag) overlay.replace({ type: 'auftrag', record: auftrag });
              }}
              empty={{
                text: offeneAuftraege.length > 0
                  ? `Nächste Aufträge: ${namen(offeneAuftraege.slice(0, 3).map(a => a.fields.auftragsnummer ?? '').filter(Boolean))}`
                  : 'Keine dringenden Aufträge — alles im Zeitplan.',
                action: { label: 'Auftrag anlegen', onClick: () => { setAuftragDefaults(undefined); setAuftragDialog(true); } },
              }}
            />
            <WorkList
              title="Material unter Mindestbestand"
              items={unterMindestbestandMaterial.map(m => ({
                id: `material:${m.record_id}`,
                title: m.fields.bezeichnung ?? 'Material',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      Bestand: {m.fields.lagerbestand ?? 0} {m.fields.einheit?.label ?? ''}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}· Min: {m.fields.mindestbestand ?? 0}
                    </span>
                  </>
                ),
              }))}
              onItemClick={id => {
                const realId = id.split(':')[1];
                const mat = material.find(m => m.record_id === realId);
                if (mat) overlay.replace({ type: 'material', record: mat });
              }}
              empty={{
                text: 'Alle Materialien über Mindestbestand.',
              }}
            />
          </>
        }
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialog}
        onClose={() => { setAuftragDialog(false); setEditingAuftrag(null); setAuftragDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields as any);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields as any);
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
        open={positionDialog}
        onClose={() => { setPositionDialog(false); setEditingPosition(null); setPositionDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields as any);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields as any);
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

      <KundenDialog
        open={kundeDialog}
        onClose={() => setKundeDialog(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createKundenEntry(fields as any);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      <PruefprotokollDialog
        open={pruefDialog}
        onClose={() => { setPruefDialog(false); setEditingPruef(null); setPruefDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields as any);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={editingPruef?.fields ?? pruefDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      {/* Overlay stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const r = top.record;
            const canAdvance = r.fields.status?.key === 'offen' || r.fields.status?.key === 'in_bearbeitung';
            return (
              <>
                <RecordHeader
                  title={r.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={r.kundeName || undefined}
                  badges={
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.fields.status?.key === 'abgeschlossen' ? 'bg-success/15 text-success-foreground' :
                      r.fields.status?.key === 'in_bearbeitung' ? 'bg-primary/15 text-primary' :
                      r.fields.status?.key === 'storniert' ? 'bg-muted text-muted-foreground' :
                      'bg-warning/15 text-warning-foreground'
                    }`}>
                      {r.fields.status?.label ?? 'Offen'}
                    </span>
                  }
                  actions={
                    <button
                      onClick={() => { setEditingAuftrag(r); setAuftragDialog(true); }}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftraegeDetails
                  record={r}
                  kundenList={kunden}
                  onOpenKunden={kunde => overlay.push({ type: 'kunde', record: kunde })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={pos => overlay.push({ type: 'auftragspositionen', record: pos })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: r.record_id });
                    setEditingPosition(null);
                    setPositionDialog(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={pruef => overlay.push({ type: 'pruefprotokoll', record: pruef })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: r.record_id });
                    setEditingPruef(null);
                    setPruefDialog(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'auftragspositionen') {
            const r = top.record;
            const enriched = enrichedAuftragspositionen.find(e => e.record_id === r.record_id);
            return (
              <>
                <RecordHeader
                  title={r.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enriched ? `${enriched.auftragName} · ${enriched.materialName}` : undefined}
                  actions={
                    <button
                      onClick={() => { setEditingPosition(r); setPositionDialog(true); }}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftragspositionenDetails
                  record={r}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enrichedA = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enrichedA) overlay.push({ type: 'auftrag', record: enrichedA });
                  }}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', record: m })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const r = top.record;
            return (
              <>
                <RecordHeader
                  title={[r.fields.vorname, r.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={r.fields.firma || undefined}
                  actions={
                    <button
                      onClick={() => setKundeDialog(true)}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      Neuer Auftrag
                    </button>
                  }
                />
                <KundenDetails
                  record={r}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enrichedA = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enrichedA) overlay.push({ type: 'auftrag', record: enrichedA });
                  }}
                  onAddAuftraege={() => {
                    setAuftragDefaults({ kunde: r.record_id });
                    setEditingAuftrag(null);
                    setAuftragDialog(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const r = top.record;
            return (
              <>
                <RecordHeader
                  title={r.fields.bezeichnung ?? 'Material'}
                  subtitle={r.fields.artikelnummer || undefined}
                  badges={
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.fields.verfuegbarkeit?.key === 'verfuegbar' ? 'bg-success/15 text-success-foreground' :
                      r.fields.verfuegbarkeit?.key === 'auf_bestellung' ? 'bg-warning/15 text-warning-foreground' :
                      'bg-destructive/15 text-destructive'
                    }`}>
                      {r.fields.verfuegbarkeit?.label ?? 'Unbekannt'}
                    </span>
                  }
                />
                <MaterialDetails
                  record={r}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={pos => overlay.push({ type: 'auftragspositionen', record: pos })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ material: r.record_id });
                    setEditingPosition(null);
                    setPositionDialog(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const r = top.record;
            return (
              <>
                <RecordHeader
                  title={`${r.fields.monteur_name_vorname ?? ''} ${r.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={enrichedPruefprotokoll.find(e => e.record_id === r.record_id)?.auftrag_pruefName}
                  badges={
                    r.fields.pruefergebnis && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.fields.pruefergebnis.key === 'bestanden' ? 'bg-success/15 text-success-foreground' :
                        r.fields.pruefergebnis.key === 'bestanden_mit_maengeln' ? 'bg-warning/15 text-warning-foreground' :
                        'bg-destructive/15 text-destructive'
                      }`}>
                        {r.fields.pruefergebnis.label}
                      </span>
                    )
                  }
                  actions={
                    <button
                      onClick={() => { setEditingPruef(r); setPruefDialog(true); }}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <PruefprotokollDetails
                  record={r}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enrichedA = enrichedAuftraege.find(e => e.record_id === a.record_id);
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
            const r = top.record;
            const canAdvance = r.fields.status?.key === 'offen' || r.fields.status?.key === 'in_bearbeitung';
            if (!canAdvance) return undefined;
            return {
              label: r.fields.status?.key === 'offen' ? '▶ In Bearbeitung setzen' : '✓ Als abgeschlossen markieren',
              onClick: () => advanceStatus(r),
            };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            setEditingAuftrag(top.record);
            setAuftragDialog(true);
          } else if (top.type === 'auftragspositionen') {
            setEditingPosition(top.record);
            setPositionDialog(true);
          } else if (top.type === 'pruefprotokoll') {
            setEditingPruef(top.record);
            setPruefDialog(true);
          }
        }}
      />
    </div>
  );
}
