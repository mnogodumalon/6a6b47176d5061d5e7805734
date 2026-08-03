/**
 * Neuen Auftrag erstellen — 3-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftragsdaten erfassen → 3) Auftragspositionen hinzufügen & bestätigen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  IconUser,
  IconClipboardList,
  IconPackage,
  IconPlus,
  IconTrash,
  IconCheck,
  IconAlertCircle,
} from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  materialBezeichnung: string;
  materialEinheitKey: string;
  mengeStr: string;
  einheitKey: string;
  beschreibung: string;
}

export default function NeuenAuftragErstellenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Step management — initialize from URL
  const urlStep = parseInt(searchParams.get('step') ?? '1', 10);
  const [step, setStep] = useState(isNaN(urlStep) || urlStep < 1 || urlStep > 3 ? 1 : urlStep);

  // Step 1: Kunde
  const urlKundeId = searchParams.get('kundeId') ?? '';
  const [selectedKundeId, setSelectedKundeId] = useState<string>(urlKundeId);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeFirma, setNewKundeFirma] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2: Auftrag fields
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [monteur, setMonteur] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [auftragCreateLoading, setAuftragCreateLoading] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);
  const [createdAuftragId, setCreatedAuftragId] = useState<string>(
    searchParams.get('auftragId') ?? ''
  );

  // Step 3: Auftragspositionen
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [positionMengeStr, setPositionMengeStr] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [positionSaveError, setPositionSaveError] = useState<string | null>(null);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // --- Step 1: Kunde auswählen ---
  const handleSelectKunde = useCallback((id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  }, []);

  const handleCreateKunde = useCallback(async () => {
    if (!newKundeVorname.trim() || !newKundeNachname.trim()) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname.trim(),
        nachname: newKundeNachname.trim(),
        firma: newKundeFirma.trim() || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeFirma('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (e) {
      setKundeCreateError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreateLoading(false);
    }
  }, [newKundeVorname, newKundeNachname, newKundeFirma, fetchAll]);

  // --- Step 2: Auftrag anlegen ---
  const selectedKunde = kunden.find((k: Kunden) => k.record_id === selectedKundeId);
  const kundeName = selectedKunde
    ? `${selectedKunde.fields.vorname ?? ''} ${selectedKunde.fields.nachname ?? ''}`.trim()
    : '';

  const canSubmitAuftrag =
    auftragsnummer.trim().length > 0 &&
    auftragsdatum.length > 0 &&
    statusKey.length > 0 &&
    auftragsbeschreibung.trim().length > 0;

  const handleCreateAuftrag = useCallback(async () => {
    if (!canSubmitAuftrag || !selectedKundeId) return;
    setAuftragCreateLoading(true);
    setAuftragCreateError(null);
    try {
      let pid = createdAuftragId;
      if (!pid) {
        const payload: Record<string, unknown> = {
          auftragsnummer: auftragsnummer.trim(),
          auftragsdatum,
          status: statusKey,
          auftragsbeschreibung: auftragsbeschreibung.trim(),
          kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
        };
        if (prioritaetKey && prioritaetKey !== 'none') {
          payload.prioritaet = prioritaetKey;
        }
        if (monteur.trim()) {
          payload.monteur = monteur.trim();
        }
        if (wunschtermin) {
          payload.wunschtermin = wunschtermin;
        }
        const created = await LivingAppsService.createAuftraegeEntry(
          payload as Parameters<typeof LivingAppsService.createAuftraegeEntry>[0]
        );
        pid = created.record_id;
        setCreatedAuftragId(pid);
      }
      setStep(3);
    } catch (e) {
      setAuftragCreateError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreateLoading(false);
    }
  }, [
    canSubmitAuftrag,
    selectedKundeId,
    auftragsnummer,
    auftragsdatum,
    statusKey,
    prioritaetKey,
    auftragsbeschreibung,
    monteur,
    wunschtermin,
    createdAuftragId,
  ]);

  // --- Step 3: Positionen ---
  const handleMaterialSelect = useCallback(
    (matId: string) => {
      const mat = material.find((m: Material) => m.record_id === matId);
      if (!mat) return;
      setSelectedMaterialId(matId);
      setPositionBeschreibung(mat.fields.bezeichnung ?? '');
      const matEinheit = mat.fields.einheit?.key ?? 'none';
      setPositionEinheitKey(matEinheit);
      setPositionMengeStr('1');
      setShowAddPosition(true);
    },
    [material]
  );

  const handleAddPosition = useCallback(() => {
    if (!selectedMaterialId) return;
    const mat = material.find((m: Material) => m.record_id === selectedMaterialId);
    if (!mat) return;
    const menge = parseFloat(positionMengeStr);
    if (isNaN(menge) || menge <= 0) return;

    setPositions((prev) => [
      ...prev,
      {
        materialId: selectedMaterialId,
        materialBezeichnung: mat.fields.bezeichnung ?? '',
        materialEinheitKey: mat.fields.einheit?.key ?? '',
        mengeStr: positionMengeStr,
        einheitKey: positionEinheitKey,
        beschreibung: positionBeschreibung,
      },
    ]);
    setSelectedMaterialId(null);
    setShowAddPosition(false);
    setPositionMengeStr('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
  }, [selectedMaterialId, positionMengeStr, positionEinheitKey, positionBeschreibung, material]);

  const handleRemovePosition = useCallback((idx: number) => {
    setPositions((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleFinalize = useCallback(async () => {
    if (!createdAuftragId) return;
    setFinalizeLoading(true);
    setFinalizeError(null);
    try {
      for (const pos of positions) {
        const menge = parseFloat(pos.mengeStr);
        if (isNaN(menge)) continue;
        const posPayload: Record<string, unknown> = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge,
        };
        if (pos.beschreibung.trim()) {
          posPayload.positionsbeschreibung = pos.beschreibung.trim();
        }
        if (pos.einheitKey && pos.einheitKey !== 'none') {
          posPayload.einheit_position = pos.einheitKey;
        }
        await LivingAppsService.createAuftragspositionenEntry(
          posPayload as Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0]
        );
      }
      await fetchAll();
      setCompleted(true);
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Fehler beim Speichern der Positionen');
    } finally {
      setFinalizeLoading(false);
    }
  }, [createdAuftragId, positions, fetchAll]);

  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedKundeId('');
    setShowCreateKunde(false);
    setNewKundeVorname('');
    setNewKundeNachname('');
    setNewKundeFirma('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setMonteur('');
    setWunschtermin('');
    setCreatedAuftragId('');
    setPositions([]);
    setSelectedMaterialId(null);
    setShowAddPosition(false);
    setPositionMengeStr('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
    setCompleted(false);
    setFinalizeError(null);
    setPositionSaveError(null);
  }, []);

  return (
    <IntentWizardShell
      title="Neuen Auftrag erstellen"
      subtitle="Wähle einen Kunden, erfasse die Auftragsdaten und füge Positionen hinzu."
      steps={[{ label: 'Kunde' }, { label: 'Auftrag' }, { label: 'Positionen' }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Kunde auswählen ─────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <IconUser size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Kunden auswählen</h2>
              <p className="text-xs text-muted-foreground">Wähle einen bestehenden Kunden oder lege einen neuen an.</p>
            </div>
          </div>

          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() || '(Unbekannt)',
              subtitle: k.fields.firma
                ? `${k.fields.firma}${k.fields.ort ? ' · ' + k.fields.ort : ''}`
                : k.fields.ort ?? undefined,
              icon: <IconUser size={18} className="text-primary" />,
            }))}
            onSelect={handleSelectKunde}
            searchPlaceholder="Kunde suchen (Name, Firma)…"
            emptyText="Kein Kunde gefunden."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowCreateKunde((v) => !v)}
            createDialog={
              showCreateKunde && (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <p className="text-sm font-medium">Neuen Kunden anlegen</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="k-vorname" className="text-xs">Vorname *</Label>
                      <Input
                        id="k-vorname"
                        value={newKundeVorname}
                        onChange={(e) => setNewKundeVorname(e.target.value)}
                        placeholder="Vorname"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="k-nachname" className="text-xs">Nachname *</Label>
                      <Input
                        id="k-nachname"
                        value={newKundeNachname}
                        onChange={(e) => setNewKundeNachname(e.target.value)}
                        placeholder="Nachname"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="k-firma" className="text-xs">Firma (optional)</Label>
                    <Input
                      id="k-firma"
                      value={newKundeFirma}
                      onChange={(e) => setNewKundeFirma(e.target.value)}
                      placeholder="Firmenname"
                    />
                  </div>
                  {kundeCreateError && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <IconAlertCircle size={14} />
                      {kundeCreateError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      disabled={!newKundeVorname.trim() || !newKundeNachname.trim() || kundeCreateLoading}
                      onClick={handleCreateKunde}
                      size="sm"
                    >
                      {kundeCreateLoading ? 'Wird angelegt…' : 'Anlegen & auswählen'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCreateKunde(false)}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </div>
              )
            }
          />
        </div>
      )}

      {/* ── Schritt 2: Auftragsdaten ───────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <IconClipboardList size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Auftragsdaten erfassen</h2>
              {kundeName && (
                <p className="text-xs text-muted-foreground">
                  Kunde: <span className="font-medium text-foreground">{kundeName}</span>
                </p>
              )}
            </div>
          </div>

          {!selectedKundeId ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
              <Button variant="outline" onClick={() => setStep(1)}>Zurück zu Schritt 1</Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="auftragsnummer" className="text-xs font-medium">
                    Auftragsnummer *
                  </Label>
                  <Input
                    id="auftragsnummer"
                    value={auftragsnummer}
                    onChange={(e) => setAuftragsnummer(e.target.value)}
                    placeholder="z.B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auftragsdatum" className="text-xs font-medium">
                    Auftragsdatum *
                  </Label>
                  <Input
                    id="auftragsdatum"
                    type="date"
                    value={auftragsdatum}
                    onChange={(e) => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="status" className="text-xs font-medium">Status *</Label>
                  <Select value={statusKey} onValueChange={setStatusKey}>
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Status wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prioritaet" className="text-xs font-medium">Priorität</Label>
                  <Select value={prioritaetKey} onValueChange={setPrioritaetKey}>
                    <SelectTrigger id="prioritaet">
                      <SelectValue placeholder="Priorität wählen (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Priorität</SelectItem>
                      {PRIORITAET_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="auftragsbeschreibung" className="text-xs font-medium">
                  Auftragsbeschreibung *
                </Label>
                <Textarea
                  id="auftragsbeschreibung"
                  value={auftragsbeschreibung}
                  onChange={(e) => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll gemacht werden?"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="monteur" className="text-xs font-medium">Monteur (optional)</Label>
                  <Input
                    id="monteur"
                    value={monteur}
                    onChange={(e) => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wunschtermin" className="text-xs font-medium">
                    Wunschtermin (optional)
                  </Label>
                  <Input
                    id="wunschtermin"
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={(e) => setWunschtermin(e.target.value)}
                  />
                </div>
              </div>

              {auftragCreateError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <IconAlertCircle size={15} />
                  {auftragCreateError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  disabled={!canSubmitAuftrag || auftragCreateLoading}
                  onClick={handleCreateAuftrag}
                >
                  {auftragCreateLoading ? 'Auftrag wird angelegt…' : 'Weiter zu Schritt 3'}
                </Button>
                <Button variant="outline" onClick={() => setStep(1)}>
                  Zurück
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Schritt 3: Positionen ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <IconPackage size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Auftragspositionen hinzufügen</h2>
              <p className="text-xs text-muted-foreground">
                Wähle Material und gib die Menge an. Du kannst mehrere Positionen hinzufügen.
              </p>
            </div>
          </div>

          {!createdAuftragId ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">Dieser Schritt braucht den Auftrag aus Schritt 2.</p>
              <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
            </div>
          ) : completed ? (
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <IconCheck size={28} className="text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Auftrag erfolgreich angelegt!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Auftrag <span className="font-medium text-foreground">{auftragsnummer}</span> wurde mit{' '}
                  <span className="font-medium text-foreground">{positions.length}</span>{' '}
                  {positions.length === 1 ? 'Position' : 'Positionen'} gespeichert.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button onClick={handleReset}>Neuen Auftrag anlegen</Button>
                <a href="#/">
                  <Button variant="outline" className="w-full sm:w-auto">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Bisherige Positionen */}
              {positions.length > 0 && (
                <div className="rounded-2xl border bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b bg-secondary/40 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {positions.length} {positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
                    </span>
                  </div>
                  <div className="divide-y">
                    {positions.map((pos, idx) => {
                      const einheitLabel =
                        EINHEIT_OPTIONS.find((o) => o.key === pos.einheitKey)?.label ?? pos.einheitKey;
                      return (
                        <div key={idx} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <IconPackage size={14} className="text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {pos.beschreibung || pos.materialBezeichnung}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {pos.mengeStr}{einheitLabel && pos.einheitKey !== 'none' ? ' ' + einheitLabel : ''}
                            </p>
                          </div>
                          <button
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

              {/* Material auswählen */}
              {!showAddPosition && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Material auswählen:</p>
                  <EntitySelectStep
                    items={material.map((m: Material) => ({
                      id: m.record_id,
                      title: m.fields.bezeichnung ?? '(ohne Name)',
                      subtitle: [
                        m.fields.artikelnummer ? `Art.-Nr.: ${m.fields.artikelnummer}` : null,
                        m.fields.lagerbestand != null ? `Bestand: ${m.fields.lagerbestand}` : null,
                        m.fields.einheit?.label ?? null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                      icon: <IconPackage size={18} className="text-primary" />,
                    }))}
                    onSelect={handleMaterialSelect}
                    searchPlaceholder="Material suchen (Bezeichnung, Artikelnummer)…"
                    emptyText="Kein Material gefunden."
                    emptyIcon={<IconPackage size={32} />}
                  />
                </div>
              )}

              {/* Position-Details-Formular */}
              {showAddPosition && selectedMaterialId && (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {material.find((m: Material) => m.record_id === selectedMaterialId)?.fields.bezeichnung ?? 'Material'}
                    </p>
                    <button
                      onClick={() => {
                        setShowAddPosition(false);
                        setSelectedMaterialId(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Abbrechen
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pos-menge" className="text-xs font-medium">Menge *</Label>
                      <Input
                        id="pos-menge"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={positionMengeStr}
                        onChange={(e) => setPositionMengeStr(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pos-einheit" className="text-xs font-medium">Einheit</Label>
                      <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                        <SelectTrigger id="pos-einheit">
                          <SelectValue placeholder="Einheit wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Einheit</SelectItem>
                          {EINHEIT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.key} value={opt.key}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pos-beschreibung" className="text-xs font-medium">
                      Positionsbeschreibung (optional)
                    </Label>
                    <Input
                      id="pos-beschreibung"
                      value={positionBeschreibung}
                      onChange={(e) => setPositionBeschreibung(e.target.value)}
                      placeholder="Beschreibung der Position"
                    />
                  </div>
                  {positionSaveError && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <IconAlertCircle size={14} />
                      {positionSaveError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !positionMengeStr ||
                        isNaN(parseFloat(positionMengeStr)) ||
                        parseFloat(positionMengeStr) <= 0
                      }
                      onClick={handleAddPosition}
                    >
                      <IconPlus size={14} className="mr-1" />
                      Position hinzufügen
                    </Button>
                  </div>
                </div>
              )}

              {finalizeError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <IconAlertCircle size={15} />
                  {finalizeError}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  disabled={finalizeLoading}
                  onClick={handleFinalize}
                >
                  {finalizeLoading
                    ? 'Wird gespeichert…'
                    : positions.length === 0
                    ? 'Fertigstellen (ohne Positionen)'
                    : `Fertigstellen (${positions.length} ${positions.length === 1 ? 'Position' : 'Positionen'})`}
                </Button>
                <Button variant="outline" onClick={() => setStep(2)}>
                  Zurück
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
