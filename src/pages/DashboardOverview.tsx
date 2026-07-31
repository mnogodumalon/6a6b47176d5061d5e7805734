import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Auftraege, Auftragspositionen, Pruefprotokoll, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
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
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
  RecordAttachments,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import { IconPlus, IconAlertTriangle } from '@tabler/icons-react';

// ─── Overlay type union ───────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string };

// ─── Kanban columns from schema ───────────────────────────────────────────────
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

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    setAuftraege,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

  // ─── Dialog state ─────────────────────────────────────────────────────────
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editingAuftrag, setEditingAuftrag] = useState<EnrichedAuftraege | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editingPosition, setEditingPosition] = useState<Auftragspositionen | undefined>();

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editingPruef, setEditingPruef] = useState<Pruefprotokoll | undefined>();

  const [kundeDialogOpen, setKundeDialogOpen] = useState(false);

  // ─── Enrichment ──────────────────────────────────────────────────────────
  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap],
  );

  // ─── Kanban cards ─────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
        const kundeLabel = a.kundeName || a.fields.auftragsnummer || 'Ohne Kunde';
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: kundeLabel,
          subtitle: a.fields.auftragsnummer
            ? `${a.fields.auftragsnummer}${a.fields.wunschtermin ? ' · bis ' + formatDate(a.fields.wunschtermin) : ''}`
            : a.fields.wunschtermin ? 'bis ' + formatDate(a.fields.wunschtermin) : undefined,
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ─── KPI derivations ──────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const dringende = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege],
  );

  const offene = useMemo(
    () => auftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [auftraege],
  );

  const inBearbeitung = useMemo(
    () => auftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [auftraege],
  );

  const ueberfaellige = useMemo(
    () => enrichedAuftraege.filter(a => {
      const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
      if (!termin) return false;
      const dateStr = termin.slice(0, 10);
      return dateStr < today && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert';
    }),
    [enrichedAuftraege, today],
  );

  // ─── Context greeting ──────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (dringende.length > 0) {
      const names = namen(dringende.map(a => a.kundeName || a.fields.auftragsnummer || ''));
      return `${names} ${dringende.length === 1 ? 'hat' : 'haben'} dringende Aufträge.`;
    }
    if (ueberfaellige.length > 0) {
      return `${ueberfaellige.length} Auftrag${ueberfaellige.length > 1 ? 'träge' : ''} überfällig — bitte nachfassen.`;
    }
    if (inBearbeitung.length > 0) {
      const names = namen(inBearbeitung.slice(0, 3).map(a => {
        const k = kundenMap.get(extractRecordId(a.fields.kunde) ?? '');
        return k ? `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() : a.fields.auftragsnummer ?? '';
      }));
      return `${inBearbeitung.length} Aufträge in Bearbeitung — davon ${names}.`;
    }
    if (auftraege.length === 0) {
      return 'Lege deinen ersten Auftrag an, um zu beginnen.';
    }
    return `${auftraege.length} Aufträge — ${offene.length} offen.`;
  }, [dringende, ueberfaellige, inBearbeitung, auftraege, offene, kundenMap]);

  // ─── Advance status helper ────────────────────────────────────────────────
  const advanceStatus = useCallback(async (auftrag: Auftraege | EnrichedAuftraege) => {
    const current = lookupKey(auftrag.fields.status);
    const nextMap: Record<string, string> = {
      offen: 'in_bearbeitung',
      in_bearbeitung: 'abgeschlossen',
    };
    const next = nextMap[current ?? ''];
    if (!next) return;
    const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
    const prevStatus = auftrag.fields.status;

    // Optimistic
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
        : a
    ));

    undoToast(`Status geändert: ${nextLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: lookupKey(prevStatus) });
      } catch { fetchAll(); }
    });

    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── Kanban card move ─────────────────────────────────────────────────────
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const prevStatus = auftrag.fields.status;

    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));

    undoToast(`${newLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: lookupKey(prevStatus) });
      } catch { fetchAll(); }
    });

    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── Filter state for KPIs ────────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<'dringend' | 'ueberfaellig' | null>(null);

  const filteredCards = useMemo(() => {
    if (activeFilter === 'dringend') {
      const ids = new Set(dringende.map(a => a.record_id));
      return cards.filter(c => ids.has(c.id.split(':')[1]));
    }
    if (activeFilter === 'ueberfaellig') {
      const ids = new Set(ueberfaellige.map(a => a.record_id));
      return cards.filter(c => ids.has(c.id.split(':')[1]));
    }
    return cards;
  }, [activeFilter, cards, dringende, ueberfaellige]);

  // ─── ALL hooks above — early returns below ────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Overlay helpers ───────────────────────────────────────────────────────
  const findAuftrag = (id: string) => enrichedAuftraege.find(a => a.record_id === id);
  const findKunde = (id: string) => kunden.find(k => k.record_id === id);
  const findPosition = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const findPruef = (id: string) => pruefprotokoll.find(p => p.record_id === id);

  // ─── Empty state ──────────────────────────────────────────────────────────
  if (auftraege.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <IconAlertTriangle size={48} className="text-muted-foreground" stroke={1.5} />
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Noch keine Aufträge</h2>
          <p className="text-sm text-muted-foreground">Richte deinen Arbeitsbereich ein — lege den ersten Auftrag an.</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} />
          Ersten Auftrag anlegen
        </button>
        <AuftraegeDialog
          open={auftragDialogOpen}
          onClose={() => setAuftragDialogOpen(false)}
          onSubmit={async (fields) => { await LivingAppsService.createAuftraegeEntry(fields); fetchAll(); }}
          kundenList={kunden}
          enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
        />
      </div>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftragDefaults(undefined); setEditingAuftrag(undefined); setAuftragDialogOpen(true); }}
          className="shrink-0 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} />
          <span className="hidden sm:inline">Neuer Auftrag</span>
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={ueberfaellige.length > 0 && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{ label: 'In Bearbeitung setzen', onClick: () => void advanceStatus(ueberfaellige[0]) }}
          >
            <b>{namen(ueberfaellige.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
            {' '}{ueberfaellige.length === 1 ? 'ist' : 'sind'} überfällig —{' '}
            Termin war {formatDate(ueberfaellige[0].fields.liefertermin ?? ueberfaellige[0].fields.wunschtermin)}.
          </HeroBanner>
        )}
        kpis={(
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              tone={offene.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringende.length}
              tone={dringende.length > 0 ? 'destructive' : 'default'}
              onClick={() => setActiveFilter(f => f === 'dringend' ? null : 'dringend')}
              active={activeFilter === 'dringend'}
            />
            <StatStripItem
              title="Überfällig"
              value={ueberfaellige.length}
              tone={ueberfaellige.length > 0 ? 'destructive' : 'default'}
              onClick={() => setActiveFilter(f => f === 'ueberfaellig' ? null : 'ueberfaellig')}
              active={activeFilter === 'ueberfaellig'}
            />
          </StatStrip>
        )}
        primary={(
          <KanbanWidget
            cards={filteredCards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] })}
            onCardMove={moveCard}
            onAddCard={column => {
              setAuftragDefaults({ status: column });
              setEditingAuftrag(undefined);
              setAuftragDialogOpen(true);
            }}
          />
        )}
        aside={(
          <>
            <WorkList
              title="Dringend & offen"
              items={[...dringende.filter(a => lookupKey(a.fields.status) === 'offen'), ...dringende.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung')].slice(0, 8).map(a => ({
                id: a.record_id,
                title: a.kundeName || a.fields.auftragsnummer || 'Ohne Kunde',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">{a.fields.prioritaet?.label ?? 'Dringend'}</span>
                    {a.fields.wunschtermin && <span className="text-muted-foreground"> · bis {formatDate(a.fields.wunschtermin)}</span>}
                  </>
                ),
                action: {
                  label: lookupKey(a.fields.status) === 'offen' ? '▶ Starten' : '✓ Fertig',
                  onClick: () => void advanceStatus(a),
                },
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Keine dringenden Aufträge — alles im Griff.',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftragDefaults(undefined); setAuftragDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Zuletzt angelegt"
              items={[...auftraege].sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? '')).slice(0, 5).map(a => {
                const k = kundenMap.get(extractRecordId(a.fields.kunde) ?? '');
                const name = k ? `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() : a.fields.auftragsnummer ?? 'Ohne Kunde';
                return {
                  id: a.record_id,
                  title: name,
                  secondLine: (
                    <>
                      <span className="text-muted-foreground">{a.fields.status?.label ?? '—'}</span>
                      {a.fields.auftragsdatum && <span className="text-muted-foreground"> · {formatDate(a.fields.auftragsdatum)}</span>}
                    </>
                  ),
                };
              })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{ text: 'Noch keine Aufträge angelegt.' }}
            />
          </>
        )}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => { setAuftragDialogOpen(false); setEditingAuftrag(undefined); setAuftragDefaults(undefined); }}
        onSubmit={async (fields) => {
          if (editingAuftrag) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftrag.record_id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editingAuftrag?.fields ?? auftragDefaults}
        recordId={editingAuftrag?.record_id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => { setPositionDialogOpen(false); setEditingPosition(undefined); setPositionDefaults(undefined); }}
        onSubmit={async (fields) => {
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
        onClose={() => { setPruefDialogOpen(false); setEditingPruef(undefined); setPruefDefaults(undefined); }}
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
        open={kundeDialogOpen}
        onClose={() => setKundeDialogOpen(false)}
        onSubmit={async (fields) => { await LivingAppsService.createKundenEntry(fields); fetchAll(); }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />

      {/* Record Overlay Host */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.kundeName || rec.fields.auftragsnummer || 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={rec.fields.prioritaet?.label ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                      {rec.fields.prioritaet.label}
                    </span>
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
                    setEditingPosition(undefined);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: rec.record_id });
                    setEditingPruef(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const rec = findKunde(top.id);
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
                    setEditingAuftrag(undefined);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const rec = findPosition(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung || 'Position'}
                  subtitle={rec.fields.einheit_position?.label}
                />
                <AuftragspositionenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const rec = findPruef(top.id);
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
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            const status = lookupKey(rec?.fields.status);
            const canAdvance = status === 'offen' || status === 'in_bearbeitung';
            if (!rec || !canAdvance) return undefined;
            const nextLabel = status === 'offen' ? 'In Bearbeitung setzen' : 'Abschließen';
            return { label: nextLabel, onClick: () => void advanceStatus(rec) };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            if (rec) { setEditingAuftrag(rec); setAuftragDialogOpen(true); }
          }
          if (top.type === 'position') {
            const rec = findPosition(top.id);
            if (rec) { setEditingPosition(rec); setPositionDialogOpen(true); }
          }
          if (top.type === 'pruef') {
            const rec = findPruef(top.id);
            if (rec) { setEditingPruef(rec); setPruefDialogOpen(true); }
          }
        }}
      />
    </>
  );
}
