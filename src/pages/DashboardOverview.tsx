import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { lookupKey, formatDate, formatDateTime } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
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
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconUsers,
  IconChecklist,
  IconPackage,
} from '@tabler/icons-react';

// ── Kanban column setup ──────────────────────────────────────────────────────
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

function toneForPriority(prio: string | undefined): KanbanTone {
  if (prio === 'dringend') return 'destructive';
  if (prio === 'hoch') return 'warning';
  return 'default';
}

// ── Overlay item union ───────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string };

export default function DashboardOverview() {
  const {
    kunden, setKunden,
    material,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | null>(null);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | null>(null);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | null>(null);

  const [kundeDialogOpen, setKundeDialogOpen] = useState(false);
  const [editingKunde, setEditingKunde] = useState<Kunden | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Enriched data
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

  // Derived data
  const today = format(clock, 'yyyy-MM-dd');

  const dringendAuftraege = useMemo(
    () => enrichedAuftraege.filter(a =>
      (lookupKey(a.fields.prioritaet) === 'dringend' || lookupKey(a.fields.prioritaet) === 'hoch') &&
      lookupKey(a.fields.status) !== 'abgeschlossen' &&
      lookupKey(a.fields.status) !== 'storniert'
    ),
    [enrichedAuftraege]
  );

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );

  const inBearbeitungAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );

  const faelligeAuftraege = useMemo(
    () => enrichedAuftraege
      .filter(a => {
        const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
        if (!termin) return false;
        const status = lookupKey(a.fields.status);
        return termin <= today && status !== 'abgeschlossen' && status !== 'storniert';
      })
      .sort((a, b) => {
        const ta = a.fields.liefertermin ?? a.fields.wunschtermin ?? '';
        const tb = b.fields.liefertermin ?? b.fields.wunschtermin ?? '';
        return ta.localeCompare(tb);
      }),
    [enrichedAuftraege, today]
  );

  const niedrigbestandMaterial = useMemo(
    () => material.filter(m =>
      m.fields.mindestbestand != null &&
      m.fields.lagerbestand != null &&
      m.fields.lagerbestand <= m.fields.mindestbestand
    ),
    [material]
  );

  // Kanban cards
  const kanbanCards = useMemo<KanbanCard[]>(() => {
    const source = statusFilter
      ? enrichedAuftraege.filter(a => lookupKey(a.fields.status) === statusFilter)
      : enrichedAuftraege;
    return source.map(a => {
      const status = lookupKey(a.fields.status) ?? 'offen';
      const prio = lookupKey(a.fields.prioritaet);
      const cardTone = (prio === 'dringend' || prio === 'hoch')
        ? toneForPriority(prio)
        : toneForStatus(status);
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? 'Ohne Nr.',
        subtitle: a.kundeName
          ? `${a.kundeName}${a.fields.monteur ? ` · ${a.fields.monteur}` : ''}`
          : a.fields.monteur ?? undefined,
        tone: cardTone,
      };
    });
  }, [enrichedAuftraege, statusFilter]);

  // Advance status helper
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const current = lookupKey(auftrag.fields.status) ?? 'offen';
    const next = current === 'offen' ? 'in_bearbeitung'
      : current === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;
    const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
    const snapshot = auftrag.fields.status;
    const newStatus = { key: next, label: nextLabel };
    setAuftraege(prev =>
      prev.map(a => a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: newStatus } }
        : a
      )
    );
    undoToast(`Auftrag ${auftrag.fields.auftragsnummer ?? ''} → ${nextLabel}`, async () => {
      setAuftraege(prev =>
        prev.map(a => a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: snapshot } }
          : a
        )
      );
      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: current });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
    } catch { await fetchAll(); }
  }, [setAuftraege, fetchAll]);

  // Card move handler
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const oldKey = lookupKey(auftrag.fields.status) ?? 'offen';
    if (oldKey === newColumn) return;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const snapshot = auftrag.fields.status;
    setAuftraege(prev =>
      prev.map(a => a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
      )
    );
    undoToast(`Status → ${newLabel}`, async () => {
      setAuftraege(prev =>
        prev.map(a => a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: snapshot } }
          : a
        )
      );
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: oldKey });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
    } catch { await fetchAll(); }
  }, [auftraege, setAuftraege, fetchAll]);

  // Context line
  const naechsterAuftrag = enrichedAuftraege
    .filter(a => {
      const status = lookupKey(a.fields.status);
      return status === 'offen' || status === 'in_bearbeitung';
    })
    .sort((a, b) => {
      const ta = a.fields.liefertermin ?? a.fields.wunschtermin ?? a.fields.auftragsdatum ?? '';
      const tb = b.fields.liefertermin ?? b.fields.wunschtermin ?? b.fields.auftragsdatum ?? '';
      return ta.localeCompare(tb);
    })[0];

  // ── Every hook goes ABOVE this line ──────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only ──────────────────────────────

  const kontextlinie = naechsterAuftrag
    ? `Nächster Auftrag: ${naechsterAuftrag.kundeName || naechsterAuftrag.fields.auftragsnummer || 'unbekannt'} — ${naechsterAuftrag.fields.monteur ? `Monteur: ${naechsterAuftrag.fields.monteur}` : 'Kein Monteur zugewiesen'}.`
    : auftraege.length === 0
    ? 'Noch keine Aufträge — lege den ersten an.'
    : 'Alle aktiven Aufträge sind im Griff.';

  // Resolve overlay records
  function resolveOverlay(item: OverlayItem) {
    if (item.type === 'auftrag') return auftraege.find(a => a.record_id === item.id);
    if (item.type === 'position') return auftragspositionen.find(p => p.record_id === item.id);
    if (item.type === 'pruef') return pruefprotokoll.find(p => p.record_id === item.id);
    if (item.type === 'kunde') return kunden.find(k => k.record_id === item.id);
    return undefined;
  }

  const topRecord = overlay.top ? resolveOverlay(overlay.top) : undefined;
  const topAuftrag = overlay.top?.type === 'auftrag' ? (topRecord as Auftraege | undefined) : undefined;

  return (
    <>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {gruss(clock)} Handwerk Pro
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{kontextlinie}</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => { setEditingAuftrag(null); setAuftragDefaults(undefined); setAuftragDialogOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <IconPlus size={16} className="shrink-0" />
            Neuer Auftrag
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={dringendAuftraege.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: 'In Bearbeitung setzen',
              onClick: () => void advanceStatus(dringendAuftraege[0]),
            }}
          >
            <b>{namen(dringendAuftraege.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
            {' '}— {dringendAuftraege.length === 1 ? 'dringender Auftrag' : `${dringendAuftraege.length} dringende/hohe Aufträge`} warten auf Bearbeitung.
          </HeroBanner>
        ) : undefined}
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
              icon={<IconChecklist size={16} className="shrink-0" />}
              tone={inBearbeitungAuftraege.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Kunden"
              value={kunden.length}
              icon={<IconUsers size={16} className="shrink-0" />}
              tone="default"
            />
            <StatStripItem
              title="Material mit Engpass"
              value={niedrigbestandMaterial.length}
              icon={<IconPackage size={16} className="shrink-0" />}
              tone={niedrigbestandMaterial.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={kanbanCards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
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
              title="Fällig & dringend"
              items={faelligeAuftraege.slice(0, 8).map(a => {
                const prio = lookupKey(a.fields.prioritaet);
                const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
                return {
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? 'Ohne Nr.',
                  secondLine: (
                    <>
                      <span className={`font-medium ${prio === 'dringend' ? 'text-destructive' : prio === 'hoch' ? 'text-orange-600' : 'text-muted-foreground'}`}>
                        {a.fields.prioritaet?.label ?? 'Normal'}
                      </span>
                      {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
                      {termin && <span className="text-muted-foreground"> · {formatDateTime(termin)}</span>}
                    </>
                  ),
                  action: {
                    label: lookupKey(a.fields.status) === 'offen' ? '▶ Starten' : '✓ Abschließen',
                    onClick: () => void advanceStatus(a),
                  },
                };
              })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: naechsterAuftrag
                  ? `Nächster Auftrag: ${naechsterAuftrag.kundeName || naechsterAuftrag.fields.auftragsnummer || '—'}`
                  : 'Alle Termine im Zeitplan — super!',
                action: { label: 'Neuer Auftrag', onClick: () => { setEditingAuftrag(null); setAuftragDefaults(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Materialengpässe"
              items={niedrigbestandMaterial.slice(0, 6).map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? 'Unbekannt',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      Bestand: {m.fields.lagerbestand ?? 0} {m.fields.einheit?.label ?? ''}
                    </span>
                    <span className="text-muted-foreground"> · Mindest: {m.fields.mindestbestand ?? 0}</span>
                  </>
                ),
              }))}
              onItemClick={_id => {}}
              empty={{
                text: 'Alle Materialien ausreichend bevorratet',
                action: undefined,
              }}
            />
          </>
        }
      />

      {/* Overlays — one RecordOverlayHost for the whole stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (!top) return null;

          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={rec.fields.prioritaet ? (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      lookupKey(rec.fields.prioritaet) === 'dringend' ? 'bg-destructive/10 text-destructive' :
                      lookupKey(rec.fields.prioritaet) === 'hoch' ? 'bg-orange-100 text-orange-700' :
                      'bg-muted text-muted-foreground'
                    }`}>{rec.fields.prioritaet.label}</span>
                  ) : undefined}
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: rec.record_id });
                    setEditingPosition(null);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: rec.record_id });
                    setEditingPruef(null);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }

          if (top.type === 'position') {
            const rec = auftragspositionen.find(p => p.record_id === top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={rec.fields.einheit_position?.label}
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={_m => {}}
                />
              </>
            );
          }

          if (top.type === 'pruef') {
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
                  onAddAuftraege={() => {
                    setAuftragDefaults({ kunde: rec.record_id });
                    setEditingAuftrag(null);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }

          return null;
        }}
        footer={top => {
          if (!top || top.type !== 'auftrag') return undefined;
          const rec = auftraege.find(a => a.record_id === top.id);
          if (!rec) return undefined;
          const status = lookupKey(rec.fields.status);
          if (status === 'offen') return { label: '▶ In Bearbeitung setzen', onClick: () => void advanceStatus(rec as EnrichedAuftraege) };
          if (status === 'in_bearbeitung') return { label: '✓ Abschließen', onClick: () => void advanceStatus(rec as EnrichedAuftraege) };
          return undefined;
        }}
        onEdit={top => {
          if (!top) return;
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (rec) { setEditingAuftrag(rec); setAuftragDefaults(undefined); setAuftragDialogOpen(true); }
          } else if (top.type === 'position') {
            const rec = auftragspositionen.find(p => p.record_id === top.id);
            if (rec) { setEditingPosition(rec); setPositionDefaults(undefined); setPositionDialogOpen(true); }
          } else if (top.type === 'pruef') {
            const rec = pruefprotokoll.find(p => p.record_id === top.id);
            if (rec) { setEditingPruef(rec); setPruefDefaults(undefined); setPruefDialogOpen(true); }
          } else if (top.type === 'kunde') {
            const rec = kunden.find(k => k.record_id === top.id);
            if (rec) { setEditingKunde(rec); setKundeDialogOpen(true); }
          }
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(null); setAuftragDefaults(undefined); }}
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
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(null); setPositionDefaults(undefined); }}
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
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(null); setPruefDefaults(undefined); }}
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
        open={kundeDialogOpen}
        onClose={() => { setKundeDialogOpen(false); setEditingKunde(null); }}
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
