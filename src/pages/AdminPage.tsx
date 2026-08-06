import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material, Auftraege, Auftragspositionen, Pruefprotokoll } from '@/types/app';
import { LivingAppsService, extractRecordId, cleanFieldsForApi } from '@/services/livingAppsService';
import { KundenDialog } from '@/components/dialogs/KundenDialog';
import { KundenViewDialog } from '@/components/dialogs/KundenViewDialog';
import { MaterialDialog } from '@/components/dialogs/MaterialDialog';
import { MaterialViewDialog } from '@/components/dialogs/MaterialViewDialog';
import { AuftraegeDialog } from '@/components/dialogs/AuftraegeDialog';
import { AuftraegeViewDialog } from '@/components/dialogs/AuftraegeViewDialog';
import { AuftragspositionenDialog } from '@/components/dialogs/AuftragspositionenDialog';
import { AuftragspositionenViewDialog } from '@/components/dialogs/AuftragspositionenViewDialog';
import { PruefprotokollDialog } from '@/components/dialogs/PruefprotokollDialog';
import { PruefprotokollViewDialog } from '@/components/dialogs/PruefprotokollViewDialog';
import { BulkEditDialog } from '@/components/dialogs/BulkEditDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageShell } from '@/components/PageShell';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { IconPencil, IconTrash, IconPlus, IconFilter, IconX, IconArrowsUpDown, IconArrowUp, IconArrowDown, IconSearch, IconCopy, IconFileText } from '@tabler/icons-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

function fmtDate(d?: string) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd.MM.yyyy', { locale: de }); } catch { return d; }
}

