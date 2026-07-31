import type { Pruefprotokoll, Auftraege } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { MediaThumbnail } from '@/components/widgets/MediaViewer';

export interface PruefprotokollDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Pruefprotokoll;
  /** N:1-Ziel „Auftraege": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  auftraegeList: Auftraege[];
  /** Klick auf die Auftraege-Relation → overlay.push auf dessen Detail. */
  onOpenAuftraege?: (record: Auftraege) => void;
}

export function PruefprotokollDetails({
  record,
  auftraegeList,
  onOpenAuftraege,
}: PruefprotokollDetailsProps) {
  const auftrag_pruefTarget = auftraegeList.find(r => r.record_id === extractRecordId(record.fields.auftrag_pruef));
  return (
    <>
      <RecordSection title="Details" cols={2}>
        <RecordField label="Vorname des Monteurs" value={record.fields.monteur_name_vorname} format="text" />
        <RecordField label="Nachname des Monteurs" value={record.fields.monteur_name_nachname} format="text" />
        <RecordField label="Datum der Prüfung" value={record.fields.pruefungsdatum} format="datetime" />
        <RecordField label="Prüfergebnis" value={record.fields.pruefergebnis} format="pill" />
        <RecordField label="Mängelbeschreibung" value={record.fields.maengelbeschreibung} format="longtext" className="md:col-span-2" />
        <RecordField label="Eingeleitete Maßnahmen" value={record.fields.massnahmen} format="longtext" className="md:col-span-2" />
        <RecordField label="Fotos / Anhänge" className="md:col-span-2">
          {record.fields.fotos ? (
            <MediaThumbnail src={record.fields.fotos as string} fit="contain" className="max-h-64 w-full rounded-lg" />
          ) : '—'}
        </RecordField>
        <RecordField label="Bemerkungen" value={record.fields.bemerkungen_pruef} format="longtext" className="md:col-span-2" />
      </RecordSection>

      {/* N:1 — verknüpfte Records: IMMER klickbar, nie eine Text-Sackgasse. */}
      <RecordSection title="Verknüpft" cols={1}>
        <RecordRelation
          label="Auftrag"
          name={auftrag_pruefTarget?.fields.auftragsnummer ?? '—'}
          meta={[auftrag_pruefTarget?.fields.monteur].filter(Boolean).join(' · ') || undefined}
          onClick={auftrag_pruefTarget && onOpenAuftraege ? () => onOpenAuftraege!(auftrag_pruefTarget!) : undefined}
        />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.PRUEFPROTOKOLL} recordId={record.record_id} />
    </>
  );
}
