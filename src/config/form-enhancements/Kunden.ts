import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'vorname',
    'nachname',
    'telefon',
    'firma',
    'email',
    { row: ['strasse', 'hausnummer'], cols: '2fr 1fr' },
    { row: ['plz', 'ort'], cols: '1fr 2fr' },
    'notizen',
  ],
  defaults: {},
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
