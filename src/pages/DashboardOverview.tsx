import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
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
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
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
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { MaterialDialog } from '@/components/dialogs/MaterialDialog';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconPackage,
  IconUsers,
  IconCheck,
} from '@tabler/icons-react';

// ── Kanban columns from schema ──────────────────────────────────────────────
const AUFTRAG_COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning';
}

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

// ── Dialog state types ───────────────────────────────────────────────────────
type DialogState =
  | { kind: 'auftrag-create'; defaults?: AuftraegeDialogDefaults }
  | { kind: 'auftrag-edit'; id: string; defaults: AuftraegeDialogDefaults }
  | { kind: 'auftragsposition-create'; defaults?: AuftragspositionenDialogDefaults }
  | { kind: 'auftragsposition-edit'; id: string; defaults: AuftragspositionenDialogDefaults }
  | { kind: 'pruefprotokoll-create'; defaults?: PruefprotokollDialogDefaults }
  | { kind: 'pruefprotokoll-edit'; id: string; defaults: PruefprotokollDialogDefaults }
  | { kind: 'kunde-create' }
  | { kind: 'material-create' }
  | null;

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    setAuftraege,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();
  const [dialog, setDialog] = useState<DialogState>(null);

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

  // ── Derived counts ──────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );
  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );
  const dringend = useMemo(
    () => enrichedAuftraege.filter(a =>
      lookupKey(a.fields.prioritaet) === 'dringend' &&
      lookupKey(a.fields.status) !== 'abgeschlossen' &&
      lookupKey(a.fields.status) !== 'storniert'
    ),
    [enrichedAuftraege]
  );
  const materialUnterMindest = useMemo(
    () => material.filter(m =>
      m.fields.mindestbestand != null &&
      m.fields.lagerbestand != null &&
      m.fields.lagerbestand < m.fields.mindestbestand
    ),
    [material]
  );
  const faelligHeute = useMemo(
    () => enrichedAuftraege.filter(a => {
      const wt = a.fields.wunschtermin?.slice(0, 10);
      return wt === today && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert';
    }),
    [enrichedAuftraege, today]
  );

  // ── Context line ─────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (dringend.length > 0) {
      parts.push(`${dringend.length} dringend${dringend.length === 1 ? 'er Auftrag' : 'e Aufträge'}`);
    }
    if (faelligHeute.length > 0) {
      parts.push(`${faelligHeute.length} für heute geplant`);
    }
    if (inBearbeitung.length > 0) {
      parts.push(`${inBearbeitung.length} in Bearbeitung`);
    }
    if (parts.length === 0) {
      if (auftraege.length === 0) return 'Noch keine Aufträge angelegt — leg gleich los!';
      return 'Alles im Griff — keine dringenden Aufträge.';
    }
    return parts.join(' · ') + '.';
  }, [dringend, faelligHeute, inBearbeitung, auftraege]);

  // ── Kanban cards ──────────────────────────────────────────────────────────
  const kanbanCards = useMemo((): KanbanCard[] =>
    enrichedAuftraege.map(a => ({
      id: `auftrag:${a.record_id}`,
      column: lookupKey(a.fields.status) ?? '',
      title: a.fields.auftragsnummer ?? '(kein Titel)',
      subtitle: [
        a.kundeName || undefined,
        a.fields.wunschtermin ? `Termin: ${formatDate(a.fields.wunschtermin)}` : undefined,
        a.fields.monteur || undefined,
      ].filter(Boolean).join(' · ') || undefined,
      tone: toneForStatus(lookupKey(a.fields.status)),
    })),
    [enrichedAuftraege]
  );

  // ── Status-advance helper ─────────────────────────────────────────────────
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const current = lookupKey(auftrag.fields.status);
    const next = current === 'offen' ? 'in_bearbeitung'
      : current === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;
    const nextLabel = AUFTRAG_COLUMNS.find(c => c.key === next)?.label ?? next;
    const snapshot = auftraege.map(a => a.record_id === auftrag.record_id ? { ...a, fields: { ...a.fields, status: a.fields.status } } : a);
    setAuftraege(prev => prev.map(a => a.record_id === auftrag.record_id
      ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
      : a
    ));
    undoToast(`„${auftrag.fields.auftragsnummer}" → ${nextLabel}`, () => {
      setAuftraege(snapshot);
      LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: current ?? undefined }).catch(() => fetchAll());
    });
    LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next }).catch(() => fetchAll());
  }, [auftraege, setAuftraege, fetchAll]);

  // ── Kanban move handler ──────────────────────────────────────────────────
  const handleCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1] ?? '';
    const auftrag = auftraege.find(a => a.record_id === id);
    if (!auftrag) return;
    const newLabel = AUFTRAG_COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const snapshot = auftraege.map(a => ({ ...a }));
    setAuftraege(prev => prev.map(a => a.record_id === id
      ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
      : a
    ));
    undoToast(`„${auftrag.fields.auftragsnummer}" → ${newLabel}`, () => {
      setAuftraege(snapshot);
      const prevKey = lookupKey(auftrag.fields.status);
      LivingAppsService.updateAuftraegeEntry(id, { status: prevKey ?? undefined }).catch(() => fetchAll());
    });
    LivingAppsService.updateAuftraegeEntry(id, { status: newColumn }).catch(() => fetchAll());
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── Every hook goes ABOVE this line ────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only ─────────────────────────────

  const heroBanner = dringend.length > 0 ? (
    <HeroBanner
      icon={<IconAlertTriangle size={18} />}
      action={{
        label: 'In Bearbeitung nehmen',
        onClick: () => advanceStatus(dringend[0]),
      }}
    >
      <b>{namen(dringend.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>{' '}
      {dringend.length === 1 ? 'hat einen dringenden Auftrag' : `haben ${dringend.length} dringende Aufträge`} —{' '}
      sofortige Bearbeitung erforderlich.
    </HeroBanner>
  ) : undefined;

  const kpisStrip = (
    <StatStrip>
      <StatStripItem
        title="Offen"
        value={offeneAuftraege.length}
        icon={<IconClipboardList size={16} />}
        tone={offeneAuftraege.length > 0 ? 'warning' : 'default'}
      />
      <StatStripItem
        title="In Bearbeitung"
        value={inBearbeitung.length}
        icon={<IconClipboardList size={16} />}
        tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
      />
      <StatStripItem
        title="Kunden"
        value={kunden.length}
        icon={<IconUsers size={16} />}
      />
      <StatStripItem
        title="Material knapp"
        value={materialUnterMindest.length}
        icon={<IconPackage size={16} />}
        tone={materialUnterMindest.length > 0 ? 'destructive' : 'default'}
      />
    </StatStrip>
  );

  const asideLists = (
    <>
      <WorkList
        title="Heute fällig & dringend"
        items={[
          ...faelligHeute.map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? '(kein Titel)',
            secondLine: (
              <>
                <span className={lookupKey(a.fields.status) === 'offen' ? 'font-medium text-warning' : 'font-medium text-primary'}>
                  {a.fields.status?.label ?? '—'}
                </span>
                {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
              </>
            ),
            action: lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'
              ? { label: '✓ Weiter', onClick: () => advanceStatus(a) }
              : undefined,
          })),
          ...dringend.filter(a => !faelligHeute.find(f => f.record_id === a.record_id)).map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? '(kein Titel)',
            secondLine: (
              <>
                <span className="font-medium text-destructive">Dringend</span>
                {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
              </>
            ),
            action: { label: '✓ Weiter', onClick: () => advanceStatus(a) },
          })),
        ]}
        onItemClick={id => overlay.replace({ type: 'auftrag', id })}
        empty={{
          text: offeneAuftraege.length > 0
            ? `Nächster Auftrag: ${offeneAuftraege[0].fields.auftragsnummer}`
            : 'Alles im Zeitplan — keine Aufträge fällig.',
          action: { label: 'Neuer Auftrag', onClick: () => setDialog({ kind: 'auftrag-create' }) },
        }}
      />
      <WorkList
        title="Material unter Mindestbestand"
        items={materialUnterMindest.map(m => ({
          id: m.record_id,
          title: m.fields.bezeichnung ?? '(unbekannt)',
          secondLine: (
            <>
              <span className="font-medium text-destructive">
                {m.fields.lagerbestand} / {m.fields.mindestbestand} {m.fields.einheit?.label ?? ''}
              </span>
              {m.fields.artikelnummer && <span className="text-muted-foreground"> · {m.fields.artikelnummer}</span>}
            </>
          ),
        }))}
        onItemClick={id => overlay.replace({ type: 'material', id })}
        empty={{ text: 'Alle Materialien ausreichend bevorratet.' }}
      />
    </>
  );

  const kanbanBoard = (
    <KanbanWidget
      columns={AUFTRAG_COLUMNS}
      cards={kanbanCards}
      defaultCollapsed={['storniert']}
      onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
      onCardMove={handleCardMove}
      onAddCard={column => setDialog({ kind: 'auftrag-create', defaults: { status: column } })}
    />
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
        <button
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={() => setDialog({ kind: 'auftrag-create' })}
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroBanner}
        kpis={kpisStrip}
        aside={asideLists}
        primary={kanbanBoard}
      />

      {/* ── Overlay stack ──────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            const nextStatus = lookupKey(rec.fields.status) === 'offen' ? 'In Bearbeitung nehmen'
              : lookupKey(rec.fields.status) === 'in_bearbeitung' ? 'Als abgeschlossen markieren'
              : null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? '(kein Titel)'}
                  subtitle={enrichedAuftraege.find(a => a.record_id === rec.record_id)?.kundeName}
                  badges={
                    rec.fields.status ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                        {rec.fields.status.label}
                      </span>
                    ) : undefined
                  }
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={ap => overlay.push({ type: 'auftragsposition', id: ap.record_id })}
                  onAddAuftragspositionen={() => setDialog({
                    kind: 'auftragsposition-create',
                    defaults: { auftrag: rec.record_id },
                  })}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={pp => overlay.push({ type: 'pruefprotokoll', id: pp.record_id })}
                  onAddPruefprotokoll={() => setDialog({
                    kind: 'pruefprotokoll-create',
                    defaults: { auftrag_pruef: rec.record_id },
                  })}
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const rec = auftragspositionen.find(ap => ap.record_id === top.id);
            if (!rec) return null;
            const auftragRec = auftraege.find(a => a.record_id === extractRecordId(rec.fields.auftrag));
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung ?? '(Position)'}
                  subtitle={auftragRec?.fields.auftragsnummer}
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const rec = pruefprotokoll.find(pp => pp.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={`Prüfprotokoll: ${rec.fields.monteur_name_vorname ?? ''} ${rec.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={formatDate(rec.fields.pruefungsdatum)}
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
                  title={[rec.fields.vorname, rec.fields.nachname].filter(Boolean).join(' ') || '(Kunde)'}
                  subtitle={rec.fields.firma}
                />
                <KundenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => setDialog({ kind: 'auftrag-create', defaults: { kunde: rec.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const rec = material.find(m => m.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.bezeichnung ?? '(Material)'}
                  subtitle={rec.fields.artikelnummer}
                />
                <MaterialDetails
                  record={rec}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={ap => overlay.push({ type: 'auftragsposition', id: ap.record_id })}
                  onAddAuftragspositionen={() => setDialog({ kind: 'auftragsposition-create', defaults: { material: rec.record_id } })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            const current = lookupKey(rec.fields.status);
            if (current === 'abgeschlossen' || current === 'storniert') return null;
            const label = current === 'offen' ? 'In Bearbeitung nehmen' : 'Als abgeschlossen markieren';
            return {
              label,
              onClick: () => {
                const enriched = enrichedAuftraege.find(a => a.record_id === rec.record_id);
                if (enriched) advanceStatus(enriched);
              },
            };
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return;
            setDialog({ kind: 'auftrag-edit', id: rec.record_id, defaults: rec.fields as AuftraegeDialogDefaults });
          }
          if (top.type === 'auftragsposition') {
            const rec = auftragspositionen.find(ap => ap.record_id === top.id);
            if (!rec) return;
            setDialog({ kind: 'auftragsposition-edit', id: rec.record_id, defaults: rec.fields as AuftragspositionenDialogDefaults });
          }
          if (top.type === 'pruefprotokoll') {
            const rec = pruefprotokoll.find(pp => pp.record_id === top.id);
            if (!rec) return;
            setDialog({ kind: 'pruefprotokoll-edit', id: rec.record_id, defaults: rec.fields as PruefprotokollDialogDefaults });
          }
        }}
      />

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      {(dialog?.kind === 'auftrag-create' || dialog?.kind === 'auftrag-edit') && (
        <AuftraegeDialog
          open
          onClose={() => setDialog(null)}
          onSubmit={async fields => {
            if (dialog.kind === 'auftrag-edit') {
              await LivingAppsService.updateAuftraegeEntry(dialog.id, fields);
            } else {
              await LivingAppsService.createAuftraegeEntry(fields);
            }
            fetchAll();
          }}
          defaultValues={dialog.kind === 'auftrag-edit' || dialog.kind === 'auftrag-create' ? dialog.defaults : undefined}
          recordId={dialog.kind === 'auftrag-edit' ? dialog.id : undefined}
          kundenList={kunden}
          enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
        />
      )}
      {(dialog?.kind === 'auftragsposition-create' || dialog?.kind === 'auftragsposition-edit') && (
        <AuftragspositionenDialog
          open
          onClose={() => setDialog(null)}
          onSubmit={async fields => {
            if (dialog.kind === 'auftragsposition-edit') {
              await LivingAppsService.updateAuftragspositionenEntry(dialog.id, fields);
            } else {
              await LivingAppsService.createAuftragspositionenEntry(fields);
            }
            fetchAll();
          }}
          defaultValues={dialog.defaults}
          recordId={dialog.kind === 'auftragsposition-edit' ? dialog.id : undefined}
          auftraegeList={auftraege}
          materialList={material}
          enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
        />
      )}
      {(dialog?.kind === 'pruefprotokoll-create' || dialog?.kind === 'pruefprotokoll-edit') && (
        <PruefprotokollDialog
          open
          onClose={() => setDialog(null)}
          onSubmit={async fields => {
            if (dialog.kind === 'pruefprotokoll-edit') {
              await LivingAppsService.updatePruefprotokollEntry(dialog.id, fields);
            } else {
              await LivingAppsService.createPruefprotokollEntry(fields);
            }
            fetchAll();
          }}
          defaultValues={dialog.defaults}
          recordId={dialog.kind === 'pruefprotokoll-edit' ? dialog.id : undefined}
          auftraegeList={auftraege}
          enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
        />
      )}
      {dialog?.kind === 'kunde-create' && (
        <KundenDialog
          open
          onClose={() => setDialog(null)}
          onSubmit={async fields => {
            await LivingAppsService.createKundenEntry(fields);
            fetchAll();
          }}
          enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
        />
      )}
      {dialog?.kind === 'material-create' && (
        <MaterialDialog
          open
          onClose={() => setDialog(null)}
          onSubmit={async fields => {
            await LivingAppsService.createMaterialEntry(fields);
            fetchAll();
          }}
          enablePhotoScan={AI_PHOTO_SCAN['Material']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Material']}
        />
      )}
    </>
  );
}
