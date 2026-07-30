import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege, enrichAuftragspositionen, enrichPruefprotokoll } from '@/lib/enrich';
import type { EnrichedAuftraege } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Kunden, Material, Pruefprotokoll } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate, formatDateTime, lookupKey } from '@/lib/formatters';
import { DashboardSkeleton, DashboardError } from '@/components/DashboardStates';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
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
import { AuftraegeDialog, type AuftraegeDialogDefaults } from '@/components/dialogs/AuftraegeDialog';
import { AuftragspositionenDialog, type AuftragspositionenDialogDefaults } from '@/components/dialogs/AuftragspositionenDialog';
import { PruefprotokollDialog, type PruefprotokollDialogDefaults } from '@/components/dialogs/PruefprotokollDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { format } from 'date-fns';
import { IconAlertTriangle, IconPlus, IconClipboardList, IconPackage } from '@tabler/icons-react';

type OverlayItem =
  | { type: 'auftrag'; id: string }
  | { type: 'auftragsposition'; id: string }
  | { type: 'pruefprotokoll'; id: string }
  | { type: 'kunde'; id: string };

const STATUS_COLUMNS: KanbanColumn[] = (LOOKUP_OPTIONS['auftraege']?.['status'] ?? []).map(o => ({
  key: o.key,
  label: o.label,
}));

function toneForStatus(status: string | undefined): KanbanTone {
  if (status === 'abgeschlossen') return 'success';
  if (status === 'in_bearbeitung') return 'primary';
  if (status === 'storniert') return 'default';
  return 'warning'; // offen
}

