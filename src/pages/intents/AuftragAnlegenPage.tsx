/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftrag erstellen → 3) Materialpositionen hinzufügen → Fertig.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { IconUser, IconClipboardList, IconPackage, IconCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  bemerkung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1 state
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');

  // Step 2 state
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [submittingAuftrag, setSubmittingAuftrag] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);

  // Step 3 state
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [pickedMaterialId, setPickedMaterialId] = useState('none');
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBemerkung, setPositionBemerkung] = useState('');
  const [submittingPositions, setSubmittingPositions] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [savedPositionIds, setSavedPositionIds] = useState<string[]>([]);

  const selectedKunde = kunden.find((k: Kunden) => k.record_id === selectedKundeId);

  const handleSelectKunde = (id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  };

  const handleCreateKunde = async () => {
    if (!neuerVorname || !neuerNachname) return;
    const created = await LivingAppsService.createKundenEntry({
      vorname: neuerVorname,
      nachname: neuerNachname,
      telefon: neueTelefon || undefined,
    });
    await fetchAll();
    setShowCreateKunde(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeueTelefon('');
    setSelectedKundeId(created.record_id);
    setStep(2);
  };

  const handleCreateAuftrag = async () => {
    if (!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || !selectedKundeId) return;
    setSubmittingAuftrag(true);
    setAuftragError(null);
    try {
      const payload: Record<string, unknown> = {
        auftragsnummer,
        auftragsdatum,
        status: statusKey,
        auftragsbeschreibung,
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaetKey && prioritaetKey !== 'none') payload.prioritaet = prioritaetKey;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur) payload.monteur = monteur;

      const result = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(result.record_id);
      setStep(3);
    } catch (e) {
      setAuftragError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Auftrags.');
    } finally {
      setSubmittingAuftrag(false);
    }
  };

  const handleAddPosition = () => {
    if (!pickedMaterialId || pickedMaterialId === 'none' || !positionMenge) return;
    const mat = material.find((m: Material) => m.record_id === pickedMaterialId);
    if (!mat) return;
    setPositions(prev => [...prev, {
      materialId: pickedMaterialId,
      materialName: mat.fields.bezeichnung ?? mat.fields.artikelnummer ?? pickedMaterialId,
      menge: positionMenge,
      einheitKey: positionEinheitKey,
      bemerkung: positionBemerkung,
    }]);
    setPickedMaterialId('none');
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBemerkung('');
  };

  const handleRemovePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const handleFinalize = async () => {
    if (!createdAuftragId) return;
    setSubmittingPositions(true);
    setPositionError(null);
    try {
      for (let i = savedPositionIds.length; i < positions.length; i++) {
        const pos = positions[i];
        const posPayload: Record<string, unknown> = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: parseFloat(pos.menge),
        };
        if (pos.einheitKey && pos.einheitKey !== 'none') posPayload.einheit_position = pos.einheitKey;
        if (pos.bemerkung) posPayload.bemerkung = pos.bemerkung;
        const created = await LivingAppsService.createAuftragspositionenEntry(posPayload);
        setSavedPositionIds(prev => [...prev, created.record_id]);
      }
      setStep(4);
    } catch (e) {
      setPositionError(e instanceof Error ? e.message : 'Fehler beim Speichern der Positionen.');
    } finally {
      setSubmittingPositions(false);
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
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragError(null);
    setCreatedAuftragId(null);
    setPositions([]);
    setPickedMaterialId('none');
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBemerkung('');
    setSubmittingPositions(false);
    setPositionError(null);
    setSavedPositionIds([]);
  };

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde wählen, Auftrag erfassen, Materialien zuordnen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Material' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Kunde wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map((k: Kunden) => ({
            id: k.record_id,
            title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || k.record_id,
            subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · ') || undefined,
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectKunde}
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowCreateKunde(true)}
          searchPlaceholder="Kunden suchen …"
          emptyText="Kein Kunde gefunden"
          createDialog={showCreateKunde && (
            <div className="rounded-2xl border p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
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
              <div className="flex gap-2">
                <Button
                  disabled={!neuerVorname || !neuerNachname}
                  onClick={handleCreateKunde}
                  className="flex-1"
                >
                  Anlegen & auswählen
                </Button>
                <Button variant="outline" onClick={() => setShowCreateKunde(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        />
      )}

      {/* Step 2: Auftrag erstellen */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-5 max-w-2xl">
            {/* Kunde summary */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconUser size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || selectedKundeId}
                </p>
                {selectedKunde?.fields.firma && (
                  <p className="text-xs text-muted-foreground truncate">{selectedKunde.fields.firma}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => setStep(1)}>
                Ändern
              </Button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Status *</label>
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
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Priorität</label>
                  <Select value={prioritaetKey} onValueChange={setPrioritaetKey}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Priorität wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Angabe</SelectItem>
                      {PRIORITAET_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Auftragsbeschreibung *</label>
                <textarea
                  className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibung des Auftrags …"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
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

            <div className="flex gap-3">
              <Button
                disabled={!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || submittingAuftrag}
                onClick={handleCreateAuftrag}
                className="flex-1"
              >
                <IconClipboardList size={16} className="mr-2" />
                {submittingAuftrag ? 'Wird angelegt …' : 'Auftrag anlegen'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
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

      {/* Step 3: Materialpositionen */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-5 max-w-2xl">
            {/* Summary bar */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconClipboardList size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">Auftrag: {auftragsnummer}</p>
                <p className="text-xs text-muted-foreground">
                  {positions.length} Position{positions.length !== 1 ? 'en' : ''} hinzugefügt
                </p>
              </div>
            </div>

            {/* Added positions list */}
            {positions.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Hinzugefügte Positionen</p>
                {positions.map((pos, i) => (
                  <div key={i} className="rounded-xl border p-3 flex items-center gap-3">
                    <IconPackage size={18} className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pos.materialName}</p>
                      <p className="text-xs text-muted-foreground">
                        {pos.menge} {pos.einheitKey !== 'none' ? (EINHEIT_OPTIONS.find(e => e.key === pos.einheitKey)?.label ?? pos.einheitKey) : ''}
                        {pos.bemerkung ? ` · ${pos.bemerkung}` : ''}
                      </p>
                    </div>
                    {i >= savedPositionIds.length && (
                      <Button variant="ghost" size="sm" onClick={() => handleRemovePosition(i)}>
                        <IconTrash size={16} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add position form */}
            <div className="rounded-2xl border p-4 space-y-3">
              <p className="text-sm font-medium">Position hinzufügen</p>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Material *</label>
                <Select value={pickedMaterialId} onValueChange={setPickedMaterialId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Material auswählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Material wählen …</SelectItem>
                    {material.map((m: Material) => (
                      <SelectItem key={m.record_id} value={m.record_id}>
                        {m.fields.bezeichnung ?? m.fields.artikelnummer ?? m.record_id}
                        {m.fields.artikelnummer && m.fields.bezeichnung ? ` (${m.fields.artikelnummer})` : ''}
                        {m.fields.lagerbestand !== undefined ? ` — Lager: ${m.fields.lagerbestand}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground">Menge *</label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={positionMenge}
                    onChange={e => setPositionMenge(e.target.value)}
                    placeholder="Menge"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground">Einheit</label>
                  <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
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

              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Bemerkung</label>
                <Input
                  value={positionBemerkung}
                  onChange={e => setPositionBemerkung(e.target.value)}
                  placeholder="Optionale Bemerkung"
                />
              </div>

              <Button
                variant="outline"
                className="w-full"
                disabled={!pickedMaterialId || pickedMaterialId === 'none' || !positionMenge}
                onClick={handleAddPosition}
              >
                <IconPlus size={16} className="mr-2" />
                Position hinzufügen
              </Button>
            </div>

            {positionError && (
              <p className="text-sm text-destructive">{positionError}</p>
            )}

            <div className="flex gap-3">
              <Button
                className="flex-1"
                disabled={submittingPositions}
                onClick={handleFinalize}
              >
                <IconCheck size={16} className="mr-2" />
                {submittingPositions ? 'Wird gespeichert …' : `Fertig${positions.length > 0 ? ` (${positions.length} Position${positions.length !== 1 ? 'en' : ''})` : ''}`}
              </Button>
              <Button variant="outline" onClick={() => setStep(2)} disabled={submittingPositions}>
                Zurück
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Du kannst auch ohne Positionen abschließen — Positionen lassen sich später ergänzen.
            </p>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht den Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}

      {/* Step 4: Fertig */}
      {step === 4 && (
        <div className="flex flex-col items-center gap-6 py-8">
          <div className="rounded-full bg-primary/10 p-5">
            <IconCheck size={40} className="text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold">Auftrag angelegt!</h2>
            <p className="text-muted-foreground">
              Auftrag <span className="font-medium text-foreground">{auftragsnummer}</span> wurde erfolgreich erstellt.
            </p>
          </div>

          <div className="rounded-2xl border bg-secondary/40 w-full max-w-sm p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Kunde</span>
              <span className="font-medium truncate ml-2 text-right">
                {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || selectedKundeId}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Auftragsnummer</span>
              <span className="font-medium">{auftragsnummer}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Positionen</span>
              <span className="font-medium">{positions.length}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <Button className="flex-1" onClick={handleReset}>
              Neuen Auftrag anlegen
            </Button>
            <a href="#/" className="flex-1">
              <Button variant="outline" className="w-full">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
