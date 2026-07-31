import type { Material, Auftragspositionen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface MaterialDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Material;
  /** 1:N „Auftragspositionen": VOLLE Liste — der Block filtert auf diesen Record. */
  auftragspositionenList: Auftragspositionen[];
  /** Zeilen-Klick → overlay.push auf das Auftragspositionen-Detail (nie der Edit-Dialog). */
  onOpenAuftragspositionen: (record: Auftragspositionen) => void;
  /** Kontextuelles „+": öffnet den Auftragspositionen-Dialog mit diesem Record vorgesetzt. */
  onAddAuftragspositionen: () => void;
}

export function MaterialDetails({
  record,
  auftragspositionenList,
  onOpenAuftragspositionen,
  onAddAuftragspositionen,
}: MaterialDetailsProps) {
  return (
    <>
      <RecordSection title="Details" cols={2}>
        <RecordField label="Materialbezeichnung" value={record.fields.bezeichnung} format="text" />
        <RecordField label="Artikelnummer" value={record.fields.artikelnummer} format="text" />
        <RecordField label="Einheit" value={record.fields.einheit} format="pill" />
        <RecordField label="Lagerbestand (Menge)" value={record.fields.lagerbestand} format="text" />
        <RecordField label="Mindestbestand" value={record.fields.mindestbestand} format="text" />
        <RecordField label="Verfügbarkeit" value={record.fields.verfuegbarkeit} format="pill" />
        <RecordField label="Notizen" value={record.fields.material_notizen} format="longtext" className="md:col-span-2" />
      </RecordSection>

      <SatelliteSection
        title="Auftragspositionen"
        items={auftragspositionenList.filter(r => extractRecordId(r.fields.material) === record.record_id)}
        map={r => ({ name: r.fields.positionsbeschreibung ?? 'Auftragspositionen', meta: undefined })}
        onOpen={onOpenAuftragspositionen}
        onAdd={onAddAuftragspositionen}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.MATERIAL} recordId={record.record_id} />
    </>
  );
}
