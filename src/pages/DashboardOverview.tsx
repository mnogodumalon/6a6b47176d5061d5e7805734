import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege, EnrichedAuftragspositionen, EnrichedPruefprotokoll } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
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
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconAlertTriangle, IconPlus, IconClipboardCheck } from '@tabler/icons-react';

// ─── Overlay union type ──────────────────────────────────────────────────────

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
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
  return 'warning'; // offen
}

function toneForPrioritaet(prioritaet: string | undefined): KanbanTone {
  if (prioritaet === 'dringend') return 'destructive';
  if (prioritaet === 'hoch') return 'warning';
  return 'default';
}

export default function DashboardOverview() {
  const {
    kunden, setKunden, material, auftraege, setAuftraege, auftragspositionen, pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

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

  const overlay = useRecordOverlayStack<OverlayItem>();

  // ─── Dialog state ───────────────────────────────────────────────────────────
  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftragId, setEditingAuftragId] = useState<string | undefined>(undefined);

  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [posDefaults, setPosDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosId, setEditingPosId] = useState<string | undefined>(undefined);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruefId, setEditingPruefId] = useState<string | undefined>(undefined);

  const [kundenDialogOpen, setKundenDialogOpen] = useState(false);

  // ─── KPIs ───────────────────────────────────────────────────────────────────
  const offene = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen'), [enrichedAuftraege]);
  const inBearbeitung = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung'), [enrichedAuftraege]);
  const dringend = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend'), [enrichedAuftraege]);
  const abgeschlossen = useMemo(() => enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen'), [enrichedAuftraege]);

  // ─── Worklist: offene + dringende Aufträge ──────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const worklistItems = useMemo(() => {
    let items = enrichedAuftraege.filter(a => {
      const st = lookupKey(a.fields.status);
      return st === 'offen' || st === 'in_bearbeitung';
    });
    if (statusFilter === 'dringend') {
      items = items.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');
    }
    return items.sort((a, b) => {
      const prio = { dringend: 0, hoch: 1, normal: 2, niedrig: 3 };
      return (prio[lookupKey(a.fields.prioritaet) as keyof typeof prio] ?? 2)
        - (prio[lookupKey(b.fields.prioritaet) as keyof typeof prio] ?? 2);
    });
  }, [enrichedAuftraege, statusFilter]);

  // ─── Hero: dringende offene Aufträge ────────────────────────────────────────
  const dringendeOffen = useMemo(() =>
    enrichedAuftraege.filter(a =>
      lookupKey(a.fields.status) === 'offen' &&
      lookupKey(a.fields.prioritaet) === 'dringend',
    ),
  [enrichedAuftraege]);

  // ─── Advance status helper ───────────────────────────────────────────────────
  const advanceStatus = useCallback(async (auftrag: EnrichedAuftraege) => {
    const current = lookupKey(auftrag.fields.status);
    const next = current === 'offen' ? 'in_bearbeitung' : current === 'in_bearbeitung' ? 'abgeschlossen' : null;
    if (!next) return;
    const nextLabel = COLUMNS.find(c => c.key === next)?.label ?? next;
    const prevStatus = auftrag.fields.status;
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
        setAuftraege(prev =>
          prev.map(a =>
            a.record_id === auftrag.record_id
              ? { ...a, fields: { ...a.fields, status: prevStatus } }
              : a,
          ),
        );
        await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, {
          status: lookupKey(prevStatus) ?? current,
        });
      });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── Kanban cards ───────────────────────────────────────────────────────────
  const cards = useMemo<KanbanCard[]>(
    () =>
      enrichedAuftraege.map(a => {
        const status = lookupKey(a.fields.status) ?? COLUMNS[0]?.key ?? '';
        const prioritaet = lookupKey(a.fields.prioritaet);
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: a.fields.auftragsnummer ?? 'Ohne Nr.',
          subtitle: a.kundeName
            ? `${a.kundeName}${a.fields.wunschtermin ? ' · ' + formatDate(a.fields.wunschtermin) : ''}`
            : a.fields.wunschtermin ? formatDate(a.fields.wunschtermin) : undefined,
          tone: prioritaet === 'dringend' ? 'destructive' : toneForStatus(status),
        };
      }),
    [enrichedAuftraege],
  );

  // ─── Move card ──────────────────────────────────────────────────────────────
  const moveCard = useCallback(async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const newLabel = COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const auftrag = auftraege.find(a => a.record_id === rid);
    const prevStatus = auftrag?.fields.status;
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
        setAuftraege(prev =>
          prev.map(a =>
            a.record_id === rid
              ? { ...a, fields: { ...a.fields, status: prevStatus } }
              : a,
          ),
        );
        if (prevStatus) {
          await LivingAppsService.updateAuftraegeEntry(rid, {
            status: lookupKey(prevStatus) ?? newColumn,
          });
        }
      });
    } catch {
      fetchAll();
    }
  }, [auftraege, setAuftraege, fetchAll]);

  // ─── Early returns AFTER all hooks ──────────────────────────────────────────
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Context line ────────────────────────────────────────────────────────────
  const offeneNamen = namen(offene.map(a => a.kundeName).filter(Boolean));
  const contextLine = enrichedAuftraege.length === 0
    ? 'Starte deinen ersten Auftrag — lege los!'
    : offene.length > 0
    ? `${offene.length} offene Aufträge${offeneNamen ? ` von ${offeneNamen}` : ''} warten auf Bearbeitung.`
    : inBearbeitung.length > 0
    ? `${inBearbeitung.length} Aufträge in Bearbeitung — alles läuft.`
    : 'Alle Aufträge erledigt — super Arbeit!';

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          dringendeOffen.length > 0 && (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: 'In Bearbeitung setzen',
                onClick: () => advanceStatus(dringendeOffen[0]),
              }}
            >
              <b>{namen(dringendeOffen.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
              {dringendeOffen.length === 1
                ? ` — dringender Auftrag (${dringendeOffen[0].fields.auftragsnummer ?? 'ohne Nr.'}) wartet auf Bearbeitung.`
                : ` — ${dringendeOffen.length} dringende Aufträge warten auf Bearbeitung.`}
            </HeroBanner>
          )
        }
        kpis={
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
              value={dringend.length}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
              onClick={() => setStatusFilter(f => f === 'dringend' ? null : 'dringend')}
              active={statusFilter === 'dringend'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={abgeschlossen.length}
              tone="default"
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id.split(':')[1] ?? '' })}
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
              title="Offen & Dringend"
              items={worklistItems.slice(0, 8).map(a => {
                const st = lookupKey(a.fields.status);
                const prio = lookupKey(a.fields.prioritaet);
                const nextLabel = st === 'offen' ? 'In Bearbeitung' : st === 'in_bearbeitung' ? 'Abschließen' : null;
                return {
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? 'Ohne Nr.',
                  secondLine: (
                    <>
                      <span className={prio === 'dringend' ? 'font-medium text-destructive' : prio === 'hoch' ? 'font-medium text-warning' : 'text-muted-foreground'}>
                        {a.fields.status?.label ?? st}
                      </span>
                      {a.kundeName && (
                        <span className="text-muted-foreground"> · {a.kundeName}</span>
                      )}
                    </>
                  ),
                  action: nextLabel ? {
                    label: `→ ${nextLabel}`,
                    onClick: () => advanceStatus(a),
                  } : undefined,
                };
              })}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: abgeschlossen.length > 0
                  ? `Alle ${enrichedAuftraege.length} Aufträge erledigt — top!`
                  : 'Noch keine Aufträge — erstelle den ersten.',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Zuletzt geprüft"
              items={enrichedPruefprotokoll
                .sort((a, b) => (b.fields.pruefungsdatum ?? '').localeCompare(a.fields.pruefungsdatum ?? ''))
                .slice(0, 5)
                .map(p => {
                  const ergebnis = lookupKey(p.fields.pruefergebnis);
                  return {
                    id: p.record_id,
                    title: `${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim() || 'Ohne Name',
                    secondLine: (
                      <>
                        <span className={ergebnis === 'nicht_bestanden' ? 'font-medium text-destructive' : ergebnis === 'bestanden_mit_maengeln' ? 'font-medium text-warning' : 'text-muted-foreground'}>
                          {p.fields.pruefergebnis?.label ?? '—'}
                        </span>
                        {p.auftrag_pruefName && (
                          <span className="text-muted-foreground"> · {p.auftrag_pruefName}</span>
                        )}
                      </>
                    ),
                  };
                })}
              onItemClick={id => overlay.replace({ type: 'pruefprotokoll', id })}
              empty={{
                text: 'Noch keine Prüfprotokolle vorhanden.',
                action: {
                  label: 'Prüfprotokoll erstellen',
                  onClick: () => { setPruefDefaults(undefined); setEditingPruefId(undefined); setPruefDialogOpen(true); },
                },
              }}
            />
          </>
        }
      />

      {/* ─── Record Overlay Host ─────────────────────────────────────────────── */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (!rec) return null;
            const st = lookupKey(rec.fields.status);
            const nextLabel = st === 'offen' ? 'In Bearbeitung' : st === 'in_bearbeitung' ? 'Abschließen' : null;
            return (
              <>
                <RecordHeader
                  title={rec.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={rec.fields.status?.label}
                  badges={rec.fields.prioritaet && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      lookupKey(rec.fields.prioritaet) === 'dringend' ? 'bg-destructive/10 text-destructive' :
                      lookupKey(rec.fields.prioritaet) === 'hoch' ? 'bg-warning/10 text-warning' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {rec.fields.prioritaet.label}
                    </span>
                  )}
                />
                <AuftraegeDetails
                  record={rec}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={ap => overlay.push({ type: 'auftragsposition', id: ap.record_id })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ auftrag: rec.record_id });
                    setEditingPosId(undefined);
                    setPosDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={pp => overlay.push({ type: 'pruefprotokoll', id: pp.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: rec.record_id });
                    setEditingPruefId(undefined);
                    setPruefDialogOpen(true);
                  }}
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
                  title={rec.fields.positionsbeschreibung ?? 'Position'}
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
            const rec = pruefprotokoll.find(p => p.record_id === top.id);
            if (!rec) return null;
            const auftragRec = auftraege.find(a => a.record_id === extractRecordId(rec.fields.auftrag_pruef));
            return (
              <>
                <RecordHeader
                  title={`${rec.fields.monteur_name_vorname ?? ''} ${rec.fields.monteur_name_nachname ?? ''}`.trim() || 'Prüfprotokoll'}
                  subtitle={auftragRec?.fields.auftragsnummer}
                  badges={rec.fields.pruefergebnis && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      lookupKey(rec.fields.pruefergebnis) === 'nicht_bestanden' ? 'bg-destructive/10 text-destructive' :
                      lookupKey(rec.fields.pruefergebnis) === 'bestanden_mit_maengeln' ? 'bg-warning/10 text-warning' :
                      'bg-success/10 text-success'
                    }`}>
                      {rec.fields.pruefergebnis.label}
                    </span>
                  )}
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
                    setAuftraegeDefaults({ kunde: rec.record_id });
                    setEditingAuftragId(undefined);
                    setAuftraegeDialogOpen(true);
                  }}
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
                  title={rec.fields.bezeichnung ?? 'Material'}
                  subtitle={rec.fields.artikelnummer}
                />
                <MaterialDetails
                  record={rec}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={ap => overlay.push({ type: 'auftragsposition', id: ap.record_id })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ material: rec.record_id });
                    setEditingPosId(undefined);
                    setPosDialogOpen(true);
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
            const st = lookupKey(rec.fields.status);
            const nextLabel = st === 'offen' ? 'In Bearbeitung' : st === 'in_bearbeitung' ? 'Abschließen' : null;
            if (!nextLabel) return undefined;
            return {
              label: nextLabel,
              onClick: () => {
                const enriched = enrichedAuftraege.find(a => a.record_id === top.id);
                if (enriched) advanceStatus(enriched);
              },
            };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const rec = auftraege.find(a => a.record_id === top.id);
            if (rec) {
              setAuftraegeDefaults(rec.fields as AuftraegeDialogDefaults);
              setEditingAuftragId(rec.record_id);
              setAuftraegeDialogOpen(true);
            }
          } else if (top.type === 'auftragsposition') {
            const rec = auftragspositionen.find(ap => ap.record_id === top.id);
            if (rec) {
              setPosDefaults(rec.fields as AuftragspositionenDialogDefaults);
              setEditingPosId(rec.record_id);
              setPosDialogOpen(true);
            }
          } else if (top.type === 'pruefprotokoll') {
            const rec = pruefprotokoll.find(p => p.record_id === top.id);
            if (rec) {
              setPruefDefaults(rec.fields as PruefprotokollDialogDefaults);
              setEditingPruefId(rec.record_id);
              setPruefDialogOpen(true);
            }
          }
        }}
      />

      {/* ─── Dialogs ────────────────────────────────────────────────────────── */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => { setAuftraegeDialogOpen(false); setEditingAuftragId(undefined); setAuftraegeDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingAuftragId) {
            await LivingAppsService.updateAuftraegeEntry(editingAuftragId, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={auftraegeDefaults}
        recordId={editingAuftragId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={posDialogOpen}
        onClose={() => { setPosDialogOpen(false); setEditingPosId(undefined); setPosDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingPosId) {
            await LivingAppsService.updateAuftragspositionenEntry(editingPosId, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
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
        onClose={() => { setPruefDialogOpen(false); setEditingPruefId(undefined); setPruefDefaults(undefined); }}
        onSubmit={async fields => {
          if (editingPruefId) {
            await LivingAppsService.updatePruefprotokollEntry(editingPruefId, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={pruefDefaults}
        recordId={editingPruefId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundenDialogOpen}
        onClose={() => setKundenDialogOpen(false)}
        onSubmit={async fields => {
          await LivingAppsService.createKundenEntry(fields);
          fetchAll();
        }}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
