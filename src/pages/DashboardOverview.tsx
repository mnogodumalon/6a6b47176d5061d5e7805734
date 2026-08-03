import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { lookupKey, formatDate, formatDateTime } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import {
  KanbanWidget,
  type KanbanCard,
  type KanbanColumn,
  type KanbanTone,
} from '@/components/widgets/KanbanWidget';
import {
  RecordOverlayHost,
  RecordHeader,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';

// Overlay union type
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string };

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
  const clock = useClock();

  const {
    kunden,
    material,
    auftraege, setAuftraege,
    auftragspositionen,
    pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | undefined>();

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>();

  // Status filter
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const today = format(clock, 'yyyy-MM-dd');

  // Kanban cards — must be above early returns
  const cards = useMemo<KanbanCard[]>(() => {
    const baseList = statusFilter
      ? auftraege.filter(a => lookupKey(a.fields.status) === statusFilter)
      : auftraege;
    return baseList.map(a => {
      const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
      const kundeFields = kundenMap.get(extractRecordId(a.fields.kunde) ?? '')?.fields;
      const name = kundeFields ? `${kundeFields.vorname ?? ''} ${kundeFields.nachname ?? ''}`.trim() : '—';
      const isOverdue = a.fields.liefertermin && a.fields.liefertermin.slice(0, 10) < today
        && status !== 'abgeschlossen' && status !== 'storniert';
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? name,
        subtitle: name !== '—' ? name : (a.fields.wunschtermin ? formatDate(a.fields.wunschtermin) : undefined),
        tone: isOverdue ? 'destructive' as KanbanTone : toneForStatus(status),
      };
    });
  }, [auftraege, kundenMap, today, statusFilter]);

  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const oldStatus = auftrag.fields.status ? { ...auftrag.fields.status } : undefined;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const oldLabel = auftrag.fields.status?.label ?? lookupKey(auftrag.fields.status) ?? '—';
    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    undoToast(`Status zu „${newLabel}" geändert`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: oldStatus ?? { key: '', label: oldLabel } } }
          : a
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: oldStatus?.key ?? '' });
      } catch { fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
    } catch { fetchAll(); }
  }, [auftraege, setAuftraege, fetchAll]);

  const advanceStatus = useCallback(async (auftrag: Auftraege) => {
    const cur = lookupKey(auftrag.fields.status);
    const sequence = ['offen', 'in_bearbeitung', 'abgeschlossen'];
    const idx = sequence.indexOf(cur ?? '');
    if (idx < 0 || idx >= sequence.length - 1) return;
    const next = sequence[idx + 1];
    const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
    const oldStatus = auftrag.fields.status ? { ...auftrag.fields.status } : undefined;
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
        : a
    ));
    undoToast(`Auftrag auf „${nextLabel}" gesetzt`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: oldStatus } }
          : a
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: oldStatus?.key ?? '' });
      } catch { fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
    } catch { fetchAll(); }
  }, [setAuftraege, fetchAll]);

  // ─── Every hook goes ABOVE this line ───────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only, no hooks. ────────────────────

  const enrichedAuftraege = enrichAuftraege(auftraege, { kundenMap });
  const enrichedAuftragspositionen = enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap });
  const enrichedPruefprotokoll = enrichPruefprotokoll(pruefprotokoll, { auftraegeMap });

  const offen = auftraege.filter(a => lookupKey(a.fields.status) === 'offen');
  const inBearbeitung = auftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung');
  const dringend = auftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');

  const faellig = enrichedAuftraege.filter(a => {
    const status = lookupKey(a.fields.status);
    if (status === 'abgeschlossen' || status === 'storniert') return false;
    if (!a.fields.liefertermin) return false;
    return a.fields.liefertermin.slice(0, 10) < today;
  });

  const ohneMonteur = auftraege.filter(a =>
    lookupKey(a.fields.status) === 'in_bearbeitung' && !a.fields.monteur
  );

  const dringendNames = namen(dringend.map(a => {
    const k = kundenMap.get(extractRecordId(a.fields.kunde) ?? '');
    return k ? `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() : (a.fields.auftragsnummer ?? '');
  }));

  const contextLine = auftraege.length === 0
    ? 'Noch keine Aufträge — leg gleich los!'
    : faellig.length > 0
      ? `${faellig.length} überfällige Aufträge · ${inBearbeitung.length} in Bearbeitung`
      : dringend.length > 0
        ? `Dringend: ${dringendNames}`
        : `${offen.length} offen, ${inBearbeitung.length} in Bearbeitung`;

  const heroAuftrag = faellig[0];

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => { setEditingAuftrag(undefined); setAuftragDefaults(undefined); setAuftragDialogOpen(true); }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          <span className="hidden sm:inline">Neuer Auftrag</span>
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroAuftrag && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: 'In Bearbeitung setzen',
              onClick: () => advanceStatus(heroAuftrag),
            }}
          >
            <b>{faellig.length === 1
              ? (enrichedAuftraege.find(a => a.record_id === heroAuftrag.record_id)?.kundeName || heroAuftrag.fields.auftragsnummer || 'Auftrag')
              : namen(faellig.map(a => enrichedAuftraege.find(e => e.record_id === a.record_id)?.kundeName || a.fields.auftragsnummer || ''))
            }</b>{' '}
            {faellig.length === 1 ? 'überfällig' : `— ${faellig.length} Aufträge überfällig`}
            {heroAuftrag.fields.liefertermin ? ` · Termin war ${formatDateTime(heroAuftrag.fields.liefertermin)}` : ''}.
          </HeroBanner>
        )}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offen.length}
              tone={offen.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
            onCardMove={moveCard}
            onAddCard={column => {
              setEditingAuftrag(undefined);
              setAuftragDefaults({ status: column });
              setAuftragDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Fällig & dringend"
              items={[
                ...faellig.map(a => {
                  const en = enrichedAuftraege.find(e => e.record_id === a.record_id);
                  const statusKey = lookupKey(a.fields.status) ?? '';
                  const seq = ['offen', 'in_bearbeitung', 'abgeschlossen'];
                  const canAdvance = seq.indexOf(statusKey) >= 0 && seq.indexOf(statusKey) < seq.length - 1;
                  return {
                    id: a.record_id,
                    title: en?.kundeName || a.fields.auftragsnummer || 'Auftrag',
                    secondLine: (
                      <>
                        <span className="font-medium text-destructive">Überfällig</span>
                        <span className="text-muted-foreground"> · {a.fields.liefertermin ? formatDateTime(a.fields.liefertermin) : '—'}</span>
                      </>
                    ),
                    action: canAdvance ? {
                      label: '→ Weiter',
                      onClick: () => advanceStatus(a),
                    } : undefined,
                  };
                }),
                ...dringend
                  .filter(a => !faellig.some(f => f.record_id === a.record_id))
                  .map(a => {
                    const en = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    const statusKey = lookupKey(a.fields.status) ?? '';
                    const seq = ['offen', 'in_bearbeitung', 'abgeschlossen'];
                    const canAdvance = seq.indexOf(statusKey) >= 0 && seq.indexOf(statusKey) < seq.length - 1;
                    return {
                      id: a.record_id,
                      title: en?.kundeName || a.fields.auftragsnummer || 'Auftrag',
                      secondLine: (
                        <>
                          <span className="font-medium" style={{ color: 'var(--color-orange-600, #ea580c)' }}>Dringend</span>
                          <span className="text-muted-foreground"> · {a.fields.auftragsdatum ? formatDate(a.fields.auftragsdatum) : '—'}</span>
                        </>
                      ),
                      action: canAdvance ? {
                        label: '→ Weiter',
                        onClick: () => advanceStatus(a),
                      } : undefined,
                    };
                  }),
              ]}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alles im Zeitplan — kein Auftrag überfällig',
                action: { label: 'Neuer Auftrag', onClick: () => { setEditingAuftrag(undefined); setAuftragDefaults(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Ohne Monteur"
              items={ohneMonteur.map(a => {
                const en = enrichedAuftraege.find(e => e.record_id === a.record_id);
                return {
                  id: a.record_id,
                  title: en?.kundeName || a.fields.auftragsnummer || 'Auftrag',
                  secondLine: (
                    <>
                      <span className="font-medium text-warning">Kein Monteur</span>
                      <span className="text-muted-foreground"> · {a.fields.auftragsnummer ?? '—'}</span>
                    </>
                  ),
                  action: {
                    label: '✎ Zuweisen',
                    onClick: () => { setEditingAuftrag(a); setAuftragDefaults(a.fields as AuftraegeDialogDefaults); setAuftragDialogOpen(true); },
                  },
                };
              })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{ text: 'Allen Aufträgen in Bearbeitung ist ein Monteur zugewiesen' }}
            />
          </>
        }
      />

      {/* Overlay stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            const en = enrichedAuftraege.find(e => e.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={en?.kundeName || rec.fields.auftragsnummer || 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={
                    rec.fields.prioritaet?.label
                      ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{rec.fields.prioritaet.label}</span>
                      : undefined
                  }
                  actions={
                    <button
                      onClick={() => { setEditingAuftrag(rec); setAuftragDefaults(rec.fields as AuftraegeDialogDefaults); setAuftragDialogOpen(true); }}
                      className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => { setEditingPosition(undefined); setPositionDefaults({ auftrag: rec.record_id }); setPositionDialogOpen(true); }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => { setEditingPruef(undefined); setPruefDefaults({ auftrag_pruef: rec.record_id }); setPruefDialogOpen(true); }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const rec = auftragspositionen.find(p => p.record_id === top.id);
            if (!rec) return null;
            const en = enrichedAuftragspositionen.find(e => e.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung || en?.auftragName || 'Position'}
                  subtitle={en?.auftragName}
                  actions={
                    <button
                      onClick={() => { setEditingPosition(rec); setPositionDefaults(rec.fields as AuftragspositionenDialogDefaults); setPositionDialogOpen(true); }}
                      className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={_m => overlay.push({ type: 'position', id: rec.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const rec = pruefprotokoll.find(p => p.record_id === top.id);
            if (!rec) return null;
            const en = enrichedPruefprotokoll.find(e => e.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={`${rec.fields.monteur_name_vorname ?? ''} ${rec.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={en?.auftrag_pruefName}
                  actions={
                    <button
                      onClick={() => { setEditingPruef(rec); setPruefDefaults(rec.fields as PruefprotokollDialogDefaults); setPruefDialogOpen(true); }}
                      className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Bearbeiten
                    </button>
                  }
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
            const rec = kunden.find(k => k.record_id === top.id);
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
                  onAddAuftraege={() => { setEditingAuftrag(undefined); setAuftragDefaults({ kunde: rec.record_id }); setAuftragDialogOpen(true); }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return undefined;
            const statusKey = lookupKey(rec.fields.status);
            const seq = ['offen', 'in_bearbeitung', 'abgeschlossen'];
            const idx = seq.indexOf(statusKey ?? '');
            if (idx < 0 || idx >= seq.length - 1) return undefined;
            const next = seq[idx + 1];
            const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
            return { label: `→ ${nextLabel}`, onClick: () => advanceStatus(rec) };
          }
          return undefined;
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(undefined); }}
        onSubmit={async fields => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={auftragDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(undefined); }}
        onSubmit={async fields => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={positionDefaults}
        recordId={editingPosition?.record_id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(undefined); }}
        onSubmit={async fields => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={pruefDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />
    </>
  );
}
