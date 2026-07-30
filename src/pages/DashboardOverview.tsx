import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { KanbanWidget } from '@/components/widgets/KanbanWidget';
import type { KanbanCard, KanbanColumn } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
  RecordField,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
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
  IconTool,
  IconPackage,
  IconAlertCircle,
  IconCheck,
} from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'kunde'; record: Kunden }
  | { type: 'position'; record: Auftragspositionen }
  | { type: 'pruef'; record: Pruefprotokoll }
  | { type: 'material'; record: Material };

export default function DashboardOverview() {
  const clock = useClock();
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    setAuftraege,
    loading, error, fetchAll,
  } = useDashboardData();

  const enrichedAuftraege = enrichAuftraege(auftraege, { kundenMap });
  const enrichedAuftragspositionen = enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap });
  const enrichedPruefprotokoll = enrichPruefprotokoll(pruefprotokoll, { auftraegeMap });

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialog, setAuftragDialog] = useState<{ open: boolean; defaults?: AuftraegeDialogDefaults; recordId?: string }>({ open: false });
  const [positionDialog, setPositionDialog] = useState<{ open: boolean; defaults?: AuftragspositionenDialogDefaults; recordId?: string }>({ open: false });
  const [pruefDialog, setPruefDialog] = useState<{ open: boolean; defaults?: PruefprotokollDialogDefaults; recordId?: string }>({ open: false });
  const [kundeDialog, setKundeDialog] = useState(false);

  // KPI filters
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // ─── Derived data ───
  const today = format(clock, 'yyyy-MM-dd');

  const activeAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege]
  );

  const dringende = useMemo(
    () => activeAuftraege.filter(
      a => lookupKey(a.fields.prioritaet) === 'dringend' &&
           lookupKey(a.fields.status) !== 'abgeschlossen'
    ),
    [activeAuftraege]
  );

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );
  const inBearbeitungAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );

  const materialUnterMindestbestand = useMemo(
    () => material.filter(m => {
      const bestand = m.fields.lagerbestand ?? 0;
      const min = m.fields.mindestbestand ?? 0;
      return min > 0 && bestand < min;
    }),
    [material]
  );

  // Aufträge mit Wunschtermin heute oder überfällig
  const heuteUndUeberfaellig = useMemo(
    () => activeAuftraege
      .filter(a => {
        if (lookupKey(a.fields.status) === 'abgeschlossen') return false;
        const termin = a.fields.wunschtermin?.slice(0, 10) ?? a.fields.auftragsdatum?.slice(0, 10);
        return termin && termin <= today;
      })
      .sort((a, b) => {
        const ta = a.fields.wunschtermin?.slice(0, 10) ?? a.fields.auftragsdatum ?? '';
        const tb = b.fields.wunschtermin?.slice(0, 10) ?? b.fields.auftragsdatum ?? '';
        return ta.localeCompare(tb);
      }),
    [activeAuftraege, today]
  );

  // ─── Status advance helper ───
  const advanceStatus = useCallback(async (a: EnrichedAuftraege) => {
    const current = lookupKey(a.fields.status);
    const next = current === 'offen' ? 'in_bearbeitung'
      : current === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;
    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
    const prevStatus = a.fields.status;
    // Optimistic update
    setAuftraege(prev => prev.map(r =>
      r.record_id === a.record_id
        ? { ...r, fields: { ...r.fields, status: { key: next, label: nextLabel } } }
        : r
    ));
    LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next }).catch(() => {
      // Revert on error
      setAuftraege(prev => prev.map(r =>
        r.record_id === a.record_id
          ? { ...r, fields: { ...r.fields, status: prevStatus } }
          : r
      ));
      fetchAll();
    });
    undoToast(`Auftrag ${a.fields.auftragsnummer ?? ''} → ${nextLabel}`, () => {
      setAuftraege(prev => prev.map(r =>
        r.record_id === a.record_id
          ? { ...r, fields: { ...r.fields, status: prevStatus } }
          : r
      ));
      LivingAppsService.updateAuftraegeEntry(a.record_id, { status: prevStatus as any }).catch(() => fetchAll());
    });
  }, [setAuftraege, fetchAll]);

  // ─── Kanban columns ───
  const kanbanColumns: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
    key: o.key,
    label: o.label,
    tone: o.key === 'abgeschlossen' ? 'success' : o.key === 'storniert' ? 'default' : 'default',
  }));

  const filteredAuftraege = statusFilter
    ? enrichedAuftraege.filter(a => lookupKey(a.fields.status) === statusFilter)
    : enrichedAuftraege;

  const kanbanCards: KanbanCard[] = filteredAuftraege
    .sort((a, b) => {
      // Dringend zuerst
      const pa = lookupKey(a.fields.prioritaet) === 'dringend' ? 0 : 1;
      const pb = lookupKey(b.fields.prioritaet) === 'dringend' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (a.fields.auftragsdatum ?? '').localeCompare(b.fields.auftragsdatum ?? '');
    })
    .map(a => ({
      id: `auftrag:${a.record_id}`,
      column: lookupKey(a.fields.status) ?? 'offen',
      title: (
        <span className="flex items-center gap-1.5 min-w-0">
          {lookupKey(a.fields.prioritaet) === 'dringend' && (
            <IconAlertTriangle size={13} className="shrink-0 text-destructive" />
          )}
          <span className="truncate">{a.fields.auftragsnummer ?? '—'}</span>
        </span>
      ),
      subtitle: (
        <span className="truncate text-xs text-muted-foreground">
          {a.kundeName || '—'}
          {a.fields.monteur ? ` · ${a.fields.monteur}` : ''}
        </span>
      ),
      tone: lookupKey(a.fields.prioritaet) === 'dringend' ? 'destructive' as const : 'default' as const,
    }));

  const onCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const recordId = cardId.split(':')[1];
    const a = enrichedAuftraege.find(r => r.record_id === recordId);
    if (!a) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const prevStatus = a.fields.status;
    // Optimistic
    setAuftraege(prev => prev.map(r =>
      r.record_id === recordId
        ? { ...r, fields: { ...r.fields, status: { key: newColumn, label: newLabel } } }
        : r
    ));
    LivingAppsService.updateAuftraegeEntry(recordId, { status: newColumn }).catch(() => {
      setAuftraege(prev => prev.map(r =>
        r.record_id === recordId
          ? { ...r, fields: { ...r.fields, status: prevStatus } }
          : r
      ));
      fetchAll();
    });
    undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${newLabel}`, () => {
      setAuftraege(prev => prev.map(r =>
        r.record_id === recordId
          ? { ...r, fields: { ...r.fields, status: prevStatus } }
          : r
      ));
      LivingAppsService.updateAuftraegeEntry(recordId, { status: prevStatus as any }).catch(() => fetchAll());
    });
  }, [enrichedAuftraege, setAuftraege, fetchAll]);

  // ─── Every hook goes ABOVE this line ───
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only, no hooks. ───

  const contextLine = (() => {
    const dringendNamen = namen(dringende.map(a => a.fields.auftragsnummer ?? ''));
    if (dringende.length > 0) return `Dringend: ${dringendNamen} — ${heuteUndUeberfaellig.length} Auftrag${heuteUndUeberfaellig.length !== 1 ? 'träge' : ''} heute fällig.`;
    if (heuteUndUeberfaellig.length > 0) return `${heuteUndUeberfaellig.length} Auftrag${heuteUndUeberfaellig.length !== 1 ? 'träge' : ''} heute fällig — ${namen(heuteUndUeberfaellig.map(a => a.kundeName))} warten.`;
    if (offeneAuftraege.length > 0) return `${offeneAuftraege.length} offene Aufträge — alles im Zeitplan.`;
    return 'Keine offenen Aufträge — alles erledigt.';
  })();

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contextLine}</p>
        </div>
        <button
          onClick={() => setAuftragDialog({ open: true })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors shrink-0"
        >
          <IconClipboardList size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={dringende.length > 0 && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: `In Bearbeitung setzen`,
              onClick: () => advanceStatus(dringende[0]),
            }}
          >
            <b>{namen(dringende.map(a => a.fields.auftragsnummer ?? ''))}</b>
            {' '}— dringend{dringende.length > 1 ? `, ${dringende.length} Aufträge` : ''}, sofort bearbeiten.
          </HeroBanner>
        )}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              icon={<IconClipboardList size={16} />}
              tone={offeneAuftraege.length > 5 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitungAuftraege.length}
              icon={<IconTool size={16} />}
              tone="primary"
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Dringend"
              value={dringende.length}
              icon={<IconAlertCircle size={16} />}
              tone={dringende.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Lagerwarnung"
              value={materialUnterMindestbestand.length}
              icon={<IconPackage size={16} />}
              tone={materialUnterMindestbestand.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={kanbanColumns}
            cards={kanbanCards}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const recordId = card.id.split(':')[1];
              const a = enrichedAuftraege.find(r => r.record_id === recordId);
              if (a) overlay.replace({ type: 'auftrag', record: a });
            }}
            onCardMove={onCardMove}
            onAddCard={column => setAuftragDialog({ open: true, defaults: { status: column } })}
          />
        }
        aside={
          <>
            <WorkList
              title="Heute fällig & überfällig"
              items={heuteUndUeberfaellig.map(a => {
                const termin = a.fields.wunschtermin?.slice(0, 10) ?? a.fields.auftragsdatum?.slice(0, 10) ?? '';
                const ueberfaellig = termin < today;
                const nextStatus = lookupKey(a.fields.status) === 'offen' ? 'In Bearbeitung'
                  : lookupKey(a.fields.status) === 'in_bearbeitung' ? 'Abschließen' : null;
                return {
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? '—',
                  secondLine: (
                    <>
                      <span className={`font-medium ${ueberfaellig ? 'text-destructive' : 'text-warning'}`}>
                        {ueberfaellig ? 'Überfällig' : 'Heute'}
                      </span>
                      <span className="text-muted-foreground"> · {a.kundeName || '—'}</span>
                      {a.fields.monteur && <span className="text-muted-foreground"> · {a.fields.monteur}</span>}
                    </>
                  ),
                  action: nextStatus ? {
                    label: nextStatus === 'Abschließen' ? <><IconCheck size={14} className="shrink-0" /> Abschließen</> : `→ ${nextStatus}`,
                    onClick: () => advanceStatus(a),
                  } : undefined,
                };
              })}
              onItemClick={id => {
                const a = enrichedAuftraege.find(r => r.record_id === id);
                if (a) overlay.replace({ type: 'auftrag', record: a });
              }}
              empty={{
                text: offeneAuftraege.length > 0
                  ? `Nächster Auftrag: ${offeneAuftraege[0].kundeName || offeneAuftraege[0].fields.auftragsnummer}`
                  : 'Alles erledigt — neuen Auftrag anlegen',
                action: { label: 'Neuer Auftrag', onClick: () => setAuftragDialog({ open: true }) },
              }}
            />

            <WorkList
              title="Lagerwarnung"
              items={materialUnterMindestbestand.map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? '—',
                secondLine: (
                  <>
                    <span className="font-medium text-warning">Knapp</span>
                    <span className="text-muted-foreground">
                      {' · '}{m.fields.lagerbestand ?? 0} von min. {m.fields.mindestbestand} {m.fields.einheit?.label ?? ''}
                    </span>
                  </>
                ),
              }))}
              onItemClick={id => {
                const m = material.find(r => r.record_id === id);
                if (m) overlay.replace({ type: 'material', record: m });
              }}
              empty={{ text: 'Alle Materialien ausreichend bevorratet' }}
            />
          </>
        }
      />

      {/* ─── Dialoge ─── */}
      <AuftraegeDialog
        open={auftragDialog.open}
        onClose={() => setAuftragDialog({ open: false })}
        onSubmit={async (fields) => {
          await LivingAppsService.createAuftraegeEntry(fields);
          fetchAll();
        }}
        defaultValues={auftragDialog.defaults}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialog.open}
        onClose={() => setPositionDialog({ open: false })}
        onSubmit={async (fields) => {
          await LivingAppsService.createAuftragspositionenEntry(fields);
          fetchAll();
        }}
        defaultValues={positionDialog.defaults}
        recordId={positionDialog.recordId}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialog.open}
        onClose={() => setPruefDialog({ open: false })}
        onSubmit={async (fields) => {
          await LivingAppsService.createPruefprotokollEntry(fields);
          fetchAll();
        }}
        defaultValues={pruefDialog.defaults}
        recordId={pruefDialog.recordId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundeDialog}
        onClose={() => setKundeDialog(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      {/* ─── Overlay-Stack ─── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={a.kundeName || undefined}
                  badges={
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {a.fields.status?.label ?? '—'}
                    </span>
                  }
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', record: k })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', record: p })}
                  onAddAuftragspositionen={() => setPositionDialog({
                    open: true,
                    defaults: { auftrag: a.record_id },
                  })}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', record: p })}
                  onAddPruefprotokoll={() => setPruefDialog({
                    open: true,
                    defaults: { auftrag_pruef: a.record_id },
                  })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = top.record;
            return (
              <>
                <RecordHeader
                  title={[k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={k.fields.firma || undefined}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(r => r.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  onAddAuftraege={() => setAuftragDialog({ open: true, defaults: { kunde: k.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const p = top.record;
            const auftragRecord = auftraegeMap.get(extractRecordId(p.fields.auftrag) ?? '');
            const enrichedAuftrag = auftragRecord ? enrichedAuftraege.find(r => r.record_id === auftragRecord.record_id) : undefined;
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enrichedAuftragspositionen.find(r => r.record_id === p.record_id)?.auftragName || undefined}
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(r => r.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', record: m })}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const p = top.record;
            return (
              <>
                <RecordHeader
                  title={`Prüfprotokoll — ${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={enrichedPruefprotokoll.find(r => r.record_id === p.record_id)?.auftrag_pruefName || undefined}
                />
                <PruefprotokollDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => {
                    const enriched = enrichedAuftraege.find(r => r.record_id === a.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
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
                  subtitle={m.fields.artikelnummer || undefined}
                />
                <MaterialDetails
                  record={m}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', record: p })}
                  onAddAuftragspositionen={() => setPositionDialog({
                    open: true,
                    defaults: { material: m.record_id },
                  })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            const current = lookupKey(a.fields.status);
            if (current === 'offen') return { label: '→ In Bearbeitung', onClick: () => advanceStatus(a) };
            if (current === 'in_bearbeitung') return { label: '✓ Abschließen', onClick: () => advanceStatus(a) };
            return undefined;
          }
          return undefined;
        }}
      />
    </>
  );
}
