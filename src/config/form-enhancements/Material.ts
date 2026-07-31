import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'bezeichnung',
    'artikelnummer',
    'einheit',
    'verfuegbarkeit',
    'lagerbestand',
    'mindestbestand',
    'material_notizen',
  ],
  defaults: {
    'lagerbestand': { kind: 'literal', value: 0 },
    'mindestbestand': { kind: 'literal', value: 0 },
    'verfuegbarkeit': { kind: 'lookup', key: 'verfuegbar', label: 'Verfügbar' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