export default function DashboardOverview() {
  const clock = useClock();

  const {
    kunden, material, auftraege, auftragspositionen, pruefprotokoll,
    setAuftraege,
    kundenMap, materialMap, auftraegeMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const overlay = useRecordOverlayStack<OverlayItem>();

  const [auftraegeDialogOpen, setAuftraegeDialogOpen] = useState(false);
  const [auftraegeDefaults, setAuftraegeDefaults] = useState<AuftraegeDialogDefaults | undefined>(undefined);
  const [editingAuftragId, setEditingAuftragId] = useState<string | undefined>(undefined);

  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [posDefaults, setPosDefaults] = useState<AuftragspositionenDialogDefaults | undefined>(undefined);
  const [editingPosId, setEditingPosId] = useState<string | undefined>(undefined);

  const [pruefDialogOpen, setPruefDialogOpen] = useState(false);
  const [pruefDefaults, setPruefDefaults] = useState<PruefprotokollDialogDefaults | undefined>(undefined);
  const [editingPruefId, setEditingPruefId] = useState<string | undefined>(undefined);

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

  const today = format(clock, 'yyyy-MM-dd');

  const dringend = useMemo(
    () => enrichedAuftraege.filter(a => {
      const sk = lookupKey(a.fields.status);
      if (sk === 'abgeschlossen' || sk === 'storniert') return false;
      const termin = a.fields.liefertermin ?? a.fields.wunschtermin;
      if (!termin) return false;
      return termin.slice(0, 10) <= today;
    }),
    [enrichedAuftraege, today]
  );

  const offenCount = useMemo(
    () => auftraege.filter(a => lookupKey(a.fields.status) === 'offen').length,
    [auftraege]
  );
  const inBearbeitungCount = useMemo(
    () => auftraege.filter(a => lookupKey(a.fields.status) === 'in_bearbeitung').length,
    [auftraege]
  );
  const abgeschlossenCount = useMemo(
    () => auftraege.filter(a => lookupKey(a.fields.status) === 'abgeschlossen').length,
    [auftraege]
  );

  const materialKnapp = useMemo(
    () => material.filter(m => {
      if (m.fields.lagerbestand == null || m.fields.mindestbestand == null) return false;
      return m.fields.lagerbestand < m.fields.mindestbestand;
    }),
    [material]
  );

  const cards = useMemo<KanbanCard[]>(
    () => enrichedAuftraege
      .slice()
      .sort((a, b) => (a.fields.auftragsdatum ?? '') < (b.fields.auftragsdatum ?? '') ? 1 : -1)
      .map(a => {
        const status = lookupKey(a.fields.status) ?? STATUS_COLUMNS[0]?.key ?? '';
        return {
          id: `auftrag:${a.record_id}`,
          column: status,
          title: a.fields.auftragsnummer ?? 'Auftrag',
          subtitle: a.kundeName ? `${a.kundeName}${a.fields.wunschtermin ? ' · ' + formatDate(a.fields.wunschtermin) : ''}` : formatDate(a.fields.wunschtermin),
          tone: toneForStatus(status),
        };
      }),
    [enrichedAuftraege]
  );

  const advanceStatus = async (a: EnrichedAuftraege) => {
    const sk = lookupKey(a.fields.status);
    const next = sk === 'offen' ? 'in_bearbeitung'
      : sk === 'in_bearbeitung' ? 'abgeschlossen'
      : null;
    if (!next) return;
    const nextLabel = STATUS_COLUMNS.find(c => c.key === next)?.label ?? next;
    const prevStatus = a.fields.status;
    setAuftraege(prev => prev.map(x =>
      x.record_id === a.record_id
        ? { ...x, fields: { ...x.fields, status: { key: next, label: nextLabel } } }
        : x
    ));
    undoToast(`${a.fields.auftragsnummer ?? 'Auftrag'} → ${nextLabel}`, async () => {
      setAuftraege(prev => prev.map(x =>
        x.record_id === a.record_id
          ? { ...x, fields: { ...x.fields, status: prevStatus } }
          : x
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: prevStatus ? lookupKey(prevStatus) : undefined });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(a.record_id, { status: next });
    } catch { await fetchAll(); }
  };

  const moveCard = async (cardId: string, newColumn: string) => {
    const rid = cardId.split(':')[1];
    if (!rid) return;
    const auftrag = auftraege.find(a => a.record_id === rid);
    if (!auftrag) return;
    const newLabel = STATUS_COLUMNS.find(c => c.key === newColumn)?.label ?? newColumn;
    const prevStatus = auftrag.fields.status;
    setAuftraege(prev => prev.map(a =>
      a.record_id === rid
        ? { ...a, fields: { ...a.fields, status: { key: newColumn, label: newLabel } } }
        : a
    ));
    undoToast(`${auftrag.fields.auftragsnummer ?? 'Auftrag'} → ${newLabel}`, async () => {
      setAuftraege(prev => prev.map(a =>
        a.record_id === rid
          ? { ...a, fields: { ...a.fields, status: prevStatus } }
          : a
      ));
      try {
        await LivingAppsService.updateAuftraegeEntry(rid, { status: prevStatus ? lookupKey(prevStatus) : undefined });
      } catch { await fetchAll(); }
    });
    try {
      await LivingAppsService.updateAuftraegeEntry(rid, { status: newColumn });
    } catch { await fetchAll(); }
  };

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // ─── Derivations only below ─────────────────────────────────────────────

  const contextLine = dringend.length > 0
    ? `${namen(dringend.map(a => a.kundeName || a.fields.auftragsnummer || '?'))} ${dringend.length === 1 ? 'hat' : 'haben'} einen überfälligen Termin.`
    : inBearbeitungCount > 0
    ? `${inBearbeitungCount} Auftrag${inBearbeitungCount !== 1 ? 'e' : ''} in Bearbeitung — ${offenCount} offen.`
    : auftraege.length === 0
    ? 'Lege deinen ersten Auftrag an und starte durch.'
    : 'Alle Aufträge im Zeitplan. Weiter so!';

  const firstDringend = dringend[0];

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{gruss(clock)}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">{contextLine}</p>
        </div>
        <button
          className="mt-3 sm:mt-0 shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          onClick={() => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); }}
        >
          <IconPlus size={16} className="shrink-0" />
          Neuer Auftrag
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={firstDringend && (
          <HeroBanner
            icon={<IconAlertTriangle size={18} />}
            action={{
              label: lookupKey(firstDringend.fields.status) === 'offen' ? 'In Bearbeitung setzen' : 'Als erledigt markieren',
              onClick: () => void advanceStatus(firstDringend),
            }}
          >
            <b>{namen(dringend.map(a => a.kundeName || a.fields.auftragsnummer || '?'))}</b>
            {dringend.length === 1
              ? ` — Termin war ${formatDate(firstDringend.fields.liefertermin ?? firstDringend.fields.wunschtermin)}.`
              : ` — ${dringend.length} Aufträge mit überfälligem Termin.`}
          </HeroBanner>
        )}
        kpis={
          <StatStrip>
            <StatStripItem
              title="Offen"
              value={offenCount}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone={offenCount > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title="In Bearbeitung"
              value={inBearbeitungCount}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone={inBearbeitungCount > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title="Abgeschlossen"
              value={abgeschlossenCount}
              icon={<IconClipboardList size={16} className="shrink-0" />}
              tone="success"
            />
            <StatStripItem
              title="Material unter Mindestbestand"
              value={materialKnapp.length}
              icon={<IconPackage size={16} className="shrink-0" />}
              tone={materialKnapp.length > 0 ? 'destructive' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <KanbanWidget
            cards={cards}
            columns={STATUS_COLUMNS}
            defaultCollapsed={['storniert']}
            onCardClick={card => {
              const id = card.id.split(':')[1] ?? '';
              overlay.replace({ type: 'auftrag', id });
            }}
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
              title="Dringend & überfällig"
              items={dringend.slice(0, 8).map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? 'Auftrag',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      {a.kundeName || '—'}
                    </span>
                    <span className="text-muted-foreground">
                      {' · '}
                      {a.fields.liefertermin
                        ? formatDateTime(a.fields.liefertermin)
                        : a.fields.wunschtermin
                        ? formatDate(a.fields.wunschtermin)
                        : '—'}
                    </span>
                  </>
                ),
                action: lookupKey(a.fields.status) !== 'abgeschlossen' ? {
                  label: lookupKey(a.fields.status) === 'offen' ? '→ Bearbeitung' : '✓ Erledigt',
                  onClick: () => void advanceStatus(a),
                } : undefined,
              }))}
              onItemClick={id => overlay.replace({ type: 'auftrag', id })}
              empty={{
                text: 'Alle Termine im Zeitplan',
                action: { label: 'Neuer Auftrag', onClick: () => { setAuftraegeDefaults(undefined); setEditingAuftragId(undefined); setAuftraegeDialogOpen(true); } },
              }}
            />
            <WorkList
              title="Material unter Mindestbestand"
              items={materialKnapp.slice(0, 6).map(m => ({
                id: m.record_id,
                title: m.fields.bezeichnung ?? 'Material',
                secondLine: (
                  <>
                    <span className="font-medium text-destructive">
                      {m.fields.lagerbestand ?? 0} {m.fields.einheit?.label ?? ''}
                    </span>
                    <span className="text-muted-foreground">
                      {' · '}Min. {m.fields.mindestbestand ?? 0} {m.fields.einheit?.label ?? ''}
                    </span>
                  </>
                ),
              }))}
              onItemClick={() => { /* no overlay for material here */ }}
              empty={{ text: 'Alle Materialien ausreichend bevorratet' }}
            />
          </>
        }
      />

      {/* Dialogs */}
      <AuftraegeDialog
        open={auftraegeDialogOpen}
        onClose={() => setAuftraegeDialogOpen(false)}
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
        onClose={() => setPosDialogOpen(false)}
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
        onClose={() => setPruefDialogOpen(false)}
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

      {/* Overlay stack */}
      <RecordOverlayHost
        overlay={overlay}
        render={top => {
          if (top.type === 'auftrag') {
            const a = auftraege.find(x => x.record_id === top.id);
            if (!a) return null;
            const sk = lookupKey(a.fields.status);
            const nextLabel = sk === 'offen' ? 'In Bearbeitung setzen' : sk === 'in_bearbeitung' ? 'Als erledigt markieren' : undefined;
            const enrichedA = enrichedAuftraege.find(x => x.record_id === top.id) ?? { ...a, kundeName: '' };
            return (
              <>
                <RecordHeader
                  title={a.fields.auftragsnummer ?? 'Auftrag'}
                  subtitle={enrichedA.kundeName || a.fields.status?.label}
                  badges={a.fields.prioritaet ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {a.fields.prioritaet.label}
                    </span>
                  ) : undefined}
                />
                <AuftraegeDetails
                  record={a}
                  kundenList={kunden}
                  onOpenKunden={k => overlay.push({ type: 'kunde', id: k.record_id })}
                  auftragspositionenList={auftragspositionen}
                  onOpenAuftragspositionen={p => overlay.push({ type: 'auftragsposition', id: p.record_id })}
                  onAddAuftragspositionen={() => {
                    setPosDefaults({ auftrag: a.record_id });
                    setEditingPosId(undefined);
                    setPosDialogOpen(true);
                  }}
                  pruefprotokollList={pruefprotokoll}
                  onOpenPruefprotokoll={p => overlay.push({ type: 'pruefprotokoll', id: p.record_id })}
                  onAddPruefprotokoll={() => {
                    setPruefDefaults({ auftrag_pruef: a.record_id });
                    setEditingPruefId(undefined);
                    setPruefDialogOpen(true);
                  }}
                />
              </>
            );
          }
          if (top.type === 'auftragsposition') {
            const p = auftragspositionen.find(x => x.record_id === top.id);
            if (!p) return null;
            const enrichedP = enrichedAuftragspositionen.find(x => x.record_id === top.id) ?? { ...p, auftragName: '', materialName: '' };
            return (
              <>
                <RecordHeader
                  title={p.fields.positionsbeschreibung ?? 'Position'}
                  subtitle={enrichedP.auftragName || undefined}
                />
                <AuftragspositionenDetails
                  record={p}
                  auftraegeList={auftraege}
                  onOpenAuftraege={a => overlay.push({ type: 'auftrag', id: a.record_id })}
                  materialList={material}
                  onOpenMaterial={m => overlay.push({ type: 'auftragsposition', id: m.record_id })}
                />
              </>
            );
          }
          if (top.type === 'pruefprotokoll') {
            const p = pruefprotokoll.find(x => x.record_id === top.id);
            if (!p) return null;
            const enrichedP = enrichedPruefprotokoll.find(x => x.record_id === top.id) ?? { ...p, auftrag_pruefName: '' };
            return (
              <>
                <RecordHeader
                  title={[p.fields.monteur_name_vorname, p.fields.monteur_name_nachname].filter(Boolean).join(' ') || 'Prüfprotokoll'}
                  subtitle={enrichedP.auftrag_pruefName || p.fields.pruefergebnis?.label}
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
            const k = kunden.find(x => x.record_id === top.id);
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
                    setAuftraegeDefaults({ kunde: k.record_id });
                    setEditingAuftragId(undefined);
                    setAuftraegeDialogOpen(true);
                  }}
                />
              </>
            );
          }
          return null;
        }}
        footer={top => {
          if (top.type === 'auftrag') {
            const a = auftraege.find(x => x.record_id === top.id);
            if (!a) return null;
            const sk = lookupKey(a.fields.status);
            if (sk === 'abgeschlossen' || sk === 'storniert') return null;
            const enrichedA = enrichedAuftraege.find(x => x.record_id === top.id) ?? { ...a, kundeName: '' };
            const label = sk === 'offen' ? 'In Bearbeitung setzen' : 'Als erledigt markieren';
            return { label, onClick: () => void advanceStatus(enrichedA) };
          }
          return null;
        }}
        onEdit={top => {
          if (top.type === 'auftrag') {
            const a = auftraege.find(x => x.record_id === top.id);
            if (!a) return;
            setAuftraegeDefaults(a.fields as AuftraegeDialogDefaults);
            setEditingAuftragId(a.record_id);
            setAuftraegeDialogOpen(true);
          } else if (top.type === 'auftragsposition') {
            const p = auftragspositionen.find(x => x.record_id === top.id);
            if (!p) return;
            setPosDefaults(p.fields as AuftragspositionenDialogDefaults);
            setEditingPosId(p.record_id);
            setPosDialogOpen(true);
          } else if (top.type === 'pruefprotokoll') {
            const p = pruefprotokoll.find(x => x.record_id === top.id);
            if (!p) return;
            setPruefDefaults(p.fields as PruefprotokollDialogDefaults);
            setEditingPruefId(p.record_id);
            setPruefDialogOpen(true);
          }
        }}
      />
    </>
  );
}
