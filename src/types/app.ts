// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Kunden {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    firma?: string;
    telefon?: string;
    email?: string;
    strasse?: string;
    hausnummer?: string;
    plz?: string;
    ort?: string;
    notizen?: string;
  };
}

export interface Material {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    bezeichnung?: string;
    artikelnummer?: string;
    einheit?: LookupValue;
    lagerbestand?: number;
    mindestbestand?: number;
    verfuegbarkeit?: LookupValue;
    material_notizen?: string;
  };
}

export interface Auftraege {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    auftragsnummer?: string;
    auftragsdatum?: string; // Format: YYYY-MM-DD oder ISO String
    status?: LookupValue;
    prioritaet?: LookupValue;
    kunde?: string; // applookup -> URL zu 'Kunden' Record
    auftragsbeschreibung?: string;
    wunschtermin?: string; // Format: YYYY-MM-DD oder ISO String
    liefertermin?: string; // Format: YYYY-MM-DD oder ISO String
    monteur?: string;
    auftrag_notizen?: string;
  };
}

export interface Auftragspositionen {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    auftrag?: string; // applookup -> URL zu 'Auftraege' Record
    material?: string; // applookup -> URL zu 'Material' Record
    positionsbeschreibung?: string;
    menge?: number;
    einheit_position?: LookupValue;
    bemerkung?: string;
  };
}

export interface Pruefprotokoll {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    auftrag_pruef?: string; // applookup -> URL zu 'Auftraege' Record
    monteur_name_vorname?: string;
    monteur_name_nachname?: string;
    pruefungsdatum?: string; // Format: YYYY-MM-DD oder ISO String
    pruefergebnis?: LookupValue;
    maengelbeschreibung?: string;
    massnahmen?: string;
    fotos?: string;
    bemerkungen_pruef?: string;
  };
}

export const APP_IDS = {
  KUNDEN: '6a6b46f24aeb03e3fc0e5803',
  MATERIAL: '6a6b46f99c583f55b2594c29',
  AUFTRAEGE: '6a6b46f93a346f58e17d78e4',
  AUFTRAGSPOSITIONEN: '6a6b46fa87658a7d930ef4ce',
  PRUEFPROTOKOLL: '6a6b46fbc50e5e76e77f12eb',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'material': {
    einheit: [{ key: "stueck", label: "Stück" }, { key: "meter", label: "Meter" }, { key: "liter", label: "Liter" }, { key: "kilogramm", label: "Kilogramm" }, { key: "paket", label: "Paket" }, { key: "rolle", label: "Rolle" }, { key: "satz", label: "Satz" }],
    verfuegbarkeit: [{ key: "verfuegbar", label: "Verfügbar" }, { key: "nicht_verfuegbar", label: "Nicht verfügbar" }, { key: "auf_bestellung", label: "Auf Bestellung" }],
  },
  'auftraege': {
    status: [{ key: "offen", label: "Offen" }, { key: "in_bearbeitung", label: "In Bearbeitung" }, { key: "abgeschlossen", label: "Abgeschlossen" }, { key: "storniert", label: "Storniert" }],
    prioritaet: [{ key: "niedrig", label: "Niedrig" }, { key: "normal", label: "Normal" }, { key: "hoch", label: "Hoch" }, { key: "dringend", label: "Dringend" }],
  },
  'auftragspositionen': {
    einheit_position: [{ key: "stueck", label: "Stück" }, { key: "meter", label: "Meter" }, { key: "liter", label: "Liter" }, { key: "kilogramm", label: "Kilogramm" }, { key: "paket", label: "Paket" }, { key: "rolle", label: "Rolle" }, { key: "satz", label: "Satz" }],
  },
  'pruefprotokoll': {
    pruefergebnis: [{ key: "nicht_bestanden", label: "Nicht bestanden" }, { key: "bestanden_mit_maengeln", label: "Bestanden mit Mängeln" }, { key: "bestanden", label: "Bestanden" }],
  },
};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'kunden': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'firma': 'string/text',
    'telefon': 'string/tel',
    'email': 'string/email',
    'strasse': 'string/text',
    'hausnummer': 'string/text',
    'plz': 'string/text',
    'ort': 'string/text',
    'notizen': 'string/textarea',
  },
  'material': {
    'bezeichnung': 'string/text',
    'artikelnummer': 'string/text',
    'einheit': 'lookup/select',
    'lagerbestand': 'number',
    'mindestbestand': 'number',
    'verfuegbarkeit': 'lookup/select',
    'material_notizen': 'string/textarea',
  },
  'auftraege': {
    'auftragsnummer': 'string/text',
    'auftragsdatum': 'date/date',
    'status': 'lookup/select',
    'prioritaet': 'lookup/radio',
    'kunde': 'applookup/select',
    'auftragsbeschreibung': 'string/textarea',
    'wunschtermin': 'date/datetimeminute',
    'liefertermin': 'date/datetimeminute',
    'monteur': 'string/text',
    'auftrag_notizen': 'string/textarea',
  },
  'auftragspositionen': {
    'auftrag': 'applookup/select',
    'material': 'applookup/select',
    'positionsbeschreibung': 'string/text',
    'menge': 'number',
    'einheit_position': 'lookup/select',
    'bemerkung': 'string/textarea',
  },
  'pruefprotokoll': {
    'auftrag_pruef': 'applookup/select',
    'monteur_name_vorname': 'string/text',
    'monteur_name_nachname': 'string/text',
    'pruefungsdatum': 'date/datetimeminute',
    'pruefergebnis': 'lookup/radio',
    'maengelbeschreibung': 'string/textarea',
    'massnahmen': 'string/textarea',
    'fotos': 'file',
    'bemerkungen_pruef': 'string/textarea',
  },
};

export const HUB_TOPOLOGY: Record<string, { field: string; entity: string }[]> = {
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateKunden = StripLookup<Kunden['fields']>;
export type CreateMaterial = StripLookup<Material['fields']>;
export type CreateAuftraege = StripLookup<Auftraege['fields']>;
export type CreateAuftragspositionen = StripLookup<Auftragspositionen['fields']>;
export type CreatePruefprotokoll = StripLookup<Pruefprotokoll['fields']>;