import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
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
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconTool,
  IconCheck,
} from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'position'; record: Auftragspositionen }
  | { type: 'pruef'; record: import('@/types/enriched').EnrichedPruefprotokoll }
  | { type: 'kunde'; record: import('@/types/app').Kunden };

export default function DashboardOverview() {
  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

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
  const enrichedPruefprotokoll = useMemo(
    () => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }),
    [pruefprotokoll, auftraegeMap]
  );

  // Dialog state
  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<EnrichedAuftraege | null>(null);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | null>(null);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | null>(null);

  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);

  // Advance-Status-Helper — shared across board, work list, overlay footer
  const advanceStatus = useCallback(async (a: EnrichedAuftraege) => {
    const currentKey = lookupKey(a.fields.status);
    const nextKey = currentKey === 'offen' ? 'in_bearbeitung'
      : currentKey === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!nextKey) return;
    const nextLabel = nextKey === 'in_bearbeitung' ? 'In Bearbeitung' : 'Abgeschlossen';
    const snapshot = auftraege.map(r => r.record_id === a.record_id
      ? { ...r, fields: { ...r.fields, status: { key: nextKey, label: nextLabel } } }
      : r);
    setAuftraege(snapshot);
    const undo = async () => {
      setAuftraege(auftraege);
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: currentKey ?? undefined });
    };
    undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, undo);
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: nextKey });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── All hooks above early returns ───────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below: plain derivations only ───────────────────────────────────────

  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen');
  const inBearbeitung = enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung');
  const dringend = enrichedAuftraege.filter(
    a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'
  );
  const heuteFaellig = enrichedAuftraege.filter(a => {
    if (!a.fields.liefertermin) return false;
    const d = a.fields.liefertermin.slice(0, 10);
    const st = lookupKey(a.fields.status);
    return d <= today && st !== 'abgeschlossen' && st !== 'storniert';
  });
  const materialUnterMindest = material.filter(
    m => m.fields.lagerbestand != null && m.fields.mindestbestand != null
      && m.fields.lagerbestand < m.fields.mindestbestand
  );
  const letzteProtokolle = enrichedPruefprotokoll
    .filter(p => lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden')
    .slice(0, 5);

  // Kanban
  const columns: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
    key: o.key,
    label: o.label,
    tone: o.key === 'abgeschlossen' ? 'success' as const
      : o.key === 'storniert' ? 'default' as const
      : o.key === 'in_bearbeitung' ? 'primary' as const
      : 'default' as const,
  }));

  const cards: KanbanCard[] = enrichedAuftraege
    .sort((a, b) => (a.fields.auftragsdatum ?? '').localeCompare(b.fields.auftragsdatum ?? ''))
    .map(a => ({
      id: `auftrag:${a.record_id}`,
      column: lookupKey(a.fields.status) ?? '',
      title: a.fields.auftragsnummer ?? '—',
      subtitle: [
        a.kundeName || undefined,
        a.fields.liefertermin ? `Liefern: ${formatDateTime(a.fields.liefertermin)}` : undefined,
      ].filter(Boolean).join(' · ') || undefined,
      tone: lookupKey(a.fields.prioritaet) === 'dringend' ? 'destructive' as const
        : lookupKey(a.fields.prioritaet) === 'hoch' ? 'warning' as const
        : 'default' as const,
    }));

  const handleCardMove = async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1];
    const rec = auftraege.find(a => a.record_id === id);
    if (!rec) return;
    const newLabel = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).find(o => o.key === newColumn)?.label ?? newColumn;
    const snapshot = auftraege;
    setAuftraege(auftraege.map(a => a.record_id === id
      ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
      : a
    ));
    const undo = async () => {
      setAuftraege(snapshot);
      await LivingAppsService.updateAuftraegeEntry(id, { status: lookupKey(rec.fields.status) });
    };
    undoToast(`Status → ${newLabel}`, undo);
    try {
      await LivingAppsService.updateAuftraegeEntry(id, { status: newColumn });
    } catch {
      fetchAll();
    }
  };

  const handleAddCard = (column: string) => {
    setEditingAuftrag(null);
    setAuftraegeDefaults({ status: column });
    setAuftraegeDialogOpen(true);
  };

  const handleCardClick = (card: KanbanCard) => {
    const id = card.id.split(':')[1];
    const rec = enrichedAuftraege.find(a => a.record_id === id);
    if (rec) overlay.replace({ type: 'auftrag', record: rec });
  };

  // Context line
  const dringendNamen = dringend.length > 0 ? namen(dringend.map(a => a.fields.auftragsnummer ?? '')) : null;
  const contextLine = dringendNamen
    ? `${dringendNamen} — dringend und noch offen.`
    : offeneAuftraege.length > 0
      ? `${offeneAuftraege.length} offene Aufträge, ${inBearbeitung.length} in Bearbeitung.`
      : 'Alle Aufträge erledigt — gut gemacht!';

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
        <button
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={() => { setEditingAuftrag(null); setAuftraegeDefaults(undefined); setAuftraegeDialogOpen(true); }}
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={dringend.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: 'In Bearbeitung nehmen',
              onClick: () => advanceStatus(dringend[0]),
            }}
          >
            <b>{namen(dringend.map(a => a.fields.auftragsnummer ?? ''))}</b>{' '}
            {dringend.length === 1 ? 'ist dringend' : 'sind dringend'} und noch nicht in Bearbeitung.
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
              value={inBearbeitung.length}
              icon={<IconTool size={16} className="shrink-0" />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Heute fällig"
              value={heuteFaellig.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={heuteFaellig.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Material unter Mindest"
              value={materialUnterMindest.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={materialUnterMindest.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={columns}
            cards={cards}
            defaultCollapsed={['storniert']}
            onCardClick={handleCardClick}
            onCardMove={handleCardMove}
            onAddCard={handleAddCard}
          />
        }
        aside={<>
          <WorkList
            title="Heute fällig & überfällig"
            items={heuteFaellig.map(a => ({
              id: a.record_id,
              title: a.fields.auftragsnummer ?? '—',
              secondLine: (
                <>
                  <span className={`font-medium ${lookupKey(a.fields.status) === 'offen' ? 'text-warning' : 'text-primary'}`}>
                    {a.fields.status?.label ?? '—'}
                  </span>
                  <span className="text-muted-foreground"> · {a.kundeName || 'Unbekannter Kunde'}</span>
                </>
              ),
              action: lookupKey(a.fields.status) !== 'abgeschlossen'
                ? {
                    label: <><IconCheck size={14} className="shrink-0" /> Weiter</>,
                    onClick: () => advanceStatus(a),
                  }
                : undefined,
            }))}
            onItemClick={id => {
              const rec = enrichedAuftraege.find(a => a.record_id === id);
              if (rec) overlay.replace({ type: 'auftrag', record: rec });
            }}
            empty={{
              text: offeneAuftraege.length > 0
                ? `Nächster Auftrag: ${offeneAuftraege[0].fields.auftragsnummer}`
                : 'Keine fälligen Aufträge — alles im Zeitplan.',
              action: { label: 'Neuer Auftrag', onClick: () => { setEditingAuftrag(null); setAuftraegeDefaults(undefined); setAuftraegeDialogOpen(true); } },
            }}
          />
          <WorkList
            title="Offene Mängel (Prüfprotokoll)"
            items={letzteProtokolle.map(p => ({
              id: p.record_id,
              title: p.auftrag_pruefName || p.fields.monteur_name_vorname || '—',
              secondLine: (
                <>
                  <span className="font-medium text-destructive">Nicht bestanden</span>
                  <span className="text-muted-foreground"> · {formatDate(p.fields.pruefungsdatum)}</span>
                </>
              ),
            }))}
            onItemClick={id => {
              const rec = enrichedPruefprotokoll.find(p => p.record_id === id);
              if (rec) overlay.replace({ type: 'pruef', record: rec } as OverlayItem);
            }}
            empty={{
              text: 'Keine offenen Mängel — alle Prüfungen bestanden.',
            }}
          />
        </>}
      />

      {/* Overlay Stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? '—'}
                  subtitle={a.kundeName || undefined}
                  badges={
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      lookupKey(a.fields.status) === 'offen' ? 'bg-warning/10 text-warning'
                      : lookupKey(a.fields.status) === 'in_bearbeitung' ? 'bg-primary/10 text-primary'
                      : lookupKey(a.fields.status) === 'abgeschlossen' ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground'
                    }`}>
                      {a.fields.status?.label ?? '—'}
                    </span>
                  }
                  actions={
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                      onClick={() => { setEditingAuftrag(a); setAuftraegeDefaults(undefined); setAuftraegeDialogOpen(true); }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', record: k })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', record: p })}
                  onAddAuftragspositionen={() => {
                    setEditingPosition(null);
                    setPositionDefaults({ auftrag: a.record_id });
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => {
                    const enriched = enrichedPruefprotokoll.find(e => e.record_id === p.record_id);
                    if (enriched) overlay.push({ type: 'pruef', record: enriched } as OverlayItem);
                  }}
                  onAddPruefprotokoll={() => {
                    setEditingPruef(null);
                    setPruefDefaults({ auftrag_pruef: a.record_id });
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const p = top.record;
            const auftrag = auftraegeMap.get(extractRecordId(p.fields.auftrag) ?? '');
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={auftrag?.fields.auftragsnummer}
                  actions={
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                      onClick={() => { setEditingPosition(p); setPositionDefaults(undefined); setPositionDialogOpen(true); }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  materialList={material}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const p = top.record;
            return (
              <>
                <RecordHeader
                  title={[p.fields.monteur_name_vorname, p.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={p.auftrag_pruefName || undefined}
                  badges={
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden' ? 'bg-destructive/10 text-destructive'
                      : lookupKey(p.fields.pruefergebnis) === 'bestanden' ? 'bg-success/10 text-success'
                      : 'bg-warning/10 text-warning'
                    }`}>
                      {p.fields.pruefergebnis?.label ?? '—'}
                    </span>
                  }
                  actions={
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                      onClick={() => { setEditingPruef(p); setPruefDefaults(undefined); setPruefDialogOpen(true); }}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <PruefprotokollDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
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
                  title={[k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '—'}
                  subtitle={k.fields.firma}
                  actions={
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                      onClick={() => setKundenDialogOpen(true)}
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  onAddAuftraege={() => {
                    setEditingAuftrag(null);
                    setAuftraegeDefaults({ kunde: k.record_id });
                    setAuftraegeDialogOpen(true);
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
            const key = lookupKey(a.fields.status);
            if (key === 'offen') return { label: 'In Bearbeitung nehmen', onClick: () => advanceStatus(a) };
            if (key === 'in_bearbeitung') return { label: 'Als erledigt markieren', onClick: () => advanceStatus(a) };
          }
          return undefined;
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => { setAuftraegeDialogOpen(false); setEditingAuftrag(null); }}
        onSubmit={async fields => {
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
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(null); }}
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
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(null); }}
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

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => setKundenDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
