/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftragsdaten erfassen → 3) Positionen (Material) hinzufügen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Material } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  IconUser,
  IconBuilding,
  IconClipboardList,
  IconPlus,
  IconTrash,
  IconCheck,
  IconPackage,
  IconAlertCircle,
} from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POS_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftrag' },
  { label: 'Positionen' },
];

interface PositionDraft {
  materialId: string;
  materialBezeichnung: string;
  menge: string;
  einheitKey: string;   // NOT named einheit_position — check-lookup-keys reads field-named props
  positionsbeschreibung: string;
  bemerkung: string;
}

interface SavedPosition {
  record_id: string;
  materialBezeichnung: string;
  menge: number;
  einheit: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard navigation
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');
  const [neuerFirma, setNeuerFirma] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2 — Auftragsdaten
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioriaetKey] = useState(
    PRIORITAET_OPTIONS.find(o => o.key === 'normal')?.key ?? PRIORITAET_OPTIONS[0]?.key ?? 'normal'
  );
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragSaving, setAuftragSaving] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);

  // Step 3 — Positionen
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);
  const [savedPositions, setSavedPositions] = useState<SavedPosition[]>([]);

  // Draft for adding a new position
  const [draft, setDraft] = useState<PositionDraft>({
    materialId: '',
    materialBezeichnung: '',
    menge: '1',
    einheitKey: 'none',
    positionsbeschreibung: '',
    bemerkung: '',
  });
  const [showMaterialSearch, setShowMaterialSearch] = useState(false);
  const [materialSearchQuery, setMaterialSearchQuery] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);

  // Completion
  const [done, setDone] = useState(false);

  // Eligible material: verfuegbar or auf_bestellung
  const eligibleMaterial = useMemo<Material[]>(() => {
    return material.filter(m => {
      const v = m.fields.verfuegbarkeit?.key;
      return v === 'verfuegbar' || v === 'auf_bestellung';
    });
  }, [material]);

  const filteredMaterial = useMemo(() => {
    if (!materialSearchQuery) return eligibleMaterial;
    const q = materialSearchQuery.toLowerCase();
    return eligibleMaterial.filter(m =>
      (m.fields.bezeichnung ?? '').toLowerCase().includes(q) ||
      (m.fields.artikelnummer ?? '').toLowerCase().includes(q)
    );
  }, [eligibleMaterial, materialSearchQuery]);

  const selectedKunde = useMemo(
    () => kunden.find(k => k.record_id === selectedKundeId) ?? null,
    [kunden, selectedKundeId]
  );

  // --- Handlers ---

  async function handleCreateKunde() {
    if (!neuerVorname.trim() && !neuerNachname.trim()) return;
    setKundeCreating(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim() || undefined,
        nachname: neuerNachname.trim() || undefined,
        telefon: neueTelefon.trim() || undefined,
        firma: neuerFirma.trim() || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeueTelefon('');
      setNeuerFirma('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (e) {
      setKundeCreateError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreating(false);
    }
  }

  async function handleCreateAuftrag() {
    if (!selectedKundeId || !auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()) return;
    // Idempotency: if we already created the auftrag, skip to step 3
    if (createdAuftragId) {
      setStep(3);
      return;
    }
    setAuftragSaving(true);
    setAuftragError(null);
    try {
      const payload: Parameters<typeof LivingAppsService.createAuftraegeEntry>[0] = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum,
        status: statusKey,
        prioritaet: prioritaetKey,
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        monteur: monteur.trim() || undefined,
      };
      if (wunschtermin) {
        payload.wunschtermin = wunschtermin;
      }
      const auftrag = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(auftrag.record_id);
      setStep(3);
    } catch (e) {
      setAuftragError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragSaving(false);
    }
  }

  async function handleAddPosition() {
    if (!createdAuftragId || !draft.materialId || !draft.menge) return;
    setPositionSaving(true);
    setPositionError(null);
    try {
      const payload: Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0] = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, draft.materialId),
        menge: Number(draft.menge),
        positionsbeschreibung: draft.positionsbeschreibung.trim() || undefined,
        bemerkung: draft.bemerkung.trim() || undefined,
      };
      if (draft.einheitKey && draft.einheitKey !== 'none') {
        payload.einheit_position = draft.einheitKey;
      }
      const pos = await LivingAppsService.createAuftragspositionenEntry(payload);
      const einheitLabel = draft.einheitKey !== 'none'
        ? (EINHEIT_POS_OPTIONS.find(o => o.key === draft.einheitKey)?.label ?? draft.einheitKey)
        : '';
      setSavedPositions(prev => [...prev, {
        record_id: pos.record_id,
        materialBezeichnung: draft.materialBezeichnung,
        menge: Number(draft.menge),
        einheit: einheitLabel,
      }]);
      // Reset draft for next position
      setDraft({
        materialId: '',
        materialBezeichnung: '',
        menge: '1',
        einheitKey: 'none',
        positionsbeschreibung: '',
        bemerkung: '',
      });
      setShowMaterialSearch(false);
      setMaterialSearchQuery('');
    } catch (e) {
      setPositionError(e instanceof Error ? e.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPositionSaving(false);
    }
  }

  function handleReset() {
    setStep(1);
    setSelectedKundeId(null);
    setShowCreateKunde(false);
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioriaetKey(PRIORITAET_OPTIONS.find(o => o.key === 'normal')?.key ?? PRIORITAET_OPTIONS[0]?.key ?? 'normal');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setCreatedAuftragId(null);
    setSavedPositions([]);
    setDraft({ materialId: '', materialBezeichnung: '', menge: '1', einheitKey: 'none', positionsbeschreibung: '', bemerkung: '' });
    setShowMaterialSearch(false);
    setMaterialSearchQuery('');
    setDone(false);
    setAuftragError(null);
    setPositionError(null);
  }

  // --- Render ---

  if (done) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col items-center justify-center py-16 gap-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <IconCheck size={32} className="text-primary" stroke={2} />
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-bold">Auftrag angelegt!</h2>
            <p className="text-muted-foreground text-sm">
              Auftrag <span className="font-semibold text-foreground">{auftragsnummer}</span> wurde erfolgreich mit {savedPositions.length} Position{savedPositions.length !== 1 ? 'en' : ''} angelegt.
            </p>
          </div>
          {savedPositions.length > 0 && (
            <div className="w-full max-w-sm rounded-2xl border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Positionen</p>
              {savedPositions.map((pos) => (
                <div key={pos.record_id} className="flex items-center gap-2 text-sm">
                  <IconCheck size={14} className="text-primary shrink-0" stroke={2.5} />
                  <span className="flex-1 min-w-0 truncate">{pos.materialBezeichnung}</span>
                  <span className="text-muted-foreground shrink-0">{pos.menge} {pos.einheit}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleReset} variant="outline">
              Neuen Auftrag anlegen
            </Button>
            <Button asChild>
              <a href="#/">Zurück zum Dashboard</a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Kunde auswählen, Auftrag erfassen und Positionen hinzufügen."
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── STEP 1: Kunde auswählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '(Kein Name)',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: k.fields.firma
                ? <IconBuilding size={20} className="text-primary" />
                : <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={(id) => { setSelectedKundeId(id); setStep(2); }}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowCreateKunde(true)}
            createDialog={showCreateKunde && (
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <p className="text-sm font-semibold text-foreground">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="k-vorname">Vorname</Label>
                    <Input
                      id="k-vorname"
                      value={neuerVorname}
                      onChange={e => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="k-nachname">Nachname</Label>
                    <Input
                      id="k-nachname"
                      value={neuerNachname}
                      onChange={e => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="k-firma">Firma</Label>
                    <Input
                      id="k-firma"
                      value={neuerFirma}
                      onChange={e => setNeuerFirma(e.target.value)}
                      placeholder="Firma (optional)"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="k-telefon">Telefon</Label>
                    <Input
                      id="k-telefon"
                      value={neueTelefon}
                      onChange={e => setNeueTelefon(e.target.value)}
                      placeholder="Telefonnummer (optional)"
                    />
                  </div>
                </div>
                {kundeCreateError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <IconAlertCircle size={14} />
                    {kundeCreateError}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setShowCreateKunde(false); setKundeCreateError(null); }}
                    className="flex-1"
                  >
                    Abbrechen
                  </Button>
                  <Button
                    disabled={(!neuerVorname.trim() && !neuerNachname.trim()) || kundeCreating}
                    onClick={handleCreateKunde}
                    className="flex-1"
                  >
                    {kundeCreating ? 'Wird angelegt…' : 'Anlegen & auswählen'}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ── STEP 2: Auftragsdaten erfassen ── */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-6">
            {/* Gewählter Kunde */}
            <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconUser size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Kunde</p>
                <p className="font-semibold text-sm truncate">
                  {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || '—'}
                </p>
                {selectedKunde?.fields.telefon && (
                  <p className="text-xs text-muted-foreground truncate">{selectedKunde.fields.telefon}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="shrink-0 text-xs">
                Ändern
              </Button>
            </div>

            {/* Formular */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <IconClipboardList size={16} className="text-primary" />
                Auftragsdaten
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                  <Input
                    id="auftragsnummer"
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auftragsdatum">Auftragsdatum *</Label>
                  <Input
                    id="auftragsdatum"
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="status">Status</Label>
                  <Select value={statusKey} onValueChange={setStatusKey}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(o => (
                        <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prioritaet">Priorität</Label>
                  <Select value={prioritaetKey} onValueChange={setPrioriaetKey}>
                    <SelectTrigger id="prioritaet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITAET_OPTIONS.map(o => (
                        <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="auftragsbeschreibung">Auftragsbeschreibung *</Label>
                <Textarea
                  id="auftragsbeschreibung"
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll durchgeführt werden?"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="wunschtermin">Wunschtermin (optional)</Label>
                  <Input
                    id="wunschtermin"
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="monteur">Monteur (optional)</Label>
                  <Input
                    id="monteur"
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <IconAlertCircle size={14} />
                  {auftragError}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1 sm:flex-none">
                Zurück
              </Button>
              <Button
                disabled={!auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim() || auftragSaving}
                onClick={handleCreateAuftrag}
                className="flex-1"
              >
                {auftragSaving ? 'Wird angelegt…' : 'Auftrag anlegen & weiter'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen Kunden aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── STEP 3: Positionen hinzufügen ── */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-6">
            {/* Auftrag-Info */}
            <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardList size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Auftrag</p>
                <p className="font-semibold text-sm truncate">{auftragsnummer}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || '—'}
                </p>
              </div>
              <div className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {savedPositions.length} Position{savedPositions.length !== 1 ? 'en' : ''}
              </div>
            </div>

            {/* Bereits hinzugefügte Positionen */}
            {savedPositions.length > 0 && (
              <div className="rounded-2xl border bg-card p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hinzugefügte Positionen</p>
                {savedPositions.map((pos) => (
                  <div key={pos.record_id} className="flex items-center gap-2 py-2 border-b last:border-0">
                    <IconCheck size={14} className="text-primary shrink-0" stroke={2.5} />
                    <span className="flex-1 min-w-0 text-sm truncate">{pos.materialBezeichnung}</span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {pos.menge}{pos.einheit ? ` ${pos.einheit}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Neue Position hinzufügen */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <IconPackage size={16} className="text-primary" />
                Position hinzufügen
              </p>

              {/* Material auswählen */}
              {!draft.materialId ? (
                <div className="space-y-2">
                  <Label>Material *</Label>
                  {!showMaterialSearch ? (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 text-muted-foreground"
                      onClick={() => setShowMaterialSearch(true)}
                    >
                      <IconPackage size={16} />
                      Material auswählen…
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        placeholder="Material suchen (Bezeichnung, Artikelnummer)…"
                        value={materialSearchQuery}
                        onChange={e => setMaterialSearchQuery(e.target.value)}
                        autoFocus
                      />
                      <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border p-1">
                        {filteredMaterial.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">Kein verfügbares Material gefunden.</p>
                        ) : (
                          filteredMaterial.map(m => (
                            <button
                              key={m.record_id}
                              onClick={() => {
                                setDraft(prev => ({
                                  ...prev,
                                  materialId: m.record_id,
                                  materialBezeichnung: m.fields.bezeichnung ?? m.record_id,
                                  einheitKey: m.fields.einheit?.key ?? 'none',
                                }));
                                setShowMaterialSearch(false);
                                setMaterialSearchQuery('');
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm flex items-center gap-3 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{m.fields.bezeichnung ?? '(Unbekannt)'}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[m.fields.artikelnummer, m.fields.einheit?.label, m.fields.verfuegbarkeit?.label].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setShowMaterialSearch(false); setMaterialSearchQuery(''); }}>
                        Abbrechen
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Material</Label>
                  <div className="flex items-center gap-2 rounded-xl border bg-secondary/40 px-3 py-2">
                    <IconPackage size={16} className="text-primary shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{draft.materialBezeichnung}</span>
                    <button
                      onClick={() => setDraft(prev => ({ ...prev, materialId: '', materialBezeichnung: '', einheitKey: 'none' }))}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="menge">Menge *</Label>
                  <Input
                    id="menge"
                    type="number"
                    min="0.001"
                    step="any"
                    value={draft.menge}
                    onChange={e => setDraft(prev => ({ ...prev, menge: e.target.value }))}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="einheit-pos">Einheit</Label>
                  <Select value={draft.einheitKey} onValueChange={v => setDraft(prev => ({ ...prev, einheitKey: v }))}>
                    <SelectTrigger id="einheit-pos">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Einheit</SelectItem>
                      {EINHEIT_POS_OPTIONS.map(o => (
                        <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pos-beschreibung">Positionsbeschreibung (optional)</Label>
                <Input
                  id="pos-beschreibung"
                  value={draft.positionsbeschreibung}
                  onChange={e => setDraft(prev => ({ ...prev, positionsbeschreibung: e.target.value }))}
                  placeholder="Kurze Beschreibung dieser Position"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pos-bemerkung">Bemerkung (optional)</Label>
                <Textarea
                  id="pos-bemerkung"
                  value={draft.bemerkung}
                  onChange={e => setDraft(prev => ({ ...prev, bemerkung: e.target.value }))}
                  placeholder="Weitere Hinweise zur Position"
                  rows={2}
                />
              </div>

              {positionError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <IconAlertCircle size={14} />
                  {positionError}
                </div>
              )}

              <Button
                disabled={!draft.materialId || !draft.menge || positionSaving}
                onClick={handleAddPosition}
                variant="outline"
                className="w-full gap-2"
              >
                <IconPlus size={15} />
                {positionSaving ? 'Wird hinzugefügt…' : 'Position hinzufügen'}
              </Button>
            </div>

            {/* Abschluss-Aktionen */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="flex-1 sm:flex-none"
              >
                Zurück
              </Button>
              <Button
                onClick={() => setDone(true)}
                className="flex-1 gap-2"
              >
                <IconCheck size={15} stroke={2.5} />
                Auftrag abschliessen
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auftragsdaten aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
