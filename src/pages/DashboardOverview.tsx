import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { KanbanWidget, type KanbanCard, type KanbanColumn } from '@/components/widgets/KanbanWidget';
import {
  useRecordOverlayStack,
  RecordOverlayHost,
  RecordHeader,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import {
  IconAlertTriangle,
  IconPlus,
  IconClipboardList,
  IconCheck,
} from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string };

export default function DashboardOverview() {
  const {
    kunden, setKunden,
    material,
    auftraege, setAuftraege,
    auftragspositionen, setAuftragspositionen,
    pruefprotokoll,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

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

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialog, setAuftragDialog] = useState<{
    open: boolean;
    defaults?: AuftraegeDialogDefaults;
    editId?: string;
  }>({ open: false });

  const [posDialog, setPosDialog] = useState<{
    open: boolean;
    defaults?: AuftragspositionenDialogDefaults;
    editId?: string;
  }>({ open: false });

  const [pruefDialog, setPruefDialog] = useState<{
    open: boolean;
    defaults?: PruefprotokollDialogDefaults;
    editId?: string;
  }>({ open: false });

  const [kundeDialog, setKundeDialog] = useState<{
    open: boolean;
    editId?: string;
  }>({ open: false });

  // Status advance helper
  const advanceStatus = useCallback(async (a: EnrichedAuftraege) => {
    const statusMap: Record<string, string> = {
      offen: 'in_bearbeitung',
      in_bearbeitung: 'abgeschlossen',
    };
    const current = lookupKey(a.fields.status);
    if (!current || !statusMap[current]) return;
    const nextKey = statusMap[current];
    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextKey)?.label ?? nextKey;
    const prev = a.fields.status;
    // Optimistic update
    setAuftraege(prev2 =>
      prev2.map(r =>
        r.record_id === a.record_id
          ? { ...r, fields: { ...r.fields, status: { key: nextKey, label: nextLabel } } }
          : r
      )
    );
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: nextKey });
      undoToast(`Auftrag ${a.fields.auftragsnummer ?? ''} → ${nextLabel}`, async () => {
        setAuftraege(prev2 =>
          prev2.map(r =>
            r.record_id === a.record_id
              ? { ...r, fields: { ...r.fields, status: prev } }
              : r
          )
        );
        await LivingAppsService.updateAuftraegeEntry(a.record_id, {
          status: typeof prev === 'object' && prev ? (prev as { key: string }).key : (prev as unknown as string),
        });
      });
    } catch {
      fetchAll();
    }
  }, [setAuftraege, fetchAll]);

  // ─── Every hook goes ABOVE this line ───
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only ───

  const today = format(clock, 'yyyy-MM-dd');

  const offene = enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'offen');
  const inBearbeitung = enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung');
  const abgeschlossen = enrichedAuftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen');
  const dringend = enrichedAuftraege.filter(a => lookupKey(a.fields.prioritaet) === 'dringend');

  // Dringende offene Aufträge = Hero signal
  const dringendOffen = dringend.filter(a => lookupKey(a.fields.status) === 'offen');

  // WorkList: heute fällig oder Wunschtermin heute
  const heuteFaellig = enrichedAuftraege
    .filter(a => {
      const wt = a.fields.wunschtermin;
      const lt = a.fields.liefertermin;
      return (wt && wt.startsWith(today)) || (lt && lt.startsWith(today));
    })
    .sort((a, b) => (a.fields.wunschtermin ?? '').localeCompare(b.fields.wunschtermin ?? ''));

  // Context line
  const aktiveMonteure = [...new Set(
    inBearbeitung.filter(a => a.fields.monteur).map(a => a.fields.monteur!)
  )];
  const kontextLine = inBearbeitung.length > 0
    ? `${inBearbeitung.length} Aufträge in Bearbeitung${aktiveMonteure.length > 0 ? ' — Monteure: ' + namen(aktiveMonteure) : ''}.`
    : offene.length > 0
      ? `${offene.length} neue Aufträge warten auf Bearbeitung.`
      : 'Keine offenen Aufträge — alles abgearbeitet.';

  // Kanban columns
  const statusOptions = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
  const columns: KanbanColumn[] = statusOptions.map(o => ({ key: o.key, label: o.label }));

  const cards: KanbanCard[] = enrichedAuftraege.map(a => {
    const status = lookupKey(a.fields.status);
    const prio = lookupKey(a.fields.prioritaet);
    const tone =
      prio === 'dringend' ? ('destructive' as const) :
      prio === 'hoch' ? ('warning' as const) :
      status === 'abgeschlossen' ? ('success' as const) :
      ('default' as const);
    return {
      id: a.record_id,
      column: status ?? '',
      title: a.fields.auftragsnummer ?? '—',
      subtitle: a.kundeName
        ? `${a.kundeName}${a.fields.wunschtermin ? ' · ' + formatDate(a.fields.wunschtermin) : ''}`
        : a.fields.wunschtermin ? formatDate(a.fields.wunschtermin) : undefined,
      tone,
    };
  });

  const handleCardMove = async (cardId: string, newColumn: string) => {
    const auftr = auftraege.find(a => a.record_id === cardId);
    if (!auftr) return;
    const newLabel = statusOptions.find(o => o.key === newColumn)?.label ?? newColumn;
    const oldStatus = auftr.fields.status;
    // Optimistic update
    setAuftraege(prev =>
      prev.map(r =>
        r.record_id === cardId
          ? { ...r, fields: { ...r.fields, status: { key: newColumn, label: newLabel } } }
          : r
      )
    );
    try {
      await LivingAppsService.updateAuftraegeEntry(cardId, { status: newColumn });
      undoToast(`Auftrag → ${newLabel}`, async () => {
        setAuftraege(prev =>
          prev.map(r =>
            r.record_id === cardId
              ? { ...r, fields: { ...r.fields, status: oldStatus } }
              : r
          )
        );
        await LivingAppsService.updateAuftraegeEntry(cardId, {
          status: typeof oldStatus === 'object' && oldStatus ? (oldStatus as { key: string }).key : (oldStatus as unknown as string),
        });
      });
    } catch {
      fetchAll();
    }
  };

  // Find records for overlay
  const findAuftrag = (id: string) => auftraege.find(a => a.record_id === id);
  const findKunde = (id: string) => kunden.find(k => k.record_id === id);
  const findPosition = (id: string) => auftragspositionen.find(p => p.record_id === id);
  const findPruef = (id: string) => pruefprotokoll.find(p => p.record_id === id);

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)} Handwerk Pro</h1>
          <p className="text-muted-foreground mt-1">{kontextLine}</p>
        </div>
        <button
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          onClick={() => setAuftragDialog({ open: true })}
        >
          <IconPlus size={16} className="shrink-0" />
          <span className="hidden sm:inline">Neuer Auftrag</span>
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          dringendOffen.length > 0 ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: 'In Bearbeitung setzen',
                onClick: () => advanceStatus(dringendOffen[0]),
              }}
            >
              <b>{namen(dringendOffen.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
              {' '}
              {dringendOffen.length === 1
                ? `— dringender Auftrag wartet auf Bearbeitung (${dringendOffen[0].fields.auftragsnummer}).`
                : `— ${dringendOffen.length} dringende Aufträge warten auf Bearbeitung.`}
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
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={abgeschlossen.length}
              icon={<IconCheck size={16} />}
              tone={abgeschlossen.length > 0 ? 'success' : 'default'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={columns}
            cards={cards}
            defaultCollapsed={['storniert']}
            onCardClick={card => overlay.replace({ type: 'auftrag', id: card.id })}
            onCardMove={handleCardMove}
            onAddCard={columnKey =>
              setAuftragDialog({ open: true, defaults: { status: columnKey } })
            }
          />
        }
        aside={
          <>
            <WorkList
              title="Heute fällig"
              items={heuteFaellig.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? '—',
                secondLine: (
                  <>
                    <span className="text-muted-foreground">{a.kundeName || '—'}</span>
                    {a.fields.wunschtermin && (
                      <span className="text-muted-foreground"> · {formatDate(a.fields.wunschtermin)}</span>
                    )}
                  </>
                ),
                action:
                  lookupKey(a.fields.status) === 'offen' || lookupKey(a.fields.status) === 'in_bearbeitung'
                    ? { label: '→ Weiter', onClick: () => advanceStatus(a) }
                    : undefined,
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Keine Aufträge heute fällig',
                action: { label: 'Auftrag anlegen', onClick: () => setAuftragDialog({ open: true }) },
              }}
            />
            <WorkList
              title="Kürzlich abgeschlossen"
              items={abgeschlossen
                .slice()
                .sort((a, b) => (b.fields.liefertermin ?? b.createdat).localeCompare(a.fields.liefertermin ?? a.createdat))
                .slice(0, 5)
                .map(a => ({
                  id: a.record_id,
                  title: a.fields.auftragsnummer ?? '—',
                  secondLine: (
                    <>
                      <span className="font-medium text-success">Abgeschlossen</span>
                      <span className="text-muted-foreground"> · {a.kundeName || '—'}</span>
                    </>
                  ),
                }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{ text: 'Noch keine abgeschlossenen Aufträge' }}
            />
          </>
        }
      />

      {/* Single overlay host for the whole stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = findAuftrag(top.id);
            if (!a) return null;
            const status = lookupKey(a.fields.status);
            const kundeId = extractRecordId(a.fields.kunde);
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? '—'}
                  subtitle={a.fields.auftragsbeschreibung}
                  badges={
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                      {a.fields.status?.label ?? '—'}
                    </span>
                  }
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'auftragsposition', id: p.record_id })}
                  onAddAuftragspositionen={() =>
                    setPosDialog({
                      open: true,
                      defaults: { auftrag: top.id },
                    })
                  }
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruefprotokoll', id: p.record_id })}
                  onAddPruefprotokoll={() =>
                    setPruefDialog({
                      open: true,
                      defaults: { auftrag_pruef: top.id },
                    })
                  }
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const p = findPosition(top.id);
            if (!p) return null;
            const auftragId = extractRecordId(p.fields.auftrag);
            const matId = extractRecordId(p.fields.material);
            return (
              <>
                <RecordHeader title={p.fields.positionsbeschreibung ?? 'Position'} />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const p = findPruef(top.id);
            if (!p) return null;
            return (
              <>
                <RecordHeader
                  title={`Prüfprotokoll — ${p.fields.monteur_name_vorname ?? ''} ${p.fields.monteur_name_nachname ?? ''}`.trim()}
                  subtitle={formatDate(p.fields.pruefungsdatum)}
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
            const k = findKunde(top.id);
            if (!k) return null;
            return (
              <>
                <RecordHeader
                  title={`${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim()}
                  subtitle={k.fields.firma}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  onAddAuftraege={() =>
                    setAuftragDialog({ open: true, defaults: { kunde: top.id } })
                  }
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = findAuftrag(top.id);
            if (!a) return undefined;
            const status = lookupKey(a.fields.status);
            if (status === 'offen') return { label: 'In Bearbeitung setzen', onClick: () => advanceStatus(enrichedAuftraege.find(e => e.record_id === top.id)!) };
            if (status === 'in_bearbeitung') return { label: 'Als abgeschlossen markieren', onClick: () => advanceStatus(enrichedAuftraege.find(e => e.record_id === top.id)!) };
            return undefined;
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = findAuftrag(top.id);
            if (a) setAuftragDialog({ open: true, defaults: a.fields as AuftraegeDialogDefaults, editId: top.id });
          } else if (top.type === 'auftragsposition') {
            const p = findPosition(top.id);
            if (p) setPosDialog({ open: true, defaults: p.fields as AuftragspositionenDialogDefaults, editId: top.id });
          } else if (top.type === 'pruefprotokoll') {
            const p = findPruef(top.id);
            if (p) setPruefDialog({ open: true, defaults: p.fields as PruefprotokollDialogDefaults, editId: top.id });
          } else if (top.type === 'kunde') {
            const k = findKunde(top.id);
            if (k) setKundeDialog({ open: true, editId: top.id });
          }
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialog.open}
        onClose={() => setAuftragDialog({ open: false })}
        onSubmit={async fields => {
          if (auftragDialog.editId) {
            await LivingAppsService.updateAuftraegeEntry(auftragDialog.editId, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={auftragDialog.defaults}
        recordId={auftragDialog.editId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={posDialog.open}
        onClose={() => setPosDialog({ open: false })}
        onSubmit={async fields => {
          if (posDialog.editId) {
            await LivingAppsService.updateAuftragspositionenEntry(posDialog.editId, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={posDialog.defaults}
        recordId={posDialog.editId}
        auftraegeList={auftraege}
        materialList={material}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <PruefprotokollDialog
        open={pruefDialog.open}
        onClose={() => setPruefDialog({ open: false })}
        onSubmit={async fields => {
          if (pruefDialog.editId) {
            await LivingAppsService.updatePruefprotokollEntry(pruefDialog.editId, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={pruefDialog.defaults}
        recordId={pruefDialog.editId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />

      <KundenDialog
        open={kundeDialog.open}
        onClose={() => setKundeDialog({ open: false })}
        onSubmit={async fields => {
          if (kundeDialog.editId) {
            await LivingAppsService.updateKundenEntry(kundeDialog.editId, fields);
          } else {
            await LivingAppsService.createKundenEntry(fields);
          }
          fetchAll();
        }}
        recordId={kundeDialog.editId}
        enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
      />
    </>
  );
}
