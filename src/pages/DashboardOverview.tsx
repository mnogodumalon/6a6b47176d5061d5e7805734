import { useState, useMemo } from 'react';
import { format, isBefore, isToday, parseISO, isAfter, addDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { KanbanWidget } from '@/components/widgets/KanbanWidget';
import type { KanbanCard, KanbanColumn } from '@/components/widgets/KanbanWidget';
import {
  RecordOverlayHost,
  RecordHeader,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import { AuftraegeDetails } from '@/components/details/AuftraegeDetails';
import { AuftragspositionenDetails } from '@/components/details/AuftragspositionenDetails';
import { KundenDetails } from '@/components/details/KundenDetails';
import { PruefprotokollDetails } from '@/components/details/PruefprotokollDetails';
import { MaterialDetails } from '@/components/details/MaterialDetails';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import type { AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import type { AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import type { PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconAlertTriangle, IconPlus, IconCheck, IconClipboardList } from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; record: EnrichedAuftraege }
  | { type: 'auftragsposition'; record: Auftragspositionen }
  | { type: 'kunde'; record: Kunden }
  | { type: 'pruefprotokoll'; record: Pruefprotokoll }
  | { type: 'material'; record: Material };

export default function DashboardOverview() {
  const {
    kunden, material, auftraege, setAuftraege, auftragspositionen, pruefprotokoll,
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
  const _enrichedPruefprotokoll = useMemo(
    () => enrichPruefprotokoll(pruefprotokoll, { auftraegeMap }),
    [pruefprotokoll, auftraegeMap]
  );

  const overlay = useRecordOverlayStack<OverlayItem>();

  // Dialog state
  const [auftragDialog, setAuftragDialog] = useState<{
    open: boolean;
    defaults?: AuftraegeDialogDefaults;
    recordId?: string;
  }>({ open: false });

  const [positionDialog, setPositionDialog] = useState<{
    open: boolean;
    defaults?: AuftragspositionenDialogDefaults;
    recordId?: string;
  }>({ open: false });

  const [pruefDialog, setPruefDialog] = useState<{
    open: boolean;
    defaults?: PruefprotokollDialogDefaults;
    recordId?: string;
  }>({ open: false });

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // ─── Every hook goes ABOVE this line ───
  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;
  // ─── Below this line: plain derivations only, no hooks. ───

  const today = format(clock, 'yyyy-MM-dd');

  // Derived KPI values
  const offene = enrichedAuftraege.filter(a => a.fields.status?.key === 'offen');
  const inBearbeitung = enrichedAuftraege.filter(a => a.fields.status?.key === 'in_bearbeitung');
  const dringend = enrichedAuftraege.filter(a => a.fields.prioritaet?.key === 'dringend');

  const ueberfaellig = enrichedAuftraege.filter(a => {
    if (a.fields.status?.key === 'abgeschlossen' || a.fields.status?.key === 'storniert') return false;
    const lt = a.fields.liefertermin;
    if (!lt) return false;
    try { return isBefore(parseISO(lt), parseISO(today)); } catch { return false; }
  });

  const faelligHeute = enrichedAuftraege.filter(a => {
    if (a.fields.status?.key === 'abgeschlossen' || a.fields.status?.key === 'storniert') return false;
    const lt = a.fields.liefertermin;
    if (!lt) return false;
    try { return isToday(parseISO(lt)); } catch { return false; }
  });

  const naechsteWoche = enrichedAuftraege.filter(a => {
    if (a.fields.status?.key === 'abgeschlossen' || a.fields.status?.key === 'storniert') return false;
    const lt = a.fields.liefertermin;
    if (!lt) return false;
    try {
      const d = parseISO(lt);
      const now = parseISO(today);
      return isAfter(d, now) && isBefore(d, addDays(now, 7));
    } catch { return false; }
  });

  // Advance status helper (plain function — not passed to memoized children)
  const advanceStatus = async (auftrag: EnrichedAuftraege) => {
    const currentKey = auftrag.fields.status?.key;
    const nextKey =
      currentKey === 'offen' ? 'in_bearbeitung'
      : currentKey === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!nextKey) return;
    const nextLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === nextKey)?.label ?? nextKey;
    const prevStatus = auftrag.fields.status;
    // Optimistic update
    setAuftraege(prev => prev.map(a =>
      a.record_id === auftrag.record_id
        ? { ...a, fields: { ...a.fields, status: { key: nextKey, label: nextLabel } } }
        : a
    ));
    undoToast(`Status: ${nextLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === auftrag.record_id
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: prevStatus?.key });
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: nextKey });
    } catch {
      await fetchAll();
    }
  };

  // Kanban columns
  const columns: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
    key: o.key,
    label: o.label,
    tone: o.key === 'abgeschlossen' ? 'success'
      : o.key === 'storniert' ? 'default'
      : o.key === 'dringend' ? 'destructive'
      : 'default',
  }));

  // Kanban cards
  const filteredAuftraege = statusFilter
    ? enrichedAuftraege.filter(a => a.fields.status?.key === statusFilter)
    : enrichedAuftraege;

  const cards: KanbanCard[] = filteredAuftraege
    .sort((a, b) => {
      const pa = a.fields.prioritaet?.key === 'dringend' ? 0 : a.fields.prioritaet?.key === 'hoch' ? 1 : 2;
      const pb = b.fields.prioritaet?.key === 'dringend' ? 0 : b.fields.prioritaet?.key === 'hoch' ? 1 : 2;
      return pa - pb;
    })
    .map(a => ({
      id: `auftrag:${a.record_id}`,
      column: a.fields.status?.key ?? '',
      title: a.fields.auftragsnummer ?? '—',
      subtitle: a.kundeName
        ? `${a.kundeName}${a.fields.liefertermin ? ' · ' + formatDate(a.fields.liefertermin) : ''}`
        : a.fields.liefertermin ? formatDate(a.fields.liefertermin) : undefined,
      tone: a.fields.prioritaet?.key === 'dringend' ? 'destructive'
        : a.fields.prioritaet?.key === 'hoch' ? 'warning'
        : 'default',
    }));

  const handleCardMove = async (cardId: string, newColumn: string) => {
    const recordId = cardId.split(':')[1];
    const auftrag = auftraege.find(a => a.record_id === recordId);
    if (!auftrag) return;
    const newLabel = LOOKUP_OPTIONS['auftraege']?.['status']?.find(o => o.key === newColumn)?.label ?? newColumn;
    const prevStatus = auftrag.fields.status;
    setAuftraege(prev => prev.map(a =>
      a.record_id === recordId
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    undoToast(`Verschoben nach: ${newLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === recordId
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      await LivingAppsService.updateAuftraegeEntry(recordId, { status: prevStatus?.key });
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(recordId, { status: newColumn });
    } catch {
      await fetchAll();
    }
  };

  const handleCardClick = (card: KanbanCard) => {
    const recordId = card.id.split(':')[1];
    const auftrag = enrichedAuftraege.find(a => a.record_id === recordId);
    if (auftrag) overlay.replace({ type: 'auftrag', record: auftrag });
  };

  const handleAddCard = (column: string) => {
    setAuftragDialog({ open: true, defaults: { status: column } });
  };

  // Context line
  const dringendNames = namen(dringend.map(a => a.kundeName || a.fields.auftragsnummer || ''));
  const contextLine = dringend.length > 0
    ? `${dringend.length} dringende Aufträge — ${dringendNames}.`
    : ueberfaellig.length > 0
    ? `${ueberfaellig.length} überfällige Aufträge. Sofortige Bearbeitung empfohlen.`
    : offene.length > 0
    ? `${offene.length} offene Aufträge, ${inBearbeitung.length} in Bearbeitung.`
    : 'Alle Aufträge im Zeitplan. ';

  // Hero: überfällige Aufträge
  const heroAuftrag = ueberfaellig[0];

  // WorkList: fällig heute + überfällig
  const workItems = [...ueberfaellig, ...faelligHeute.filter(a => !ueberfaellig.includes(a))]
    .slice(0, 8)
    .map(a => ({
      id: a.record_id,
      title: a.fields.auftragsnummer ?? '—',
      secondLine: (
        <span>
          <span className={ueberfaellig.includes(a) ? 'font-medium text-destructive' : 'font-medium text-warning'}>
            {ueberfaellig.includes(a) ? 'Überfällig' : 'Heute fällig'}
          </span>
          {a.fields.liefertermin && (
            <span className="text-muted-foreground"> · {formatDateTime(a.fields.liefertermin)}</span>
          )}
          {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
        </span>
      ),
      action: a.fields.status?.key !== 'abgeschlossen' && a.fields.status?.key !== 'storniert'
        ? {
            label: a.fields.status?.key === 'offen' ? '▶ Starten' : '✓ Fertig',
            onClick: () => { void advanceStatus(a); },
          }
        : undefined,
    }));

  // WorkList: nächste Woche
  const naechsteWocheItems = naechsteWoche
    .slice(0, 5)
    .map(a => ({
      id: a.record_id,
      title: a.fields.auftragsnummer ?? '—',
      secondLine: (
        <span>
          <span className="text-muted-foreground">
            {formatDate(a.fields.liefertermin)}
          </span>
          {a.kundeName && <span className="text-muted-foreground"> · {a.kundeName}</span>}
          {a.fields.prioritaet && (
            <span className={`ml-1 font-medium ${a.fields.prioritaet.key === 'hoch' ? 'text-warning' : 'text-muted-foreground'}`}>
              {a.fields.prioritaet.label}
            </span>
          )}
        </span>
      ),
    }));

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
            <p className="text-muted-foreground mt-1">{contextLine}</p>
          </div>
          <button
            onClick={() => setAuftragDialog({ open: true })}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            <IconPlus size={16} className="shrink-0" />
            Neuer Auftrag
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={ueberfaellig.length > 0 && heroAuftrag ? (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: heroAuftrag.fields.status?.key === 'offen' ? 'Auftrag starten' : 'Als erledigt markieren',
              onClick: () => void advanceStatus(heroAuftrag),
            }}
          >
            <b>{namen(ueberfaellig.map(a => a.kundeName || a.fields.auftragsnummer || ''))}</b>
            {ueberfaellig.length === 1
              ? ` — Liefertermin war ${formatDateTime(heroAuftrag.fields.liefertermin)}.`
              : ` — ${ueberfaellig.length} Aufträge überfällig.`}
          </HeroBanner>
        ) : undefined}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offene.length}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone={offene.length > 5 ? 'warning' : 'default'}
              onClick={() => setStatusFilter(f => f === 'offen' ? null : 'offen')}
              active={statusFilter === 'offen'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitung.length}
              tone={inBearbeitung.length > 0 ? 'primary' : 'default'}
              onClick={() => setStatusFilter(f => f === 'in_bearbeitung' ? null : 'in_bearbeitung')}
              active={statusFilter === 'in_bearbeitung'}
            />
            <StatStripItem
              title="Dringend"
              value={dringend.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={dringend.length > 0 ? 'destructive' : 'default'}
              onClick={() => setStatusFilter(f => f === null && dringend.length > 0 ? 'dringend_filter' : null)}
              active={false}
            />
            <StatStripItem
              title="Heute fällig"
              value={faelligHeute.length}
              icon={<IconCheck size={16} className="shrink-0" />}
              tone={faelligHeute.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            columns={columns}
            cards={cards}
            defaultCollapsed={['storniert']}
            onCardClick={handleCardClick}
            onCardMove={handleCardMove}
            onAddCard={handleAddCard}
          />
        }
        aside={
          <>
            <WorkList
              title="Heute fällig & überfällig"
              items={workItems}
              onItemClick={id => {
                const auftrag = enrichedAuftraege.find(a => a.record_id === id);
                if (auftrag) overlay.replace({ type: 'auftrag', record: auftrag });
              }}
              empty={{
                text: naechsteWoche.length > 0
                  ? `Nächster Termin: ${formatDate(naechsteWoche[0]?.fields.liefertermin)} — ${naechsteWoche[0]?.kundeName || naechsteWoche[0]?.fields.auftragsnummer || ''}`
                  : 'Keine fälligen Aufträge — alles im Zeitplan.',
                action: { label: 'Auftrag erstellen', onClick: () => setAuftragDialog({ open: true }) },
              }}
            />
            <WorkList
              title="Nächste 7 Tage"
              items={naechsteWocheItems}
              onItemClick={id => {
                const auftrag = enrichedAuftraege.find(a => a.record_id === id);
                if (auftrag) overlay.replace({ type: 'auftrag', record: auftrag });
              }}
              empty={{
                text: 'Keine Aufträge in den nächsten 7 Tagen.',
                action: { label: 'Auftrag planen', onClick: () => setAuftragDialog({ open: true }) },
              }}
            />
          </>
        }
      />

      {/* Overlay stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? '—'}
                  subtitle={a.kundeName || undefined}
                  badges={a.fields.status ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {a.fields.status.label}
                    </span>
                  ) : undefined}
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={r => overlay.push({ type: 'kunde', record: r })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={r => overlay.push({ type: 'auftragsposition', record: r })}
                  onAddAuftragspositionen={() => {
                    setPositionDialog({
                      open: true,
                      defaults: { auftrag: a.record_id },
                    });
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={r => overlay.push({ type: 'pruefprotokoll', record: r })}
                  onAddPruefprotokoll={() => {
                    setPruefDialog({
                      open: true,
                      defaults: { auftrag_pruef: a.record_id },
                    });
                  }}
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const pos = top.record;
            return (
              <>
                <RecordHeader title={pos.fields.positionsbeschreibung ?? '—'} />
                <AuftragspositionenDetails
                  record={pos}
                  auftraegeList={auftraege}
                  onOpenAuftraege={r => {
                    const enriched = enrichedAuftraege.find(a => a.record_id === r.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  materialList={material}
                  onOpenMaterial={r => overlay.push({ type: 'material', record: r })}
                />
              </>
            );
          }
          if (top.type === 'kunde') {
            const k = top.record;
            return (
              <>
                <RecordHeader
                  title={[k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '—'}
                  subtitle={k.fields.firma || undefined}
                />
                <KundenDetails
                  record={k}
                  auftraegeList={auftraege}
                  onOpenAuftraege={r => {
                    const enriched = enrichedAuftraege.find(a => a.record_id === r.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                  onAddAuftraege={() => setAuftragDialog({ open: true, defaults: { kunde: k.record_id } })}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const pp = top.record;
            return (
              <>
                <RecordHeader
                  title={[pp.fields.monteur_name_vorname, pp.fields.monteur_name_nachname].filter(Boolean).join(' ') || '—'}
                  subtitle={pp.fields.pruefungsdatum ? formatDateTime(pp.fields.pruefungsdatum) : undefined}
                />
                <PruefprotokollDetails
                  record={pp}
                  auftraegeList={auftraege}
                  onOpenAuftraege={r => {
                    const enriched = enrichedAuftraege.find(a => a.record_id === r.record_id);
                    if (enriched) overlay.push({ type: 'auftrag', record: enriched });
                  }}
                />
              </>
            );
          }
          if (top.type === 'material') {
            const m = top.record;
            return (
              <>
                <RecordHeader
                  title={m.fields.bezeichnung ?? '—'}
                  subtitle={m.fields.artikelnummer || undefined}
                />
                <MaterialDetails
                  record={m}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={r => overlay.push({ type: 'auftragsposition', record: r })}
                  onAddAuftragspositionen={() => setPositionDialog({ open: true, defaults: { material: m.record_id } })}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = top.record;
            const nextKey = a.fields.status?.key === 'offen' ? 'in_bearbeitung'
              : a.fields.status?.key === 'in_bearbeitung' ? 'abgeschlossen'
              : null;
            if (!nextKey) return undefined;
            const nextLabel = nextKey === 'in_bearbeitung' ? 'Auftrag starten' : 'Als erledigt markieren';
            return { label: nextLabel, onClick: () => void advanceStatus(a) };
          }
          return undefined;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            setAuftragDialog({ open: true, defaults: top.record.fields, recordId: top.record.record_id });
          }
        }}
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftragDialog.open}
        onClose={() => setAuftragDialog({ open: false })}
        onSubmit={async fields => {
          if (auftragDialog.recordId) {
            await LivingAppsService.updateAuftraegeEntry(auftragDialog.recordId, fields);
          } else {
            await LivingAppsService.createAuftraegeEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={auftragDialog.defaults}
        recordId={auftragDialog.recordId}
        kundenList={kunden}
        enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
      />

      <AuftragspositionenDialog
        open={positionDialog.open}
        onClose={() => setPositionDialog({ open: false })}
        onSubmit={async fields => {
          if (positionDialog.recordId) {
            await LivingAppsService.updateAuftragspositionenEntry(positionDialog.recordId, fields);
          } else {
            await LivingAppsService.createAuftragspositionenEntry(fields);
          }
          await fetchAll();
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
            await LivingAppsService.updatePruefprotokollEntry(pruefDialog.recordId, fields);
          } else {
            await LivingAppsService.createPruefprotokollEntry(fields);
          }
          await fetchAll();
        }}
        defaultValues={pruefDialog.defaults}
        recordId={pruefDialog.recordId}
        auftraegeList={auftraege}
        enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
      />
    </>
  );
}
