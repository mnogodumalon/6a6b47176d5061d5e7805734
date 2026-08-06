/**
 * Neuer Auftrag — 3-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftragsdaten eingeben → 3) Auftragspositionen hinzufügen.
 * Reads: kunden, auftraege, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import {
  IconUser,
  IconPlus,
  IconTrash,
  IconCheck,
  IconClipboardList,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionEntry {
  materialId: string;
  materialLabel: string;
  menge: number;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function NeuerAuftragPage() {
  const { kunden, auftraege, material, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1 state
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neueTelefon, setNeueTelefon] = useState('');

  // Step 2 state
  const auftragCount = auftraege.length;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const generatedNummer =
    'AU-' + todayStr + '-' + String(auftragCount + 1).padStart(4, '0');

  const [auftragsnummer, setAuftragsnummer] = useState(generatedNummer);
  const [auftragsdatum, setAuftragsdatum] = useState(todayStr);
  const [status, setStatus] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaet, setPrioritaet] = useState('normal');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [savingAuftrag, setSavingAuftrag] = useState(false);
  const [auftragError, setAuftragError] = useState('');

  // Step 3 state
  const [newAuftragId, setNewAuftragId] = useState('');
  const [positionen, setPositionen] = useState<PositionEntry[]>([]);

  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState(EINHEIT_OPTIONS[0]?.key ?? 'stueck');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [addingPosition, setAddingPosition] = useState(false);
  const [positionError, setPositionError] = useState('');

  const handleKundeSelect = (id: string) => {
    const k = kunden.find((k) => k.record_id === id) ?? null;
    setSelectedKunde(k);
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
    const freshKunde: Kunden = {
      record_id: created.record_id,
      created_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      updated_at: null,
      createdat: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      updatedat: null,
      fields: {
        vorname: neuerVorname,
        nachname: neuerNachname,
        telefon: neueTelefon || undefined,
      },
    };
    setSelectedKunde(freshKunde);
    setStep(2);
  };

  const handleSaveAuftrag = async () => {
    if (!selectedKunde || !auftragsnummer || !auftragsdatum || !auftragsbeschreibung) return;
    setSavingAuftrag(true);
    setAuftragError('');
    try {
      const payload: Record<string, unknown> = {
        auftragsnummer,
        auftragsdatum,
        status,
        prioritaet,
        auftragsbeschreibung,
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
      };
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur) payload.monteur = monteur;
      const result = await LivingAppsService.createAuftraegeEntry(payload);
      setNewAuftragId(result.record_id);
      await fetchAll();
      setStep(3);
    } catch {
      setAuftragError('Fehler beim Speichern des Auftrags. Bitte erneut versuchen.');
    } finally {
      setSavingAuftrag(false);
    }
  };

  const getSelectedMaterial = (): Material | undefined =>
    material.find((m) => m.record_id === selectedMaterialId);

  const handleMaterialChange = (id: string) => {
    setSelectedMaterialId(id);
    const mat = material.find((m) => m.record_id === id);
    if (mat?.fields.einheit?.key) {
      setPositionEinheitKey(mat.fields.einheit.key);
    }
  };

  const handleAddPosition = async () => {
    if (!selectedMaterialId || !positionMenge || Number(positionMenge) <= 0 || !newAuftragId) return;
    setAddingPosition(true);
    setPositionError('');
    try {
      const mat = getSelectedMaterial();
      const payload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, newAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterialId),
        menge: Number(positionMenge),
        einheit_position: positionEinheitKey,
      };
      if (positionBeschreibung) payload.positionsbeschreibung = positionBeschreibung;
      await LivingAppsService.createAuftragspositionenEntry(payload);
      const einheitLabel =
        EINHEIT_OPTIONS.find((e) => e.key === positionEinheitKey)?.label ?? positionEinheitKey;
      setPositionen((prev) => [
        ...prev,
        {
          materialId: selectedMaterialId,
          materialLabel: mat
            ? `${mat.fields.bezeichnung ?? ''}${mat.fields.artikelnummer ? ' (' + mat.fields.artikelnummer + ')' : ''}`
            : selectedMaterialId,
          menge: Number(positionMenge),
          einheitKey: einheitLabel,
          positionsbeschreibung: positionBeschreibung,
        },
      ]);
      setSelectedMaterialId('');
      setPositionMenge('1');
      setPositionEinheitKey(EINHEIT_OPTIONS[0]?.key ?? 'stueck');
      setPositionBeschreibung('');
    } catch {
      setPositionError('Fehler beim Hinzufügen der Position. Bitte erneut versuchen.');
    } finally {
      setAddingPosition(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKunde(null);
    setShowCreateKunde(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeueTelefon('');
    const newCount = auftraege.length;
    const newNummer = 'AU-' + todayStr + '-' + String(newCount + 1).padStart(4, '0');
    setAuftragsnummer(newNummer);
    setAuftragsdatum(todayStr);
    setStatus(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaet('normal');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragError('');
    setNewAuftragId('');
    setPositionen([]);
    setSelectedMaterialId('');
    setPositionMenge('1');
    setPositionEinheitKey(EINHEIT_OPTIONS[0]?.key ?? 'stueck');
    setPositionBeschreibung('');
    setPositionError('');
  };

  return (
    <IntentWizardShell
      title="Neuer Auftrag"
      subtitle="In drei Schritten zum fertigen Auftrag"
      steps={[{ label: 'Kunde' }, { label: 'Auftrag' }, { label: 'Positionen' }]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Kunde auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map((k) => ({
            id: k.record_id,
            title:
              [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') ||
              k.fields.firma ||
              'Unbekannt',
            subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · ') || undefined,
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleKundeSelect}
          searchPlaceholder="Kunden suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowCreateKunde(true)}
          createDialog={
            showCreateKunde ? (
              <div className="rounded-2xl border p-4 space-y-3">
                <p className="text-sm font-medium">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="new-vorname">Vorname *</Label>
                    <Input
                      id="new-vorname"
                      value={neuerVorname}
                      onChange={(e) => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-nachname">Nachname *</Label>
                    <Input
                      id="new-nachname"
                      value={neuerNachname}
                      onChange={(e) => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-telefon">Telefon</Label>
                  <Input
                    id="new-telefon"
                    value={neueTelefon}
                    onChange={(e) => setNeueTelefon(e.target.value)}
                    placeholder="Telefonnummer"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={!neuerVorname || !neuerNachname}
                    onClick={handleCreateKunde}
                  >
                    Anlegen & auswählen
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateKunde(false)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : undefined
          }
        />
      )}

      {/* Step 2: Auftragsdaten eingeben */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-6">
            {/* Kunde summary */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconUser size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname]
                    .filter(Boolean)
                    .join(' ') || selectedKunde.fields.firma || 'Unbekannt'}
                </p>
                {selectedKunde.fields.firma && (
                  <p className="text-xs text-muted-foreground truncate">
                    {selectedKunde.fields.firma}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0"
                onClick={() => setStep(1)}
              >
                Ändern
              </Button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                  <Input
                    id="auftragsnummer"
                    value={auftragsnummer}
                    onChange={(e) => setAuftragsnummer(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auftragsdatum">Auftragsdatum *</Label>
                  <Input
                    id="auftragsdatum"
                    type="date"
                    value={auftragsdatum}
                    onChange={(e) => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="status">Status *</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="status">
                      <SelectValue />
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
                <div className="space-y-1">
                  <Label htmlFor="prioritaet">Priorität</Label>
                  <Select value={prioritaet} onValueChange={setPrioritaet}>
                    <SelectTrigger id="prioritaet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITAET_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
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
                  onChange={(e) => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibe den Auftrag …"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="wunschtermin">Wunschtermin</Label>
                  <Input
                    id="wunschtermin"
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={(e) => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="monteur">Monteur</Label>
                  <Input
                    id="monteur"
                    value={monteur}
                    onChange={(e) => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragError && (
                <p className="text-sm text-destructive">{auftragError}</p>
              )}

              <div className="flex gap-3">
                <Button
                  disabled={
                    !auftragsnummer ||
                    !auftragsdatum ||
                    !auftragsbeschreibung ||
                    savingAuftrag
                  }
                  onClick={handleSaveAuftrag}
                >
                  {savingAuftrag ? 'Wird gespeichert …' : 'Auftrag anlegen →'}
                </Button>
                <Button variant="outline" onClick={() => setStep(1)}>
                  Zurück
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Kunden aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}

      {/* Step 3: Auftragspositionen */}
      {step === 3 && (
        newAuftragId ? (
          <div className="space-y-6">
            {/* Summary header */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconClipboardList size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">Auftrag {auftragsnummer}</p>
                <p className="text-xs text-muted-foreground">
                  {positionen.length}{' '}
                  {positionen.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
                </p>
              </div>
            </div>

            {/* Already added positions */}
            {positionen.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Hinzugefügte Positionen</p>
                <div className="space-y-2">
                  {positionen.map((pos, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border p-3 flex items-start gap-3"
                    >
                      <IconCheck size={16} className="text-green-600 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{pos.materialLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.menge} {pos.einheitKey}
                          {pos.positionsbeschreibung
                            ? ' · ' + pos.positionsbeschreibung
                            : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add position form */}
            <div className="rounded-2xl border p-4 space-y-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <IconPlus size={16} />
                Position hinzufügen
              </p>

              <div className="space-y-1">
                <Label htmlFor="pos-material">Material *</Label>
                <Select value={selectedMaterialId || 'none'} onValueChange={(v) => handleMaterialChange(v === 'none' ? '' : v)}>
                  <SelectTrigger id="pos-material">
                    <SelectValue placeholder="Material auswählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Material auswählen …</SelectItem>
                    {material.map((m) => (
                      <SelectItem key={m.record_id} value={m.record_id}>
                        {m.fields.bezeichnung ?? m.record_id}
                        {m.fields.artikelnummer ? ` (${m.fields.artikelnummer})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pos-menge">Menge *</Label>
                  <Input
                    id="pos-menge"
                    type="number"
                    min="0.01"
                    step="any"
                    value={positionMenge}
                    onChange={(e) => setPositionMenge(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pos-einheit">Einheit *</Label>
                  <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                    <SelectTrigger id="pos-einheit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EINHEIT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pos-beschreibung">Positionsbeschreibung</Label>
                <Input
                  id="pos-beschreibung"
                  value={positionBeschreibung}
                  onChange={(e) => setPositionBeschreibung(e.target.value)}
                  placeholder="Optional …"
                />
              </div>

              {positionError && (
                <p className="text-sm text-destructive">{positionError}</p>
              )}

              <Button
                onClick={handleAddPosition}
                disabled={
                  !selectedMaterialId ||
                  !positionMenge ||
                  Number(positionMenge) <= 0 ||
                  addingPosition
                }
                className="w-full"
              >
                {addingPosition ? 'Wird gespeichert …' : 'Position hinzufügen'}
              </Button>
            </div>

            {/* Finish */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                onClick={() => {
                  window.location.hash = '/';
                }}
                className="w-full sm:w-auto"
              >
                <IconCheck size={16} className="mr-2" />
                Abschließen
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-full sm:w-auto"
              >
                <IconTrash size={16} className="mr-2" />
                Neuen Auftrag anlegen
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen angelegten Auftrag aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(2)}>
              Zurück zu Schritt 2
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
