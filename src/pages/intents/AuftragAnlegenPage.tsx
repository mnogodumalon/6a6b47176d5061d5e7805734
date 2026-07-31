/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftrag anlegen (Mini-Form) → 3) Positionen hinzufügen → Zusammenfassung.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import {
  IconUser,
  IconBox,
  IconPlus,
  IconCheck,
  IconTrash,
  IconClipboardList,
} from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

const TODAY = format(new Date(), 'yyyy-MM-dd');

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftrag' },
  { label: 'Positionen' },
  { label: 'Fertig' },
];

interface PositionRow {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Deep-link: read kundeId from URL
  const urlKundeId = searchParams.get('kundeId') ?? '';
  const urlStep = parseInt(searchParams.get('step') ?? '1', 10);
  const initialStep = urlStep >= 1 && urlStep <= 4 ? urlStep : 1;

  // Wizard step state
  const [step, setStep] = useState(initialStep);

  // Step 1: selected Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string>(urlKundeId);

  // Step 2: Auftrag form
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(TODAY);
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragSubmitting, setAuftragSubmitting] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);

  // Created auftrag
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // Step 3: Positionen
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [addMaterialId, setAddMaterialId] = useState('');
  const [addMenge, setAddMenge] = useState('1');
  const [addEinheitKey, setAddEinheitKey] = useState('none');
  const [addBeschreibung, setAddBeschreibung] = useState('');
  const [addingPosition, setAddingPosition] = useState(false);
  const [addPositionError, setAddPositionError] = useState<string | null>(null);
  const [finishingUp, setFinishingUp] = useState(false);

  // Step 3 material search
  const [materialSearch, setMaterialSearch] = useState('');

  // Step 1 helpers
  const getKundeName = useCallback(
    (k: Kunden) => {
      const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : '(Kein Name)';
    },
    []
  );

  const selectedKunde = kunden.find(k => k.record_id === selectedKundeId) ?? null;

  // Step 2: submit auftrag
  const handleAuftragSubmit = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim() || !selectedKundeId) return;
    setAuftragSubmitting(true);
    setAuftragError(null);
    try {
      // Idempotency guard: if already created, proceed
      let auftragId = createdAuftragId;
      if (!auftragId) {
        const payload: Record<string, unknown> = {
          auftragsnummer: auftragsnummer.trim(),
          auftragsdatum: auftragsdatum,
          status: statusKey,
          auftragsbeschreibung: auftragsbeschreibung.trim(),
          kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
        };
        if (prioritaetKey && prioritaetKey !== 'none') {
          payload.prioritaet = prioritaetKey;
        }
        if (wunschtermin) {
          payload.wunschtermin = wunschtermin;
        }
        if (monteur.trim()) {
          payload.monteur = monteur.trim();
        }
        const result = await LivingAppsService.createAuftraegeEntry(payload as Parameters<typeof LivingAppsService.createAuftraegeEntry>[0]);
        auftragId = result.record_id;
        setCreatedAuftragId(auftragId);
      }
      await fetchAll();
      setStep(3);
    } catch (err) {
      setAuftragError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags.');
    } finally {
      setAuftragSubmitting(false);
    }
  };

  // Step 3: add a position
  const handleAddPosition = async () => {
    if (!addMaterialId || !addMenge || !createdAuftragId) return;
    const mengeNum = parseFloat(addMenge);
    if (isNaN(mengeNum) || mengeNum <= 0) return;

    setAddingPosition(true);
    setAddPositionError(null);
    try {
      const mat = material.find(m => m.record_id === addMaterialId);
      const payload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, addMaterialId),
        menge: mengeNum,
      };
      if (addEinheitKey && addEinheitKey !== 'none') {
        payload.einheit_position = addEinheitKey;
      }
      if (addBeschreibung.trim()) {
        payload.positionsbeschreibung = addBeschreibung.trim();
      }
      await LivingAppsService.createAuftragspositionenEntry(payload as Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0]);

      setPositions(prev => [
        ...prev,
        {
          materialId: addMaterialId,
          materialName: mat?.fields.bezeichnung ?? addMaterialId,
          menge: addMenge,
          einheitKey: addEinheitKey,
          positionsbeschreibung: addBeschreibung.trim(),
        },
      ]);
      // Reset form
      setAddMaterialId('');
      setAddMenge('1');
      setAddEinheitKey('none');
      setAddBeschreibung('');
      setShowAddPosition(false);
    } catch (err) {
      setAddPositionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position.');
    } finally {
      setAddingPosition(false);
    }
  };

  const handleRemovePosition = (idx: number) => {
    setPositions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleFinish = async () => {
    setFinishingUp(true);
    await fetchAll();
    setFinishingUp(false);
    setStep(4);
  };

  const handleReset = () => {
    setSelectedKundeId('');
    setAuftragsnummer('');
    setAuftragsdatum(TODAY);
    setStatusKey(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragError(null);
    setCreatedAuftragId(null);
    setPositions([]);
    setShowAddPosition(false);
    setAddMaterialId('');
    setAddMenge('1');
    setAddEinheitKey('none');
    setAddBeschreibung('');
    setAddPositionError(null);
    setMaterialSearch('');
    setStep(1);
  };

  // Material filtered by search for step 3
  const filteredMaterial = materialSearch.trim()
    ? material.filter(m =>
        (m.fields.bezeichnung ?? '').toLowerCase().includes(materialSearch.toLowerCase()) ||
        (m.fields.artikelnummer ?? '').toLowerCase().includes(materialSearch.toLowerCase())
      )
    : material;

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde auswählen, Auftrag erfassen und Positionen hinzufügen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Kunde auswählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Kunde auswählen</h2>
          <p className="text-sm text-muted-foreground">
            Wähle den Kunden aus, für den der Auftrag angelegt werden soll.
          </p>
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: getKundeName(k),
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: <IconUser size={18} className="text-primary" />,
            }))}
            onSelect={(id) => {
              setSelectedKundeId(id);
              setStep(2);
            }}
            searchPlaceholder="Kunden suchen..."
            emptyIcon={<IconUser size={32} />}
            emptyText="Kein Kunde gefunden."
          />
        </div>
      )}

      {/* ── Step 2: Auftrag anlegen ── */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconUser size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ausgewählter Kunde</p>
                <p className="font-semibold text-sm">{selectedKunde ? getKundeName(selectedKunde) : selectedKundeId}</p>
                {selectedKunde?.fields.firma && (
                  <p className="text-xs text-muted-foreground">{selectedKunde.fields.firma}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setStep(1)}
              >
                Ändern
              </Button>
            </div>

            <h2 className="text-lg font-semibold">Auftrag erfassen</h2>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Auftragsnummer */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Auftragsnummer <span className="text-destructive">*</span>
                </label>
                <Input
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder="z. B. AU-2026-001"
                />
              </div>

              {/* Auftragsdatum */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Auftragsdatum <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={auftragsdatum}
                  onChange={e => setAuftragsdatum(e.target.value)}
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Status <span className="text-destructive">*</span>
                </label>
                <Select value={statusKey} onValueChange={setStatusKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priorität */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priorität</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPrioritaetKey('none')}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                      prioritaetKey === 'none'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border hover:bg-accent'
                    }`}
                  >
                    Keine
                  </button>
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPrioritaetKey(opt.key)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        prioritaetKey === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border hover:bg-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auftragsbeschreibung */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Auftragsbeschreibung <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibung des Auftrags..."
                  rows={3}
                />
              </div>

              {/* Wunschtermin */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Wunschtermin (optional)</label>
                <Input
                  type="datetime-local"
                  value={wunschtermin}
                  onChange={e => setWunschtermin(e.target.value)}
                />
              </div>

              {/* Monteur */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Monteur (optional)</label>
                <Input
                  value={monteur}
                  onChange={e => setMonteur(e.target.value)}
                  placeholder="Name des Monteurs"
                />
              </div>
            </div>

            {auftragError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {auftragError}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
              <Button
                className="flex-1"
                disabled={
                  !auftragsnummer.trim() ||
                  !auftragsdatum ||
                  !statusKey ||
                  !auftragsbeschreibung.trim() ||
                  auftragSubmitting
                }
                onClick={handleAuftragSubmit}
              >
                {auftragSubmitting ? 'Wird angelegt...' : 'Auftrag anlegen & weiter'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Step 3: Positionen hinzufügen ── */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-5">
            {/* Context card */}
            <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardList size={17} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Auftrag</p>
                <p className="font-semibold text-sm truncate">{auftragsnummer}</p>
                {selectedKunde && (
                  <p className="text-xs text-muted-foreground truncate">{getKundeName(selectedKunde)}</p>
                )}
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className="text-2xl font-bold text-primary">{positions.length}</p>
                <p className="text-xs text-muted-foreground">Position{positions.length !== 1 ? 'en' : ''}</p>
              </div>
            </div>

            <h2 className="text-lg font-semibold">Positionen hinzufügen</h2>
            <p className="text-sm text-muted-foreground">
              Wähle Material aus und füge Positionen zum Auftrag hinzu.
            </p>

            {/* Already added positions */}
            {positions.length > 0 && (
              <div className="space-y-2">
                {positions.map((pos, idx) => {
                  const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <IconBox size={15} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pos.materialName}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.menge}{einheitLabel ? ` ${einheitLabel}` : ''}
                          {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10">
                          <IconCheck size={12} className="text-primary" stroke={2.5} />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemovePosition(idx)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Position entfernen (nur lokal)"
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add position form */}
            {showAddPosition ? (
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h3 className="text-sm font-semibold">Neue Position</h3>

                {/* Material auswählen */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Material <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="Material suchen..."
                    value={materialSearch}
                    onChange={e => setMaterialSearch(e.target.value)}
                    className="mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {filteredMaterial.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">Kein Material gefunden.</p>
                    ) : (
                      filteredMaterial.map((m: Material) => (
                        <button
                          key={m.record_id}
                          type="button"
                          onClick={() => setAddMaterialId(m.record_id)}
                          className={`w-full text-left flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-colors ${
                            addMaterialId === m.record_id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card border-border hover:bg-accent'
                          }`}
                        >
                          <IconBox size={14} className="shrink-0" />
                          <span className="flex-1 truncate font-medium">{m.fields.bezeichnung ?? '(Kein Name)'}</span>
                          {m.fields.artikelnummer && (
                            <span className="text-xs opacity-70 shrink-0">{m.fields.artikelnummer}</span>
                          )}
                          {m.fields.lagerbestand !== undefined && (
                            <span className="text-xs opacity-70 shrink-0">
                              Bestand: {m.fields.lagerbestand}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Menge */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Menge <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={addMenge}
                    onChange={e => setAddMenge(e.target.value)}
                    placeholder="1"
                  />
                </div>

                {/* Einheit */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Einheit (optional)</label>
                  <Select value={addEinheitKey} onValueChange={setAddEinheitKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Keine Einheit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Einheit</SelectItem>
                      {EINHEIT_POSITION_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Beschreibung */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Beschreibung (optional)</label>
                  <Input
                    value={addBeschreibung}
                    onChange={e => setAddBeschreibung(e.target.value)}
                    placeholder="Kurze Beschreibung der Position"
                  />
                </div>

                {addPositionError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                    {addPositionError}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddPosition(false);
                      setAddMaterialId('');
                      setAddMenge('1');
                      setAddEinheitKey('none');
                      setAddBeschreibung('');
                      setAddPositionError(null);
                    }}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!addMaterialId || !addMenge || addingPosition}
                    onClick={handleAddPosition}
                  >
                    {addingPosition ? 'Wird hinzugefügt...' : 'Position hinzufügen'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowAddPosition(true)}
              >
                <IconPlus size={16} />
                Position hinzufügen
              </Button>
            )}

            {addPositionError && !showAddPosition && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {addPositionError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Zurück
              </Button>
              <Button
                className="flex-1"
                disabled={finishingUp}
                onClick={handleFinish}
              >
                {finishingUp ? 'Wird abgeschlossen...' : `Fertigstellen${positions.length > 0 ? ` (${positions.length} Position${positions.length !== 1 ? 'en' : ''})` : ''}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen angelegten Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}

      {/* ── Step 4: Zusammenfassung ── */}
      {step === 4 && (
        createdAuftragId ? (
          <div className="space-y-6">
            <div className="text-center py-6 space-y-2">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <IconCheck size={28} className="text-primary" stroke={2.5} />
              </div>
              <h2 className="text-xl font-bold">Auftrag erfolgreich angelegt!</h2>
              <p className="text-sm text-muted-foreground">
                Der Auftrag wurde erstellt und alle Positionen wurden hinzugefügt.
              </p>
            </div>

            {/* Summary card */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Zusammenfassung</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                  <p className="font-semibold">{auftragsnummer}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Auftragsdatum</p>
                  <p className="font-semibold">{auftragsdatum}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kunde</p>
                  <p className="font-semibold">{selectedKunde ? getKundeName(selectedKunde) : selectedKundeId}</p>
                  {selectedKunde?.fields.firma && (
                    <p className="text-xs text-muted-foreground">{selectedKunde.fields.firma}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Positionen</p>
                  <p className="font-semibold text-primary text-lg">{positions.length}</p>
                </div>
              </div>

              {positions.length > 0 && (
                <div className="border-t pt-3 space-y-1.5">
                  {positions.map((pos, idx) => {
                    const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                    return (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <IconBox size={13} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{pos.materialName}</span>
                        <span className="text-muted-foreground shrink-0">
                          {pos.menge}{einheitLabel ? ` ${einheitLabel}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" className="flex-1" onClick={handleReset}>
                Neuen Auftrag anlegen
              </Button>
              <a href="#/" className="flex-1">
                <Button className="w-full">Zurück zum Dashboard</Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen abgeschlossenen Workflow.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
