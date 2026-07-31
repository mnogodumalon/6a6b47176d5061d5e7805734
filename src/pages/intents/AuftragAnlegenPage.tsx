/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftragsdaten erfassen → 3) Materialpositionen hinzufügen & bestätigen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  IconUser,
  IconBuilding,
  IconPackage,
  IconPlus,
  IconTrash,
  IconCheck,
  IconClipboardList,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionEntry {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard navigation
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2 — Auftragsdaten
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [prioritaet, setPrioritaet] = useState(PRIORITAET_OPTIONS[1]?.key ?? '');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [step2Loading, setStep2Loading] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // Step 3 — Positionen
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [selectedMaterialForAdd, setSelectedMaterialForAdd] = useState<Material | null>(null);
  const [addMenge, setAddMenge] = useState('1');
  const [addEinheitKey, setAddEinheitKey] = useState('none');
  const [addBeschreibung, setAddBeschreibung] = useState('');
  const [step3Loading, setStep3Loading] = useState(false);
  const [step3Error, setStep3Error] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset wizard
  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedKunde(null);
    setShowKundeCreate(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeueTelefon('');
    setKundeCreateError(null);
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setAuftragsbeschreibung('');
    setPrioritaet(PRIORITAET_OPTIONS[1]?.key ?? '');
    setWunschtermin('');
    setMonteur('');
    setStep2Error(null);
    setCreatedAuftragId(null);
    setPositions([]);
    setMaterialSearch('');
    setSelectedMaterialForAdd(null);
    setAddMenge('1');
    setAddEinheitKey('none');
    setAddBeschreibung('');
    setStep3Error(null);
    setDone(false);
  }, []);

  // --- Step 1 Handlers ---
  const handleSelectKunde = useCallback((id: string) => {
    const k = kunden.find(k => k.record_id === id) ?? null;
    setSelectedKunde(k);
    setStep(2);
  }, [kunden]);

  const handleCreateKunde = useCallback(async () => {
    if (!neuerVorname.trim() || !neuerNachname.trim()) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim(),
        nachname: neuerNachname.trim(),
        telefon: neueTelefon.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeueTelefon('');
      setSelectedKunde({ record_id: created.record_id, created_at: '', updated_at: null, createdat: '', updatedat: null, fields: { vorname: neuerVorname.trim(), nachname: neuerNachname.trim(), telefon: neueTelefon.trim() || undefined } });
      setStep(2);
    } catch (e) {
      setKundeCreateError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreateLoading(false);
    }
  }, [neuerVorname, neuerNachname, neueTelefon, fetchAll]);

  // --- Step 2 Handlers ---
  const handleCreateAuftrag = useCallback(async () => {
    if (!selectedKunde || !auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()) return;

    // idempotency guard — if already created, just advance
    if (createdAuftragId) {
      setStep(3);
      return;
    }

    setStep2Loading(true);
    setStep2Error(null);
    try {
      const fields: Parameters<typeof LivingAppsService.createAuftraegeEntry>[0] = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum: auftragsdatum,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        status: 'offen',
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
      };
      if (prioritaet) fields.prioritaet = prioritaet;
      if (wunschtermin) fields.wunschtermin = wunschtermin;
      if (monteur.trim()) fields.monteur = monteur.trim();

      const result = await LivingAppsService.createAuftraegeEntry(fields);
      setCreatedAuftragId(result.record_id);
      setStep(3);
    } catch (e) {
      setStep2Error(e instanceof Error ? e.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setStep2Loading(false);
    }
  }, [selectedKunde, auftragsnummer, auftragsdatum, auftragsbeschreibung, prioritaet, wunschtermin, monteur, createdAuftragId]);

  // --- Step 3 Handlers ---
  const availableMaterial = material.filter(m =>
    m.fields.verfuegbarkeit?.key === 'verfuegbar' || m.fields.verfuegbarkeit?.key === 'auf_bestellung'
  );

  const filteredMaterial = materialSearch
    ? availableMaterial.filter(m =>
        (m.fields.bezeichnung ?? '').toLowerCase().includes(materialSearch.toLowerCase()) ||
        (m.fields.artikelnummer ?? '').toLowerCase().includes(materialSearch.toLowerCase())
      )
    : availableMaterial;

  const handleAddPosition = useCallback(() => {
    if (!selectedMaterialForAdd || !addMenge || parseFloat(addMenge) <= 0) return;
    setPositions(prev => [...prev, {
      materialId: selectedMaterialForAdd.record_id,
      materialName: selectedMaterialForAdd.fields.bezeichnung ?? selectedMaterialForAdd.record_id,
      menge: addMenge,
      einheitKey: addEinheitKey,
      positionsbeschreibung: addBeschreibung.trim(),
    }]);
    setSelectedMaterialForAdd(null);
    setAddMenge('1');
    setAddEinheitKey('none');
    setAddBeschreibung('');
    setMaterialSearch('');
  }, [selectedMaterialForAdd, addMenge, addEinheitKey, addBeschreibung]);

  const handleRemovePosition = useCallback((idx: number) => {
    setPositions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleFinish = useCallback(async () => {
    if (!createdAuftragId) return;
    setStep3Loading(true);
    setStep3Error(null);
    try {
      for (const pos of positions) {
        const posFields: Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0] = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: parseFloat(pos.menge),
        };
        if (pos.einheitKey && pos.einheitKey !== 'none') posFields.einheit_position = pos.einheitKey;
        if (pos.positionsbeschreibung) posFields.positionsbeschreibung = pos.positionsbeschreibung;
        await LivingAppsService.createAuftragspositionenEntry(posFields);
      }
      setDone(true);
    } catch (e) {
      setStep3Error(e instanceof Error ? e.message : 'Fehler beim Speichern der Positionen');
    } finally {
      setStep3Loading(false);
    }
  }, [createdAuftragId, positions]);

  const kundenName = (k: Kunden) => {
    const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
    return parts || k.record_id;
  };

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde wählen, Auftrag erfassen und Materialpositionen hinzufügen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Material' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ========== SCHRITT 1: KUNDE WÄHLEN ========== */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Kunde auswählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle einen bestehenden Kunden oder lege einen neuen an.
            </p>
          </div>
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: kundenName(k),
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: k.fields.firma
                ? <IconBuilding size={20} className="text-primary" />
                : <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectKunde}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden."
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(v => !v)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <p className="text-sm font-medium">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="Vorname *"
                    value={neuerVorname}
                    onChange={e => setNeuerVorname(e.target.value)}
                  />
                  <Input
                    placeholder="Nachname *"
                    value={neuerNachname}
                    onChange={e => setNeuerNachname(e.target.value)}
                  />
                </div>
                <Input
                  placeholder="Telefon (optional)"
                  value={neueTelefon}
                  onChange={e => setNeueTelefon(e.target.value)}
                />
                {kundeCreateError && (
                  <p className="text-sm text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    disabled={!neuerVorname.trim() || !neuerNachname.trim() || kundeCreateLoading}
                    onClick={handleCreateKunde}
                  >
                    {kundeCreateLoading ? 'Wird angelegt…' : 'Kunden anlegen & auswählen'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowKundeCreate(false)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ========== SCHRITT 2: AUFTRAGSDATEN ========== */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Auftragsdaten erfassen</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Kunde: <span className="font-medium text-foreground">{kundenName(selectedKunde)}</span>
                {selectedKunde.fields.firma && (
                  <span className="text-muted-foreground"> · {selectedKunde.fields.firma}</span>
                )}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Auftragsnummer *</label>
                <Input
                  placeholder="z. B. AU-2026-001"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Auftragsdatum *</label>
                <Input
                  type="date"
                  value={auftragsdatum}
                  onChange={e => setAuftragsdatum(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Beschreibung *</label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Was soll gemacht werden?"
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Priorität</label>
                <div className="flex flex-wrap gap-2">
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPrioritaet(opt.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        prioritaet === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Wunschtermin (optional)</label>
                <Input
                  type="datetime-local"
                  value={wunschtermin}
                  onChange={e => setWunschtermin(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Monteur (optional)</label>
                <Input
                  placeholder="Name des Monteurs"
                  value={monteur}
                  onChange={e => setMonteur(e.target.value)}
                />
              </div>
            </div>

            {step2Error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {step2Error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                disabled={!auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim() || step2Loading}
                onClick={handleCreateAuftrag}
              >
                {step2Loading ? 'Wird angelegt…' : 'Auftrag anlegen & weiter'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht einen ausgewählten Kunden aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ========== SCHRITT 3: MATERIALPOSITIONEN ========== */}
      {step === 3 && (
        createdAuftragId ? (
          done ? (
            /* Erfolg */
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <IconCheck size={24} className="text-primary" />
                </div>
                <h2 className="text-xl font-bold">Auftrag erfolgreich angelegt!</h2>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Kunde: <span className="font-medium text-foreground">
                      {selectedKunde ? kundenName(selectedKunde) : '–'}
                    </span>
                  </p>
                  <p>
                    Auftragsnummer: <span className="font-medium text-foreground">{auftragsnummer}</span>
                  </p>
                  <p>
                    Materialpositionen: <span className="font-medium text-foreground">{positions.length}</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={handleReset}>
                  <IconClipboardList size={16} className="mr-2" />
                  Neuen Auftrag anlegen
                </Button>
                <a href="#/">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Materialpositionen hinzufügen</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Auftrag <span className="font-medium text-foreground">{auftragsnummer}</span> —
                  {' '}{positions.length} {positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
                </p>
              </div>

              {/* Material suchen & auswählen */}
              {!selectedMaterialForAdd ? (
                <div className="space-y-3">
                  <label className="text-sm font-medium block">Material auswählen</label>
                  <div className="relative">
                    <Input
                      placeholder="Material suchen..."
                      value={materialSearch}
                      onChange={e => setMaterialSearch(e.target.value)}
                      className="pl-9"
                    />
                    <IconPackage size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredMaterial.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        Kein verfügbares Material gefunden.
                      </p>
                    ) : (
                      filteredMaterial.map(m => (
                        <button
                          key={m.record_id}
                          type="button"
                          onClick={() => setSelectedMaterialForAdd(m)}
                          className="w-full text-left flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent hover:border-primary/30 transition-colors overflow-hidden"
                        >
                          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <IconPackage size={18} className="text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {m.fields.bezeichnung ?? m.record_id}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[
                                m.fields.artikelnummer && `Art.-Nr. ${m.fields.artikelnummer}`,
                                m.fields.einheit?.label,
                                m.fields.verfuegbarkeit?.label,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                /* Menge & Einheit erfassen */
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {selectedMaterialForAdd.fields.bezeichnung ?? selectedMaterialForAdd.record_id}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedMaterialForAdd(null)}
                    >
                      Anderes wählen
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Menge *</label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="1"
                        value={addMenge}
                        onChange={e => setAddMenge(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Einheit</label>
                      <Select value={addEinheitKey} onValueChange={setAddEinheitKey}>
                        <SelectTrigger>
                          <SelectValue placeholder="Einheit wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Einheit</SelectItem>
                          {EINHEIT_OPTIONS.map(opt => (
                            <SelectItem key={opt.key} value={opt.key}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Beschreibung (optional)</label>
                    <Input
                      placeholder="z. B. für Außenwand"
                      value={addBeschreibung}
                      onChange={e => setAddBeschreibung(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!addMenge || parseFloat(addMenge) <= 0}
                    onClick={handleAddPosition}
                  >
                    <IconPlus size={16} className="mr-2" />
                    Position hinzufügen
                  </Button>
                </div>
              )}

              {/* Hinzugefügte Positionen */}
              {positions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Hinzugefügte Positionen ({positions.length})
                  </p>
                  <div className="space-y-2">
                    {positions.map((pos, idx) => {
                      const einheitLabel = pos.einheitKey !== 'none'
                        ? EINHEIT_OPTIONS.find(o => o.key === pos.einheitKey)?.label
                        : undefined;
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{pos.materialName}</p>
                            <p className="text-xs text-muted-foreground">
                              {pos.menge}{einheitLabel ? ` ${einheitLabel}` : ''}
                              {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemovePosition(idx)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                            aria-label="Position entfernen"
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {step3Error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                  {step3Error}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  disabled={step3Loading}
                  onClick={handleFinish}
                >
                  {step3Loading
                    ? 'Wird gespeichert…'
                    : positions.length === 0
                    ? 'Auftrag ohne Positionen abschließen'
                    : `${positions.length} ${positions.length === 1 ? 'Position' : 'Positionen'} speichern & abschließen`}
                </Button>
                <Button variant="outline" onClick={() => setStep(2)}>
                  Zurück
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht einen angelegten Auftrag aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
