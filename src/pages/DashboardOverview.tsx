import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { lookupKey, formatDate } from '@/lib/formatters';
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
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconAlertTriangle, IconPlus, IconClipboardList } from '@tabler/icons-react';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';

// Overlay-type union
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'material'; id: string };

// Status-tone mapping
function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen → needs attention
}

const COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    setAuftraege,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();
  const overlay = useRecordOverlayStack<OverlayItem>();

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

  // Dialog state
  const [auftraegeDialog, setAuftraegeDialog] = useState<{ open: boolean; defaults?: AuftraegeDialogDefaults; recordId?: string }>({ open: false });
  const [positionDialog, setPositionDialog] = useState<{ open: boolean; defaults?: AuftragspositionenDialogDefaults; recordId?: string }>({ open: false });
  const [pruefDialog, setPruefDialog] = useState<{ open: boolean; defaults?: PruefprotokollDialogDefaults; recordId?: string }>({ open: false });
  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<'dringend' | 'ueberfaellig' | null>(null);

  // ─── Derived data ───────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const dringende = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege]
  );

  const ueberfaellige = useMemo(
    () => enrichedAuftraege.filter(a => {
      const termin = a.fields.wunschtermin ?? a.fields.liefertermin;
      if (!termin) return false;
      const termStr = termin.slice(0, 10);
      const st = lookupKey(a.fields.status);
      return termStr < today && st !== 'abgeschlossen' && st !== 'storniert';
    }),
    [enrichedAuftraege, today]
  );

  const offene = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege]
  );

  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege]
  );

  // Context line
  const contextNamen = useMemo(() => {
    const next = [...inBearbeitung].sort((a, b) =>
      (a.fields.wunschtermin ?? '').localeCompare(b.fields.wunschtermin ?? '')
    ).slice(0, 3).map(a => a.kundeName || a.fields.auftragsnummer || '');
    return namen(next);
  }, [inBearbeitung]);

  const contextLine = inBearbeitung.length > 0
    ? `${inBearbeitung.length} Aufträge in Bearbeitung${contextNamen ? ' — ' + contextNamen : ''}.`
    : offene.length > 0
    ? `${offene.length} offene Aufträge warten auf Bearbeitung.`
    : 'Alle Aufträge sind abgeschlossen — super!';

  // Kanban cards (with optional filter)
  const filteredAuftraege = useMemo(() => {
    if (filter === 'dringend') return enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');
    if (filter === 'ueberfaellig') return ueberfaellige;
    return enrichedAuftraege;
  }, [enrichedAuftraege, filter, ueberfaellige]);

  const cards = useMemo<KanbanCard[]>(
    () => filteredAuftraege.map(a => {
      const status = lookupKey(a.fields.status) ?? 'offen';
      const isDringend = lookupKey(a.fields.prioritaet) === 'dringend';
      const termin = a.fields.wunschtermin ?? a.fields.liefertermin;
      return {
        id: `auftrag:${a.record_id}`,
        column: status,
        title: a.fields.auftragsnummer ?? 'Auftrag',
        subtitle: [
          a.kundeName || undefined,
          termin ? formatDate(termin) : undefined,
          isDringend ? '⚡ Dringend' : undefined,
        ].filter(Boolean).join(' · '),
        tone: toneForStatus(status),
      };
    }),
    [filteredAuftraege]
  );

  // Status advance helper
  const advanceStatus = useCallback(async (a: EnrichedAuftraege) => {
    const current = lookupKey(a.fields.status) ?? 'offen';
    const next = current === 'offen' ? 'in_bearbeitung'
      : current === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
    const prev = a.fields.status;
    // Optimistic update
    setAuftraege(prev2 => prev2.map(r =>
      r.record_id === a.record_id
        ? { ...r, fields: { ...r.fields, status: { key: next, label: newLabel } } }
        : r
    ));
    undoToast(`Auftrag ${a.fields.auftragsnummer} → ${newLabel}`, async () => {
      setAuftraege(prev2 => prev2.map(r =>
        r.record_id === a.record_id
          ? { ...r, fields: { ...r.fields, status: prev } }
          : r
      ));
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: prev as any });
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next as any });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // Card move handler
  const handleCardMove = useCallback(async (cardId: string, newColumn: string) => {
    const id = cardId.split(':')[1] ?? '';
    const a = auftraege.find(r => r.record_id === id);
    if (!a) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const prev = a.fields.status;
    setAuftraege(prev2 => prev2.map(r =>
      r.record_id === id
        ? { ...r, fields: { ...r.fields, status: { key: newColumn, label: newLabel } } }
        : r
    ));
    undoToast(`Status → ${newLabel}`, async () => {
      setAuftraege(prev2 => prev2.map(r =>
        r.record_id === id
          ? { ...r, fields: { ...r.fields, status: prev } }
          : r
      ));
      await LivingAppsService.updateAuftraegeEntry(id, { status: prev as any });
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(id, { status: newColumn as any });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // Helpers for overlay navigation
  const getAuftrag = (id: string) => auftraege.find(r => r.record_id === id);
  const getKunde = (id: string) => kunden.find(r => r.record_id === id);
  const getPosition = (id: string) => auftragspositionen.find(r => r.record_id === id);
  const getPruef = (id: string) => pruefprotokoll.find(r => r.record_id === id);
  const getMaterial = (id: string) => material.find(r => r.record_id === id);

  // ─── Hooks end here. ────────────────────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below: plain derivations, no hooks. ────────────────────────────────────

  // WorkList items: dringend + überfällig Aufträge
  const actionItems = enrichedAuftraege
    .filter(a => {
      const st = lookupKey(a.fields.status);
      return st !== 'abgeschlossen' && st !== 'storniert' &&
        (lookupKey(a.fields.prioritaet) === 'dringend' || ueberfaellige.some(u => u.record_id === a.record_id));
    })
    .sort((a, b) => {
      const aD = lookupKey(a.fields.prioritaet) === 'dringend' ? 0 : 1;
      const bD = lookupKey(b.fields.prioritaet) === 'dringend' ? 0 : 1;
      return aD - bD;
    })
    .map(a => {
      const isDringend = lookupKey(a.fields.prioritaet) === 'dringend';
      const isUeberfaellig = ueberfaellige.some(u => u.record_id === a.record_id);
      const termin = a.fields.wunschtermin ?? a.fields.liefertermin;
      const statusLabel = a.fields.status?.label ?? '—';
      const nextSt = lookupKey(a.fields.status) === 'offen' ? 'In Bearbeitung'
        : lookupKey(a.fields.status) === 'in_bearbeitung' ? 'Abschließen'
        : null;
      return {
        id: a.record_id,
        title: `${a.fields.auftragsnummer ?? 'Auftrag'} — ${a.kundeName || 'Kein Kunde'}`,
        secondLine: (
          <>
            {isDringend && <span className="font-medium text-warning">Dringend</span>}
            {isUeberfaellig && <span className="font-medium text-destructive">{isDringend ? ' · ' : ''}Überfällig</span>}
            {termin && <span className="text-muted-foreground"> · {formatDate(termin)}</span>}
            <span className="text-muted-foreground"> · {statusLabel}</span>
          </>
        ),
        action: nextSt ? {
          label: `→ ${nextSt}`,
          onClick: () => advanceStatus(a),
        } : undefined,
      };
    });

  // Hero: dringendste überfällige Aufträge
  const heroItems = ueberfaellige.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');
  const bannerItems = heroItems.length > 0 ? heroItems : ueberfaellige.slice(0, 2);
  const showBanner = bannerItems.length > 0;

  return (
    <>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
        <p className="text-muted-foreground mt-1">{contextLine}</p>
      </div>

      <DashboardGrid
        variant="wide"
        hero={showBanner && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: `→ In Bearbeitung`,
              onClick: () => advanceStatus(bannerItems[0]),
            }}
          >
            <b>{namen(bannerItems.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
            {' '}— {bannerItems.length === 1 ? 'Auftrag überfällig' : `${bannerItems.length} Aufträge überfällig`}.
            {bannerItems[0].fields.wunschtermin && <> Termin war {formatDate(bannerItems[0].fields.wunschtermin)}.</>}
          </HeroBanner>
        )}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              tone={offene.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilter(f => f === null ? null : null)}
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
              onClick={() => setFilter(f => f === 'dringend' ? null : 'dringend')}
              active={filter === 'dringend'}
            />
            <StatStripItem
              title="Überfällig"
              value={ueberfaellige.length}
              tone={ueberfaellige.length > 0 ? 'destructive' : 'default'}
              onClick={() => setFilter(f => f === 'ueberfaellig' ? null : 'ueberfaellig')}
              active={filter === 'ueberfaellig'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={auftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen').length}
              tone="success"
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={COLUMNS}
            cards={cards}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1] ?? '';
              overlay.replace({ type: 'auftrag', id });
            }}
            onCardMove={handleCardMove}
            onAddCard={column => setAuftraegeDialog({ open: true, defaults: { status: column } })}
          />
        }
        aside={
          <>
            <WorkList
              title="Handlungsbedarf"
              items={actionItems}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Kein dringender Handlungsbedarf — alles im Griff!',
                action: { label: 'Neuer Auftrag', onClick: () => setAuftraegeDialog({ open: true }) },
              }}
              max={6}
            />
            <WorkList
              title="Zuletzt erstellt"
              items={[...enrichedAuftraege]
                .sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? ''))
                .slice(0, 5)
                .map(a => ({
                  id: a.record_id,
                  title: `${a.fields.auftragsnummer ?? 'Auftrag'}`,
                  secondLine: (
                    <>
                      <span className="text-muted-foreground">{a.kundeName || 'Kein Kunde'}</span>
                      {a.fields.auftragsdatum && <span className="text-muted-foreground"> · {formatDate(a.fields.auftragsdatum)}</span>}
                    </>
                  ),
                }))
              }
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Noch keine Aufträge — leg los!',
                action: { label: 'Ersten Auftrag anlegen', onClick: () => setAuftraegeDialog({ open: true }) },
              }}
            />
          </>
        }
      />

      {/* ─── Overlay stack ─────────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftrag(top.id);
            if (!rec) return null;
            const st = lookupKey(rec.fields.status);
            const nextLabel = st === 'offen' ? 'In Bearbeitung starten'
              : st === 'in_bearbeitung' ? 'Abschließen'
              : null;
            const enrichedRec = enrichedAuftraege.find(a => a.record_id === top.id) ?? { ...rec, kundeName: '' };
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[enrichedRec.kundeName, rec.fields.status?.label].filter(Boolean).join(' · ')}
                  badges={<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    st === 'abgeschlossen' ? 'bg-success/10 text-success' :
                    st === 'in_bearbeitung' ? 'bg-primary/10 text-primary' :
                    st === 'storniert' ? 'bg-muted text-muted-foreground' :
                    'bg-warning/10 text-warning'
                  }`}>{rec.fields.status?.label ?? '—'}</span>}
                  actions={
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground"
                      onClick={() => setAuftraegeDialog({ open: true, defaults: rec.fields as any, recordId: rec.record_id })}
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
                  onAddAuftragspositionen={() => setPositionDialog({ open: true, defaults: { auftrag: rec.record_id } })}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => setPruefDialog({ open: true, defaults: { auftrag_pruef: rec.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const rec = getKunde(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={[rec.fields.vorname, rec.fields.nachname].filter(Boolean).join(' ')}
                  subtitle={rec.fields.firma ?? rec.fields.ort ?? undefined}
                />
                <KundenDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() => setAuftraegeDialog({ open: true, defaults: { kunde: rec.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const rec = getPosition(top.id);
            if (!rec) return null;
            const enriched = enrichedAuftragspositionen.find(p => p.record_id === top.id);
            return (
              <>
                <RecordHeader
                  title={rec.fields.positionsbeschreibung ?? 'Auftragsposition'}
                  subtitle={enriched ? `${enriched.auftragName} · ${enriched.materialName}` : undefined}
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
          if (top.type === 'pruef') {
            const rec = getPruef(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={[rec.fields.monteur_name_vorname, rec.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={rec.fields.pruefergebnis?.label ?? undefined}
                />
                <PruefprotokollDetails
                  record={rec}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const rec = getMaterial(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.bezeichnung ?? 'Material'}
                  subtitle={rec.fields.artikelnummer ?? undefined}
                />
                <MaterialDetails
                  record={rec}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => setPositionDialog({ open: true, defaults: { material: rec.record_id } })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftrag(top.id);
            if (!rec) return null;
            const st = lookupKey(rec.fields.status);
            const nextLabel = st === 'offen' ? 'In Bearbeitung starten'
              : st === 'in_bearbeitung' ? 'Auftrag abschließen'
              : null;
            if (!nextLabel) return null;
            const enrichedRec = enrichedAuftraege.find(a => a.record_id === top.id) ?? { ...rec, kundeName: '' };
            return { label: nextLabel, onClick: () => advanceStatus(enrichedRec) };
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = getAuftrag(top.id);
            if (rec) setAuftraegeDialog({ open: true, defaults: rec.fields as any, recordId: rec.record_id });
          }
        }}
      />

      {/* ─── Dialogs ────────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftraegeDialog.open}
        onClose={() => setAuftraegeDialog({ open: false })}
        onSubmit={async fields => {
          if (auftraegeDialog.recordId) {
            await LivingAppsService.updateAuftraegeEntry(auftraegeDialog.recordId, fields as any);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={auftraegeDialog.defaults}
        recordId={auftraegeDialog.recordId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialog.open}
        onClose={() => setPositionDialog({ open: false })}
        onSubmit={async fields => {
          if (positionDialog.recordId) {
            await LivingAppsService.updateAuftragspositionenEntry(positionDialog.recordId, fields as any);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields as any);
          }
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
        onSubmit={async fields => {
          if (pruefDialog.recordId) {
            await LivingAppsService.updatePruefprotokollEntry(pruefDialog.recordId, fields as any);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={pruefDialog.defaults}
        recordId={pruefDialog.recordId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => setKundenDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createKundenEntry(fields as any);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