// Field metadata per entity for bulk edit and column filters
const KUNDEN_FIELDS = [
  { key: 'vorname', label: 'Vorname', type: 'string/text' },
  { key: 'nachname', label: 'Nachname', type: 'string/text' },
  { key: 'firma', label: 'Firma', type: 'string/text' },
  { key: 'telefon', label: 'Telefon', type: 'string/tel' },
  { key: 'email', label: 'E-Mail', type: 'string/email' },
  { key: 'strasse', label: 'Straße', type: 'string/text' },
  { key: 'hausnummer', label: 'Hausnummer', type: 'string/text' },
  { key: 'plz', label: 'Postleitzahl', type: 'string/text' },
  { key: 'ort', label: 'Ort', type: 'string/text' },
  { key: 'notizen', label: 'Notizen', type: 'string/textarea' },
];
const MATERIAL_FIELDS = [
  { key: 'bezeichnung', label: 'Materialbezeichnung', type: 'string/text' },
  { key: 'artikelnummer', label: 'Artikelnummer', type: 'string/text' },
  { key: 'einheit', label: 'Einheit', type: 'lookup/select', options: [{ key: 'stueck', label: 'Stück' }, { key: 'meter', label: 'Meter' }, { key: 'liter', label: 'Liter' }, { key: 'kilogramm', label: 'Kilogramm' }, { key: 'paket', label: 'Paket' }, { key: 'rolle', label: 'Rolle' }, { key: 'satz', label: 'Satz' }] },
  { key: 'lagerbestand', label: 'Lagerbestand (Menge)', type: 'number' },
  { key: 'mindestbestand', label: 'Mindestbestand', type: 'number' },
  { key: 'verfuegbarkeit', label: 'Verfügbarkeit', type: 'lookup/select', options: [{ key: 'verfuegbar', label: 'Verfügbar' }, { key: 'nicht_verfuegbar', label: 'Nicht verfügbar' }, { key: 'auf_bestellung', label: 'Auf Bestellung' }] },
  { key: 'material_notizen', label: 'Notizen', type: 'string/textarea' },
];
const AUFTRAEGE_FIELDS = [
  { key: 'auftragsnummer', label: 'Auftragsnummer', type: 'string/text' },
  { key: 'auftragsdatum', label: 'Auftragsdatum', type: 'date/date' },
  { key: 'status', label: 'Status', type: 'lookup/select', options: [{ key: 'offen', label: 'Offen' }, { key: 'in_bearbeitung', label: 'In Bearbeitung' }, { key: 'abgeschlossen', label: 'Abgeschlossen' }, { key: 'storniert', label: 'Storniert' }] },
  { key: 'prioritaet', label: 'Priorität', type: 'lookup/radio', options: [{ key: 'niedrig', label: 'Niedrig' }, { key: 'normal', label: 'Normal' }, { key: 'hoch', label: 'Hoch' }, { key: 'dringend', label: 'Dringend' }] },
  { key: 'kunde', label: 'Kunde', type: 'applookup/select', targetEntity: 'kunden', targetAppId: 'KUNDEN', displayField: 'vorname' },
  { key: 'auftragsbeschreibung', label: 'Auftragsbeschreibung', type: 'string/textarea' },
  { key: 'wunschtermin', label: 'Wunschtermin', type: 'date/datetimeminute' },
  { key: 'liefertermin', label: 'Liefertermin', type: 'date/datetimeminute' },
  { key: 'monteur', label: 'Zuständiger Monteur', type: 'string/text' },
  { key: 'auftrag_notizen', label: 'Notizen', type: 'string/textarea' },
];
const AUFTRAGSPOSITIONEN_FIELDS = [
  { key: 'auftrag', label: 'Auftrag', type: 'applookup/select', targetEntity: 'auftraege', targetAppId: 'AUFTRAEGE', displayField: 'auftragsnummer' },
  { key: 'material', label: 'Material', type: 'applookup/select', targetEntity: 'material', targetAppId: 'MATERIAL', displayField: 'bezeichnung' },
  { key: 'positionsbeschreibung', label: 'Positionsbeschreibung', type: 'string/text' },
  { key: 'menge', label: 'Menge', type: 'number' },
  { key: 'einheit_position', label: 'Einheit', type: 'lookup/select', options: [{ key: 'stueck', label: 'Stück' }, { key: 'meter', label: 'Meter' }, { key: 'liter', label: 'Liter' }, { key: 'kilogramm', label: 'Kilogramm' }, { key: 'paket', label: 'Paket' }, { key: 'rolle', label: 'Rolle' }, { key: 'satz', label: 'Satz' }] },
  { key: 'bemerkung', label: 'Bemerkung', type: 'string/textarea' },
];
const PRUEFPROTOKOLL_FIELDS = [
  { key: 'auftrag_pruef', label: 'Auftrag', type: 'applookup/select', targetEntity: 'auftraege', targetAppId: 'AUFTRAEGE', displayField: 'auftragsnummer' },
  { key: 'monteur_name_vorname', label: 'Vorname des Monteurs', type: 'string/text' },
  { key: 'monteur_name_nachname', label: 'Nachname des Monteurs', type: 'string/text' },
  { key: 'pruefungsdatum', label: 'Datum der Prüfung', type: 'date/datetimeminute' },
  { key: 'pruefergebnis', label: 'Prüfergebnis', type: 'lookup/radio', options: [{ key: 'nicht_bestanden', label: 'Nicht bestanden' }, { key: 'bestanden_mit_maengeln', label: 'Bestanden mit Mängeln' }, { key: 'bestanden', label: 'Bestanden' }] },
  { key: 'maengelbeschreibung', label: 'Mängelbeschreibung', type: 'string/textarea' },
  { key: 'massnahmen', label: 'Eingeleitete Maßnahmen', type: 'string/textarea' },
  { key: 'fotos', label: 'Fotos / Anhänge', type: 'file' },
  { key: 'bemerkungen_pruef', label: 'Bemerkungen', type: 'string/textarea' },
];

const ENTITY_TABS = [
  { key: 'kunden', label: 'Kunden', pascal: 'Kunden' },
  { key: 'material', label: 'Material', pascal: 'Material' },
  { key: 'auftraege', label: 'Aufträge', pascal: 'Auftraege' },
  { key: 'auftragspositionen', label: 'Auftragspositionen', pascal: 'Auftragspositionen' },
  { key: 'pruefprotokoll', label: 'Prüfprotokoll', pascal: 'Pruefprotokoll' },
] as const;

type EntityKey = typeof ENTITY_TABS[number]['key'];

