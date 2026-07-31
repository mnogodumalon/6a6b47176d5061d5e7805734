import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupKey } from '@/lib/formatters';
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
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconClipboardList, IconAlertTriangle, IconPlus, IconCheck } from '@tabler/icons-react';

// ─── Overlay item union ────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string };

// ─── Kanban columns from schema ───────────────────────────────────────────
const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → needs attention
}

// ─── Status-Advance helper ─────────────────────────────────────────────────
const STATUS_ORDER = ['offen', 'in_bearbeitung', 'abgeschlossen'];
function nextStatus(current: string | undefined): string | null {
  const idx = STATUS_ORDER.indexOf(current ?? '');
  return idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
}
function nextStatusLabel(current: string | undefined): string | null {
  const next = nextStatus(current);
  if (!next) return null;
  return COLUMNS.find(c => c.key === next)?.label ?? null;
}

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    setAuftraege, kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftragId, setEditingAuftragId] = useState<string | undefined>(undefined);

  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [posDefaults, setPosDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosId, setEditingPosId] = useState<string | undefined>(undefined);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruefId, setEditingPruefId] = useState<string | undefined>(undefined);

  // ─── All hooks ABOVE early returns ────────────────────────────────────────
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
  const offene = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'), [enrichedAuftraege]);
  const inBearbeitung = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'), [enrichedAuftraege]);
  const dringende = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'), [enrichedAuftraege]);

  // Material mit niedrigem Bestand
  const materialKnapp = useMemo(() =>
    material.filter(m => {
      const bestand = m.fields.lagerbestand ?? 0;
      const mindest = m.fields.mindestbestand ?? 0;
      return mindest > 0 && bestand <= mindest;
    }),
    [material]
  );

  // Kanban cards
  const cards = useMemo<KanbanCard[]>(
    () => enrichedAuftraege.map(a => {
      const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? 'Ohne Nummer',
        subtitle: a.kundeName ? a.kundeName : undefined,
        tone: toneForStatus(status),
      };
    }),
    [enrichedAuftraege]
  );

  // Advance status — shared helper used by banner, worklist, overlay
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const currentStatus = lookupKey(auftrag.fields.status);
    const next = nextStatus(currentStatus);
    if (!next) return;
    const nextLbl = nextStatusLabel(currentStatus) ?? next;
    const prevStatus = auftrag.fields.status;

    // Optimistic update
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLbl } } }
        : a
    ));

    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
      undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${nextLbl}`, async () => {
        setAuftraege(prev => prev.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: prevStatus } }
            : a
        ));
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevStatus ? (typeof prevStatus === 'object' ? prevStatus.key : prevStatus) : 'offen' });
      });
    } catch {
      await fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // Move card on drag
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const prevStatus = auftrag.fields.status;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;

    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
      undoToast(`Auftrag → ${newLabel}`, async () => {
        setAuftraege(prev => prev.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: prevStatus } }
            : a
        ));
        const prevKey = prevStatus && typeof prevStatus === 'object' ? prevStatus.key : (prevStatus ?? 'offen');
        await LivingAppsService.updateAuftraegeEntry(rid, { status: prevKey });
      });
    } catch {
      await fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Plain derivations below ───────────────────────────────────────────

  // Context line
  const dringendeNames = dringende.map(a => a.kundeName || a.fields.auftragsnummer || 'Auftrag');
  const contextLine = dringende.length > 0
    ? `${namen(dringendeNames)} ${dringende.length === 1 ? 'hat einen dringenden Auftrag' : 'haben dringende Aufträge'}.`
    : offene.length > 0
    ? `${offene.length} offene ${offene.length === 1 ? 'Auftrag' : 'Aufträge'} warten auf Bearbeitung.`
    : 'Alle Aufträge sind auf dem neuesten Stand.';

  // Overlay helpers
  const currentTop = overlay.top;

  const openAuftragDetail = (id: string) => overlay.push({ type: 'auftrag', id });
  const openPosDetail = (id: string) => overlay.push({ type: 'auftragsposition', id });
  const openPruefDetail = (id: string) => overlay.push({ type: 'pruefprotokoll', id });
  const openKundeDetail = (id: string) => overlay.push({ type: 'kunde', id });

  // WorkList: offene + dringende Aufträge
  const workItems = [...dringende, ...offene.filter(a => !dringende.includes(a))]
    .slice(0, 8)
    .map(a => ({
      id: a.record_id,
      title: `${a.fields.auftragsnummer ?? '—'} · ${a.kundeName || '—'}`,
      secondLine: (
        <span>
          <span className={`font-medium ${lookupKey(a.fields.prioritaet) === 'dringend' ? 'text-destructive' : 'text-amber-600'}`}>
            {a.fields.status?.label ?? 'Offen'}
          </span>
          {a.fields.wunschtermin && (
            <span className="text-muted-foreground"> · {formatDate(a.fields.wunschtermin)}</span>
          )}
        </span>
      ),
      action: nextStatus(lookupKey(a.fields.status))
        ? {
            label: `→ ${nextStatusLabel(lookupKey(a.fields.status))}`,
            onClick: () => advanceStatus(a),
          }
        : undefined,
    }));

  // WorkList: Material knapp
  const materialItems = materialKnapp.slice(0, 5).map(m => ({
    id: m.record_id,
    title: m.fields.bezeichnung ?? '—',
    secondLine: (
      <span>
        <span className="font-medium text-destructive">Knapp</span>
        <span className="text-muted-foreground"> · {m.fields.lagerbestand ?? 0} / mind. {m.fields.mindestbestand ?? 0} {m.fields.einheit?.label ?? ''}</span>
      </span>
    ),
  }));

  // Hero: dringende offene Aufträge
  const heroDringende = dringende.filter(a => lookupKey(a.fields.status) !== 'abgeschlossen');

  return (
    <>
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground truncate">
              {gruss(clock)} Handwerk Pro
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{contextLine}</p>
          </div>
          <button
            onClick={() => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 shrink-0"
          >
            <IconPlus size={16} className="shrink-0" />
            Neuer Auftrag
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={heroDringende.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: `→ In Bearbeitung`,
              onClick: () => advanceStatus(heroDringende[0]),
            }}
          >
            <b>{namen(heroDringende.map(a => a.kundeName || a.fields.auftragsnummer || 'Auftrag'))}</b>
            {heroDringende.length === 1 ? ' hat einen dringenden Auftrag' : ' haben dringende Aufträge'} — bitte sofort bearbeiten.
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              icon={<IconClipboardList size={16} />}
              tone={offene.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              icon={<IconClipboardList size={16} />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringende.length}
              icon={<IconAlertTriangle size={16} />}
              tone={dringende.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Material knapp"
              value={materialKnapp.length}
              icon={<IconAlertTriangle size={16} />}
              tone={materialKnapp.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1] ?? '';
              overlay.replace({ type: 'auftrag', id });
            }}
            onCardMove={moveCard}
            onAddCard={column => {
              setAuftraegeDefaults({ status: column });
              setEditingAuftragId(undefined);
              setAuftraegeDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Offen & dringend"
              items={workItems}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alle Aufträge erledigt — super!',
                action: {
                  label: 'Neuer Auftrag',
                  onClick: () => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); },
                },
              }}
            />
            <WorkList
              title="Material knapp"
              items={materialItems}
              onItemClick={() => {}}
              empty={{ text: 'Alle Materialien ausreichend verfügbar.' }}
            />
          </>
        }
      />

      {/* ─── Overlays ────────────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            const currentStatusKey = lookupKey(rec.fields.status);
            const next = nextStatus(currentStatusKey);
            const nextLbl = nextStatusLabel(currentStatusKey);
            const enriched = enrichedAuftraege.find(a => a.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={enriched?.kundeName}
                  badges={rec.fields.status ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {rec.fields.status.label}
                    </span>
                  ) : undefined}
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => openKundeDetail(k.record_id)}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => openPosDetail(p.record_id)}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ auftrag: top.id });
                    setEditingPosId(undefined);
                    setPosDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => openPruefDetail(p.record_id)}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: top.id });
                    setEditingPruefId(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const rec = auftragspositionen.find(p => p.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung ?? 'Auftragsposition'}
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => openAuftragDetail(a.record_id)}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'auftragsposition', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const rec = pruefprotokoll.find(p => p.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={`${rec.fields.monteur_name_vorname ?? ''} ${rec.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={rec.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => openAuftragDetail(a.record_id)}
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
                  onOpenAuftraege={a => openAuftragDetail(a.record_id)}
                  onAddAuftraege={() => {
                    setAuftraegeDefaults({ kunde: top.id });
                    setEditingAuftragId(undefined);
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
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return undefined;
            const enrichedA = enrichedAuftraege.find(a => a.record_id === top.id);
            const currentStatusKey = lookupKey(rec.fields.status);
            const next = nextStatus(currentStatusKey);
            const nextLbl = nextStatusLabel(currentStatusKey);
            if (!next || !nextLbl) return undefined;
            return {
              label: `→ ${nextLbl}`,
              onClick: () => enrichedA && advanceStatus(enrichedA),
            };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return;
            setAuftraegeDefaults(rec.fields as AuftraegeDialogDefaults);
            setEditingAuftragId(rec.record_id);
            setAuftraegeDialogOpen(true);
          }
        }}
      />

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => setAuftraegeDialogOpen(false)}
        onSubmit={async fields => {
          if (editingAuftragId) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftragId, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={auftraegeDefaults}
        recordId={editingAuftragId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={posDialogOpen}
        onClose={() => setPosDialogOpen(false)}
        onSubmit={async fields => {
          if (editingPosId) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosId, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={posDefaults}
        recordId={editingPosId}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => setPruefDialogOpen(false)}
        onSubmit={async fields => {
          if (editingPruefId) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruefId, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={pruefDefaults}
        recordId={editingPruefId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />
    </>
  );
}
