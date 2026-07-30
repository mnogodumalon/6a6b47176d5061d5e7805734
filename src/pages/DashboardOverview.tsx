import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftragspositionen, Pruefprotokoll, Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { lookupKey, formatDate } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { KanbanWidget, type KanbanCard, type KanbanColumn, type KanbanTone } from '@/components/widgets/KanbanWidget';
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
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format, isAfter, isBefore, addDays, parseISO } from 'date-fns';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconAlertCircle,
  IconPackage,
} from '@tabler/icons-react';

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

// ─── Overlay union type ────────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

export default function DashboardOverview() {
  const clock = useClock();

  const {
    kunden, setKunden,
    material,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap],
  );

  // ─── Overlay stack ─────────────────────────────────────────────────────────
  const overlay = useRecordOverlayStack<OverlayItem>();

  // ─── Dialog state ──────────────────────────────────────────────────────────
  const [auftragDialog, setAuftragDialog] = useState<{ open: boolean; defaults?: AuftraegeDialogDefaults; id?: string }>({ open: false });
  const [posDialog, setPosDialog] = useState<{ open: boolean; defaults?: AuftragspositionenDialogDefaults; id?: string }>({ open: false });
  const [pruefDialog, setPruefDialog] = useState<{ open: boolean; defaults?: PruefprotokollDialogDefaults; id?: string }>({ open: false });

  // ─── Status-filter ─────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // ─── Kanban cards ──────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? 'offen';
        const kundenName = a.kundeName || a.fields.auftragsnummer || 'Auftrag';
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: kundenName,
          subtitle: a.fields.auftragsnummer
            ? `${a.fields.auftragsnummer}${a.fields.monteur ? ` · ${a.fields.monteur}` : ''}`
            : a.fields.monteur ?? undefined,
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ─── Derived data for KPIs and lists ──────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const offene = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );
  const dringende = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend' && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert'),
    [enrichedAuftraege],
  );
  const faelligHeute = useMemo(
    () => enrichedAuftraege.filter(a => {
      if (!a.fields.wunschtermin) return false;
      const d = a.fields.wunschtermin.slice(0, 10);
      return d === today && lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert';
    }),
    [enrichedAuftraege, today],
  );

  // Material-Engpässe: Lagerbestand ≤ Mindestbestand
  const engpaesse = useMemo(
    () => material.filter(m => {
      const lb = m.fields.lagerbestand ?? 0;
      const mb = m.fields.mindestbestand ?? 0;
      return lb <= mb;
    }),
    [material],
  );

  // ─── Hero signal: dringende offene Aufträge ────────────────────────────────
  const heroAuftraege = useMemo(
    () => dringende.filter(a => lookupKey(a.fields.status) === 'offen'),
    [dringende],
  );

  // ─── Status advance helper ─────────────────────────────────────────────────
  const advanceStatus = useCallback(
    async (auftrag: EnrichedAuftraege) => {
      const current = lookupKey(auftrag.fields.status) ?? 'offen';
      const next = current === 'offen' ? 'in_bearbeitung' : current === 'in_bearbeitung' ? 'abgeschlossen' : null;
      if (!next) return;
      const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
      const snapshot = auftraege.map(a => ({ ...a }));
      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
            : a,
        ),
      );
      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
        undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, async () => {
          setAuftraege(snapshot);
          await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: current });
        });
      } catch {
        await fetchAll();
      }
    },
    [auftraege, setAuftraege, fetchAll],
  );

  // ─── Card move (kanban drag) ───────────────────────────────────────────────
  const moveCard = useCallback(
    async (cardId: string, newColumn: string) => {
      const rid = cardId.split(':')[1];
      if (!rid) return;
      const auftrag = auftraege.find(a => a.record_id === rid);
      if (!auftrag) return;
      const oldKey = lookupKey(auftrag.fields.status) ?? 'offen';
      const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
      const snapshot = auftraege.map(a => ({ ...a }));
      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
            : a,
        ),
      );
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
        undoToast(`Status → ${newLabel}`, async () => {
          setAuftraege(snapshot);
          await LivingAppsService.updateAuftraegeEntry(rid, { status: oldKey });
        });
      } catch {
        await fetchAll();
      }
    },
    [auftraege, setAuftraege, fetchAll],
  );

  // ─── Every hook goes ABOVE this line ──────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only, no hooks. ───

  // Helpers for overlay lookups
  const findAuftrag = (id: string) => auftraege.find(a => a.record_id === id);
  const findPosition = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const findPruef = (id: string) => pruefprotokoll.find(p => p.record_id === id);
  const findKunde = (id: string) => kunden.find(k => k.record_id === id);
  const findMaterial = (id: string) => material.find(m => m.record_id === id);

  const nextStatusLabel = (a: EnrichedAuftraege) => {
    const k = lookupKey(a.fields.status);
    if (k === 'offen') return 'In Bearbeitung';
    if (k === 'in_bearbeitung') return 'Abgeschlossen';
    return null;
  };

  const contextLine = (() => {
    if (offene.length === 0 && dringende.length === 0) {
      return 'Alle Aufträge sind erledigt — wunderbar!';
    }
    const parts: string[] = [];
    if (dringende.length > 0) {
      parts.push(`${dringende.length} dringend${dringende.length > 1 ? 'e' : 'er'} Auftrag${dringende.length > 1 ? 'e' : ''} (${namen(dringende.slice(0, 3).map(a => a.kundeName || a.fields.auftragsnummer || ''))})`);
    }
    if (offene.length > 0) {
      parts.push(`${offene.length} offen${offene.length > 1 ? 'e' : 'er'} Auftrag${offene.length > 1 ? 'e' : ''}`);
    }
    return parts.join(', ') + '.';
  })();

  return (
    <>
      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialog.open}
        onClose={() => setAuftragDialog({ open: false })}
        onSubmit={async fields => {
          if (auftragDialog.id) {
            await LivingAppsService.updateAuftraegeEntry(auftragDialog.id, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={auftragDialog.defaults}
        recordId={auftragDialog.id}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />
      <AuftragspositionenDialog
        open={posDialog.open}
        onClose={() => setPosDialog({ open: false })}
        onSubmit={async fields => {
          if (posDialog.id) {
            await LivingAppsService.updateAuftragspositionenEntry(posDialog.id, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={posDialog.defaults}
        recordId={posDialog.id}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />
      <PruefprotokollDialog
        open={pruefDialog.open}
        onClose={() => setPruefDialog({ open: false })}
        onSubmit={async fields => {
          if (pruefDialog.id) {
            await LivingAppsService.updatePruefprotokollEntry(pruefDialog.id, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={pruefDialog.defaults}
        recordId={pruefDialog.id}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
            <p className="text-muted-foreground mt-0.5">{contextLine}</p>
          </div>
          <button
            onClick={() => setAuftragDialog({ open: true })}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors shrink-0"
          >
            <IconPlus size={16} className="shrink-0" />
            Neuer Auftrag
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroAuftraege.length > 0 ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: `In Bearbeitung setzen`,
                onClick: () => advanceStatus(heroAuftraege[0]),
              }}
            >
              <b>{namen(heroAuftraege.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
              {' '}— dringend{heroAuftraege.length > 1 ? 'e Aufträge warten' : 'er Auftrag wartet'} auf Bearbeitung.
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              icon={<IconClipboardList size={16} />}
              tone={offene.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung').length}
              icon={<IconClipboardList size={16} />}
              tone="primary"
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Dringend"
              value={dringende.length}
              icon={<IconAlertCircle size={16} />}
              tone={dringende.length > 0 ? 'destructive' : 'default'}
              onClick={() => setStatusFilter(f => f === '__dringend' ? null : '__dringend')}
              active={statusFilter === '__dringend'}
            />
            <StatStripItem
              title="Heute fällig"
              value={faelligHeute.length}
              icon={<IconAlertCircle size={16} />}
              tone={faelligHeute.length > 0 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === '__heute' ? null : '__heute')}
              active={statusFilter === '__heute'}
            />
            <StatStripItem
              title="Materialengpässe"
              value={engpaesse.length}
              icon={<IconPackage size={16} />}
              tone={engpaesse.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={statusFilter ? cards.filter(c => {
              if (statusFilter === '__dringend') return dringende.some(a => `auftrag:${a.record_id}` === c.id);
              if (statusFilter === '__heute') return faelligHeute.some(a => `auftrag:${a.record_id}` === c.id);
              return c.column === statusFilter;
            }) : cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert', 'abgeschlossen']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
            onCardMove={moveCard}
            onAddCard={column => setAuftragDialog({ open: true, defaults: { status: column } })}
          />
        }
        aside={
          <>
            <WorkList
              title="Dringend & fällig"
              items={[
                ...dringende.filter(a => lookupKey(a.fields.status) === 'offen').slice(0, 3),
                ...faelligHeute.filter(a => !dringende.some(d => d.record_id === a.record_id)).slice(0, 3),
              ].slice(0, 5).map(a => ({
                id: a.record_id,
                title: a.kundeName || a.fields.auftragsnummer || 'Auftrag',
                secondLine: (
                  <>
                    <span className={lookupKey(a.fields.prioritaet) === 'dringend' ? 'font-medium text-destructive' : 'font-medium text-warning-foreground'}>
                      {a.fields.prioritaet?.label ?? 'Offen'}
                    </span>
                    {a.fields.wunschtermin && (
                      <span className="text-muted-foreground"> · {formatDate(a.fields.wunschtermin)}</span>
                    )}
                  </>
                ),
                action: nextStatusLabel(a) ? {
                  label: `→ ${nextStatusLabel(a)}`,
                  onClick: () => advanceStatus(a),
                } : undefined,
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: offene.length === 0
                  ? 'Keine dringenden Aufträge — alles im Griff!'
                  : `Nächster Auftrag: ${enrichedAuftraege.filter(a => lookupKey(a.fields.status) !== 'abgeschlossen' && lookupKey(a.fields.status) !== 'storniert')[0]?.fields.auftragsnummer ?? '—'}`,
                action: { label: 'Neuer Auftrag', onClick: () => setAuftragDialog({ open: true }) },
              }}
            />
            <WorkList
              title="Materialengpässe"
              items={engpaesse.slice(0, 5).map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? 'Material',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      {m.fields.lagerbestand ?? 0} {m.fields.einheit?.label ?? ''} Bestand
                    </span>
                    <span className="text-muted-foreground"> · Mind. {m.fields.mindestbestand ?? 0}</span>
                  </>
                ),
              }))}
              onItemClick={id => overlay.replace({ type: 'material', id })}
              empty={{
                text: 'Alle Materialien ausreichend bevorratet.',
              }}
            />
          </>
        }
      />

      {/* Overlay stack — ONE shell for the whole page */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            if (!rec) return null;
            const enriched = enrichAuftraege([rec], { kundenMap })[0];
            return (
              <>
                <RecordHeader
                  title={enriched.kundeName || rec.fields.auftragsnummer || 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={
                    rec.fields.prioritaet ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {rec.fields.prioritaet.label}
                      </span>
                    ) : undefined
                  }
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => setPosDialog({ open: true, defaults: { auftrag: rec.record_id } })}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruef', id: p.record_id })}
                  onAddPruefprotokoll={() => setPruefDialog({ open: true, defaults: { auftrag_pruef: rec.record_id } })}
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
                  title={rec.fields.positionsbeschreibung ?? 'Auftragsposition'}
                  subtitle={`${rec.fields.menge ?? ''} ${rec.fields.einheit_position?.label ?? ''}`}
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
                  onAddAuftraege={() => setAuftragDialog({ open: true, defaults: { kunde: rec.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const rec = findMaterial(top.id);
            if (!rec) return null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.bezeichnung ?? 'Material'}
                  subtitle={`${rec.fields.lagerbestand ?? 0} ${rec.fields.einheit?.label ?? ''} Lagerbestand`}
                />
                <MaterialDetails
                  record={rec}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'position', id: p.record_id })}
                  onAddAuftragspositionen={() => setPosDialog({ open: true, defaults: { material: rec.record_id } })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            if (!rec) return null;
            const enriched = enrichAuftraege([rec], { kundenMap })[0];
            const nextLabel = nextStatusLabel(enriched);
            if (!nextLabel) return null;
            return { label: `→ ${nextLabel}`, onClick: () => advanceStatus(enriched) };
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = findAuftrag(top.id);
            if (rec) setAuftragDialog({ open: true, defaults: rec.fields as AuftraegeDialogDefaults, id: rec.record_id });
          }
          if (top.type === 'position') {
            const rec = findPosition(top.id);
            if (rec) setPosDialog({ open: true, defaults: rec.fields as AuftragspositionenDialogDefaults, id: rec.record_id });
          }
          if (top.type === 'pruef') {
            const rec = findPruef(top.id);
            if (rec) setPruefDialog({ open: true, defaults: rec.fields as PruefprotokollDialogDefaults, id: rec.record_id });
          }
        }}
      />
    </>
  );
}
