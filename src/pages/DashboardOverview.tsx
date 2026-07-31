import { useState, useMemo, useCallback } from 'react';
import { format, parseISO, isAfter, isBefore, addDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { lookupKey, formatDate } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
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
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconAlertTriangle, IconClipboardList, IconHammer, IconCheckbox, IconBoxSeam } from '@tabler/icons-react';

// ─── Types für Overlay-Stack ────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

// ─── Kanban-Columns aus dem Schema ─────────────────────────────────────────
const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen
}

function toneForPrioritaet(prio: string | undefined): KanbanTone {
  if (prio === 'dringend') return 'destructive';
  if (prio === 'hoch') return 'warning';
  return 'default';
}

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    setAuftraege,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  const enrichedAuftraege = enrichAuftraege(auftraege, { kundenMap });
  const enrichedAuftragspositionen = enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap });
  const enrichedPruefprotokoll = enrichPruefprotokoll(pruefprotokoll, { auftraegeMap });

  // ─── Dialog-State ───────────────────────────────────────────────────────
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDialogDefaults, setAuftragDialogDefaults] = useState<Record<string, string> | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<Auftraege | null>(null);

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDialogDefaults, setPositionDialogDefaults] = useState<Record<string, string> | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | null>(null);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDialogDefaults, setPruefDialogDefaults] = useState<Record<string, string> | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | null>(null);

  const [kundeDialogOpen, setKundeDialogOpen] = useState(false);
  const [editingKunde, setEditingKunde] = useState<Kunden | null>(null);

  // ─── Overlay-Stack ──────────────────────────────────────────────────────
  const overlay = useRecordOverlayStack<OverlayItem>();

  // ─── Ableitungen ────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');
  const nextWeek = format(addDays(clock, 7), 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );
  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege],
  );
  const dringendeAuftraege = useMemo(
    () => enrichedAuftraege.filter(
      a => ['dringend', 'hoch'].includes(lookupKey(a.fields.prioritaet) ?? '')
        && ['offen', 'in_bearbeitung'].includes(lookupKey(a.fields.status) ?? ''),
    ),
    [enrichedAuftraege],
  );

  // Materialengpass: Lagerbestand unter Mindestbestand
  const materialEngpass = useMemo(
    () => material.filter(m =>
      m.fields.lagerbestand != null &&
      m.fields.mindestbestand != null &&
      m.fields.lagerbestand < m.fields.mindestbestand,
    ),
    [material],
  );

  // Heute fällige oder überfällige Aufträge (Wunschtermin)
  const faelligeHeute = useMemo(
    () => enrichedAuftraege
      .filter(a => {
        if (!a.fields.wunschtermin) return false;
        const d = a.fields.wunschtermin.slice(0, 10);
        return d <= today && !['abgeschlossen', 'storniert'].includes(lookupKey(a.fields.status) ?? '');
      })
      .sort((a, b) => (a.fields.wunschtermin ?? '').localeCompare(b.fields.wunschtermin ?? '')),
    [enrichedAuftraege, today],
  );

  // Prüfprotokolle: noch nicht bestanden
  const offenePruefungen = useMemo(
    () => enrichedPruefprotokoll.filter(p =>
      lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden' ||
      lookupKey(p.fields.pruefergebnis) === 'bestanden_mit_maengeln',
    ),
    [enrichedPruefprotokoll],
  );

  // ─── Kanban-Cards ────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege
        .sort((a, b) => (b.fields.auftragsdatum ?? '').localeCompare(a.fields.auftragsdatum ?? ''))
        .map(a => {
          const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
          const prio = lookupKey(a.fields.prioritaet);
          const isPrio = prio === 'dringend' || prio === 'hoch';
          return {
            id: `auftrag:${a.record_id}`,
            column: status,
            title: a.fields.auftragsnummer ?? 'Auftrag',
            subtitle: a.kundeName
              ? `${a.kundeName}${isPrio ? ` · ${a.fields.prioritaet?.label}` : ''}`
              : isPrio ? a.fields.prioritaet?.label : undefined,
            tone: isPrio && status !== 'abgeschlossen' && status !== 'storniert'
              ? toneForPrioritaet(prio)
              : toneForStatus(status),
          };
        }),
    [enrichedAuftraege],
  );

  // ─── Status-Advance ──────────────────────────────────────────────────────
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const currentStatus = lookupKey(auftrag.fields.status);
    const nextStatus =
      currentStatus === 'offen' ? 'in_bearbeitung' :
      currentStatus === 'in_bearbeitung' ? 'abgeschlossen' : null;
    if (!nextStatus) return;

    const label = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextStatus)?.label ?? nextStatus;
    const snapshot = { status: auftrag.fields.status };
    const id = auftrag.record_id;

    // Optimistisch
    setAuftraege(prev => prev.map(a =>
      a.record_id === id
        ? { ...a, fields: { ...a.fields, status: { key: nextStatus, label } } }
        : a,
    ));

    try {
      await LivingAppsService.updateAuftraegeEntry(id, { status: nextStatus });
      undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${label}`, async () => {
        setAuftraege(prev => prev.map(a =>
          a.record_id === id ? { ...a, fields: { ...a.fields, status: snapshot.status } } : a,
        ));
        await LivingAppsService.updateAuftraegeEntry(id, { status: (snapshot.status as any)?.key ?? snapshot.status });
      });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── Kanban onCardMove ────────────────────────────────────────────────────
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;

    const label = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const auftrag = auftraege.find(a => a.record_id === rid);
    const snapshot = { status: auftrag?.fields.status };

    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label } } }
        : a,
    ));

    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
      undoToast(`Status → ${label}`, async () => {
        setAuftraege(prev => prev.map(a =>
          a.record_id === rid ? { ...a, fields: { ...a.fields, status: snapshot.status } } : a,
        ));
        await LivingAppsService.updateAuftraegeEntry(rid, { status: (snapshot.status as any)?.key ?? snapshot.status });
      });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── Context-Line ─────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (enrichedAuftraege.length === 0) return 'Noch keine Aufträge erfasst.';
    const parts: string[] = [];
    if (offeneAuftraege.length > 0) {
      const names = namen(offeneAuftraege.slice(0, 3).map(a => a.kundeName || a.fields.auftragsnummer || ''));
      parts.push(`${offeneAuftraege.length} offene Aufträge (${names})`);
    }
    if (faelligeHeute.length > 0) {
      parts.push(`${faelligeHeute.length} heute fällig`);
    }
    if (materialEngpass.length > 0) {
      parts.push(`${materialEngpass.length} Material unter Mindestbestand`);
    }
    return parts.length > 0 ? parts.join(' · ') + '.' : 'Alle Aufträge im Zeitplan.';
  }, [enrichedAuftraege, offeneAuftraege, faelligeHeute, materialEngpass]);

  // ─── Early returns NACH allen Hooks ────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Overlay-Hilfsfunktionen (nur nach Hooks/Early-Returns) ────────────────
  const getAuftrag = (id: string) => auftraege.find(a => a.record_id === id);
  const getEnrichedAuftrag = (id: string) => enrichedAuftraege.find(a => a.record_id === id);
  const getPosition = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const getPruef = (id: string) => pruefprotokoll.find(p => p.record_id === id);
  const getKunde = (id: string) => kunden.find(k => k.record_id === id);
  const getMaterial = (id: string) => material.find(m => m.record_id === id);

  // ─── Hero: Dringende Aufträge ─────────────────────────────────────────────
  const heroDringend = dringendeAuftraege.length > 0 ? dringendeAuftraege[0] : null;

  return (
    <>
      {/* ─── Page-Header (oberhalb DashboardGrid) ─── */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {gruss(clock)} Handwerk Pro
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroDringend
            ? (
              <HeroBanner
                icon={<IconAlertTriangle size={18} />}
                action={{
                  label: heroDringend.fields.status?.key === 'offen' ? 'In Bearbeitung setzen' : 'Abschließen',
                  onClick: () => advanceStatus(heroDringend),
                }}
              >
                <b>{heroDringend.fields.auftragsnummer ?? 'Auftrag'}</b>
                {heroDringend.kundeName ? ` (${heroDringend.kundeName})` : ''}{' '}
                mit Priorität <b>{heroDringend.fields.prioritaet?.label ?? 'Hoch'}</b> wartet auf Bearbeitung.
              </HeroBanner>
            )
            : undefined
        }
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
              icon={<IconHammer size={16} className="shrink-0" />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend / Hoch"
              value={dringendeAuftraege.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={dringendeAuftraege.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Materialengpass"
              value={materialEngpass.length}
              icon={<IconBoxSeam size={16} className="shrink-0" />}
              tone={materialEngpass.length > 0 ? 'warning' : 'default'}
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
              setAuftragDialogDefaults({ status: column });
              setEditingAuftrag(null);
              setAuftragDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Heute fällig & überfällig"
              items={faelligeHeute.map(a => {
                const isUeberfaellig = (a.fields.wunschtermin ?? '') < today;
                return {
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? 'Auftrag',
                  secondLine: (
                    <>
                      <span className={isUeberfaellig ? 'font-medium text-destructive' : 'font-medium text-warning'}>
                        {isUeberfaellig ? 'Überfällig' : 'Fällig heute'}
                      </span>
                      {a.kundeName && (
                        <span className="text-muted-foreground"> · {a.kundeName}</span>
                      )}
                    </>
                  ),
                  action: {
                    label: lookupKey(a.fields.status) === 'offen' ? '▶ Starten' : '✓ Abschließen',
                    onClick: () => advanceStatus(a),
                  },
                };
              })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alles im Zeitplan — kein Auftrag heute fällig.',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftragDialogDefaults(undefined); setEditingAuftrag(null); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Prüfprotokolle mit Mängeln"
              items={offenePruefungen.slice(0, 8).map(p => ({
                id: p.record_id,
                title: `${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Monteur',
                secondLine: (
                  <>
                    <span className={lookupKey(p.fields.pruefergebnis) === 'nicht_bestanden' ? 'font-medium text-destructive' : 'font-medium text-warning'}>
                      {p.fields.pruefergebnis?.label ?? 'Offen'}
                    </span>
                    <span className="text-muted-foreground"> · {p.auftrag_pruefName || 'Kein Auftrag'}</span>
                  </>
                ),
                action: {
                  label: '→ Auftrag',
                  onClick: () => {
                    const auftragId = extractRecordId(p.fields.auftrag_pruef);
                    if (auftragId) overlay.replace({ type: 'auftrag', id: auftragId });
                  },
                },
              }))}
              onItemClick={id => overlay.replace({ type: 'pruef', id })}
              empty={{
                text: 'Alle Prüfungen bestanden.',
                action: { label: 'Neues Protokoll', onClick: () => { setPruefDialogDefaults(undefined); setEditingPruef(null); setPruefDialogOpen(true); } },
              }}
            />
          </>
        }
      />

      {/* ─── Dialoge ────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => setAuftragDialogOpen(false)}
        onSubmit={async fields => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingAuftrag ? editingAuftrag.fields : auftragDialogDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => setPositionDialogOpen(false)}
        onSubmit={async fields => {
          if (editingPosition) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosition.record_id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPosition ? editingPosition.fields : positionDialogDefaults}
        recordId={editingPosition?.record_id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => setPruefDialogOpen(false)}
        onSubmit={async fields => {
          if (editingPruef) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruef.record_id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingPruef ? editingPruef.fields : pruefDialogDefaults}
        recordId={editingPruef?.record_id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundeDialogOpen}
        onClose={() => setKundeDialogOpen(false)}
        onSubmit={async fields => {
          if (editingKunde) {
            await LivingAppsService.updateKundenEntry(editingKunde.record_id, fields);
          } else {
            await LivingAppsService.createKundenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingKunde?.fields}
        recordId={editingKunde?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      {/* ─── Overlay-Host ────────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = getAuftrag(top.id);
            if (!a) return null;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[a.fields.status?.label, a.fields.prioritaet?.label].filter(Boolean).join(' · ')}
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDialogDefaults({ auftrag: a.record_id });
                    setEditingPosition(null);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDialogDefaults({ auftrag_pruef: a.record_id });
                    setEditingPruef(null);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const p = getPosition(top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={`Menge: ${p.fields.menge ?? '—'} ${p.fields.einheit_position?.label ?? ''}`}
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const p = getPruef(top.id);
            if (!p) return null;
            const monteur = [p.fields.monteur_name_vorname, p.fields.monteur_name_nachname].filter(Boolean).join(' ');
            return (
              <>
                <RecordHeader
                  title={monteur || 'Prüfprotokoll'}
                  subtitle={p.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = getKunde(top.id);
            if (!k) return null;
            return (
              <>
                <RecordHeader
                  title={[k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={k.fields.firma}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => {
                    setAuftragDialogDefaults({ kunde: k.record_id });
                    setEditingAuftrag(null);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const m = getMaterial(top.id);
            if (!m) return null;
            return (
              <>
                <RecordHeader
                  title={m.fields.bezeichnung ?? 'Material'}
                  subtitle={m.fields.artikelnummer}
                />
                <MaterialDetails
                  record={m}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPositionDialogDefaults({ material: m.record_id });
                    setEditingPosition(null);
                    setPositionDialogOpen(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = getAuftrag(top.id);
            if (a) { setEditingAuftrag(a); setAuftragDialogOpen(true); }
          } else if (top.type === 'position') {
            const p = getPosition(top.id);
            if (p) { setEditingPosition(p); setPositionDialogOpen(true); }
          } else if (top.type === 'pruef') {
            const p = getPruef(top.id);
            if (p) { setEditingPruef(p); setPruefDialogOpen(true); }
          } else if (top.type === 'kunde') {
            const k = getKunde(top.id);
            if (k) { setEditingKunde(k); setKundeDialogOpen(true); }
          }
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = getEnrichedAuftrag(top.id);
            if (!a) return undefined;
            const status = lookupKey(a.fields.status);
            if (status === 'abgeschlossen' || status === 'storniert') return undefined;
            return {
              label: status === 'offen' ? 'In Bearbeitung setzen' : 'Abschließen',
              onClick: () => { void advanceStatus(a); overlay.close(); },
            };
          }
          return undefined;
        }}
      />
    </>
  );
}
