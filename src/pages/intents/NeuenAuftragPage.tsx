/**
 * Neuen Auftrag anlegen — 4-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftrag anlegen → 3) Positionen hinzufügen → 4) Zusammenfassung.
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
  positionsbeschreibung: string;
  bemerkung: string;
}

export default function NeuenAuftragPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard step
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [kundeVorname, setKundeVorname] = useState('');
  const [kundeNachname, setKundeNachname] = useState('');
  const [kundeTelefon, setKundeTelefon] = useState('');
  const [kundeEmail, setKundeEmail] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2 — Auftrag
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaetKey, setPrioritaetKey] = useState('');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragNotizen, setAuftragNotizen] = useState('');
  const [auftragCreating, setAuftragCreating] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);
  const [createdAuftragsnummer, setCreatedAuftragsnummer] = useState('');

  // Step 3 — Positionen
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [posMaterialId, setPosMaterialId] = useState('');
  const [posMenge, setPosMenge] = useState('1');
  const [posEinheitKey, setPosEinheitKey] = useState('none');
  const [posBeschreibung, setPosBeschreibung] = useState('');
  const [posBemerkung, setPosBemerkung] = useState('');
  const [positionsSaving, setPositionsSaving] = useState(false);
  const [positionsSaveError, setPositionsSaveError] = useState<string | null>(null);

  // Step 4 state (positions saved count)
  const [savedPositionenCount, setSavedPositionenCount] = useState(0);

  const selectedKunde: Kunden | undefined = kunden.find(k => k.record_id === selectedKundeId);

  // --- Step 1 handlers ---

  const handleKundeSelect = (id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  };

  const handleCreateKunde = async () => {
    if (!kundeNachname) return;
    setKundeCreating(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: kundeVorname || undefined,
        nachname: kundeNachname,
        telefon: kundeTelefon || undefined,
        email: kundeEmail || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setKundeVorname('');
      setKundeNachname('');
      setKundeTelefon('');
      setKundeEmail('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreating(false);
    }
  };

  // --- Step 2 handlers ---

  const handleCreateAuftrag = async () => {
    if (!selectedKundeId || !auftragsnummer || !auftragsdatum || !auftragsbeschreibung) return;

    // Idempotency: if already created, just proceed
    if (createdAuftragId) {
      setStep(3);
      return;
    }

    setAuftragCreating(true);
    setAuftragCreateError(null);
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
      if (auftragNotizen) payload.auftrag_notizen = auftragNotizen;

      const created = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(created.record_id);
      setCreatedAuftragsnummer(auftragsnummer);
      setStep(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreating(false);
    }
  };

  // --- Step 3 handlers ---

  const selectedMaterialForPos: Material | undefined = material.find(m => m.record_id === posMaterialId);

  const handleAddPositionToList = () => {
    if (!posMaterialId || !posMenge) return;
    const mat = material.find(m => m.record_id === posMaterialId);
    setPositions(prev => [
      ...prev,
      {
        materialId: posMaterialId,
        materialName: mat?.fields.bezeichnung ?? posMaterialId,
        menge: posMenge,
        einheitKey: posEinheitKey,
        positionsbeschreibung: posBeschreibung,
        bemerkung: posBemerkung,
      },
    ]);
    // Reset position form
    setPosMaterialId('');
    setPosMenge('1');
    setPosEinheitKey('none');
    setPosBeschreibung('');
    setPosBemerkung('');
    setShowAddPosition(false);
  };

  const handleRemovePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const handleSavePositions = async () => {
    if (!createdAuftragId) return;
    setPositionsSaving(true);
    setPositionsSaveError(null);
    try {
      for (const pos of positions) {
        const posPayload: Record<string, unknown> = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: parseFloat(pos.menge),
        };
        if (pos.einheitKey && pos.einheitKey !== 'none') posPayload.einheit_position = pos.einheitKey;
        if (pos.positionsbeschreibung) posPayload.positionsbeschreibung = pos.positionsbeschreibung;
        if (pos.bemerkung) posPayload.bemerkung = pos.bemerkung;
        await LivingAppsService.createAuftragspositionenEntry(posPayload);
      }
      setSavedPositionenCount(positions.length);
      setStep(4);
    } catch (err) {
      setPositionsSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern der Positionen');
    } finally {
      setPositionsSaving(false);
    }
  };

  const handleSkipPositions = () => {
    setSavedPositionenCount(0);
    setStep(4);
  };

  // --- Reset ---
  const handleReset = () => {
    setStep(1);
    setSelectedKundeId(null);
    setShowCreateKunde(false);
    setKundeVorname('');
    setKundeNachname('');
    setKundeTelefon('');
    setKundeEmail('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaetKey('');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragNotizen('');
    setCreatedAuftragId(null);
    setCreatedAuftragsnummer('');
    setPositions([]);
    setShowAddPosition(false);
    setPosMaterialId('');
    setPosMenge('1');
    setPosEinheitKey('none');
    setPosBeschreibung('');
    setPosBemerkung('');
    setSavedPositionenCount(0);
    setAuftragCreateError(null);
    setPositionsSaveError(null);
    setKundeCreateError(null);
  };

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde auswählen, Auftragsdetails erfassen und Materialien zuweisen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Positionen' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Kunde auswählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Kunde auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Wähle einen bestehenden Kunden oder lege einen neuen an.</p>
          </div>
          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '(Kein Name)',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowCreateKunde(v => !v)}
            createDialog={showCreateKunde && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    value={kundeVorname}
                    onChange={e => setKundeVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                  <Input
                    value={kundeNachname}
                    onChange={e => setKundeNachname(e.target.value)}
                    placeholder="Nachname *"
                  />
                  <Input
                    value={kundeTelefon}
                    onChange={e => setKundeTelefon(e.target.value)}
                    placeholder="Telefon"
                  />
                  <Input
                    value={kundeEmail}
                    onChange={e => setKundeEmail(e.target.value)}
                    placeholder="E-Mail"
                    type="email"
                  />
                </div>
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    disabled={!kundeNachname || kundeCreating}
                    onClick={handleCreateKunde}
                    className="gap-1.5"
                  >
                    <IconPlus size={15} />
                    {kundeCreating ? 'Wird angelegt...' : 'Anlegen & auswählen'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCreateKunde(false)}>Abbrechen</Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ── Step 2: Auftrag anlegen ── */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Auftragsdetails</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag für <span className="font-medium text-foreground">
                  {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || 'Kunden'}
                </span> anlegen.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Auftragsnummer + Datum */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z.B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              {/* Status + Priorität */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Status *</label>
                  <Select value={statusKey} onValueChange={setStatusKey}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Status wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(o => (
                        <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Priorität</label>
                  <Select value={prioritaetKey || 'none'} onValueChange={v => setPrioritaetKey(v === 'none' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Priorität wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Angabe</SelectItem>
                      {PRIORITAET_OPTIONS.map(o => (
                        <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Beschreibung */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Auftragsbeschreibung *</label>
                <textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibung des Auftrags..."
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Wunschtermin + Monteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Monteur</label>
                  <Input
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {/* Notizen */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Notizen</label>
                <textarea
                  value={auftragNotizen}
                  onChange={e => setAuftragNotizen(e.target.value)}
                  placeholder="Interne Notizen zum Auftrag..."
                  rows={2}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>

            {auftragCreateError && (
              <p className="text-sm text-destructive">{auftragCreateError}</p>
            )}

            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={() => setStep(1)}>Zurück</Button>
              <Button
                disabled={!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || auftragCreating}
                onClick={handleCreateAuftrag}
                className="gap-1.5"
              >
                <IconClipboardList size={16} />
                {auftragCreating ? 'Wird angelegt...' : 'Auftrag anlegen'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt benötigt einen ausgewählten Kunden aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Step 3: Positionen hinzufügen ── */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Materialien & Positionen</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Füge Materialien zum Auftrag <span className="font-medium text-foreground">{createdAuftragsnummer}</span> hinzu.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                  <IconPackage size={14} />
                  {positions.length} {positions.length === 1 ? 'Position' : 'Positionen'}
                </span>
              </div>
            </div>

            {/* Position list */}
            {positions.length > 0 && (
              <div className="space-y-2">
                {positions.map((pos, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <IconPackage size={15} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pos.materialName}</p>
                      <p className="text-xs text-muted-foreground">
                        {pos.menge} {pos.einheitKey !== 'none' ? (EINHEIT_OPTIONS.find(e => e.key === pos.einheitKey)?.label ?? pos.einheitKey) : ''}
                        {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePosition(idx)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add position button */}
            {!showAddPosition && (
              <Button variant="outline" onClick={() => setShowAddPosition(true)} className="w-full gap-1.5">
                <IconPlus size={15} />
                Position hinzufügen
              </Button>
            )}

            {/* Add position form */}
            {showAddPosition && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Neue Position</h3>

                {/* Material selection */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Material *</label>
                  <Select value={posMaterialId || 'none'} onValueChange={v => setPosMaterialId(v === 'none' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Material auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Material wählen...</SelectItem>
                      {material.map((m: Material) => (
                        <SelectItem key={m.record_id} value={m.record_id}>
                          {m.fields.bezeichnung || m.record_id}
                          {m.fields.artikelnummer ? ` (${m.fields.artikelnummer})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMaterialForPos && (
                    <p className="text-xs text-muted-foreground">
                      Lagerbestand: {selectedMaterialForPos.fields.lagerbestand ?? '–'}
                      {selectedMaterialForPos.fields.einheit ? ` ${selectedMaterialForPos.fields.einheit.label}` : ''}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Menge */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Menge *</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={posMenge}
                      onChange={e => setPosMenge(e.target.value)}
                      placeholder="Menge"
                    />
                  </div>

                  {/* Einheit */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Einheit</label>
                    <Select value={posEinheitKey} onValueChange={setPosEinheitKey}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Einheit wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Einheit</SelectItem>
                        {EINHEIT_OPTIONS.map(o => (
                          <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Positionsbeschreibung */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Positionsbeschreibung</label>
                  <Input
                    value={posBeschreibung}
                    onChange={e => setPosBeschreibung(e.target.value)}
                    placeholder="Kurze Beschreibung dieser Position"
                  />
                </div>

                {/* Bemerkung */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Bemerkung</label>
                  <textarea
                    value={posBemerkung}
                    onChange={e => setPosBemerkung(e.target.value)}
                    placeholder="Optionale Bemerkung..."
                    rows={2}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    disabled={!posMaterialId || !posMenge}
                    onClick={handleAddPositionToList}
                    className="gap-1.5"
                  >
                    <IconPlus size={15} />
                    Hinzufügen
                  </Button>
                  <Button variant="ghost" onClick={() => setShowAddPosition(false)}>Abbrechen</Button>
                </div>
              </div>
            )}

            {positionsSaveError && (
              <p className="text-sm text-destructive">{positionsSaveError}</p>
            )}

            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={() => setStep(2)}>Zurück</Button>
              {positions.length > 0 ? (
                <Button
                  disabled={positionsSaving}
                  onClick={handleSavePositions}
                  className="gap-1.5"
                >
                  <IconCheck size={16} />
                  {positionsSaving ? 'Wird gespeichert...' : `${positions.length} ${positions.length === 1 ? 'Position' : 'Positionen'} speichern`}
                </Button>
              ) : (
                <Button variant="outline" onClick={handleSkipPositions}>
                  Ohne Positionen abschließen
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt benötigt einen angelegten Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Step 4: Zusammenfassung ── */}
      {step === 4 && (
        createdAuftragId ? (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center py-8 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <IconCheck size={32} className="text-primary" stroke={2} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Auftrag erfolgreich angelegt!</h2>
                <p className="text-sm text-muted-foreground mt-1">Der Auftrag wurde gespeichert.</p>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Zusammenfassung</h3>
              <div className="divide-y">
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="text-muted-foreground">Auftragsnummer</span>
                  <span className="font-medium text-foreground">{createdAuftragsnummer}</span>
                </div>
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="text-muted-foreground">Kunde</span>
                  <span className="font-medium text-foreground">
                    {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') || selectedKunde?.fields.firma || '–'}
                  </span>
                </div>
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="text-muted-foreground">Auftragsdatum</span>
                  <span className="font-medium text-foreground">{auftragsdatum}</span>
                </div>
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium text-foreground">
                    {STATUS_OPTIONS.find(o => o.key === statusKey)?.label ?? statusKey}
                  </span>
                </div>
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="text-muted-foreground">Positionen</span>
                  <span className="font-medium text-foreground">
                    {savedPositionenCount} {savedPositionenCount === 1 ? 'Position' : 'Positionen'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button onClick={handleReset} className="gap-1.5">
                <IconPlus size={16} />
                Neuen Auftrag anlegen
              </Button>
              <a href="#/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors">
                Zurück zum Dashboard
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Kein Auftrag gefunden. Bitte starte den Wizard neu.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
