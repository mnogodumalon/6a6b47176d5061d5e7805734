import type { Kunden, Auftraege } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface KundenDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Kunden;
  /** 1:N „Aufträge": VOLLE Liste — der Block filtert auf diesen Record. */
  auftraegeList: Auftraege[];
  /** Zeilen-Klick → overlay.push auf das Auftraege-Detail (nie der Edit-Dialog). */
  onOpenAuftraege: (record: Auftraege) => void;
  /** Kontextuelles „+": öffnet den Auftraege-Dialog mit diesem Record vorgesetzt. */
  onAddAuftraege: () => void;
}

export function KundenDetails({
  record,
  auftraegeList,
  onOpenAuftraege,
  onAddAuftraege,
}: KundenDetailsProps) {
  return (
    <>
      <RecordSection title="Details" cols={2}>
        <RecordField label="Vorname" value={record.fields.vorname} format="text" />
        <RecordField label="Nachname" value={record.fields.nachname} format="text" />
        <RecordField label="Firma" value={record.fields.firma} format="text" />
        <RecordField label="Telefon" value={record.fields.telefon} format="text" />
        <RecordField label="E-Mail" value={record.fields.email} format="email" />
        <RecordField label="Straße" value={record.fields.strasse} format="text" />
        <RecordField label="Hausnummer" value={record.fields.hausnummer} format="text" />
        <RecordField label="Postleitzahl" value={record.fields.plz} format="text" />
        <RecordField label="Ort" value={record.fields.ort} format="text" />
        <RecordField label="Notizen" value={record.fields.notizen} format="longtext" className="md:col-span-2" />
      </RecordSection>

      <SatelliteSection
        title="Aufträge"
        items={auftraegeList.filter(r => extractRecordId(r.fields.kunde) === record.record_id)}
        map={r => ({ name: r.fields.auftragsnummer ?? 'Aufträge', meta: r.fields.auftragsdatum })}
        onOpen={onOpenAuftraege}
        onAdd={onAddAuftraege}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.KUNDEN} recordId={record.record_id} />
    </>
  );
}
