import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupKey } from '@/lib/formatters';
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
import {
  IconAlertTriangle,
  IconClipboardList,
  IconClock,
  IconCircleCheck,
  IconPackage,
  IconPlus,
  IconUser,
} from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'auftragsposition'; record: Auftragspositionen }
  | { type: 'pruefprotokoll'; record: Pruefprotokoll }
  | { type: 'kunde'; record: Kunden }
  | { type: 'material'; record: Material };

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    setAuftraege,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap]
  );

  // Dialog state
  const [auftraegeDialog, setAuftraegeDialog] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<EnrichedAuftraege | undefined>();

  const [posDialog, setPosDialog] = useState(false);
  const [posDefaults, setPosDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPos, setEditingPos] = useState<Auftragspositionen | undefined>();

  const [pruefDialog, setPruefDialog] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>();

  const [kundenDialog, setKundenDialog] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // ── Status-KPI-Werte ──────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of auftraege) {
      const k = lookupKey(a.fields.status) ?? 'ohne';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [auftraege]);

  // Dringende Aufträge (Priorität "dringend", nicht abgeschlossen/storniert)
  const dringend = useMemo(() =>
    enrichedAuftraege.filter(a => {
      const s = lookupKey(a.fields.status);
      const p = lookupKey(a.fields.prioritaet);
      return p === 'dringend' && s !== 'abgeschlossen' && s !== 'storniert';
    }),
    [enrichedAuftraege]
  );

  // Material unter Mindestbestand
  const unterMindest = useMemo(() =>
    material.filter(m =>
      m.fields.mindestbestand != null &&
      (m.fields.lagerbestand ?? 0) < (m.fields.mindestbestand ?? 0)
    ),
    [material]
  );

  // ── Advance-Helper (Status vorwärts schalten) ─────────────────────────────
  const STATUS_ORDER = ['offen', 'in_bearbeitung', 'abgeschlossen'];

  const advanceStatus = useCallback((auftrag: Auftraege) => {
    const cur = lookupKey(auftrag.fields.status) ?? 'offen';
    const idx = STATUS_ORDER.indexOf(cur);
    if (idx < 0 || idx >= STATUS_ORDER.length - 1) return;
    const next = STATUS_ORDER[idx + 1];
    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
    const prev = auftrag.fields.status;
    // Optimistic update
    setAuftraege(prev2 => prev2.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
        : a
    ));
    void LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next })
      .catch(() => {
        setAuftraege(prev2 => prev2.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: prev } }
            : a
        ));
        fetchAll();
      });
    undoToast(
      `Auftrag ${auftrag.fields.auftragsnummer ?? ''} → ${nextLabel}`,
      () => {
        setAuftraege(prev2 => prev2.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: prev } }
            : a
        ));
        void LivingAppsService.updateAuftraegeEntry(auftrag.record_id, {
          status: typeof prev === 'object' && prev !== null && 'key' in prev
            ? (prev as { key: string }).key
            : (prev as string | undefined) ?? 'offen'
        }).catch(fetchAll);
      }
    );
  }, [setAuftraege, fetchAll]);

  // ── Kanban ────────────────────────────────────────────────────────────────
  const kanbanColumns: KanbanColumn[] = useMemo(() =>
    (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
      key: o.key,
      label: o.label,
      tone: o.key === 'abgeschlossen' ? 'success' as const
        : o.key === 'storniert' ? 'default' as const
        : o.key === 'in_bearbeitung' ? 'primary' as const
        : 'default' as const,
    })),
    []
  );

  const kanbanCards: KanbanCard[] = useMemo(() => {
    const filtered = statusFilter
      ? enrichedAuftraege.filter(a => lookupKey(a.fields.status) === statusFilter)
      : enrichedAuftraege;
    return filtered.map(a => ({
      id: `auftrag:${a.record_id}`,
      column: lookupKey(a.fields.status) ?? '',
      title: (
        <span className="font-medium truncate">{a.fields.auftragsnummer ?? '—'}</span>
      ),
      subtitle: (
        <span className="text-xs text-muted-foreground truncate">
          {a.kundeName || '—'}
          {a.fields.prioritaet && lookupKey(a.fields.prioritaet) === 'dringend' && (
            <span className="ml-1 text-destructive font-semibold">· Dringend</span>
          )}
        </span>
      ),
      tone: lookupKey(a.fields.prioritaet) === 'dringend' ? 'warning' as const : 'default' as const,
    }));
  }, [enrichedAuftraege, statusFilter]);

  const handleCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1];
    const auftrag = auftraege.find(a => a.record_id === id);
    if (!auftrag) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const prev = auftrag.fields.status;
    setAuftraege(prev2 => prev2.map(a =>
      a.record_id === id
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    try {
      await LivingAppsService.updateAuftraegeEntry(id, { status: newColumn });
    } catch {
      setAuftraege(prev2 => prev2.map(a =>
        a.record_id === id
          ? { ...a, fields: { ...a.fields, status: prev } }
          : a
      ));
      fetchAll();
    }
    undoToast(
      `Auftrag → ${newLabel}`,
      () => {
        setAuftraege(prev2 => prev2.map(a =>
          a.record_id === id
            ? { ...a, fields: { ...a.fields, status: prev } }
            : a
        ));
        void LivingAppsService.updateAuftraegeEntry(id, {
          status: typeof prev === 'object' && prev !== null && 'key' in prev
            ? (prev as { key: string }).key
            : (prev as string | undefined) ?? 'offen'
        }).catch(fetchAll);
      }
    );
  }, [auftraege, setAuftraege, fetchAll]);

  const handleCardClick = useCallback((card: KanbanCard) => {
    const id = card.id.split(':')[1];
    const rec = enrichedAuftraege.find(a => a.record_id === id);
    if (rec) overlay.replace({ type: 'auftrag', record: rec });
  }, [enrichedAuftraege, overlay]);

  // ── Context-Zeile ─────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const offenCount = statusCounts['offen'] ?? 0;
    const inArbeit = statusCounts['in_bearbeitung'] ?? 0;
    if (enrichedAuftraege.length === 0) {
      return 'Noch keine Aufträge — lege deinen ersten Auftrag an.';
    }
    if (dringend.length > 0) {
      return `${namen(dringend.map(a => a.fields.auftragsnummer ?? ''))} dringend — ${offenCount} offen, ${inArbeit} in Bearbeitung.`;
    }
    return `${offenCount} offen, ${inArbeit} in Bearbeitung — alles im Griff.`;
  }, [enrichedAuftraege, dringend, statusCounts]);

  // ── WorkList: Dringende Aufträge ──────────────────────────────────────────
  const dringendItems = useMemo(() => dringend.map(a => ({
    id: a.record_id,
    title: a.fields.auftragsnummer ?? '—',
    secondLine: (
      <>
        <span className="font-medium text-destructive">Dringend</span>
        <span className="text-muted-foreground"> · {a.kundeName || '—'}</span>
        {a.fields.wunschtermin && (
          <span className="text-muted-foreground"> · {formatDate(a.fields.wunschtermin)}</span>
        )}
      </>
    ),
    action: {
      label: lookupKey(a.fields.status) === 'offen' ? '▶ Starten'
        : lookupKey(a.fields.status) === 'in_bearbeitung' ? '✓ Abschließen'
        : undefined,
      onClick: () => advanceStatus(a),
    },
  })).filter(item => item.action.label !== undefined) as { id: string; title: string; secondLine: React.ReactNode; action: { label: string; onClick: () => void } }[], [dringend, advanceStatus]);

  // ── WorkList: Material-Alarm ───────────────────────────────────────────────
  const materialAlarmItems = useMemo(() => unterMindest.map(m => ({
    id: m.record_id,
    title: m.fields.bezeichnung ?? '—',
    secondLine: (
      <>
        <span className="font-medium text-warning">Unterbestand</span>
        <span className="text-muted-foreground">
          {' '}· {m.fields.lagerbestand ?? 0} / {m.fields.mindestbestand} {m.fields.einheit?.label ?? ''}
        </span>
      </>
    ),
  })), [unterMindest]);

  // ── Every hook ABOVE this line ────────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Plain derivations only below ───────────────────────────────────────

  const offenCount = statusCounts['offen'] ?? 0;
  const inArbeitCount = statusCounts['in_bearbeitung'] ?? 0;
  const abgeschlossenCount = statusCounts['abgeschlossen'] ?? 0;

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">{gruss(clock)}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftraegeDefaults(undefined); setEditingAuftrag(undefined); setAuftraegeDialog(true); }}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          <span className="hidden sm:inline">Neuer Auftrag</span>
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={dringend.length > 0 && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: 'Jetzt starten',
              onClick: () => advanceStatus(dringend[0]),
            }}
          >
            <b>{namen(dringend.map(a => a.fields.auftragsnummer ?? ''))}</b> mit Priorität Dringend —{' '}
            {dringend[0].kundeName ? `Kunde: ${dringend[0].kundeName}` : 'kein Kunde hinterlegt'}.
          </HeroBanner>
        )}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offenCount}
              icon={<IconClipboardList size={16} />}
              tone={offenCount > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inArbeitCount}
              icon={<IconClock size={16} />}
              tone={inArbeitCount > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={abgeschlossenCount}
              icon={<IconCircleCheck size={16} />}
              tone={abgeschlossenCount > 0 ? 'success' : 'default'}
              onClick={() => setStatusFilter(f => f === 'abgeschlossen' ? null : 'abgeschlossen')}
              active={statusFilter === 'abgeschlossen'}
            />
            <StatStripItem
              title="Material-Alarm"
              value={unterMindest.length}
              icon={<IconPackage size={16} />}
              tone={unterMindest.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          enrichedAuftraege.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-xl border border-dashed border-border bg-muted/30">
              <IconClipboardList size={48} className="text-muted-foreground" stroke={1.5} />
              <div className="text-center">
                <p className="font-medium text-foreground">Noch keine Aufträge</p>
                <p className="text-sm text-muted-foreground mt-1">Lege deinen ersten Auftrag an und starte mit der Arbeit.</p>
              </div>
              <button
                onClick={() => { setAuftraegeDefaults(undefined); setEditingAuftrag(undefined); setAuftraegeDialog(true); }}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <IconPlus size={16} className="shrink-0" />
                Ersten Auftrag anlegen
              </button>
            </div>
          ) : (
            <KanbanWidget
              columns={kanbanColumns}
              cards={kanbanCards}
              defaultCollapsed={['storniert']}
              onCardClick={handleCardClick}
              onCardMove={handleCardMove}
              onAddCard={(column) => {
                setAuftraegeDefaults({ status: column });
                setEditingAuftrag(undefined);
                setAuftraegeDialog(true);
              }}
            />
          )
        }
        aside={
          <>
            <WorkList
              title="Dringende Aufträge"
              items={dringendItems}
              onItemClick={(id) => {
                const rec = enrichedAuftraege.find(a => a.record_id === id);
                if (rec) overlay.replace({ type: 'auftrag', record: rec });
              }}
              empty={{
                text: auftraege.length > 0
                  ? 'Keine dringenden Aufträge — alles im Plan.'
                  : 'Noch keine Aufträge vorhanden.',
                action: { label: 'Neuer Auftrag', onClick: () => setAuftraegeDialog(true) },
              }}
            />
            <WorkList
              title="Material-Alarm"
              items={materialAlarmItems}
              onItemClick={(id) => {
                const rec = material.find(m => m.record_id === id);
                if (rec) overlay.replace({ type: 'material', record: rec });
              }}
              empty={{
                text: unterMindest.length === 0
                  ? `Alles ausreichend bevorratet — ${material.length} Materialien im Lager.`
                  : undefined,
              }}
            />
          </>
        }
      />

      {/* ── Dialoge ─────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftraegeDialog}
        onClose={() => { setAuftraegeDialog(false); setEditingAuftrag(undefined); setAuftraegeDefaults(undefined); }}
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
        open={posDialog}
        onClose={() => { setPosDialog(false); setEditingPos(undefined); setPosDefaults(undefined); }}
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
        open={pruefDialog}
        onClose={() => { setPruefDialog(false); setEditingPruef(undefined); setPruefDefaults(undefined); }}
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
        open={kundenDialog}
        onClose={() => setKundenDialog(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      {/* ── Record-Overlay-Stack ─────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        onEdit={(item) => {
          if (item.type === 'auftrag') {
            setEditingAuftrag(item.record);
            setAuftraegeDefaults(undefined);
            setAuftraegeDialog(true);
          } else if (item.type === 'auftragsposition') {
            setEditingPos(item.record);
            setPosDefaults(undefined);
            setPosDialog(true);
          } else if (item.type === 'pruefprotokoll') {
            setEditingPruef(item.record);
            setPruefDefaults(undefined);
            setPruefDialog(true);
          }
        }}
        render={(item) => {
          if (item.type === 'auftrag') {
            const nextStatus = (() => {
              const cur = lookupKey(item.record.fields.status) ?? 'offen';
              const idx = STATUS_ORDER.indexOf(cur);
              if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
              return STATUS_ORDER[idx + 1];
            })();
            const nextLabel = nextStatus
              ? LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextStatus)?.label
              : null;
            return (
              <>
                <RecordHeader
                  title={item.record.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={item.record.kundeName || undefined}
                  badges={item.record.fields.status ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {item.record.fields.status?.label ?? lookupKey(item.record.fields.status)}
                    </span>
                  ) : undefined}
                />
                <AuftraegeDetails
                  record={item.record}
                  kundenList={kunden}
                  onOpenKunden={(k) => overlay.push({ type: 'kunde', record: k })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={(p) => overlay.push({ type: 'auftragsposition', record: p })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ auftrag: item.record.record_id });
                    setEditingPos(undefined);
                    setPosDialog(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={(p) => overlay.push({ type: 'pruefprotokoll', record: p })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: item.record.record_id });
                    setEditingPruef(undefined);
                    setPruefDialog(true);
                  }}
                />
              </>
            );
          }
          if (item.type === 'auftragsposition') {
            const auftrag = auftraegeMap.get(extractRecordId(item.record.fields.auftrag) ?? '');
            return (
              <>
                <RecordHeader
                  title={item.record.fields.positionsbeschreibung ?? 'Auftragsposition'}
                  subtitle={auftrag?.fields.auftragsnummer}
                />
                <AuftragspositionenDetails
                  record={item.record}
                  auftraegeList={auftraege}
                  onOpenAuftraege={(a) => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  materialList={material}
                  onOpenMaterial={(m) => overlay.push({ type: 'material', record: m })}
                />
              </>
            );
          }
          if (item.type === 'pruefprotokoll') {
            const auftrag = auftraegeMap.get(extractRecordId(item.record.fields.auftrag_pruef) ?? '');
            return (
              <>
                <RecordHeader
                  title={`${item.record.fields.monteur_name_vorname ?? ''} ${item.record.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={auftrag?.fields.auftragsnummer}
                />
                <PruefprotokollDetails
                  record={item.record}
                  auftraegeList={auftraege}
                  onOpenAuftraege={(a) => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                />
              </>
            );
          }
          if (item.type === 'kunde') {
            return (
              <>
                <RecordHeader
                  title={`${item.record.fields.vorname ?? ''} ${item.record.fields.nachname ?? ''}`.trim() || 'Kunde'}
                  subtitle={item.record.fields.firma}
                />
                <KundenDetails
                  record={item.record}
                  auftraegeList={auftraege}
                  onOpenAuftraege={(a) => {
                    const enriched = enrichedAuftraege.find(e => e.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  onAddAuftraege={() => {
                    setAuftraegeDefaults({ kunde: item.record.record_id });
                    setEditingAuftrag(undefined);
                    setAuftraegeDialog(true);
                  }}
                />
              </>
            );
          }
          if (item.type === 'material') {
            return (
              <>
                <RecordHeader
                  title={item.record.fields.bezeichnung ?? 'Material'}
                  subtitle={item.record.fields.artikelnummer}
                  badges={item.record.fields.verfuegbarkeit ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {item.record.fields.verfuegbarkeit?.label}
                    </span>
                  ) : undefined}
                />
                <MaterialDetails
                  record={item.record}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={(p) => overlay.push({ type: 'auftragsposition', record: p })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ material: item.record.record_id });
                    setEditingPos(undefined);
                    setPosDialog(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={(item) => {
          if (item.type === 'auftrag') {
            const cur = lookupKey(item.record.fields.status) ?? 'offen';
            const idx = STATUS_ORDER.indexOf(cur);
            if (idx >= 0 && idx < STATUS_ORDER.length - 1) {
              const next = STATUS_ORDER[idx + 1];
              const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
              return {
                label: `→ ${nextLabel}`,
                onClick: () => {
                  advanceStatus(item.record);
                  overlay.close();
                },
              };
            }
          }
          return undefined;
        }}
      />
    </>
  );
}
