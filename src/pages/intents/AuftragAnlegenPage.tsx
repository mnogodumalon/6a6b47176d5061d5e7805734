/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftragsdaten erfassen → 3) Materialien (Auftragspositionen) hinzufügen & bestätigen.
 * Reads: kunden, auftraege, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IconUser, IconPlus, IconTrash, IconAlertTriangle, IconCheck, IconPackage } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, auftraege, material, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);

  // Step 2 fields
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [prioritaet, setPrioritaet] = useState(PRIORITAET_OPTIONS[1]?.key ?? '');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [savingAuftrag, setSavingAuftrag] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);
  const [newAuftragId, setNewAuftragId] = useState<string | null>(null);
  const [newAuftragNummer, setNewAuftragNummer] = useState<string | null>(null);

  // Step 3 fields
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState(EINHEIT_POSITION_OPTIONS[0]?.key ?? 'stueck');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [savingPositions, setSavingPositions] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [savedPositionIds, setSavedPositionIds] = useState<string[]>([]);

  // Neue Kunde anlegen
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [creatingKunde, setCreatingKunde] = useState(false);

  // Derived auftragsnummer
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const auftragsnummer = useMemo(() => {
    const count = auftraege.length;
    return `AU-${todayStr}-${String(count + 1).padStart(3, '0')}`;
  }, [auftraege.length, todayStr]);

  // Per-Kunde Auftragsanzahl
  const auftraegePerKunde = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of auftraege) {
      if (a.fields.kunde) {
        const kundeId = extractRecordId(a.fields.kunde);
        if (kundeId) map.set(kundeId, (map.get(kundeId) ?? 0) + 1);
      }
    }
    return map;
  }, [auftraege]);

  // Material map
  const materialMap = useMemo(() => {
    const m = new Map<string, Material>();
    for (const mat of material) m.set(mat.record_id, mat);
    return m;
  }, [material]);

  const selectedMaterial = selectedMaterialId ? materialMap.get(selectedMaterialId) ?? null : null;

  // Step 1: Kunde wählen
  const handleKundeSelect = (id: string) => {
    const k = kunden.find(k => k.record_id === id);
    if (k) {
      setSelectedKunde(k);
      setStep(2);
    }
  };

  const handleCreateKunde = async () => {
    if (!newKundeVorname.trim() || !newKundeNachname.trim()) return;
    setCreatingKunde(true);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname.trim(),
        nachname: newKundeNachname.trim(),
        telefon: newKundeTelefon.trim() || undefined,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeTelefon('');
      const k = kunden.find(k => k.record_id === created.record_id) ??
        { record_id: created.record_id, fields: { vorname: newKundeVorname, nachname: newKundeNachname, telefon: newKundeTelefon }, created_at: format(today, "yyyy-MM-dd'T'HH:mm"), createdat: format(today, "yyyy-MM-dd'T'HH:mm"), updated_at: null, updatedat: null };
      setSelectedKunde(k as Kunden);
      setStep(2);
    } finally {
      setCreatingKunde(false);
    }
  };

  // Step 2: Auftrag anlegen
  const handleCreateAuftrag = async () => {
    if (!selectedKunde || !auftragsbeschreibung.trim()) return;
    // Idempotency guard
    if (newAuftragId) { setStep(3); return; }
    setSavingAuftrag(true);
    setAuftragError(null);
    try {
      const result = await LivingAppsService.createAuftraegeEntry({
        auftragsnummer,
        auftragsdatum: todayStr,
        status: 'offen',
        prioritaet: prioritaet || 'normal',
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        wunschtermin: wunschtermin || undefined,
        monteur: monteur.trim() || undefined,
      });
      setNewAuftragId(result.record_id);
      setNewAuftragNummer(auftragsnummer);
      await fetchAll();
      setStep(3);
    } catch (e) {
      setAuftragError(e instanceof Error ? e.message : 'Fehler beim Anlegen des Auftrags.');
    } finally {
      setSavingAuftrag(false);
    }
  };

  // Step 3: Position hinzufügen
  const handleAddPosition = () => {
    if (!selectedMaterialId || !positionMenge) return;
    const draft: PositionDraft = {
      materialId: selectedMaterialId,
      menge: positionMenge,
      einheitKey: positionEinheitKey,
      positionsbeschreibung: positionBeschreibung.trim(),
    };
    setPositions(prev => [...prev, draft]);
    setSelectedMaterialId(null);
    setPositionMenge('1');
    setPositionEinheitKey(EINHEIT_POSITION_OPTIONS[0]?.key ?? 'stueck');
    setPositionBeschreibung('');
  };

  const handleRemovePosition = (idx: number) => {
    setPositions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSavePositions = async () => {
    if (!newAuftragId) return;
    setSavingPositions(true);
    setPositionError(null);
    try {
      // Only create positions that haven't been saved yet
      const unsavedPositions = positions.slice(savedPositionIds.length);
      for (const pos of unsavedPositions) {
        const result = await LivingAppsService.createAuftragspositionenEntry({
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, newAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: Number(pos.menge),
          einheit_position: pos.einheitKey !== 'none' ? pos.einheitKey : undefined,
          positionsbeschreibung: pos.positionsbeschreibung || undefined,
        });
        setSavedPositionIds(prev => [...prev, result.record_id]);
      }
      await fetchAll();
      setStep(4);
    } catch (e) {
      setPositionError(e instanceof Error ? e.message : 'Fehler beim Speichern der Positionen.');
    } finally {
      setSavingPositions(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKunde(null);
    setAuftragsbeschreibung('');
    setPrioritaet(PRIORITAET_OPTIONS[1]?.key ?? '');
    setWunschtermin('');
    setMonteur('');
    setNewAuftragId(null);
    setNewAuftragNummer(null);
    setPositions([]);
    setSavedPositionIds([]);
    setSelectedMaterialId(null);
    setPositionMenge('1');
    setPositionEinheitKey(EINHEIT_POSITION_OPTIONS[0]?.key ?? 'stueck');
    setPositionBeschreibung('');
    setAuftragError(null);
    setPositionError(null);
  };

  const mengeNum = Number(positionMenge);
  const lagerbestand = selectedMaterial?.fields.lagerbestand ?? 0;
  const mindestbestand = selectedMaterial?.fields.mindestbestand ?? 0;

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Neuen Auftrag in 3 Schritten erstellen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Materialien' },
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
          items={kunden.map(k => ({
            id: k.record_id,
            title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || k.record_id,
            subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
            icon: <IconUser size={20} className="text-primary" />,
            stats: [
              { label: 'Aufträge', value: auftraegePerKunde.get(k.record_id) ?? 0 },
            ],
          }))}
          onSelect={handleKundeSelect}
          searchPlaceholder="Kunden suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowCreateKunde(true)}
          createDialog={showCreateKunde ? (
            <div className="rounded-2xl border p-4 space-y-3 bg-card">
              <p className="text-sm font-medium">Neuen Kunden anlegen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  value={newKundeVorname}
                  onChange={e => setNewKundeVorname(e.target.value)}
                  placeholder="Vorname *"
                />
                <Input
                  value={newKundeNachname}
                  onChange={e => setNewKundeNachname(e.target.value)}
                  placeholder="Nachname *"
                />
              </div>
              <Input
                value={newKundeTelefon}
                onChange={e => setNewKundeTelefon(e.target.value)}
                placeholder="Telefon"
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateKunde}
                  disabled={!newKundeVorname.trim() || !newKundeNachname.trim() || creatingKunde}
                >
                  {creatingKunde ? 'Wird angelegt …' : 'Anlegen & auswählen'}
                </Button>
                <Button variant="outline" onClick={() => setShowCreateKunde(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : undefined}
        />
      )}

      {/* Step 2: Auftragsdaten */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-5 max-w-xl mx-auto">
            {/* Kontextinfo */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconUser size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma}
                </p>
                {selectedKunde.fields.firma && <p className="text-sm text-muted-foreground truncate">{selectedKunde.fields.firma}</p>}
              </div>
              <div className="ml-auto shrink-0">
                <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                <p className="text-sm font-mono font-semibold">{auftragsnummer}</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Auftragsbeschreibung *</label>
              <Textarea
                value={auftragsbeschreibung}
                onChange={e => setAuftragsbeschreibung(e.target.value)}
                placeholder="Beschreibung des Auftrags …"
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Priorität</label>
              <div className="flex flex-wrap gap-2">
                {PRIORITAET_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPrioritaet(opt.key)}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                      prioritaet === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

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

            {auftragError && (
              <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                <IconAlertTriangle size={16} />
                {auftragError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                onClick={handleCreateAuftrag}
                disabled={!auftragsbeschreibung.trim() || savingAuftrag}
                className="flex-1"
              >
                {savingAuftrag ? 'Wird angelegt …' : 'Auftrag anlegen & weiter'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Kundenauswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* Step 3: Auftragspositionen */}
      {step === 3 && (
        newAuftragId ? (
          <div className="space-y-5 max-w-2xl mx-auto">
            {/* Auftrag-Kontext */}
            <div className="rounded-2xl border bg-secondary/40 p-3 flex items-center gap-3">
              <IconPackage size={18} className="text-primary shrink-0" />
              <p className="text-sm font-medium">Auftrag <span className="font-mono">{newAuftragNummer}</span></p>
              <span className="ml-auto text-xs text-muted-foreground">{positions.length} Position(en)</span>
            </div>

            {/* Material auswählen */}
            <div className="rounded-2xl border p-4 space-y-4 bg-card">
              <p className="text-sm font-medium">Position hinzufügen</p>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Material *</label>
                <Select value={selectedMaterialId ?? 'none'} onValueChange={v => setSelectedMaterialId(v === 'none' ? null : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Material wählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Material wählen …</SelectItem>
                    {material.map(m => (
                      <SelectItem key={m.record_id} value={m.record_id}>
                        {m.fields.bezeichnung ?? m.record_id}
                        {m.fields.artikelnummer ? ` (${m.fields.artikelnummer})` : ''}
                        {m.fields.verfuegbarkeit?.key === 'nicht_verfuegbar' ? ' ⚠ nicht verfügbar' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedMaterial && (
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Lagerbestand: <span className={lagerbestand <= mindestbestand ? 'text-amber-600 font-semibold' : 'font-semibold'}>{lagerbestand}</span>
                    </span>
                    {mindestbestand > 0 && (
                      <span className="text-muted-foreground">Mindestbestand: <span className="font-semibold">{mindestbestand}</span></span>
                    )}
                    {selectedMaterial.fields.verfuegbarkeit && (
                      <Badge variant="outline" className="text-xs">
                        {selectedMaterial.fields.verfuegbarkeit.label}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Menge *</label>
                  <Input
                    type="number"
                    min="1"
                    value={positionMenge}
                    onChange={e => setPositionMenge(e.target.value)}
                  />
                  {selectedMaterial && mengeNum > lagerbestand && lagerbestand > 0 && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <IconAlertTriangle size={12} />
                      Übersteigt den Lagerbestand ({lagerbestand}) — trotzdem möglich.
                    </p>
                  )}
                  {selectedMaterial && lagerbestand <= mindestbestand && mindestbestand > 0 && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <IconAlertTriangle size={12} />
                      Lagerbestand unter Mindestbestand.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Einheit</label>
                  <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EINHEIT_POSITION_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Beschreibung (optional)</label>
                <Input
                  value={positionBeschreibung}
                  onChange={e => setPositionBeschreibung(e.target.value)}
                  placeholder="Kurzbeschreibung der Position"
                />
              </div>

              <Button
                onClick={handleAddPosition}
                disabled={!selectedMaterialId || selectedMaterialId === 'none' || !positionMenge || Number(positionMenge) <= 0}
                variant="outline"
                className="w-full"
              >
                <IconPlus size={16} className="mr-1" />
                Position zur Liste hinzufügen
              </Button>
            </div>

            {/* Positions-Liste */}
            {positions.length > 0 && (
              <div className="rounded-2xl border overflow-hidden">
                <div className="px-4 py-2 bg-secondary/40 border-b">
                  <p className="text-sm font-medium">{positions.length} Position(en) erfasst</p>
                </div>
                <div className="divide-y">
                  {positions.map((pos, idx) => {
                    const mat = materialMap.get(pos.materialId);
                    const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label ?? pos.einheitKey;
                    return (
                      <div key={idx} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{mat?.fields.bezeichnung ?? pos.materialId}</p>
                          <p className="text-xs text-muted-foreground">
                            {pos.menge} {einheitLabel}
                            {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                          </p>
                          {idx < savedPositionIds.length && (
                            <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                              <IconCheck size={12} /> Gespeichert
                            </p>
                          )}
                        </div>
                        {idx >= savedPositionIds.length && (
                          <button
                            type="button"
                            onClick={() => handleRemovePosition(idx)}
                            className="text-muted-foreground hover:text-destructive p-1 rounded shrink-0"
                          >
                            <IconTrash size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {positionError && (
              <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                <IconAlertTriangle size={16} />
                {positionError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleSavePositions}
                disabled={savingPositions || positions.length === savedPositionIds.length}
                className="flex-1"
              >
                {savingPositions ? 'Wird gespeichert …' : positions.length === 0 ? 'Ohne Positionen abschließen' : `${positions.length - savedPositionIds.length} Position(en) speichern & abschließen`}
              </Button>
              {positions.length === savedPositionIds.length && positions.length > 0 && (
                <Button onClick={() => setStep(4)} className="flex-1">
                  Weiter zu Zusammenfassung
                </Button>
              )}
              {positions.length === 0 && (
                <Button variant="outline" onClick={() => setStep(4)}>
                  Überspringen
                </Button>
              )}
              <Button variant="outline" onClick={() => setStep(2)}>
                Zurück
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht den angelegten Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}

      {/* Step 4: Zusammenfassung */}
      {step === 4 && (
        newAuftragId ? (
          <div className="space-y-5 max-w-xl mx-auto text-center">
            <div className="rounded-full bg-green-100 w-16 h-16 flex items-center justify-center mx-auto">
              <IconCheck size={32} className="text-green-600" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Auftrag angelegt!</h2>
              <p className="text-muted-foreground text-sm">
                Auftrag <span className="font-mono font-semibold">{newAuftragNummer}</span> wurde erfolgreich erstellt.
              </p>
              {positions.length > 0 && (
                <p className="text-sm text-muted-foreground">{positions.length} Position(en) erfasst.</p>
              )}
            </div>

            <div className="rounded-2xl border bg-secondary/40 p-4 text-left space-y-2">
              {selectedKunde && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Kunde</span>
                  <span className="font-medium">
                    {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Datum</span>
                <span className="font-medium">{todayStr}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">Offen</span>
              </div>
              {monteur && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Monteur</span>
                  <span className="font-medium">{monteur}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={handleReset}>
                Neuen Auftrag anlegen
              </Button>
              <a href="#/" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2">
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
