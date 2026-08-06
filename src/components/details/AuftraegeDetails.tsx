import type { Auftraege, Kunden, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface AuftraegeDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Auftraege;
  /** N:1-Ziel „Kunden": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  kundenList: Kunden[];
  /** Klick auf die Kunden-Relation → overlay.push auf dessen Detail. */
  onOpenKunden?: (record: Kunden) => void;
  /** 1:N „Auftragspositionen": VOLLE Liste — der Block filtert auf diesen Record. */
  auftragspositionenList: Auftragspositionen[];
  /** Zeilen-Klick → overlay.push auf das Auftragspositionen-Detail (nie der Edit-Dialog). */
  onOpenAuftragspositionen: (record: Auftragspositionen) => void;
  /** Kontextuelles „+": öffnet den Auftragspositionen-Dialog mit diesem Record vorgesetzt. */
  onAddAuftragspositionen: () => void;
  /** 1:N „Prüfprotokoll": VOLLE Liste — der Block filtert auf diesen Record. */
  pruefprotokollList: Pruefprotokoll[];
  /** Zeilen-Klick → overlay.push auf das Pruefprotokoll-Detail (nie der Edit-Dialog). */
  onOpenPruefprotokoll: (record: Pruefprotokoll) => void;
  /** Kontextuelles „+": öffnet den Pruefprotokoll-Dialog mit diesem Record vorgesetzt. */
  onAddPruefprotokoll: () => void;
}

export function AuftraegeDetails({
  record,
  kundenList,
  onOpenKunden,
  auftragspositionenList,
  onOpenAuftragspositionen,
  onAddAuftragspositionen,
  pruefprotokollList,
  onOpenPruefprotokoll,
  onAddPruefprotokoll,
}: AuftraegeDetailsProps) {
  const kundeTarget = kundenList.find(r => r.record_id === extractRecordId(record.fields.kunde));
  return (
    <>
      <RecordSection title="Details" cols={2}>
        <RecordField label="Auftragsnummer" value={record.fields.auftragsnummer} format="text" />
        <RecordField label="Auftragsdatum" value={record.fields.auftragsdatum} format="date" />
        <RecordField label="Status" value={record.fields.status} format="pill" />
        <RecordField label="Priorität" value={record.fields.prioritaet} format="pill" />
        <RecordField label="Auftragsbeschreibung" value={record.fields.auftragsbeschreibung} format="longtext" className="md:col-span-2" />
        <RecordField label="Wunschtermin" value={record.fields.wunschtermin} format="datetime" />
        <RecordField label="Liefertermin" value={record.fields.liefertermin} format="datetime" />
        <RecordField label="Zuständiger Monteur" value={record.fields.monteur} format="text" />
        <RecordField label="Notizen" value={record.fields.auftrag_notizen} format="longtext" className="md:col-span-2" />
      </RecordSection>

      {/* N:1 — verknüpfte Records: IMMER klickbar, nie eine Text-Sackgasse. */}
      <RecordSection title="Verknüpft" cols={1}>
        <RecordRelation
          label="Kunde"
          name={kundeTarget?.fields.vorname ?? '—'}
          meta={[kundeTarget?.fields.telefon, kundeTarget?.fields.email].filter(Boolean).join(' · ') || undefined}
          onClick={kundeTarget && onOpenKunden ? () => onOpenKunden!(kundeTarget!) : undefined}
        />
      </RecordSection>

      <SatelliteSection
        title="Auftragspositionen"
        items={auftragspositionenList.filter(r => extractRecordId(r.fields.auftrag) === record.record_id)}
        map={r => ({ name: r.fields.positionsbeschreibung ?? 'Auftragspositionen', meta: undefined })}
        onOpen={onOpenAuftragspositionen}
        onAdd={onAddAuftragspositionen}
        getKey={r => r.record_id}
      />

      <SatelliteSection
        title="Prüfprotokoll"
        items={pruefprotokollList.filter(r => extractRecordId(r.fields.auftrag_pruef) === record.record_id)}
        map={r => ({ name: r.fields.monteur_name_vorname ?? 'Prüfprotokoll', meta: r.fields.pruefungsdatum })}
        onOpen={onOpenPruefprotokoll}
        onAdd={onAddPruefprotokoll}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.AUFTRAEGE} recordId={record.record_id} />
    </>
  );
}
