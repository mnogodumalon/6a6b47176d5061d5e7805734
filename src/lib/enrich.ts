import type { EnrichedAuftraege, EnrichedAuftragspositionen, EnrichedPruefprotokoll } from '@/types/enriched';
import type { Auftraege, Auftragspositionen, Kunden, Material, Pruefprotokoll } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface AuftraegeMaps {
  kundenMap: Map<string, Kunden>;
}

export function enrichAuftraege(
  auftraege: Auftraege[],
  maps: AuftraegeMaps
): EnrichedAuftraege[] {
  return auftraege.map(r => ({
    ...r,
    kundeName: resolveDisplay(r.fields.kunde, maps.kundenMap, 'vorname', 'nachname'),
  }));
}

interface AuftragspositionenMaps {
  auftraegeMap: Map<string, Auftraege>;
  materialMap: Map<string, Material>;
}

export function enrichAuftragspositionen(
  auftragspositionen: Auftragspositionen[],
  maps: AuftragspositionenMaps
): EnrichedAuftragspositionen[] {
  return auftragspositionen.map(r => ({
    ...r,
    auftragName: resolveDisplay(r.fields.auftrag, maps.auftraegeMap, 'auftragsnummer'),
    materialName: resolveDisplay(r.fields.material, maps.materialMap, 'bezeichnung'),
  }));
}

interface PruefprotokollMaps {
  auftraegeMap: Map<string, Auftraege>;
}

export function enrichPruefprotokoll(
  pruefprotokoll: Pruefprotokoll[],
  maps: PruefprotokollMaps
): EnrichedPruefprotokoll[] {
  return pruefprotokoll.map(r => ({
    ...r,
    auftrag_pruefName: resolveDisplay(r.fields.auftrag_pruef, maps.auftraegeMap, 'auftragsnummer'),
  }));
}