export default function AdminPage() {
  const data = useDashboardData();
  const { loading, error, fetchAll } = data;

  const [activeTab, setActiveTab] = useState<EntityKey>('kunden');
  const [selectedIds, setSelectedIds] = useState<Record<EntityKey, Set<string>>>(() => ({
    'kunden': new Set(),
    'material': new Set(),
    'auftraege': new Set(),
    'auftragspositionen': new Set(),
    'pruefprotokoll': new Set(),
  }));
  const [filters, setFilters] = useState<Record<EntityKey, Record<string, string>>>(() => ({
    'kunden': {},
    'material': {},
    'auftraege': {},
    'auftragspositionen': {},
    'pruefprotokoll': {},
  }));
  const [showFilters, setShowFilters] = useState(false);
  const [dialogState, setDialogState] = useState<{ entity: EntityKey; record: any } | null>(null);
  const [createEntity, setCreateEntity] = useState<EntityKey | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<{ entity: EntityKey; ids: string[] } | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState<EntityKey | null>(null);
  const [viewState, setViewState] = useState<{ entity: EntityKey; record: any } | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');

  const getRecords = useCallback((entity: EntityKey) => {
    switch (entity) {
      case 'kunden': return (data as any).kunden as Kunden[] ?? [];
      case 'material': return (data as any).material as Material[] ?? [];
      case 'auftraege': return (data as any).auftraege as Auftraege[] ?? [];
      case 'auftragspositionen': return (data as any).auftragspositionen as Auftragspositionen[] ?? [];
      case 'pruefprotokoll': return (data as any).pruefprotokoll as Pruefprotokoll[] ?? [];
      default: return [];
    }
  }, [data]);

  const getLookupLists = useCallback((entity: EntityKey) => {
    const lists: Record<string, any[]> = {};
    switch (entity) {
      case 'auftraege':
        lists.kundenList = (data as any).kunden ?? [];
        break;
      case 'auftragspositionen':
        lists.auftraegeList = (data as any).auftraege ?? [];
        lists.materialList = (data as any).material ?? [];
        break;
      case 'pruefprotokoll':
        lists.auftraegeList = (data as any).auftraege ?? [];
        break;
    }
    return lists;
  }, [data]);

  const getApplookupDisplay = useCallback((entity: EntityKey, fieldKey: string, url?: unknown) => {
    if (!url) return '—';
    const id = extractRecordId(url);
    if (!id) return '—';
    const lists = getLookupLists(entity);
    void fieldKey; // ensure used for noUnusedParameters
    if (entity === 'auftraege' && fieldKey === 'kunde') {
      const match = (lists.kundenList ?? []).find((r: any) => r.record_id === id);
      return match?.fields.vorname ?? '—';
    }
    if (entity === 'auftragspositionen' && fieldKey === 'auftrag') {
      const match = (lists.auftraegeList ?? []).find((r: any) => r.record_id === id);
      return match?.fields.auftragsnummer ?? '—';
    }
    if (entity === 'auftragspositionen' && fieldKey === 'material') {
      const match = (lists.materialList ?? []).find((r: any) => r.record_id === id);
      return match?.fields.bezeichnung ?? '—';
    }
    if (entity === 'pruefprotokoll' && fieldKey === 'auftrag_pruef') {
      const match = (lists.auftraegeList ?? []).find((r: any) => r.record_id === id);
      return match?.fields.auftragsnummer ?? '—';
    }
    return String(url);
  }, [getLookupLists]);

  const getFieldMeta = useCallback((entity: EntityKey) => {
    switch (entity) {
      case 'kunden': return KUNDEN_FIELDS;
      case 'material': return MATERIAL_FIELDS;
      case 'auftraege': return AUFTRAEGE_FIELDS;
      case 'auftragspositionen': return AUFTRAGSPOSITIONEN_FIELDS;
      case 'pruefprotokoll': return PRUEFPROTOKOLL_FIELDS;
      default: return [];
    }
  }, []);

  const getFilteredRecords = useCallback((entity: EntityKey) => {
    const records = getRecords(entity);
    const s = search.toLowerCase();
    const searched = !s ? records : records.filter((r: any) => {
      return Object.values(r.fields).some((v: any) => {
        if (v == null) return false;
        if (Array.isArray(v)) return v.some((item: any) => typeof item === 'object' && item !== null && 'label' in item ? String((item as any).label).toLowerCase().includes(s) : String(item).toLowerCase().includes(s));
        if (typeof v === 'object' && 'label' in (v as any)) return String((v as any).label).toLowerCase().includes(s);
        return String(v).toLowerCase().includes(s);
      });
    });
    const entityFilters = filters[entity] ?? {};
    const fieldMeta = getFieldMeta(entity);
    return searched.filter((r: any) => {
      return fieldMeta.every((fm: any) => {
        const fv = entityFilters[fm.key];
        if (!fv || fv === '') return true;
        const val = r.fields?.[fm.key];
        if (fm.type === 'bool') {
          if (fv === 'true') return val === true;
          if (fv === 'false') return val !== true;
          return true;
        }
        if (fm.type === 'lookup/select' || fm.type === 'lookup/radio') {
          const label = val && typeof val === 'object' && 'label' in val ? val.label : '';
          return String(label).toLowerCase().includes(fv.toLowerCase());
        }
        if (fm.type.includes('multiplelookup')) {
          if (!Array.isArray(val)) return false;
          return val.some((item: any) => String(item?.label ?? '').toLowerCase().includes(fv.toLowerCase()));
        }
        if (fm.type.includes('applookup')) {
          const display = getApplookupDisplay(entity, fm.key, val);
          return String(display).toLowerCase().includes(fv.toLowerCase());
        }
        return String(val ?? '').toLowerCase().includes(fv.toLowerCase());
      });
    });
  }, [getRecords, filters, getFieldMeta, getApplookupDisplay, search]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(''); setSortDir('asc'); }
    } else { setSortKey(key); setSortDir('asc'); }
  }

  function sortRecords<T extends { fields: Record<string, any> }>(recs: T[]): T[] {
    if (!sortKey) return recs;
    return [...recs].sort((a, b) => {
      let va: any = a.fields[sortKey], vb: any = b.fields[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'object' && 'label' in va) va = va.label;
      if (typeof vb === 'object' && 'label' in vb) vb = vb.label;
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }

  const toggleSelect = useCallback((entity: EntityKey, id: string) => {
    setSelectedIds(prev => {
      const next = { ...prev, [entity]: new Set(prev[entity]) };
      if (next[entity].has(id)) next[entity].delete(id);
      else next[entity].add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((entity: EntityKey) => {
    const filtered = getFilteredRecords(entity);
    setSelectedIds(prev => {
      const allSelected = filtered.every((r: any) => prev[entity].has(r.record_id));
      const next = { ...prev, [entity]: new Set(prev[entity]) };
      if (allSelected) {
        filtered.forEach((r: any) => next[entity].delete(r.record_id));
      } else {
        filtered.forEach((r: any) => next[entity].add(r.record_id));
      }
      return next;
    });
  }, [getFilteredRecords]);

  const clearSelection = useCallback((entity: EntityKey) => {
    setSelectedIds(prev => ({ ...prev, [entity]: new Set() }));
  }, []);

  const getServiceMethods = useCallback((entity: EntityKey) => {
    switch (entity) {
      case 'kunden': return {
        create: (fields: any) => LivingAppsService.createKundenEntry(fields),
        update: (id: string, fields: any) => LivingAppsService.updateKundenEntry(id, fields),
        remove: (id: string) => LivingAppsService.deleteKundenEntry(id),
      };
      case 'material': return {
        create: (fields: any) => LivingAppsService.createMaterialEntry(fields),
        update: (id: string, fields: any) => LivingAppsService.updateMaterialEntry(id, fields),
        remove: (id: string) => LivingAppsService.deleteMaterialEntry(id),
      };
      case 'auftraege': return {
        create: (fields: any) => LivingAppsService.createAuftraegeEntry(fields),
        update: (id: string, fields: any) => LivingAppsService.updateAuftraegeEntry(id, fields),
        remove: (id: string) => LivingAppsService.deleteAuftraegeEntry(id),
      };
      case 'auftragspositionen': return {
        create: (fields: any) => LivingAppsService.createAuftragspositionenEntry(fields),
        update: (id: string, fields: any) => LivingAppsService.updateAuftragspositionenEntry(id, fields),
        remove: (id: string) => LivingAppsService.deleteAuftragspositionenEntry(id),
      };
      case 'pruefprotokoll': return {
        create: (fields: any) => LivingAppsService.createPruefprotokollEntry(fields),
        update: (id: string, fields: any) => LivingAppsService.updatePruefprotokollEntry(id, fields),
        remove: (id: string) => LivingAppsService.deletePruefprotokollEntry(id),
      };
      default: return null;
    }
  }, []);

  async function handleCreate(entity: EntityKey, fields: any) {
    const svc = getServiceMethods(entity);
    if (!svc) return;
    await svc.create(fields);
    fetchAll();
    setCreateEntity(null);
  }

  async function handleUpdate(fields: any) {
    if (!dialogState) return;
    const svc = getServiceMethods(dialogState.entity);
    if (!svc) return;
    await svc.update(dialogState.record.record_id, fields);
    fetchAll();
    setDialogState(null);
  }

  async function handleBulkDelete() {
    if (!deleteTargets) return;
    const svc = getServiceMethods(deleteTargets.entity);
    if (!svc) return;
    setBulkLoading(true);
    try {
      for (const id of deleteTargets.ids) {
        await svc.remove(id);
      }
      clearSelection(deleteTargets.entity);
      fetchAll();
    } finally {
      setBulkLoading(false);
      setDeleteTargets(null);
    }
  }

  async function handleBulkClone() {
    const svc = getServiceMethods(activeTab);
    if (!svc) return;
    setBulkLoading(true);
    try {
      const records = getRecords(activeTab);
      const ids = Array.from(selectedIds[activeTab]);
      for (const id of ids) {
        const rec = records.find((r: any) => r.record_id === id);
        if (!rec) continue;
        const clean = cleanFieldsForApi(rec.fields, activeTab);
        await svc.create(clean as any);
      }
      clearSelection(activeTab);
      fetchAll();
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkEdit(fieldKey: string, value: any) {
    if (!bulkEditOpen) return;
    const svc = getServiceMethods(bulkEditOpen);
    if (!svc) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds[bulkEditOpen]);
      for (const id of ids) {
        await svc.update(id, { [fieldKey]: value });
      }
      clearSelection(bulkEditOpen);
      fetchAll();
    } finally {
      setBulkLoading(false);
      setBulkEditOpen(null);
    }
  }

  function updateFilter(entity: EntityKey, fieldKey: string, value: string) {
    setFilters(prev => ({
      ...prev,
      [entity]: { ...prev[entity], [fieldKey]: value },
    }));
  }

  function clearEntityFilters(entity: EntityKey) {
    setFilters(prev => ({ ...prev, [entity]: {} }));
  }

  const activeFilterCount = useMemo(() => {
    const f = filters[activeTab] ?? {};
    return Object.values(f).filter(v => v && v !== '').length;
  }, [filters, activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-destructive">{error.message}</p>
        <Button onClick={fetchAll}>Erneut versuchen</Button>
      </div>
    );
  }

  const filtered = getFilteredRecords(activeTab);
  const sel = selectedIds[activeTab];
  const allFiltered = filtered.every((r: any) => sel.has(r.record_id)) && filtered.length > 0;
  const fieldMeta = getFieldMeta(activeTab);

  return (
    <PageShell
      title="Verwaltung"
      subtitle="Alle Daten verwalten"
      action={
        <Button onClick={() => setCreateEntity(activeTab)} className="shrink-0">
          <IconPlus className="h-4 w-4 mr-2" /> Hinzufügen
        </Button>
      }
    >
      <div className="flex gap-2 flex-wrap">
        {ENTITY_TABS.map(tab => {
          const count = getRecords(tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(''); setSortKey(''); setSortDir('asc'); fetchAll(); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label}
              <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-sm">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(f => !f)} className="gap-2">
            <IconFilter className="h-4 w-4" />
            Filtern
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => clearEntityFilters(activeTab)}>
              Filter zurücksetzen
            </Button>
          )}
        </div>
        {sel.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap bg-muted/60 rounded-lg px-3 py-1.5">
            <span className="text-sm font-medium">{sel.size} ausgewählt</span>
            <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(activeTab)}>
              <IconPencil className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Feld bearbeiten</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleBulkClone()}>
              <IconCopy className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Kopieren</span>
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteTargets({ entity: activeTab, ids: Array.from(sel) })}>
              <IconTrash className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Ausgewählte löschen</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => clearSelection(activeTab)}>
              <IconX className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Auswahl aufheben</span>
            </Button>
          </div>
        )}
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4 rounded-lg border bg-muted/30">
          {fieldMeta.map((fm: any) => (
            <div key={fm.key} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{fm.label}</label>
              {fm.type === 'bool' ? (
                <Select value={filters[activeTab]?.[fm.key] ?? ''} onValueChange={v => updateFilter(activeTab, fm.key, v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Alle" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle</SelectItem>
                    <SelectItem value="true">Ja</SelectItem>
                    <SelectItem value="false">Nein</SelectItem>
                  </SelectContent>
                </Select>
              ) : fm.type === 'lookup/select' || fm.type === 'lookup/radio' ? (
                <Select value={filters[activeTab]?.[fm.key] ?? ''} onValueChange={v => updateFilter(activeTab, fm.key, v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Alle" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle</SelectItem>
                    {fm.options?.map((o: any) => (
                      <SelectItem key={o.key} value={o.label}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8 text-xs"
                  placeholder="Filtern..."
                  value={filters[activeTab]?.[fm.key] ?? ''}
                  onChange={e => updateFilter(activeTab, fm.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-[27px] bg-card shadow-lg overflow-x-auto">
        <Table className="[&_tbody_td]:px-6 [&_tbody_td]:py-2 [&_tbody_td]:text-base [&_tbody_td]:font-medium [&_tbody_tr:first-child_td]:pt-6 [&_tbody_tr:last-child_td]:pb-10">
          <TableHeader className="bg-secondary">
            <TableRow className="border-b border-input">
              <TableHead className="w-10 px-6">
                <Checkbox
                  checked={allFiltered}
                  onCheckedChange={() => toggleSelectAll(activeTab)}
                />
              </TableHead>
              {fieldMeta.map((fm: any) => (
                <TableHead key={fm.key} className="uppercase text-xs font-semibold text-secondary-foreground tracking-wider px-6 cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort(fm.key)}>
                  <span className="inline-flex items-center gap-1">
                    {fm.label}
                    {sortKey === fm.key ? (sortDir === 'asc' ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />) : <IconArrowsUpDown size={14} className="opacity-30" />}
                  </span>
                </TableHead>
              ))}
              <TableHead className="w-24 uppercase text-xs font-semibold text-secondary-foreground tracking-wider px-6">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortRecords(filtered).map((record: any) => (
              <TableRow key={record.record_id} className={`transition-colors cursor-pointer ${sel.has(record.record_id) ? "bg-primary/5" : "hover:bg-muted/50"}`} onClick={(e) => { if ((e.target as HTMLElement).closest('button, [role="checkbox"]')) return; setViewState({ entity: activeTab, record }); }}>
                <TableCell>
                  <Checkbox
                    checked={sel.has(record.record_id)}
                    onCheckedChange={() => toggleSelect(activeTab, record.record_id)}
                  />
                </TableCell>
                {fieldMeta.map((fm: any) => {
                  const val = record.fields?.[fm.key];
                  if (fm.type === 'bool') {
                    return (
                      <TableCell key={fm.key}>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          val ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          {val ? 'Ja' : 'Nein'}
                        </span>
                      </TableCell>
                    );
                  }
                  if (fm.type === 'lookup/select' || fm.type === 'lookup/radio') {
                    return <TableCell key={fm.key}><span className="inline-flex items-center bg-secondary border border-[#bfdbfe] text-[#2563eb] rounded-[10px] px-2 py-1 text-sm font-medium">{val?.label ?? '—'}</span></TableCell>;
                  }
                  if (fm.type.startsWith('multiplelookup')) {
                    return <TableCell key={fm.key}>{Array.isArray(val) ? val.map((v: any) => v?.label ?? v).join(', ') : '—'}</TableCell>;
                  }
                  if (fm.type.startsWith('multipleapplookup')) {
                    return (
                      <TableCell key={fm.key}>
                        {Array.isArray(val) && val.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {val.map((url: any, i: number) => (
                              <span key={i} className="inline-flex items-center bg-secondary border border-[#bfdbfe] text-[#2563eb] rounded-[10px] px-2 py-1 text-sm font-medium">{getApplookupDisplay(activeTab, fm.key, url)}</span>
                            ))}
                          </div>
                        ) : '—'}
                      </TableCell>
                    );
                  }
                  if (fm.type.startsWith('applookup')) {
                    return <TableCell key={fm.key}><span className="inline-flex items-center bg-secondary border border-[#bfdbfe] text-[#2563eb] rounded-[10px] px-2 py-1 text-sm font-medium">{getApplookupDisplay(activeTab, fm.key, val)}</span></TableCell>;
                  }
                  if (fm.type.includes('date')) {
                    return <TableCell key={fm.key} className="text-muted-foreground">{fmtDate(val)}</TableCell>;
                  }
                  if (fm.type.startsWith('file')) {
                    return (
                      <TableCell key={fm.key}>
                        {val ? (
                          <div className="relative h-8 w-8 rounded bg-muted overflow-hidden">
                            <img src={val} alt="" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          </div>
                        ) : '—'}
                      </TableCell>
                    );
                  }
                  if (fm.type === 'string/textarea') {
                    return <TableCell key={fm.key} className="max-w-xs"><span className="truncate block">{val ?? '—'}</span></TableCell>;
                  }
                  if (fm.type === 'geo') {
                    return (
                      <TableCell key={fm.key} className="max-w-[200px]">
                        <span className="truncate block" title={val ? `${val.lat}, ${val.long}` : undefined}>
                          {val?.info ?? (val ? `${val.lat?.toFixed(4)}, ${val.long?.toFixed(4)}` : '—')}
                        </span>
                      </TableCell>
                    );
                  }
                  return <TableCell key={fm.key}>{val ?? '—'}</TableCell>;
                })}
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setDialogState({ entity: activeTab, record })}>
                      <IconPencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTargets({ entity: activeTab, ids: [record.record_id] })}>
                      <IconTrash className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={fieldMeta.length + 2} className="text-center py-16 text-muted-foreground">
                  Keine Ergebnisse gefunden.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {(createEntity === 'kunden' || dialogState?.entity === 'kunden') && (
        <KundenDialog
          open={createEntity === 'kunden' || dialogState?.entity === 'kunden'}
          onClose={() => { setCreateEntity(null); setDialogState(null); }}
          onSubmit={dialogState?.entity === 'kunden' ? handleUpdate : (fields: any) => handleCreate('kunden', fields)}
          defaultValues={dialogState?.entity === 'kunden' ? dialogState.record?.fields : undefined}
          enablePhotoScan={AI_PHOTO_SCAN['Kunden']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Kunden']}
        />
      )}
      {(createEntity === 'material' || dialogState?.entity === 'material') && (
        <MaterialDialog
          open={createEntity === 'material' || dialogState?.entity === 'material'}
          onClose={() => { setCreateEntity(null); setDialogState(null); }}
          onSubmit={dialogState?.entity === 'material' ? handleUpdate : (fields: any) => handleCreate('material', fields)}
          defaultValues={dialogState?.entity === 'material' ? dialogState.record?.fields : undefined}
          enablePhotoScan={AI_PHOTO_SCAN['Material']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Material']}
        />
      )}
      {(createEntity === 'auftraege' || dialogState?.entity === 'auftraege') && (
        <AuftraegeDialog
          open={createEntity === 'auftraege' || dialogState?.entity === 'auftraege'}
          onClose={() => { setCreateEntity(null); setDialogState(null); }}
          onSubmit={dialogState?.entity === 'auftraege' ? handleUpdate : (fields: any) => handleCreate('auftraege', fields)}
          defaultValues={dialogState?.entity === 'auftraege' ? dialogState.record?.fields : undefined}
          kundenList={(data as any).kunden ?? []}
          enablePhotoScan={AI_PHOTO_SCAN['Auftraege']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftraege']}
        />
      )}
      {(createEntity === 'auftragspositionen' || dialogState?.entity === 'auftragspositionen') && (
        <AuftragspositionenDialog
          open={createEntity === 'auftragspositionen' || dialogState?.entity === 'auftragspositionen'}
          onClose={() => { setCreateEntity(null); setDialogState(null); }}
          onSubmit={dialogState?.entity === 'auftragspositionen' ? handleUpdate : (fields: any) => handleCreate('auftragspositionen', fields)}
          defaultValues={dialogState?.entity === 'auftragspositionen' ? dialogState.record?.fields : undefined}
          auftraegeList={(data as any).auftraege ?? []}
          materialList={(data as any).material ?? []}
          enablePhotoScan={AI_PHOTO_SCAN['Auftragspositionen']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Auftragspositionen']}
        />
      )}
      {(createEntity === 'pruefprotokoll' || dialogState?.entity === 'pruefprotokoll') && (
        <PruefprotokollDialog
          open={createEntity === 'pruefprotokoll' || dialogState?.entity === 'pruefprotokoll'}
          onClose={() => { setCreateEntity(null); setDialogState(null); }}
          onSubmit={dialogState?.entity === 'pruefprotokoll' ? handleUpdate : (fields: any) => handleCreate('pruefprotokoll', fields)}
          defaultValues={dialogState?.entity === 'pruefprotokoll' ? dialogState.record?.fields : undefined}
          auftraegeList={(data as any).auftraege ?? []}
          enablePhotoScan={AI_PHOTO_SCAN['Pruefprotokoll']}
          enablePhotoLocation={AI_PHOTO_LOCATION['Pruefprotokoll']}
        />
      )}
      {viewState?.entity === 'kunden' && (
        <KundenViewDialog
          open={viewState?.entity === 'kunden'}
          onClose={() => setViewState(null)}
          record={viewState?.record}
          onEdit={(r: any) => { setViewState(null); setDialogState({ entity: 'kunden', record: r }); }}
        />
      )}
      {viewState?.entity === 'material' && (
        <MaterialViewDialog
          open={viewState?.entity === 'material'}
          onClose={() => setViewState(null)}
          record={viewState?.record}
          onEdit={(r: any) => { setViewState(null); setDialogState({ entity: 'material', record: r }); }}
        />
      )}
      {viewState?.entity === 'auftraege' && (
        <AuftraegeViewDialog
          open={viewState?.entity === 'auftraege'}
          onClose={() => setViewState(null)}
          record={viewState?.record}
          onEdit={(r: any) => { setViewState(null); setDialogState({ entity: 'auftraege', record: r }); }}
          kundenList={(data as any).kunden ?? []}
        />
      )}
      {viewState?.entity === 'auftragspositionen' && (
        <AuftragspositionenViewDialog
          open={viewState?.entity === 'auftragspositionen'}
          onClose={() => setViewState(null)}
          record={viewState?.record}
          onEdit={(r: any) => { setViewState(null); setDialogState({ entity: 'auftragspositionen', record: r }); }}
          auftraegeList={(data as any).auftraege ?? []}
          materialList={(data as any).material ?? []}
        />
      )}
      {viewState?.entity === 'pruefprotokoll' && (
        <PruefprotokollViewDialog
          open={viewState?.entity === 'pruefprotokoll'}
          onClose={() => setViewState(null)}
          record={viewState?.record}
          onEdit={(r: any) => { setViewState(null); setDialogState({ entity: 'pruefprotokoll', record: r }); }}
          auftraegeList={(data as any).auftraege ?? []}
        />
      )}

      <BulkEditDialog
        open={!!bulkEditOpen}
        onClose={() => setBulkEditOpen(null)}
        onApply={handleBulkEdit}
        fields={bulkEditOpen ? getFieldMeta(bulkEditOpen) : []}
        selectedCount={bulkEditOpen ? selectedIds[bulkEditOpen].size : 0}
        loading={bulkLoading}
        lookupLists={bulkEditOpen ? getLookupLists(bulkEditOpen) : {}}
      />

      <ConfirmDialog
        open={!!deleteTargets}
        onClose={() => setDeleteTargets(null)}
        onConfirm={handleBulkDelete}
        title="Ausgewählte löschen"
        description={`Sollen ${deleteTargets?.ids.length ?? 0} Einträge wirklich gelöscht werden? Diese Aktion kann nicht rückgängig gemacht werden.`}
      />
    </PageShell>
  );
}