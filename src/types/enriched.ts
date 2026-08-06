import type { Auftraege, Auftragspositionen, Pruefprotokoll } from './app';

export type EnrichedAuftraege = Auftraege & {
  kundeName: string;
};

export type EnrichedAuftragspositionen = Auftragspositionen & {
  auftragName: string;
  materialName: string;
};

export type EnrichedPruefprotokoll = Pruefprotokoll & {
  auftrag_pruefName: string;
};
