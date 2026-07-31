import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'auftrag_pruef',
    { row: ['monteur_name_vorname', 'monteur_name_nachname'], cols: '1fr 1fr' },
    'pruefungsdatum',
    'pruefergebnis',
    'maengelbeschreibung',
    'massnahmen',
    'bemerkungen_pruef',
  ],
  defaults: {
    'pruefungsdatum': { kind: 'today', withTime: true },
    'pruefergebnis': { kind: 'lookup', key: 'bestanden', label: 'Bestanden' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
