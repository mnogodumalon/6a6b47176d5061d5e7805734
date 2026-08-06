import type { Auftragspositionen, Auftraege, Material } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';

export interface AuftragspositionenDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Auftragspositionen;
  /** N:1-Ziel „Auftraege": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  auftraegeList: Auftraege[];
  /** Klick auf die Auftraege-Relation → overlay.push auf dessen Detail. */
  onOpenAuftraege?: (record: Auftraege) => void;
  /** N:1-Ziel „Material": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  materialList: Material[];
  /** Klick auf die Material-Relation → overlay.push auf dessen Detail. */
  onOpenMaterial?: (record: Material) => void;
}

export function AuftragspositionenDetails({
  record,
  auftraegeList,
  onOpenAuftraege,
  materialList,
  onOpenMaterial,
}: AuftragspositionenDetailsProps) {
  const auftragTarget = auftraegeList.find(r => r.record_id === extractRecordId(record.fields.auftrag));
  const materialTarget = materialList.find(r => r.record_id === extractRecordId(record.fields.material));
  return (
    <>
      <RecordSection title="Details" cols={2}>
        <RecordField label="Positionsbeschreibung" value={record.fields.positionsbeschreibung} format="text" />
        <RecordField label="Menge" value={record.fields.menge} format="text" />
        <RecordField label="Einheit" value={record.fields.einheit_position} format="pill" />
        <RecordField label="Bemerkung" value={record.fields.bemerkung} format="longtext" className="md:col-span-2" />
      </RecordSection>

      {/* N:1 — verknüpfte Records: IMMER klickbar, nie eine Text-Sackgasse. */}
      <RecordSection title="Verknüpft" cols={2}>
        <RecordRelation
          label="Auftrag"
          name={auftragTarget?.fields.auftragsnummer ?? '—'}
          meta={[auftragTarget?.fields.monteur].filter(Boolean).join(' · ') || undefined}
          onClick={auftragTarget && onOpenAuftraege ? () => onOpenAuftraege!(auftragTarget!) : undefined}
        />
        <RecordRelation
          label="Material"
          name={materialTarget?.fields.bezeichnung ?? '—'}
          meta={[materialTarget?.fields.artikelnummer].filter(Boolean).join(' · ') || undefined}
          onClick={materialTarget && onOpenMaterial ? () => onOpenMaterial!(materialTarget!) : undefined}
        />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.AUFTRAGSPOSITIONEN} recordId={record.record_id} />
    </>
  );
}
