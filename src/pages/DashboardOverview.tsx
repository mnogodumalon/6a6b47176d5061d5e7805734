import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege, EnrichedAuftragspositionen, EnrichedPruefprotokoll } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
import { RecordOverlayHost, RecordHeader, useRecordOverlayStack } from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconPlus, IconAlertTriangle, IconClipboardList, IconPackage, IconCheck } from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string }
  | { type: 'pruef'; id: string };

const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning';
}

export default function DashboardOverview() {
  const {
    kunden, setKunden,
    material, setMaterial,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | null>(null);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | null>(null);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | null>(null);

  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);
  const [editingKunde, setEditingKunde] = useState<Kunden | null>(null);

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

  // KPI derivations
  const offene = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );
  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );
  const dringend = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend'),
    [enrichedAuftraege]
  );
  const unterMindestbestand = useMemo(
    () => material.filter(m => {
      const lager = m.fields.lagerbestand ?? 0;
      const mind = m.fields.mindestbestand ?? 0;
      return mind > 0 && lager < mind;
    }),
    [material]
  );

  // Advance: offen → in_bearbeitung, in_bearbeitung → abgeschlossen
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const currentKey = lookupKey(auftrag.fields.status);
    const nextKey = currentKey === 'offen' ? 'in_bearbeitung'
      : currentKey === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!nextKey) return;
    const nextLabel = COLUMNS.find(c => c.key === nextKey)?.label ?? nextKey;
    const prevFields = { ...auftrag.fields };
    // Optimistic
    setAuftraege(prev =>
      prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: { key: nextKey, label: nextLabel } } }
          : a
      )
    );
    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: nextKey });
      undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, async () => {
        setAuftraege(prev =>
          prev.map(a =>
            a.record_id === auftrag.record_id ? { ...a, fields: prevFields } : a
          )
        );
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevFields.status });
      });
    } catch {
      await fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // Kanban cards
  const cards = useMemo<KanbanCard[]>(() => {
    const filtered = statusFilter
      ? enrichedAuftraege.filter(a => lookupKey(a.fields.status) === statusFilter)
      : enrichedAuftraege;
    return filtered.map(a => {
      const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
      const prio = lookupKey(a.fields.prioritaet);
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? 'Kein Auftrag',
        subtitle: [
          a.kundeName || undefined,
          prio === 'dringend' ? '⚡ Dringend' : prio === 'hoch' ? '↑ Hoch' : undefined,
          a.fields.wunschtermin ? `Wunsch: ${formatDate(a.fields.wunschtermin)}` : undefined,
        ].filter(Boolean).join(' · '),
        tone: toneForStatus(status),
      };
    });
  }, [enrichedAuftraege, statusFilter]);

  const moveCard = useCallback(async (cardId: string, newColumn: string): Promise<string | void> => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const prevFields = { ...auftrag.fields };
    setAuftraege(prev =>
      prev.map(a =>
        a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
          : a
      )
    );
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
      undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${newLabel}`, async () => {
        setAuftraege(prev =>
          prev.map(a => a.record_id === rid ? { ...a, fields: prevFields } : a)
        );
        await LivingAppsService.updateAuftraegeEntry(rid, { status: prevFields.status });
      });
    } catch {
      await fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // WorkList items — dringende/offene Aufträge (cross-stage, time axis)
  const dringendItems = useMemo(() => {
    return dringend
      .filter(a => {
        const s = lookupKey(a.fields.status);
        return s !== 'abgeschlossen' && s !== 'storniert';
      })
      .sort((a, b) => (a.fields.wunschtermin ?? '').localeCompare(b.fields.wunschtermin ?? ''))
      .slice(0, 8)
      .map(a => {
        const statusKey = lookupKey(a.fields.status);
        const statusLabel = a.fields.status?.label ?? statusKey ?? 'Offen';
        const nextKey = statusKey === 'offen' ? 'in_bearbeitung'
          : statusKey === 'in_bearbeitung' ? 'abgeschlossen' : null;
        const nextLabel = nextKey === 'in_bearbeitung' ? 'Starten' : nextKey === 'abgeschlossen' ? 'Abschließen' : null;
        return {
          id: a.record_id,
          title: `${a.fields.auftragsnummer ?? '–'} · ${a.kundeName || 'Kein Kunde'}`,
          secondLine: (
            <span className="flex items-center gap-1 flex-wrap">
              <span className={statusKey === 'in_bearbeitung' ? 'font-medium text-primary' : 'font-medium text-warning'}>
                {statusLabel}
              </span>
              {a.fields.wunschtermin && (
                <span className="text-muted-foreground"> · Wunsch: {formatDate(a.fields.wunschtermin)}</span>
              )}
            </span>
          ),
          action: nextLabel ? {
            label: nextLabel,
            onClick: () => void advanceStatus(a),
          } : undefined,
        };
      });
  }, [dringend, advanceStatus]);

  // WorkList items — Material unter Mindestbestand
  const materialItems = useMemo(() => {
    return unterMindestbestand
      .sort((a, b) => {
        const diffA = (a.fields.lagerbestand ?? 0) - (a.fields.mindestbestand ?? 0);
        const diffB = (b.fields.lagerbestand ?? 0) - (b.fields.mindestbestand ?? 0);
        return diffA - diffB;
      })
      .slice(0, 6)
      .map(m => ({
        id: m.record_id,
        title: m.fields.bezeichnung ?? 'Unbekannt',
        secondLine: (
          <span className="flex items-center gap-1">
            <span className="font-medium text-destructive">
              {m.fields.lagerbestand ?? 0} / {m.fields.mindestbestand}
            </span>
            <span className="text-muted-foreground"> {m.fields.einheit?.label ?? ''}</span>
          </span>
        ),
      }));
  }, [unterMindestbestand]);

  // Context line
  const contextLine = useMemo(() => {
    const active = enrichedAuftraege.filter(a => {
      const s = lookupKey(a.fields.status);
      return s === 'offen' || s === 'in_bearbeitung';
    });
    if (active.length === 0) return 'Keine offenen Aufträge — alles erledigt.';
    const names = namen(active.map(a => a.kundeName).filter(Boolean));
    return `${active.length} aktive Aufträge${names ? ` für ${names}` : ''}.`;
  }, [enrichedAuftraege]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Hero: dringende Aufträge
  const heroAuftraege = dringend.filter(a => {
    const s = lookupKey(a.fields.status);
    return s !== 'abgeschlossen' && s !== 'storniert';
  });

  // Overlay render helpers
  const topItem = overlay.top;
  const currentAuftrag = topItem?.type === 'auftrag'
    ? auftraege.find(a => a.record_id === topItem.id) ?? null
    : null;
  const currentPosition = topItem?.type === 'position'
    ? auftragspositionen.find(p => p.record_id === topItem.id) ?? null
    : null;
  const currentKunde = topItem?.type === 'kunde'
    ? kunden.find(k => k.record_id === topItem.id) ?? null
    : null;
  const currentMaterial = topItem?.type === 'material'
    ? material.find(m => m.record_id === topItem.id) ?? null
    : null;
  const currentPruef = topItem?.type === 'pruef'
    ? pruefprotokoll.find(p => p.record_id === topItem.id) ?? null
    : null;

  const currentAuftragForAdvance = currentAuftrag
    ? enrichedAuftraege.find(a => a.record_id === currentAuftrag.record_id) ?? null
    : null;
  const overlayAuftragStatus = currentAuftrag ? lookupKey(currentAuftrag.fields.status) : null;
  const overlayNextKey = overlayAuftragStatus === 'offen' ? 'in_bearbeitung'
    : overlayAuftragStatus === 'in_bearbeitung' ? 'abgeschlossen' : null;
  const overlayNextLabel = overlayNextKey === 'in_bearbeitung' ? 'Auftrag starten'
    : overlayNextKey === 'abgeschlossen' ? 'Abschließen' : undefined;

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
          <p className="mt-1 text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => { setEditingAuftrag(null); setAuftragDefaults(undefined); setAuftragDialogOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroAuftraege.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: heroAuftraege[0] && lookupKey(heroAuftraege[0].fields.status) === 'offen'
                ? 'Auftrag starten'
                : 'Abschließen',
              onClick: () => {
                const ea = enrichedAuftraege.find(a => a.record_id === heroAuftraege[0]?.record_id);
                if (ea) void advanceStatus(ea);
              },
            }}
          >
            <b>{namen(heroAuftraege.map(a => enrichedAuftraege.find(ea => ea.record_id === a.record_id)?.kundeName ?? a.fields.auftragsnummer ?? '').filter(Boolean))}</b>
            {' '}— {heroAuftraege.length === 1 ? 'dringender Auftrag' : `${heroAuftraege.length} dringende Aufträge`} warten auf Bearbeitung.
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              icon={<IconClipboardList size={14} />}
              tone={offene.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              icon={<IconCheck size={14} />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={14} />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
              onClick={() => setStatusFilter(f => f === '__dringend__' ? null : '__dringend__')}
              active={statusFilter === '__dringend__'}
            />
            <StatStripItem
              title="Niedriger Bestand"
              value={unterMindestbestand.length}
              icon={<IconPackage size={14} />}
              tone={unterMindestbestand.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={statusFilter === '__dringend__'
              ? cards.filter(c => {
                  const rid = c.id.split(':')[1];
                  return dringend.some(d => d.record_id === rid);
                })
              : cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1] ?? '';
              overlay.replace({ type: 'auftrag', id });
            }}
            onCardMove={moveCard}
            onAddCard={column => {
              setEditingAuftrag(null);
              setAuftragDefaults({ status: column });
              setAuftragDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Dringende Aufträge"
              items={dringendItems}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Keine dringenden Aufträge — alles im Zeitplan.',
                action: { label: 'Neuer Auftrag', onClick: () => setAuftragDialogOpen(true) },
              }}
            />
            <WorkList
              title="Materialbestand kritisch"
              items={materialItems}
              onItemClick={id => overlay.replace({ type: 'material', id })}
              empty={{
                text: 'Alle Materialien über Mindestbestand.',
              }}
            />
          </>
        }
      />

      {/* Overlay stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (!top) return null;
          if (top.type === 'auftrag' && currentAuftrag) {
            return (
              <>
                <RecordHeader
                  title={currentAuftrag.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[
                    currentAuftrag.fields.status?.label,
                    currentAuftragForAdvance?.kundeName,
                  ].filter(Boolean).join(' · ')}
                  actions={
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setEditingAuftrag(currentAuftrag);
                        setAuftragDefaults(undefined);
                        setAuftragDialogOpen(true);
                      }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftraegeDetails
                  record={currentAuftrag}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setEditingPosition(null);
                    setPositionDefaults({ auftrag: currentAuftrag.record_id });
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setEditingPruef(null);
                    setPruefDefaults({ auftrag_pruef: currentAuftrag.record_id });
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position' && currentPosition) {
            return (
              <>
                <RecordHeader
                  title={currentPosition.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enrichedAuftragspositionen.find(p => p.record_id === currentPosition.record_id)?.auftragName}
                  actions={
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setEditingPosition(currentPosition);
                        setPositionDefaults(undefined);
                        setPositionDialogOpen(true);
                      }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftragspositionenDetails
                  record={currentPosition}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'kunde' && currentKunde) {
            return (
              <>
                <RecordHeader
                  title={[currentKunde.fields.vorname, currentKunde.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={currentKunde.fields.firma}
                  actions={
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setEditingKunde(currentKunde);
                        setKundenDialogOpen(true);
                      }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <KundenDetails
                  record={currentKunde}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => {
                    setEditingAuftrag(null);
                    setAuftragDefaults({ kunde: currentKunde.record_id });
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material' && currentMaterial) {
            return (
              <>
                <RecordHeader
                  title={currentMaterial.fields.bezeichnung ?? 'Material'}
                  subtitle={[
                    currentMaterial.fields.artikelnummer,
                    currentMaterial.fields.verfuegbarkeit?.label,
                  ].filter(Boolean).join(' · ')}
                />
                <MaterialDetails
                  record={currentMaterial}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setEditingPosition(null);
                    setPositionDefaults({ material: currentMaterial.record_id });
                    setPositionDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'pruef' && currentPruef) {
            return (
              <>
                <RecordHeader
                  title={[currentPruef.fields.monteur_name_vorname, currentPruef.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={[
                    currentPruef.fields.pruefergebnis?.label,
                    currentPruef.fields.pruefungsdatum ? formatDate(currentPruef.fields.pruefungsdatum) : undefined,
                  ].filter(Boolean).join(' · ')}
                  actions={
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setEditingPruef(currentPruef);
                        setPruefDefaults(undefined);
                        setPruefDialogOpen(true);
                      }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <PruefprotokollDetails
                  record={currentPruef}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (!top) return null;
          if (top.type === 'auftrag' && currentAuftragForAdvance && overlayNextLabel) {
            return {
              label: overlayNextLabel,
              onClick: () => void advanceStatus(currentAuftragForAdvance).then(() => overlay.close()),
            };
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag' && currentAuftrag) {
            setEditingAuftrag(currentAuftrag);
            setAuftragDefaults(undefined);
            setAuftragDialogOpen(true);
          }
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(null); }}
        onSubmit={async fields => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={editingAuftrag ? editingAuftrag.fields : auftragDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(null); }}
        onSubmit={async fields => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          await fetchAll();
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
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(null); }}
        onSubmit={async fields => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={editingPruef ? editingPruef.fields : pruefDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => { setKundenDialogOpen(false); setEditingKunde(null); }}
        onSubmit={async fields => {
          if (editingKunde) {
            await LivingAppsService.updateKundenEntry(editingKunde.record_id, fields);
          } else {
            await LivingAppsService.createKundenEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={editingKunde?.fields}
        recordId={editingKunde?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
