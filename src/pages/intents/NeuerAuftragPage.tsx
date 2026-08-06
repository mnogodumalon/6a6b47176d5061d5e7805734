/**
 * Neuer Auftrag — 3-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftragsdaten erfassen → 3) Positionen hinzufügen & abschließen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { IconUser, IconClipboardList, IconPackage, IconCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  mengeStr: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function NeuerAuftragPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeError, setKundeError] = useState<string | null>(null);

  // Step 2
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioritaetKey] = useState('');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragSaving, setAuftragSaving] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // Step 3
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [savedPositionCount, setSavedPositionCount] = useState(0);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [newMaterialId, setNewMaterialId] = useState('');
  const [newMengeStr, setNewMengeStr] = useState('1');
  const [newEinheitKey, setNewEinheitKey] = useState('none');
  const [newBeschreibung, setNewBeschreibung] = useState('');
  const [completed, setCompleted] = useState(false);

  const selectedKunde = kunden.find((k: Kunden) => k.record_id === selectedKundeId);

  const handleSelectKunde = useCallback((id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  }, []);

  const handleCreateKunde = async () => {
    if (!neuerVorname.trim() || !neuerNachname.trim()) return;
    setKundeCreating(true);
    setKundeError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim(),
        nachname: neuerNachname.trim(),
        telefon: neueTelefon.trim() || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeueTelefon('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch {
      setKundeError('Kunde konnte nicht angelegt werden.');
    } finally {
      setKundeCreating(false);
    }
  };

  const handleSaveAuftrag = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim() || !selectedKundeId) return;
    setAuftragSaving(true);
    setAuftragError(null);

    // Idempotency: don't create again if already created
    if (createdAuftragId) {
      setStep(3);
      setAuftragSaving(false);
      return;
    }

    try {
      const payload: Parameters<typeof LivingAppsService.createAuftraegeEntry>[0] = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum,
        status: statusKey,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaetKey && prioritaetKey !== 'none') payload.prioritaet = prioritaetKey;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur.trim()) payload.monteur = monteur.trim();

      const result = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(result.record_id);
      await fetchAll();
      setStep(3);
    } catch {
      setAuftragError('Auftrag konnte nicht gespeichert werden. Bitte erneut versuchen.');
    } finally {
      setAuftragSaving(false);
    }
  };

  const handleAddPosition = () => {
    if (!newMaterialId || !newMengeStr || parseFloat(newMengeStr) <= 0) return;
    setPositions(prev => [
      ...prev,
      {
        materialId: newMaterialId,
        mengeStr: newMengeStr,
        einheitKey: newEinheitKey,
        positionsbeschreibung: newBeschreibung,
      },
    ]);
    setNewMaterialId('');
    setNewMengeStr('1');
    setNewEinheitKey('none');
    setNewBeschreibung('');
    setShowAddPosition(false);
  };

  const handleRemovePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const handleFinish = async () => {
    if (!createdAuftragId) return;
    setPositionSaving(true);
    setPositionError(null);

    try {
      let count = savedPositionCount;
      const remaining = positions.slice(count);
      for (const pos of remaining) {
        const posPayload: Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0] = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: parseFloat(pos.mengeStr),
        };
        if (pos.einheitKey && pos.einheitKey !== 'none') posPayload.einheit_position = pos.einheitKey;
        if (pos.positionsbeschreibung.trim()) posPayload.positionsbeschreibung = pos.positionsbeschreibung.trim();
        await LivingAppsService.createAuftragspositionenEntry(posPayload);
        count++;
        setSavedPositionCount(count);
      }
      await fetchAll();
      setCompleted(true);
    } catch {
      setPositionError('Einige Positionen konnten nicht gespeichert werden. Bitte erneut versuchen.');
    } finally {
      setPositionSaving(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKundeId(null);
    setShowCreateKunde(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeueTelefon('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaetKey('');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setCreatedAuftragId(null);
    setPositions([]);
    setSavedPositionCount(0);
    setShowAddPosition(false);
    setNewMaterialId('');
    setNewMengeStr('1');
    setNewEinheitKey('none');
    setNewBeschreibung('');
    setCompleted(false);
    setAuftragError(null);
    setPositionError(null);
    setKundeError(null);
  };

  const getMaterialLabel = (mat: Material) => {
    const bez = mat.fields.bezeichnung ?? '';
    const nr = mat.fields.artikelnummer ? ` (${mat.fields.artikelnummer})` : '';
    return `${bez}${nr}`;
  };

  return (
    <IntentWizardShell
      title="Neuer Auftrag"
      subtitle="Kunden wählen, Auftragsdaten erfassen und Positionen hinzufügen"
      steps={[{ label: 'Kunde' }, { label: 'Auftragsdaten' }, { label: 'Positionen' }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Kunde auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map((k: Kunden) => ({
            id: k.record_id,
            title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || k.record_id,
            subtitle: [k.fields.firma, k.fields.telefon, k.fields.ort].filter(Boolean).join(' · '),
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectKunde}
          searchPlaceholder="Kunde suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowCreateKunde(true)}
          createDialog={showCreateKunde ? (
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <p className="text-sm font-medium">Neuen Kunden anlegen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  value={neuerVorname}
                  onChange={e => setNeuerVorname(e.target.value)}
                  placeholder="Vorname *"
                />
                <Input
                  value={neuerNachname}
                  onChange={e => setNeuerNachname(e.target.value)}
                  placeholder="Nachname *"
                />
              </div>
              <Input
                value={neueTelefon}
                onChange={e => setNeueTelefon(e.target.value)}
                placeholder="Telefon"
              />
              {kundeError && <p className="text-sm text-destructive">{kundeError}</p>}
              <div className="flex gap-2">
                <Button
                  disabled={!neuerVorname.trim() || !neuerNachname.trim() || kundeCreating}
                  onClick={handleCreateKunde}
                >
                  {kundeCreating ? 'Wird angelegt …' : 'Anlegen'}
                </Button>
                <Button variant="outline" onClick={() => setShowCreateKunde(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : undefined}
        />
      )}

      {/* Step 2: Auftragsdaten erfassen */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-6">
            {/* Selected customer banner */}
            <div className="flex items-center gap-3 rounded-2xl border bg-secondary/40 px-4 py-3">
              <IconUser size={18} className="text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Kunde</p>
                <p className="font-medium truncate">
                  {selectedKunde
                    ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma || selectedKundeId
                    : selectedKundeId}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => setStep(1)}>
                Ändern
              </Button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z.B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={statusKey} onValueChange={setStatusKey}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Status wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Priorität</label>
                  <Select value={prioritaetKey || 'none'} onValueChange={v => setPrioritaetKey(v === 'none' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Priorität wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Priorität</SelectItem>
                      {PRIORITAET_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Auftragsbeschreibung *</label>
                <Textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll durchgeführt werden?"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Monteur</label>
                  <Input
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>
            </div>

            {auftragError && (
              <p className="text-sm text-destructive">{auftragError}</p>
            )}

            <div className="flex gap-3 flex-wrap">
              <Button
                disabled={!auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim() || auftragSaving}
                onClick={handleSaveAuftrag}
              >
                <IconClipboardList size={16} className="mr-2" />
                {auftragSaving ? 'Wird gespeichert …' : 'Auftrag anlegen'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
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

      {/* Step 3: Positionen hinzufügen */}
      {step === 3 && (
        createdAuftragId ? (
          completed ? (
            <div className="text-center py-12 space-y-6">
              <div className="flex justify-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <IconCheck size={32} className="text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Auftrag erfolgreich angelegt!</h3>
                <p className="text-sm text-muted-foreground">
                  {savedPositionCount > 0
                    ? `${savedPositionCount} Position${savedPositionCount !== 1 ? 'en' : ''} hinzugefügt.`
                    : 'Auftrag ohne Positionen angelegt.'}
                </p>
              </div>
              <div className="flex justify-center gap-3 flex-wrap">
                <Button onClick={handleReset}>
                  Neuen Auftrag anlegen
                </Button>
                <a href="#/">
                  <Button variant="outline">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Auftrag summary */}
              <div className="flex items-center gap-3 rounded-2xl border bg-secondary/40 px-4 py-3">
                <IconClipboardList size={18} className="text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Auftrag</p>
                  <p className="font-medium truncate">{auftragsnummer}</p>
                </div>
                <StatusBadge statusKey={statusKey} label={STATUS_OPTIONS.find(o => o.key === statusKey)?.label} className="ml-auto shrink-0" />
              </div>

              {/* Position counter */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconPackage size={18} className="text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {positions.length === 0
                      ? 'Noch keine Positionen'
                      : `${positions.length} Position${positions.length !== 1 ? 'en' : ''} geplant`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddPosition(true)}
                  disabled={showAddPosition}
                >
                  <IconPlus size={16} className="mr-1" />
                  Position hinzufügen
                </Button>
              </div>

              {/* Add position form */}
              {showAddPosition && (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <p className="text-sm font-medium">Neue Position</p>
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">Material *</label>
                    <Select value={newMaterialId || 'none'} onValueChange={v => setNewMaterialId(v === 'none' ? '' : v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Material wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Material wählen …</SelectItem>
                        {material.map((m: Material) => (
                          <SelectItem key={m.record_id} value={m.record_id}>
                            <span className="flex items-center gap-2">
                              {getMaterialLabel(m)}
                              {m.fields.verfuegbarkeit && (
                                <Badge variant="outline" className="text-xs ml-1">
                                  {m.fields.verfuegbarkeit.label}
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-muted-foreground">Menge *</label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={newMengeStr}
                        onChange={e => setNewMengeStr(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-muted-foreground">Einheit</label>
                      <Select value={newEinheitKey} onValueChange={setNewEinheitKey}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Einheit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Einheit</SelectItem>
                          {EINHEIT_OPTIONS.map(opt => (
                            <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">Beschreibung</label>
                    <Input
                      value={newBeschreibung}
                      onChange={e => setNewBeschreibung(e.target.value)}
                      placeholder="Optionale Beschreibung"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={!newMaterialId || !newMengeStr || parseFloat(newMengeStr) <= 0}
                      onClick={handleAddPosition}
                    >
                      Hinzufügen
                    </Button>
                    <Button variant="outline" onClick={() => setShowAddPosition(false)}>
                      Abbrechen
                    </Button>
                  </div>
                </div>
              )}

              {/* Positions list */}
              {positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((pos, idx) => {
                    const mat = material.find((m: Material) => m.record_id === pos.materialId);
                    const einheitLabel = EINHEIT_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                    return (
                      <div key={idx} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
                        <IconPackage size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{mat ? getMaterialLabel(mat) : pos.materialId}</p>
                          <p className="text-sm text-muted-foreground">
                            {pos.mengeStr} {einheitLabel ?? ''}
                            {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-destructive"
                          onClick={() => handleRemovePosition(idx)}
                        >
                          <IconTrash size={16} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {positionError && (
                <p className="text-sm text-destructive">{positionError}</p>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button
                  disabled={positionSaving}
                  onClick={handleFinish}
                >
                  <IconCheck size={16} className="mr-2" />
                  {positionSaving
                    ? `Speichere ${savedPositionCount + 1} von ${positions.length} …`
                    : positions.length > 0
                    ? `Auftrag mit ${positions.length} Position${positions.length !== 1 ? 'en' : ''} abschließen`
                    : 'Auftrag abschließen (ohne Positionen)'}
                </Button>
                <Button variant="outline" onClick={() => setStep(2)}>
                  Zurück
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Daten aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
