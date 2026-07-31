import { useMemo, useState, useCallback } from 'react';
import { format, parseISO, isBefore } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconTools,
  IconChecks,
} from '@tabler/icons-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { lookupKey, formatDate, formatDateTime } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
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
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';

// ─── Overlay union type ───────────────────────────────────────────────────────
type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'position'; id: string }
  | { type: 'pruef'; id: string }
  | { type: 'kunde'; id: string }
  | { type: 'material'; id: string };

// ─── Kanban columns from schema ───────────────────────────────────────────────
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

function toneForPruef(ergebnis: string | undefined): KanbanTone {
  if (ergebnis === 'bestanden') return 'success';
  if (ergebnis === 'bestanden_mit_maengeln') return 'warning';
  if (ergebnis === 'nicht_bestanden') return 'destructive';
  return 'default';
}

export default function DashboardOverview() {
  const {
    kunden, setKunden,
    material, setMaterial,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll, setPruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap],
  );

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialogOpen, setAuftragDialogOpen] = useState(false);
  const [auftragDefaults, setAuftragDefaults] = useState<AuftraegeDialogDefaults | undefined>();
  const [editAuftragId, setEditAuftragId] = useState<string | undefined>();

  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [positionDefaults, setPositionDefaults] = useState<AuftragspositionenDialogDefaults | undefined>();
  const [editPositionId, setEditPositionId] = useState<string | undefined>();

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>();
  const [editPruefId, setEditPruefId] = useState<string | undefined>();

  // ─── Advance status helper (shared across board, list, overlay footer) ──────
  const advanceStatus = useCallback(
    async (auftrag: Auftraege | EnrichedAuftraege) => {
      const current = lookupKey(auftrag.fields.status);
      const next =
        current === 'offen' ? 'in_bearbeitung'
        : current === 'in_bearbeitung' ? 'abgeschlossen'
        : null;
      if (!next) return;

      const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === next)?.label ?? next;
      const prevStatus = auftrag.fields.status;

      // Optimistisch updaten
      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === auftrag.record_id
            ? { ...a, fields: { ...a.fields, status: { key: next, label: nextLabel } } }
            : a,
        ),
      );

      try {
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: next });
        undoToast(`Status: ${nextLabel}`, async () => {
          setAuftraege(prev =>
            prev.map(a =>
              a.record_id === auftrag.record_id
                ? { ...a, fields: { ...a.fields, status: prevStatus } }
                : a,
            ),
          );
          await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, {
            status: prevStatus ? lookupKey(prevStatus) : undefined,
          });
        });
      } catch {
        fetchAll();
      }
    },
    [setAuftraege, fetchAll],
  );

  // ─── Derived data ─────────────────────────────────────────────────────────
  const today = format(clock, 'yyyy-MM-dd');

  const offeneAuftraege = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'),
    [enrichedAuftraege],
  );

  const inBearbeitung = useMemo(
    () => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'),
    [enrichedAuftraege],
  );

  const ueberfaellige = useMemo(
    () =>
      enrichedAuftraege.filter(a => {
        const lt = a.fields.liefertermin;
        if (!lt) return false;
        const statusKey = lookupKey(a.fields.status);
        if (statusKey === 'abgeschlossen' || statusKey === 'storniert') return false;
        return isBefore(parseISO(lt), clock);
      }),
    [enrichedAuftraege, clock],
  );

  const dringend = useMemo(
    () =>
      enrichedAuftraege.filter(a => {
        const prio = lookupKey(a.fields.prioritaet);
        const statusKey = lookupKey(a.fields.status);
        return (
          (prio === 'dringend' || prio === 'hoch') &&
          statusKey !== 'abgeschlossen' &&
          statusKey !== 'storniert'
        );
      }),
    [enrichedAuftraege],
  );

  const maengelProtokolle = useMemo(
    () =>
      pruefprotokoll.filter(p => {
        const ergebnis = lookupKey(p.fields.pruefergebnis);
        return ergebnis === 'nicht_bestanden' || ergebnis === 'bestanden_mit_maengeln';
      }),
    [pruefprotokoll],
  );

  // ─── Kanban cards ─────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
        const prio = lookupKey(a.fields.prioritaet);
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: a.fields.auftragsnummer ?? 'Auftrag',
          subtitle: [
            a.kundeName || undefined,
            a.fields.liefertermin
              ? `Liefertermin: ${formatDate(a.fields.liefertermin)}`
              : undefined,
            prio === 'dringend' ? '⚡ Dringend' : prio === 'hoch' ? '↑ Hoch' : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ─── Kanban move ──────────────────────────────────────────────────────────
  const moveCard = useCallback(
    async (cardId: string, newColumn: string) => {
      const rid = cardId.split(':')[1];
      if (!rid) return;
      const auftrag = auftraege.find(a => a.record_id === rid);
      if (!auftrag) return;

      const newLabel =
        LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
      const prevStatus = auftrag.fields.status;

      setAuftraege(prev =>
        prev.map(a =>
          a.record_id === rid
            ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
            : a,
        ),
      );

      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
        undoToast(`Status: ${newLabel}`, async () => {
          setAuftraege(prev =>
            prev.map(a =>
              a.record_id === rid
                ? { ...a, fields: { ...a.fields, status: prevStatus } }
                : a,
            ),
          );
          await LivingAppsService.updateAuftraegeEntry(rid, {
            status: prevStatus ? lookupKey(prevStatus) : undefined,
          });
        });
      } catch {
        fetchAll();
      }
    },
    [auftraege, setAuftraege, fetchAll],
  );

  // ─── Context line ─────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    if (enrichedAuftraege.length === 0) return 'Noch keine Aufträge — legen wir los!';
    if (ueberfaellige.length > 0) {
      const names = ueberfaellige.map(a => a.kundeName || a.fields.auftragsnummer || '').filter(Boolean);
      return `${namen(names)} ${ueberfaellige.length === 1 ? 'ist' : 'sind'} überfällig — bitte prüfen.`;
    }
    if (inBearbeitung.length > 0) {
      const names = inBearbeitung.slice(0, 3).map(a => a.kundeName || a.fields.auftragsnummer || '').filter(Boolean);
      return `${namen(names)} ${inBearbeitung.length === 1 ? 'ist' : 'sind'} gerade in Bearbeitung.`;
    }
    return `${offeneAuftraege.length} offene Aufträge warten auf Bearbeitung.`;
  }, [enrichedAuftraege, ueberfaellige, inBearbeitung, offeneAuftraege]);

  // ─── Overlay helpers ──────────────────────────────────────────────────────
  const openAuftragDetail = useCallback(
    (a: Auftraege | EnrichedAuftraege) => overlay.push({ type: 'auftrag', id: a.record_id }),
    [overlay],
  );
  const openPositionDetail = useCallback(
    (p: Auftragspositionen) => overlay.push({ type: 'position', id: p.record_id }),
    [overlay],
  );
  const openPruefDetail = useCallback(
    (p: Pruefprotokoll) => overlay.push({ type: 'pruef', id: p.record_id }),
    [overlay],
  );
  const openKundeDetail = useCallback(
    (k: Kunden) => overlay.push({ type: 'kunde', id: k.record_id }),
    [overlay],
  );

  // ─── Early returns (after all hooks) ─────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Helpers (post-hooks) ─────────────────────────────────────────────────
  const firstUeberfaellig = ueberfaellige[0];

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {gruss(clock)} Auftragsübersicht
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          className="mt-3 sm:mt-0 inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          onClick={() => {
            setAuftragDefaults(undefined);
            setEditAuftragId(undefined);
            setAuftragDialogOpen(true);
          }}
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          ueberfaellige.length > 0 && firstUeberfaellig ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: `Status weiterschalten`,
                onClick: () => advanceStatus(firstUeberfaellig),
              }}
            >
              <b>
                {namen(
                  ueberfaellige.map(
                    a =>
                      (a as EnrichedAuftraege).kundeName ||
                      a.fields.auftragsnummer ||
                      '',
                  ).filter(Boolean),
                )}
              </b>{' '}
              {ueberfaellige.length === 1 ? 'ist' : 'sind'} überfällig — Liefertermin{' '}
              {firstUeberfaellig.fields.liefertermin
                ? formatDateTime(firstUeberfaellig.fields.liefertermin)
                : '?'}{' '}
              war bereits.
            </HeroBanner>
          ) : undefined
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
              icon={<IconTools size={16} className="shrink-0" />}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
            />
            <StatStripItem
              title="Mängel offen"
              value={maengelProtokolle.length}
              icon={<IconChecks size={16} className="shrink-0" />}
              tone={maengelProtokolle.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1];
              if (id) overlay.replace({ type: 'auftrag', id });
            }}
            onCardMove={moveCard}
            onAddCard={column => {
              setAuftragDefaults({ status: column });
              setEditAuftragId(undefined);
              setAuftragDialogOpen(true);
            }}
          />
        }
        aside={
          <>
            <WorkList
              title="Dringend & Überfällig"
              items={[
                ...ueberfaellige.map(a => ({
                  id: a.record_id,
                  title:
                    (a as EnrichedAuftraege).kundeName || a.fields.auftragsnummer || 'Auftrag',
                  secondLine: (
                    <>
                      <span className="font-medium text-destructive">Überfällig</span>
                      {a.fields.liefertermin && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {formatDateTime(a.fields.liefertermin)}
                        </span>
                      )}
                    </>
                  ),
                  action: {
                    label: '→ Weiter',
                    onClick: () => advanceStatus(a),
                  },
                })),
                ...dringend
                  .filter(a => !ueberfaellige.find(u => u.record_id === a.record_id))
                  .slice(0, 5)
                  .map(a => ({
                    id: a.record_id,
                    title:
                      (a as EnrichedAuftraege).kundeName || a.fields.auftragsnummer || 'Auftrag',
                    secondLine: (
                      <>
                        <span className="font-medium text-warning">
                          {lookupKey(a.fields.prioritaet) === 'dringend' ? 'Dringend' : 'Hoch'}
                        </span>
                        {a.fields.wunschtermin && (
                          <span className="text-muted-foreground">
                            {' '}
                            · Wunsch: {formatDate(a.fields.wunschtermin)}
                          </span>
                        )}
                      </>
                    ),
                    action: {
                      label: '→ Weiter',
                      onClick: () => advanceStatus(a),
                    },
                  })),
              ].slice(0, 8)}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text:
                  offeneAuftraege.length > 0
                    ? `${offeneAuftraege.length} offene Aufträge — kein dringender dabei`
                    : 'Alles entspannt — kein dringender Auftrag',
                action: {
                  label: 'Neuer Auftrag',
                  onClick: () => {
                    setAuftragDefaults({ status: 'offen' });
                    setAuftragDialogOpen(true);
                  },
                },
              }}
            />
            <WorkList
              title="Mängel & Prüfprotokolle"
              items={maengelProtokolle.slice(0, 8).map(p => {
                const auftrag = auftraege.find(
                  a => a.record_id === extractRecordId(p.fields.auftrag_pruef),
                );
                const ergebnis = lookupKey(p.fields.pruefergebnis);
                return {
                  id: p.record_id,
                  title: `${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Monteur',
                  secondLine: (
                    <>
                      <span
                        className={
                          ergebnis === 'nicht_bestanden'
                            ? 'font-medium text-destructive'
                            : 'font-medium text-warning'
                        }
                      >
                        {p.fields.pruefergebnis?.label ?? '—'}
                      </span>
                      {auftrag && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {auftrag.fields.auftragsnummer}
                        </span>
                      )}
                    </>
                  ),
                  action: {
                    label: 'Protokoll',
                    onClick: () => overlay.replace({ type: 'pruef', id: p.record_id }),
                  },
                };
              })}
              onItemClick={id => overlay.replace({ type: 'pruef', id })}
              empty={{
                text:
                  pruefprotokoll.length === 0
                    ? 'Noch kein Prüfprotokoll — nach Auftrag erfassen'
                    : 'Alle Prüfungen bestanden — keine Mängel offen',
              }}
            />
          </>
        }
      />

      {/* ─── Overlay Host ──────────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const auftrag = auftraege.find(a => a.record_id === top.id);
            if (!auftrag) return null;
            const enriched = enrichedAuftraege.find(a => a.record_id === top.id);
            const nextStatusKey =
              lookupKey(auftrag.fields.status) === 'offen'
                ? 'in_bearbeitung'
                : lookupKey(auftrag.fields.status) === 'in_bearbeitung'
                ? 'abgeschlossen'
                : null;
            const nextStatusLabel = nextStatusKey
              ? LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextStatusKey)?.label
              : null;
            return (
              <>
                <RecordHeader
                  title={auftrag.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={[
                    enriched?.kundeName,
                    auftrag.fields.status?.label,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <AuftraegeDetails
                  record={auftrag}
                  kundenList={kunden}
                  onOpenKunden={openKundeDetail}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={openPositionDetail}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ auftrag: auftrag.record_id });
                    setEditPositionId(undefined);
                    setPositionDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={openPruefDetail}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: auftrag.record_id });
                    setEditPruefId(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'position') {
            const pos = auftragspositionen.find(p => p.record_id === top.id);
            if (!pos) return null;
            const auftragTarget = auftraege.find(
              a => a.record_id === extractRecordId(pos.fields.auftrag),
            );
            return (
              <>
                <RecordHeader
                  title={pos.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={auftragTarget?.fields.auftragsnummer}
                />
                <AuftragspositionenDetails
                  record={pos}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'material', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruef') {
            const pruef = pruefprotokoll.find(p => p.record_id === top.id);
            if (!pruef) return null;
            return (
              <>
                <RecordHeader
                  title={`${pruef.fields.monteur_name_vorname ?? ''} ${pruef.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={pruef.fields.pruefergebnis?.label}
                />
                <PruefprotokollDetails
                  record={pruef}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const kunde = kunden.find(k => k.record_id === top.id);
            if (!kunde) return null;
            return (
              <>
                <RecordHeader
                  title={[kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || 'Kunde'}
                  subtitle={kunde.fields.firma ?? kunde.fields.telefon}
                />
                <KundenDetails
                  record={kunde}
                  auftraegeList={auftraege}
                  onOpenAuftraege={openAuftragDetail}
                  onAddAuftraege={() => {
                    setAuftragDefaults({ kunde: kunde.record_id });
                    setEditAuftragId(undefined);
                    setAuftragDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const mat = material.find(m => m.record_id === top.id);
            if (!mat) return null;
            return (
              <>
                <RecordHeader
                  title={mat.fields.bezeichnung ?? 'Material'}
                  subtitle={[mat.fields.artikelnummer, mat.fields.einheit?.label]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <MaterialDetails
                  record={mat}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={openPositionDetail}
                  onAddAuftragspositionen={() => {
                    setPositionDefaults({ material: mat.record_id });
                    setEditPositionId(undefined);
                    setPositionDialogOpen(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const auftrag = auftraege.find(a => a.record_id === top.id);
            if (!auftrag) return undefined;
            const statusKey = lookupKey(auftrag.fields.status);
            if (statusKey === 'abgeschlossen' || statusKey === 'storniert') return undefined;
            const nextStatusKey =
              statusKey === 'offen'
                ? 'in_bearbeitung'
                : statusKey === 'in_bearbeitung'
                ? 'abgeschlossen'
                : null;
            if (!nextStatusKey) return undefined;
            const nextLabel =
              LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextStatusKey)?.label ??
              nextStatusKey;
            return {
              label: `→ ${nextLabel}`,
              onClick: () => advanceStatus(auftrag),
            };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const auftrag = auftraege.find(a => a.record_id === top.id);
            if (!auftrag) return;
            setAuftragDefaults(undefined);
            setEditAuftragId(auftrag.record_id);
            setAuftragDialogOpen(true);
          }
          if (top.type === 'position') {
            const pos = auftragspositionen.find(p => p.record_id === top.id);
            if (!pos) return;
            setPositionDefaults(undefined);
            setEditPositionId(pos.record_id);
            setPositionDialogOpen(true);
          }
          if (top.type === 'pruef') {
            const pruef = pruefprotokoll.find(p => p.record_id === top.id);
            if (!pruef) return;
            setPruefDefaults(undefined);
            setEditPruefId(pruef.record_id);
            setPruefDialogOpen(true);
          }
        }}
      />

      {/* ─── Dialogs ───────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftragDialogOpen}
        onClose={() => setAuftragDialogOpen(false)}
        onSubmit={async fields => {
          if (editAuftragId) {
            await LivingAppsService.updateAuftraegeEntry(editAuftragId, fields as any);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={editAuftragId
          ? auftraege.find(a => a.record_id === editAuftragId)?.fields
          : auftragDefaults}
        recordId={editAuftragId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />
      <AuftragspositionenDialog
        open={positionDialogOpen}
        onClose={() => setPositionDialogOpen(false)}
        onSubmit={async fields => {
          if (editPositionId) {
            await LivingAppsService.updateAuftragspositionenEntry(editPositionId, fields as any);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={editPositionId
          ? auftragspositionen.find(p => p.record_id === editPositionId)?.fields
          : positionDefaults}
        recordId={editPositionId}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />
      <PruefprotokollDialog
        open={pruefDialogOpen}
        onClose={() => setPruefDialogOpen(false)}
        onSubmit={async fields => {
          if (editPruefId) {
            await LivingAppsService.updatePruefprotokollEntry(editPruefId, fields as any);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields as any);
          }
          fetchAll();
        }}
        defaultValues={editPruefId
          ? pruefprotokoll.find(p => p.record_id === editPruefId)?.fields
          : pruefDefaults}
        recordId={editPruefId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />
    </>
  );
}
