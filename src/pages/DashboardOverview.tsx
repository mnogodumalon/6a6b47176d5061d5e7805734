import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Auftragspositionen, Pruefprotokoll } from '@/types/app';
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
  RecordAttachments,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import { IconAlertTriangle, IconClipboardList, IconPlus } from '@tabler/icons-react';

// ─── Overlay item types ──────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'pruefprotokoll'; id: string };

// ─── Kanban columns from schema ──────────────────────────────────────────────
const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → braucht Aufmerksamkeit
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function DashboardOverview() {
  const clock = useClock();

  const {
    kunden, setKunden, material, auftraege, setAuftraege, auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  // ALL hooks BEFORE early returns
  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap],
  );
  const enrichedAuftragspositionen = useMemo(
    () => enrichAuftragspositionen(auftragspositionen, { auftraegeMap, materialMap }),
    [auftragspositionen, auftraegeMap, materialMap],
  );
  const enrichedPruefprotokoll = useMemo(
    () => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }),
    [pruefprotokoll, auftraegeMap],
  );

  // Overlay stack
  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDialogDefaults, setAuftragDialogDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [auftragDialogEditId, setAuftragDialogEditId] = useState<string | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDialogDefaults, setPositionDialogDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [positionDialogEditId, setPositionDialogEditId] = useState<string | undefined>();

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDialogDefaults, setPruefDialogDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [pruefDialogEditId, setPruefDialogEditId] = useState<string | undefined>();

  // KPI-Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Computed data
  const today = format(clock, 'yyyy-MM-dd');

  const dringendeAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege],
  );

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );

  const inBearbeitungAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege],
  );

  const ueberfaelligeAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => {
      const lt = a.fields.liefertermin;
      if (!lt) return false;
      const key = lookupKey(a.fields.status);
      if (key === 'abgeschlossen' || key === 'storniert') return false;
      return lt.slice(0, 10) < today;
    }),
    [enrichedAuftraege, today],
  );

  // Kanban cards — filtered by active KPI filter
  const visibleAuftraege = useMemo(
    () => statusFilter ? enrichedAuftraege.filter(a => lookupKey(a.fields.status) === statusFilter) : enrichedAuftraege,
    [enrichedAuftraege, statusFilter],
  );

  const cards = useMemo<KanbanCard[]>(
    () =>
      visibleAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
        const prioritaet = lookupKey(a.fields.prioritaet);
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: a.fields.auftragsnummer ?? 'Ohne Nr.',
          subtitle: a.kundeName
            ? `${a.kundeName}${a.fields.monteur ? ` · ${a.fields.monteur}` : ''}`
            : a.fields.monteur ?? undefined,
          tone: prioritaet === 'dringend' ? 'destructive' : toneForStatus(status),
        };
      }),
    [visibleAuftraege],
  );

  // Status-Advance Helper: nächster Status
  const nextStatus = useCallback((currentStatus: string | undefined): string | null => {
    const flow = ['offen', 'in_bearbeitung', 'abgeschlossen'];
    const idx = flow.indexOf(currentStatus ?? '');
    return idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
  }, []);

  const nextStatusLabel = useCallback((currentStatus: string | undefined): string | null => {
    const next = nextStatus(currentStatus);
    if (!next) return null;
    return COLUMNS.find(c => c.key === next)?.label ?? next;
  }, [nextStatus]);

  const advanceAuftrag = useCallback(async (a: EnrichedAuftraege) => {
    const currentKey = lookupKey(a.fields.status);
    const next = nextStatus(currentKey);
    if (!next) return;
    const prevStatus = a.fields.status;
    // Optimistic update
    setAuftraege(prev =>
      prev.map(r =>
        r.record_id === a.record_id
          ? { ...r, fields: { ...r.fields, status: { key: next, label: COLUMNS.find(c => c.key === next)?.label ?? next } } }
          : r,
      ),
    );
    undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${COLUMNS.find(c => c.key === next)?.label}`, async () => {
      setAuftraege(prev =>
        prev.map(r =>
          r.record_id === a.record_id
            ? { ...r, fields: { ...r.fields, status: prevStatus } }
            : r,
        ),
      );
      try {
        const undoKey = typeof prevStatus === 'object' && prevStatus !== null ? (prevStatus as { key: string }).key : (prevStatus ?? null);
        await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: undoKey ?? undefined });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next });
    } catch { await fetchAll(); }
  }, [nextStatus, setAuftraege, fetchAll]);

  // Card move via Kanban drag
  const handleCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const prevStatus = auftrag.fields.status;
    setAuftraege(prev =>
      prev.map(a =>
        a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn } } }
          : a,
      ),
    );
    undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${COLUMNS.find(c => c.key === newColumn)?.label}`, async () => {
      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: prevStatus } }
            : a,
        ),
      );
      try {
        const undoKey2 = typeof prevStatus === 'object' && prevStatus !== null ? (prevStatus as { key: string }).key : (prevStatus ?? null);
        await LivingAppsService.updateAuftraegeEntry(rid, { status: undoKey2 ?? undefined });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
    } catch { await fetchAll(); }
  }, [auftraege, setAuftraege, fetchAll]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Context line
  const dringendeNamen = namen(dringendeAuftraege.map(a => a.fields.auftragsnummer ?? ''));
  const contextLine = auftraege.length === 0
    ? 'Noch kein Auftrag erfasst — leg gleich los.'
    : dringendeAuftraege.length > 0
      ? `${dringendeNamen} ${dringendeAuftraege.length === 1 ? 'ist dringend' : 'sind dringend'} — ${offeneAuftraege.length} offen, ${inBearbeitungAuftraege.length} in Bearbeitung.`
      : `${offeneAuftraege.length} offen, ${inBearbeitungAuftraege.length} in Bearbeitung — alles im Griff.`;

  // Fällige heute / Überfällig-Liste
  const faelligeHeute = enrichedAuftraege.filter(a => {
    const lt = a.fields.liefertermin;
    const key = lookupKey(a.fields.status);
    if (!lt || key === 'abgeschlossen' || key === 'storniert') return false;
    return lt.slice(0, 10) === today;
  });

  const allFaelligOrOverdue = [...ueberfaelligeAuftraege, ...faelligeHeute.filter(a => !ueberfaelligeAuftraege.includes(a))];

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => { setAuftragDialogDefaults(undefined); setAuftragDialogEditId(undefined); setAuftragDialogOpen(true); }}
        >
          <IconPlus size={16} className="shrink-0" />
          <span>Neuer Auftrag</span>
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={ueberfaelligeAuftraege.length > 0 ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: `${ueberfaelligeAuftraege[0].fields.auftragsnummer ?? 'Auftrag'} weiterschalten`,
              onClick: () => advanceAuftrag(ueberfaelligeAuftraege[0]),
            }}
          >
            <b>{namen(ueberfaelligeAuftraege.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
            {' '}{ueberfaelligeAuftraege.length === 1 ? 'hat' : 'haben'} den Liefertermin überschritten — fällig war{' '}
            {formatDate(ueberfaelligeAuftraege[0].fields.liefertermin)}.
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offeneAuftraege.length}
              tone={offeneAuftraege.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitungAuftraege.length}
              tone={inBearbeitungAuftraege.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Überfällig"
              value={ueberfaelligeAuftraege.length}
              tone={ueberfaelligeAuftraege.length > 0 ? 'destructive' : 'default'}
              onClick={() => setStatusFilter(f => f === null && ueberfaelligeAuftraege.length > 0 ? 'offen' : null)}
            />
            <StatStripItem
              title="Dringend"
              value={dringendeAuftraege.length}
              tone={dringendeAuftraege.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Kunden"
              value={kunden.length}
              tone="default"
            />
          </StatStrip>
        }
        primary={
          auftraege.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-24 gap-4">
              <IconClipboardList size={48} className="text-muted-foreground" stroke={1.5} />
              <div className="text-center">
                <p className="font-semibold text-foreground">Noch kein Auftrag</p>
                <p className="mt-1 text-sm text-muted-foreground">Erstelle deinen ersten Auftrag, um loszulegen.</p>
              </div>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => { setAuftragDialogDefaults(undefined); setAuftragDialogEditId(undefined); setAuftragDialogOpen(true); }}
              >
                <IconPlus size={16} className="shrink-0" />
                Ersten Auftrag anlegen
              </button>
            </div>
          ) : (
            <KanbanWidget
              cards={cards}
              columns={COLUMNS}
              defaultCollapsed={['storniert']}
              onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
              onCardMove={handleCardMove}
              onAddCard={column => {
                setAuftragDialogDefaults({ status: column });
                setAuftragDialogEditId(undefined);
                setAuftragDialogOpen(true);
              }}
            />
          )
        }
        aside={
          <>
            <WorkList
              title={allFaelligOrOverdue.length > 0 ? 'Heute fällig & überfällig' : 'Fällige Aufträge'}
              items={allFaelligOrOverdue.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? 'Ohne Nr.',
                secondLine: (
                  <>
                    <span className={`font-medium ${ueberfaelligeAuftraege.includes(a) ? 'text-destructive' : 'text-warning'}`}>
                      {ueberfaelligeAuftraege.includes(a) ? 'Überfällig' : 'Heute fällig'}
                    </span>
                    {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
                  </>
                ),
                action: nextStatusLabel(lookupKey(a.fields.status))
                  ? { label: `→ ${nextStatusLabel(lookupKey(a.fields.status))}`, onClick: () => advanceAuftrag(a) }
                  : undefined,
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alles im Zeitplan — keine Fälligkeiten heute.',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftragDialogDefaults(undefined); setAuftragDialogEditId(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Zuletzt aktualisiert"
              items={[...enrichedAuftraege]
                .sort((a, b) => (b.updatedat ?? b.createdat).localeCompare(a.updatedat ?? a.createdat))
                .slice(0, 5)
                .map(a => ({
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? 'Ohne Nr.',
                  secondLine: (
                    <>
                      <span className="text-muted-foreground">{a.fields.status?.label ?? '—'}</span>
                      {a.fields.monteur && <span className="text-muted-foreground"> · {a.fields.monteur}</span>}
                    </>
                  ),
                }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{ text: 'Noch keine Aufträge vorhanden.' }}
            />
          </>
        }
      />

      {/* ─── Overlay host ─── */}
      <RecordOverlayHost
        overlay={overlay}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = auftraege.find(r => r.record_id === top.id);
            if (a) { setAuftragDialogDefaults(a.fields as AuftraegeDialogDefaults); setAuftragDialogEditId(a.record_id); setAuftragDialogOpen(true); }
          } else if (top.type === 'auftragsposition') {
            const p = auftragspositionen.find(r => r.record_id === top.id);
            if (p) { setPositionDialogDefaults(p.fields as AuftragspositionenDialogDefaults); setPositionDialogEditId(p.record_id); setPositionDialogOpen(true); }
          } else if (top.type === 'pruefprotokoll') {
            const pr = pruefprotokoll.find(r => r.record_id === top.id);
            if (pr) { setPruefDialogDefaults(pr.fields as PruefprotokollDialogDefaults); setPruefDialogEditId(pr.record_id); setPruefDialogOpen(true); }
          }
        }}
        render={top => {
          if (top.type === 'auftrag') {
            const a = auftraege.find(r => r.record_id === top.id);
            if (!a) return null;
            const _kundeId = extractRecordId(a.fields.kunde);
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={a.fields.status?.label}
                  badges={a.fields.prioritaet ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{a.fields.prioritaet.label}</span> : undefined}
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'auftragsposition', id: p.record_id })}
                  onAddAuftragspositionen={() => { setPositionDialogDefaults({ auftrag: a.record_id }); setPositionDialogEditId(undefined); setPositionDialogOpen(true); }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={pr => overlay.push({ type: 'pruefprotokoll', id: pr.record_id })}
                  onAddPruefprotokoll={() => { setPruefDialogDefaults({ auftrag_pruef: a.record_id }); setPruefDialogEditId(undefined); setPruefDialogOpen(true); }}
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const p = auftragspositionen.find(r => r.record_id === top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader title={p.fields.positionsbeschreibung ?? 'Position'} subtitle={p.fields.einheit_position?.label} />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={_m => {}}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = kunden.find(r => r.record_id === top.id);
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
                  onAddAuftraege={() => { setAuftragDialogDefaults({ kunde: k.record_id }); setAuftragDialogEditId(undefined); setAuftragDialogOpen(true); }}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const pr = pruefprotokoll.find(r => r.record_id === top.id);
            if (!pr) return null;
            return (
              <>
                <RecordHeader
                  title={[pr.fields.monteur_name_vorname, pr.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={pr.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={pr}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = enrichedAuftraege.find(r => r.record_id === top.id);
            if (!a) return undefined;
            const nextLabel = nextStatusLabel(lookupKey(a.fields.status));
            if (!nextLabel) return undefined;
            return { label: `→ ${nextLabel}`, onClick: () => { advanceAuftrag(a); overlay.close(); } };
          }
          return undefined;
        }}
      />

      {/* ─── Dialogs ─── */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => setAuftragDialogOpen(false)}
        onSubmit={async (fields) => {
          if (auftragDialogEditId) {
            await LivingAppsService.updateAuftraegeEntry(auftragDialogEditId, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={auftragDialogDefaults}
        recordId={auftragDialogEditId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => setPositionDialogOpen(false)}
        onSubmit={async (fields) => {
          if (positionDialogEditId) {
            await LivingAppsService.updateAuftragspositionenEntry(positionDialogEditId, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={positionDialogDefaults}
        recordId={positionDialogEditId}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => setPruefDialogOpen(false)}
        onSubmit={async (fields) => {
          if (pruefDialogEditId) {
            await LivingAppsService.updatePruefprotokollEntry(pruefDialogEditId, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={pruefDialogDefaults}
        recordId={pruefDialogEditId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />
    </>
  );
}
