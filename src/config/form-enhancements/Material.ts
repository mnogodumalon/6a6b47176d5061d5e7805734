import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'bezeichnung',
    'artikelnummer',
    'einheit',
    'lagerbestand',
    'mindestbestand',
    'verfuegbarkeit',
    'material_notizen',
  ],
  defaults: {
    'verfuegbarkeit': { kind: 'lookup', key: 'verfuegbar', label: 'Verfügbar' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, { lookupKey: string }[]> = {};
