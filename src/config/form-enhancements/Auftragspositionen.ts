import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'auftrag',
    'material',
    'positionsbeschreibung',
    { row: ['menge', 'einheit_position'], cols: '1fr 1fr' },
    'bemerkung',
  ],
  defaults: {
    'menge': { kind: 'literal', value: 1 },
  },
  computed: {
    // Auftragspositionen ohne Preis-Target im Material-Applookup
    // (Material hat nur Lagerbestand/Mindestbestand, keine Preis-Felder)
    // → keine Multiplikationen möglich
  },
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
