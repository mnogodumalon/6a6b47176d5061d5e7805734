import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { KanbanWidget } from '@/components/widgets/KanbanWidget';
import type { KanbanCard, KanbanColumn } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import {
  IconAlertTriangle,
  IconClipboardList,
  IconHammer,
  IconCheckbox,
  IconBan,
  IconPackage,
} from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

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

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap]
  );
  const enrichedAuftragspositionen = useMemo(
    () => enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap }),
    [auftragspositionen, auftraegeMap, materialMap]
  );
  const enrichedPruefprotokoll = useMemo(
    () => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }),
    [pruefprotokoll, auftraegeMap]
  );

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | undefined>(undefined);

  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [posDefaults, setPosDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPos, setEditingPos] = useState<Auftragspositionen | undefined>(undefined);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>(undefined);

  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);

  // KPI derivations
  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );
  const inBearbeitungAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );
  const dringendAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege]
  );

  // Materials below minimum stock
  const materialMangel = useMemo(
    () => material.filter(m =>
      m.fields.mindestbestand != null &&
      (m.fields.lagerbestand ?? 0) < (m.fields.mindestbestand ?? 0)
    ),
    [material]
  );

  // Wunschtermin today
  const heuteAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => {
      if (!a.fields.wunschtermin) return false;
      return a.fields.wunschtermin.slice(0, 10) === today;
    }),
    [enrichedAuftraege, today]
  );

  // Kanban columns
  const kanbanColumns: KanbanColumn[] = useMemo(
    () => (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
      key: o.key,
      label: o.label,
      tone: o.key === 'abgeschlossen' ? 'success' as const
        : o.key === 'storniert' ? 'destructive' as const
        : o.key === 'in_bearbeitung' ? 'primary' as const
        : 'default' as const,
    })),
    []
  );

  // Kanban cards
  const kanbanCards: KanbanCard[] = useMemo(
    () => enrichedAuftraege.map(a => ({
      id: `auftrag:${a.record_id}`,
      column: lookupKey(a.fields.status) ?? 'offen',
      title: a.fields.auftragsnummer ?? '(kein Titel)',
      subtitle: a.kundeName ? (
        <span className="text-muted-foreground">
          {a.kundeName}
          {a.fields.wunschtermin ? <> · {formatDateTime(a.fields.wunschtermin)}</> : null}
        </span>
      ) : a.fields.wunschtermin ? (
        <span className="text-muted-foreground">{formatDateTime(a.fields.wunschtermin)}</span>
      ) : undefined,
      tone: lookupKey(a.fields.prioritaet) === 'dringend' ? 'destructive' as const
        : lookupKey(a.fields.prioritaet) === 'hoch' ? 'warning' as const
        : 'default' as const,
    })),
    [enrichedAuftraege]
  );

  // Shared status-advance helper
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const current = lookupKey(auftrag.fields.status);
    const next = current === 'offen' ? 'in_bearbeitung'
      : current === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;

    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
    const prevStatus = auftrag.fields.status;

    // Optimistic update
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
        : a
    ));

    undoToast(`„${auftrag.fields.auftragsnummer}" → ${nextLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevStatus as any });
    });

    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  const getAdvanceLabel = (a: Auftraege) => {
    const s = lookupKey(a.fields.status);
    if (s === 'offen') return '▶ In Bearbeitung';
    if (s === 'in_bearbeitung') return '✓ Abschließen';
    return null;
  };

  // Kanban card move
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

    undoToast(`„${auftrag.fields.auftragsnummer}" → ${newLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(id, { status: prevStatus as any });
    });

    try {
      await LivingAppsService.updateAuftraegeEntry(id, { status: newColumn });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── Every hook goes ABOVE this line ───
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Below: plain derivations only ───

  const contextPeople = heuteAuftraege.length > 0
    ? `Heute ${heuteAuftraege.length === 1 ? 'ist' : 'sind'} ${namen(heuteAuftraege.map(a => a.kundeName || a.fields.auftragsnummer || ''))} geplant.`
    : inBearbeitungAuftraege.length > 0
      ? `${inBearbeitungAuftraege.length} ${inBearbeitungAuftraege.length === 1 ? 'Auftrag' : 'Aufträge'} in Bearbeitung.`
      : offeneAuftraege.length > 0
        ? `${offeneAuftraege.length} ${offeneAuftraege.length === 1 ? 'Auftrag' : 'Aufträge'} warten auf Bearbeitung.`
        : 'Alles abgearbeitet — gut gemacht!';

  const heroAuftrag = dringendAuftraege[0]
    ? enrichedAuftraege.find(a => a.record_id === dringendAuftraege[0].record_id)
    : null;

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="mt-1 text-muted-foreground">{contextPeople}</p>
        </div>
        <button
          onClick={() => {
            setEditingAuftrag(undefined);
            setAuftraegeDefaults(undefined);
            setAuftraegeDialogOpen(true);
          }}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconHammer size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroAuftrag ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: getAdvanceLabel(heroAuftrag) ?? 'Auftrag öffnen',
              onClick: () => getAdvanceLabel(heroAuftrag)
                ? advanceStatus(heroAuftrag)
                : overlay.replace({ type: 'auftrag', id: heroAuftrag.record_id }),
            }}
          >
            <b>{namen(dringendAuftraege.map(a => a.fields.auftragsnummer || ''))}</b>
            {' '}
            {dringendAuftraege.length === 1 ? 'hat' : 'haben'} dringende Priorität
            {dringendAuftraege[0]?.kundeName ? ` — Kunde: ${dringendAuftraege[0].kundeName}` : ''}.
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone={offeneAuftraege.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitungAuftraege.length}
              icon={<IconHammer size={16} className="shrink-0" />}
              tone={inBearbeitungAuftraege.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={auftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen').length}
              icon={<IconCheckbox size={16} className="shrink-0" />}
              tone="success"
            />
            <StatStripItem
              title="Storniert"
              value={auftraege.filter(a => lookupKey(a.fields.status) === 'storniert').length}
              icon={<IconBan size={16} className="shrink-0" />}
              tone="default"
            />
            {materialMangel.length > 0 && (
              <StatStripItem
                title="Material unter Mindestbestand"
                value={materialMangel.length}
                icon={<IconPackage size={16} className="shrink-0" />}
                tone="destructive"
              />
            )}
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={kanbanColumns}
            cards={kanbanCards}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1];
              overlay.replace({ type: 'auftrag', id });
            }}
            onCardMove={handleCardMove}
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
              title="Heute & dringend"
              items={[
                ...heuteAuftraege.map(a => ({
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? '—',
                  secondLine: (
                    <>
                      <span className="text-muted-foreground">{a.kundeName || '—'}</span>
                      {a.fields.wunschtermin && (
                        <> · <span className="font-medium">{formatDateTime(a.fields.wunschtermin)}</span></>
                      )}
                    </>
                  ),
                  action: getAdvanceLabel(a) ? {
                    label: getAdvanceLabel(a)!,
                    onClick: () => advanceStatus(enrichedAuftraege.find(e => e.record_id === a.record_id)!),
                  } : undefined,
                })),
                ...dringendAuftraege
                  .filter(a => !heuteAuftraege.find(h => h.record_id === a.record_id))
                  .map(a => ({
                    id: a.record_id,
                    title: a.fields.auftragsnummer ?? '—',
                    secondLine: (
                      <>
                        <span className="font-medium text-destructive">Dringend</span>
                        {a.kundeName ? <> · <span className="text-muted-foreground">{a.kundeName}</span></> : null}
                      </>
                    ),
                    action: getAdvanceLabel(a) ? {
                      label: getAdvanceLabel(a)!,
                      onClick: () => advanceStatus(enrichedAuftraege.find(e => e.record_id === a.record_id)!),
                    } : undefined,
                  })),
              ]}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: offeneAuftraege.length > 0
                  ? `Nächster offener Auftrag: ${offeneAuftraege[0].fields.auftragsnummer}`
                  : 'Keine dringenden Aufträge — alles im Plan',
                action: { label: 'Neuer Auftrag', onClick: () => setAuftraegeDialogOpen(true) },
              }}
            />
            <WorkList
              title="Material unter Mindestbestand"
              items={materialMangel.map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? '—',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      {m.fields.lagerbestand ?? 0} {m.fields.einheit?.label ?? ''}
                    </span>
                    <span className="text-muted-foreground"> · Mindest: {m.fields.mindestbestand}</span>
                  </>
                ),
              }))}
              onItemClick={id => overlay.replace({ type: 'material', id })}
              empty={{
                text: 'Alle Materialien ausreichend bevorratet',
              }}
            />
          </>
        }
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => { setAuftraegeDialogOpen(false); setEditingAuftrag(undefined); }}
        onSubmit={async (fields) => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingAuftrag?.fields ?? auftraegeDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={posDialogOpen}
        onClose={() => { setPosDialogOpen(false); setEditingPos(undefined); }}
        onSubmit={async (fields) => {
          if (editingPos) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPos.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPos?.fields ?? posDefaults}
        recordId={editingPos?.record_id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(undefined); }}
        onSubmit={async (fields) => {
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

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => setKundenDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      {/* Single RecordOverlayHost for the full drill stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const auftrag = auftraege.find(a => a.record_id === top.id);
            if (!auftrag) return null;
            const enriched = enrichedAuftraege.find(a => a.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={auftrag.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={enriched?.kundeName}
                  badges={
                    auftrag.fields.status ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-foreground">
                        {auftrag.fields.status.label}
                      </span>
                    ) : undefined
                  }
                  actions={
                    <button
                      onClick={() => {
                        setEditingAuftrag(auftrag);
                        setAuftraegeDefaults(undefined);
                        setAuftraegeDialogOpen(true);
                      }}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftraegeDetails
                  record={auftrag}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'auftragsposition', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ auftrag: auftrag.record_id });
                    setEditingPos(undefined);
                    setPosDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruefprotokoll', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: auftrag.record_id });
                    setEditingPruef(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }

          if (top.type === 'auftragsposition') {
            const pos = auftragspositionen.find(p => p.record_id === top.id);
            if (!pos) return null;
            const enriched = enrichedAuftragspositionen.find(p => p.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={pos.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enriched?.auftragName}
                  actions={
                    <button
                      onClick={() => {
                        setEditingPos(pos);
                        setPosDefaults(undefined);
                        setPosDialogOpen(true);
                      }}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftragspositionenDetails
                  record={pos}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }

          if (top.type === 'pruefprotokoll') {
            const pruef = pruefprotokoll.find(p => p.record_id === top.id);
            if (!pruef) return null;
            const enriched = enrichedPruefprotokoll.find(p => p.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={[pruef.fields.monteur_name_vorname, pruef.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={enriched?.auftrag_pruefName}
                  badges={
                    pruef.fields.pruefergebnis ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        pruef.fields.pruefergebnis.key === 'bestanden' ? 'bg-green-100 text-green-700'
                        : pruef.fields.pruefergebnis.key === 'nicht_bestanden' ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {pruef.fields.pruefergebnis.label}
                      </span>
                    ) : undefined
                  }
                  actions={
                    <button
                      onClick={() => {
                        setEditingPruef(pruef);
                        setPruefDefaults(undefined);
                        setPruefDialogOpen(true);
                      }}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <PruefprotokollDetails
                  record={pruef}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }

          if (top.type === 'kunde') {
            const kunde = kunden.find(k => k.record_id === top.id);
            if (!kunde) return null;
            return (
              <>
                <RecordHeader
                  title={[kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || '—'}
                  subtitle={kunde.fields.firma}
                />
                <KundenDetails
                  record={kunde}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => {
                    setAuftraegeDefaults({ kunde: kunde.record_id });
                    setEditingAuftrag(undefined);
                    setAuftraegeDialogOpen(true);
                  }}
                />
              </>
            );
          }

          if (top.type === 'material') {
            const mat = material.find(m => m.record_id === top.id);
            if (!mat) return null;
            return (
              <>
                <RecordHeader
                  title={mat.fields.bezeichnung ?? '—'}
                  subtitle={mat.fields.artikelnummer ? `Art.-Nr. ${mat.fields.artikelnummer}` : undefined}
                  badges={
                    mat.fields.verfuegbarkeit ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        mat.fields.verfuegbarkeit.key === 'verfuegbar' ? 'bg-green-100 text-green-700'
                        : mat.fields.verfuegbarkeit.key === 'nicht_verfuegbar' ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {mat.fields.verfuegbarkeit.label}
                      </span>
                    ) : undefined
                  }
                />
                <MaterialDetails
                  record={mat}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'auftragsposition', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ material: mat.record_id });
                    setEditingPos(undefined);
                    setPosDialogOpen(true);
                  }}
                />
              </>
            );
          }

          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const auftrag = auftraege.find(a => a.record_id === top.id);
            if (!auftrag) return undefined;
            const enriched = enrichedAuftraege.find(a => a.record_id === top.id);
            const label = getAdvanceLabel(auftrag);
            if (!label) return undefined;
            return {
              label,
              onClick: () => enriched && advanceStatus(enriched),
            };
          }
          return undefined;
        }}
      />
    </>
  );
}
