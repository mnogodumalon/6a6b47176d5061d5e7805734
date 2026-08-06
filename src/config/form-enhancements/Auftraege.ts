import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'auftragsnummer',
    'auftragsdatum',
    'status',
    'prioritaet',
    'kunde',
    'auftragsbeschreibung',
    { row: ['wunschtermin', 'liefertermin'] },
    'monteur',
    'auftrag_notizen',
  ],
  defaults: {
    'auftragsdatum': { kind: 'today' },
    'status': { kind: 'lookup', key: 'offen', label: 'Offen' },
    'wunschtermin': { kind: 'today', withTime: true },
    'liefertermin': { kind: 'todayOffset', days: 7, withTime: true },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
