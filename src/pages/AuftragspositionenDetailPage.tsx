import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import type { Auftragspositionen, Auftraege, Material } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { Button } from '@/components/ui/button';
import { IconArrowLeft, IconTrash } from '@tabler/icons-react';
import {
  RecordView, RecordHeader, RecordKeyFacts, RecordSection, RecordField,
  RecordAttachments, RecordViewSkeleton, RecordViewEmpty,
} from '@/components/widgets/RecordView';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { formEnhancements } from '@/config/form-enhancements/Auftragspositionen';
import { evalComputed } from '@/config/form-enhancements/types';

export default function AuftragspositionenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<Auftragspositionen | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [auftraegeList, setAuftraegeList] = useState<Auftraege[]>([]);
  const [materialList, setMaterialList] = useState<Material[]>([]);

  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const [mainData, auftraegeData, materialData] = await Promise.all([
        LivingAppsService.getAuftragspositionen(),
        LivingAppsService.getAuftraege(),
        LivingAppsService.getMaterial(),
      ]);
      setAuftraegeList(auftraegeData);
      setMaterialList(materialData);
      setRecord(mainData.find(r => r.record_id === id) ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate(fields: Auftragspositionen['fields']) {
    if (!record) return;
    await LivingAppsService.updateAuftragspositionenEntry(record.record_id, fields);
    await loadData();
    setEditing(false);
  }

  async function handleDelete() {
    if (!record) return;
    await LivingAppsService.deleteAuftragspositionenEntry(record.record_id);
    setDeleteOpen(false);
    navigate('/auftragspositionen');
  }

  function getAuftraegeDisplayName(url?: unknown) {
    if (!url) return '—';
    const refId = extractRecordId(url);
    return auftraegeList.find(r => r.record_id === refId)?.fields.auftragsnummer ?? '—';
  }

  function getMaterialDisplayName(url?: unknown) {
    if (!url) return '—';
    const refId = extractRecordId(url);
    return materialList.find(r => r.record_id === refId)?.fields.bezeichnung ?? '—';
  }

  if (loading) {
    return <RecordViewSkeleton />;
  }

  if (!record) {
    return (
      <RecordViewEmpty
        title="Eintrag nicht gefunden"
        action={
          <Button variant="ghost" onClick={() => navigate('/auftragspositionen')}>
            <IconArrowLeft className="h-4 w-4 mr-1.5" />
            Zurück
          </Button>
        }
      />
    );
  }

  return (
    <RecordView
      onBack={() => navigate('/auftragspositionen')}
      onEdit={() => setEditing(true)}
      backLabel="Zurück"
      editLabel="Bearbeiten"
    >
      <RecordHeader title={record.fields.positionsbeschreibung ?? 'Auftragspositionen'} />

      {(() => {
        const lookupLists: Record<string, unknown> = {
          auftrag: auftraegeList,
          material: materialList,
        };
        const fmtComputed = (k: string, n: number) =>
          /(?:kosten|preis|betrag|gesamt|netto|brutto|summe|mwst|rabatt|anzahlung|umsatz|saldo)/i.test(k)
            ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
        const computedFacts = Object.entries(formEnhancements.computed)
          .map(([key, formula]) => {
            const v = evalComputed(formula, record!.fields as Record<string, unknown>, { lookupLists });
            return v != null
              ? { label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), value: fmtComputed(key, v) }
              : null;
          })
          .filter((f): f is { label: string; value: string } => f !== null);
        return computedFacts.length > 0 ? <RecordKeyFacts items={computedFacts} /> : null;
      })()}

      <RecordSection title="Details" cols={2}>
        <RecordField label="Auftrag" value={getAuftraegeDisplayName(record.fields.auftrag)} format="text" />
        <RecordField label="Material" value={getMaterialDisplayName(record.fields.material)} format="text" />
        <RecordField label="Positionsbeschreibung" value={record.fields.positionsbeschreibung} format="text" />
        <RecordField label="Menge" value={record.fields.menge} format="text" />
        <RecordField label="Einheit" value={record.fields.einheit_position} format="pill" />
        <RecordField label="Bemerkung" value={record.fields.bemerkung} format="longtext" className="md:col-span-2" />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.AUFTRAGSPOSITIONEN} recordId={record.record_id} />

      <div className="flex justify-end pt-2">
        <Button variant="ghost" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive">
          <IconTrash className="h-4 w-4 mr-1.5" />
          Löschen
        </Button>
      </div>

      <AuftragspositionenDialog
        open={editing}
        onClose={() => setEditing(false)}
        onSubmit={handleUpdate}
        defaultValues={record.fields}
        recordId={record.record_id}
        auftraegeList={auftraegeList}
        materialList={materialList}
        enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Auftragspositionen löschen"
        description="Soll dieser Eintrag wirklich gelöscht werden? Diese Aktion kann nicht rückgängig gemacht werden."
      />
    </RecordView>
  );
}
