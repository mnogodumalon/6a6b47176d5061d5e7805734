import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'auftragsnummer',
    'auftragsdatum',
    'status',
    'prioritaet',
    'kunde',
    'auftragsbeschreibung',
    { row: ['wunschtermin', 'liefertermin'], cols: '1fr 1fr' },
    'monteur',
    'auftrag_notizen',
  ],
  defaults: {
    'auftragsdatum': { kind: 'today' },
    'status': { kind: 'lookup', key: 'offen', label: 'Offen' },
    'prioritaet': { kind: 'lookup', key: 'normal', label: 'Normal' },
    'wunschtermin': { kind: 'today', withTime: true },
    'liefertermin': { kind: 'todayOffset', days: 14, withTime: true },
  },
  computed: {
    // Aufträge ohne Preis-/Kosten-Felder — keine Berechnungen
  },
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
