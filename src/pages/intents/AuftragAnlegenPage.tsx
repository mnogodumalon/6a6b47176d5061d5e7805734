/**
 * Auftrag anlegen — 4-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftrag anlegen → 3) Positionen & Material hinzufügen → 4) Zusammenfassung.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  IconUser,
  IconClipboardList,
  IconPackage,
  IconCheck,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

const TODAY = format(new Date(), 'yyyy-MM-dd');

interface PositionRow {
  tempId: number;
  materialId: string;
  materialLabel: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function AuftragAnlegenPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Step state — initialize from URL param, validate it makes sense
  const urlStep = parseInt(searchParams.get('step') ?? '1', 10);
  const urlKundeId = searchParams.get('kundeId') ?? '';

  const [step, setStep] = useState<number>(() => {
    if (urlKundeId && urlStep >= 2) return urlStep;
    return 1;
  });

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string>(urlKundeId);
  const [showCreateKunde, setShowCreateKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeFirma, setNewKundeFirma] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [creatingKunde, setCreatingKunde] = useState(false);

  // Step 2 — Auftrag form
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(TODAY);
  const [prioritaet, setPrioritaet] = useState<string>('normal');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [savingAuftrag, setSavingAuftrag] = useState(false);
  const [auftragError, setAuftragError] = useState('');

  // Step 3 — Positionen
  const [createdAuftragId, setCreatedAuftragId] = useState<string>('');
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [nextTempId, setNextTempId] = useState(1);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [addMatId, setAddMatId] = useState('');
  const [addMenge, setAddMenge] = useState('1');
  const [addEinheitKey, setAddEinheitKey] = useState<string>('stueck');
  const [addBeschreibung, setAddBeschreibung] = useState('');
  const [addMatSearch, setAddMatSearch] = useState('');
  const [savingPositions, setSavingPositions] = useState(false);
  const [positionError, setPositionError] = useState('');

  // Step 4 — summary
  const [done, setDone] = useState(false);

  const kundenArray = Object.values(kunden ?? {}) as Kunden[];
  const materialArray = Object.values(material ?? {}) as Material[];

  const selectedKunde = kundenArray.find(k => k.record_id === selectedKundeId);

  const navigateToStep = useCallback((newStep: number) => {
    setStep(newStep);
    const params: Record<string, string> = { step: String(newStep) };
    if (selectedKundeId) params.kundeId = selectedKundeId;
    setSearchParams(params, { replace: true });
  }, [selectedKundeId, setSearchParams]);

  // Kunde erstellen
  const handleCreateKunde = async () => {
    if (!newKundeVorname.trim() && !newKundeFirma.trim()) return;
    setCreatingKunde(true);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname,
        nachname: newKundeNachname,
        firma: newKundeFirma,
        telefon: newKundeTelefon,
      });
      await fetchAll();
      setShowCreateKunde(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeFirma('');
      setNewKundeTelefon('');
      setSelectedKundeId(created.record_id);
      const params: Record<string, string> = { step: '2', kundeId: created.record_id };
      setSearchParams(params, { replace: true });
      setStep(2);
    } finally {
      setCreatingKunde(false);
    }
  };

  // Auftrag erstellen
  const handleCreateAuftrag = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()) {
      setAuftragError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }
    setAuftragError('');
    setSavingAuftrag(true);
    try {
      const payload: Record<string, unknown> = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        status: 'offen',
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaet && prioritaet !== 'none') payload.prioritaet = prioritaet;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur.trim()) payload.monteur = monteur.trim();

      const created = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(created.record_id);
      navigateToStep(3);
    } catch {
      setAuftragError('Fehler beim Anlegen des Auftrags. Bitte versuche es erneut.');
    } finally {
      setSavingAuftrag(false);
    }
  };

  // Position zur lokalen Liste hinzufügen
  const handleAddPosition = () => {
    if (!addMatId || !addMenge || parseFloat(addMenge) <= 0) return;
    const mat = materialArray.find(m => m.record_id === addMatId);
    setPositions(prev => [
      ...prev,
      {
        tempId: nextTempId,
        materialId: addMatId,
        materialLabel: mat?.fields.bezeichnung ?? addMatId,
        menge: addMenge,
        einheitKey: addEinheitKey,
        positionsbeschreibung: addBeschreibung,
      },
    ]);
    setNextTempId(n => n + 1);
    setAddMatId('');
    setAddMenge('1');
    setAddEinheitKey('stueck');
    setAddBeschreibung('');
    setAddMatSearch('');
    setShowAddPosition(false);
  };

  const handleRemovePosition = (tempId: number) => {
    setPositions(prev => prev.filter(p => p.tempId !== tempId));
  };

  // Alle Positionen speichern und zur Zusammenfassung wechseln
  const handleFinish = async () => {
    if (!createdAuftragId) return;
    setSavingPositions(true);
    setPositionError('');
    try {
      for (const pos of positions) {
        const payload: Record<string, unknown> = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge: parseFloat(pos.menge),
        };
        if (pos.einheitKey && pos.einheitKey !== 'none') payload.einheit_position = pos.einheitKey;
        if (pos.positionsbeschreibung.trim()) payload.positionsbeschreibung = pos.positionsbeschreibung.trim();
        await LivingAppsService.createAuftragspositionenEntry(payload);
      }
      setDone(true);
      navigateToStep(4);
    } catch {
      setPositionError('Fehler beim Speichern der Positionen. Bitte versuche es erneut.');
    } finally {
      setSavingPositions(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKundeId('');
    setAuftragsnummer('');
    setAuftragsdatum(TODAY);
    setPrioritaet('normal');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setCreatedAuftragId('');
    setPositions([]);
    setNextTempId(1);
    setDone(false);
    setAuftragError('');
    setPositionError('');
    setSearchParams({}, { replace: true });
  };

  const filteredMaterial = materialArray.filter(m => {
    if (!addMatSearch) return true;
    const q = addMatSearch.toLowerCase();
    return (
      m.fields.bezeichnung?.toLowerCase().includes(q) ||
      m.fields.artikelnummer?.toLowerCase().includes(q)
    );
  });

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde wählen, Auftrag erfassen und Positionen hinzufügen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Positionen' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={navigateToStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Kunde wählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={kundenArray.map(k => ({
            id: k.record_id,
            title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '–',
            subtitle: k.fields.firma && (k.fields.vorname || k.fields.nachname)
              ? k.fields.firma
              : k.fields.email ?? k.fields.telefon ?? '',
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={(id) => {
            setSelectedKundeId(id);
            const params: Record<string, string> = { step: '2', kundeId: id };
            setSearchParams(params, { replace: true });
            setStep(2);
          }}
          searchPlaceholder="Kunde suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowCreateKunde(true)}
          createDialog={showCreateKunde && (
            <div className="rounded-2xl border bg-card p-4 space-y-3 mt-4">
              <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="kd-vorname">Vorname</Label>
                  <Input
                    id="kd-vorname"
                    value={newKundeVorname}
                    onChange={e => setNewKundeVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="kd-nachname">Nachname</Label>
                  <Input
                    id="kd-nachname"
                    value={newKundeNachname}
                    onChange={e => setNewKundeNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="kd-firma">Firma</Label>
                <Input
                  id="kd-firma"
                  value={newKundeFirma}
                  onChange={e => setNewKundeFirma(e.target.value)}
                  placeholder="Firmenname (optional)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kd-telefon">Telefon</Label>
                <Input
                  id="kd-telefon"
                  value={newKundeTelefon}
                  onChange={e => setNewKundeTelefon(e.target.value)}
                  placeholder="Telefonnummer (optional)"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateKunde}
                  disabled={creatingKunde || (!newKundeVorname.trim() && !newKundeFirma.trim())}
                >
                  {creatingKunde ? 'Wird angelegt …' : 'Anlegen'}
                </Button>
                <Button variant="outline" onClick={() => setShowCreateKunde(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        />
      )}

      {/* ── Schritt 2: Auftrag anlegen ── */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-6 max-w-2xl mx-auto">
            {/* Kundenkontext */}
            <div className="rounded-2xl border bg-secondary/30 p-4 flex items-center gap-3">
              <IconUser size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Kunde</p>
                <p className="font-medium truncate">
                  {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') ||
                    selectedKunde?.fields.firma || selectedKundeId}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => navigateToStep(1)}>
                Ändern
              </Button>
            </div>

            {/* Auftragsdaten */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <IconClipboardList size={18} className="text-primary" />
                <h2 className="font-semibold text-foreground">Auftragsdetails</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="auftragsnummer">
                    Auftragsnummer <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="auftragsnummer"
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="auftragsdatum">
                    Auftragsdatum <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="auftragsdatum"
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              {/* Priorität als Radio-Tiles */}
              <div className="space-y-1">
                <Label>Priorität</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPrioritaet(opt.key)}
                      className={[
                        'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                        prioritaet === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground border-border hover:bg-secondary',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="auftragsbeschreibung">
                  Auftragsbeschreibung <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="auftragsbeschreibung"
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll erledigt werden?"
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
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="monteur">Monteur</Label>
                  <Input
                    id="monteur"
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragError && (
                <p className="text-sm text-destructive">{auftragError}</p>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => navigateToStep(1)}>
                  Zurück
                </Button>
                <Button
                  onClick={handleCreateAuftrag}
                  disabled={savingAuftrag || !auftragsnummer.trim() || !auftragsdatum || !auftragsbeschreibung.trim()}
                >
                  {savingAuftrag ? 'Wird angelegt …' : 'Auftrag anlegen & weiter'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => navigateToStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Schritt 3: Positionen ── */}
      {step === 3 && (
        createdAuftragId ? (
          <div className="space-y-5 max-w-2xl mx-auto">
            {/* Kontext-Banner */}
            <div className="rounded-2xl border bg-secondary/30 p-4 flex items-center gap-3">
              <IconClipboardList size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Auftrag</p>
                <p className="font-medium truncate">{auftragsnummer}</p>
              </div>
              <div className="ml-auto shrink-0 rounded-full bg-primary/10 text-primary px-3 py-1 text-sm font-medium">
                {positions.length} {positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
              </div>
            </div>

            {/* Positions-Liste */}
            {positions.length > 0 && (
              <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="divide-y">
                  {positions.map(pos => (
                    <div key={pos.tempId} className="flex items-center gap-3 px-4 py-3">
                      <IconPackage size={16} className="text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{pos.materialLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.menge} {EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label ?? pos.einheitKey}
                          {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePosition(pos.tempId)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                        aria-label="Position entfernen"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Position hinzufügen */}
            {!showAddPosition ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddPosition(true)}
              >
                <IconPlus size={16} className="mr-2" />
                Position hinzufügen
              </Button>
            ) : (
              <div className="rounded-2xl border bg-card p-4 space-y-4">
                <p className="text-sm font-medium text-foreground">Neue Position</p>

                {/* Material-Suche */}
                <div className="space-y-1">
                  <Label>Material <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Material suchen …"
                    value={addMatSearch}
                    onChange={e => {
                      setAddMatSearch(e.target.value);
                      setAddMatId('');
                    }}
                  />
                  {addMatSearch && (
                    <div className="rounded-xl border bg-card max-h-48 overflow-y-auto divide-y mt-1">
                      {filteredMaterial.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-3 py-2">Kein Material gefunden</p>
                      ) : (
                        filteredMaterial.map(m => (
                          <button
                            key={m.record_id}
                            type="button"
                            onClick={() => {
                              setAddMatId(m.record_id);
                              setAddMatSearch(m.fields.bezeichnung ?? m.record_id);
                            }}
                            className={[
                              'w-full text-left px-3 py-2 text-sm transition-colors',
                              addMatId === m.record_id
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-secondary text-foreground',
                            ].join(' ')}
                          >
                            <span className="font-medium">{m.fields.bezeichnung ?? '–'}</span>
                            {m.fields.artikelnummer && (
                              <span className="text-muted-foreground ml-2 text-xs">{m.fields.artikelnummer}</span>
                            )}
                            {m.fields.verfuegbarkeit && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                · {m.fields.verfuegbarkeit.label}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="add-menge">Menge <span className="text-destructive">*</span></Label>
                    <Input
                      id="add-menge"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={addMenge}
                      onChange={e => setAddMenge(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="add-einheit">Einheit</Label>
                    <Select value={addEinheitKey} onValueChange={setAddEinheitKey}>
                      <SelectTrigger id="add-einheit">
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
                  <Label htmlFor="add-beschreibung">Positionsbeschreibung</Label>
                  <Input
                    id="add-beschreibung"
                    value={addBeschreibung}
                    onChange={e => setAddBeschreibung(e.target.value)}
                    placeholder="Kurze Beschreibung (optional)"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleAddPosition}
                    disabled={!addMatId || !addMenge || parseFloat(addMenge) <= 0}
                  >
                    Hinzufügen
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setShowAddPosition(false);
                    setAddMatId('');
                    setAddMenge('1');
                    setAddEinheitKey('stueck');
                    setAddBeschreibung('');
                    setAddMatSearch('');
                  }}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}

            {positionError && (
              <p className="text-sm text-destructive">{positionError}</p>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => navigateToStep(2)}>
                Zurück
              </Button>
              <Button
                onClick={handleFinish}
                disabled={savingPositions}
              >
                {savingPositions ? 'Wird gespeichert …' : 'Fertigstellen'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 2.</p>
            <Button variant="outline" onClick={() => navigateToStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Schritt 4: Zusammenfassung ── */}
      {step === 4 && (
        done && createdAuftragId ? (
          <div className="space-y-6 max-w-lg mx-auto text-center">
            <div className="rounded-2xl border bg-card p-6 space-y-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <IconCheck size={28} className="text-primary" stroke={2} />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Auftrag angelegt!</h2>

              <div className="text-left divide-y rounded-xl border overflow-hidden">
                <div className="flex justify-between px-4 py-3 bg-secondary/20">
                  <span className="text-sm text-muted-foreground">Kunde</span>
                  <span className="text-sm font-medium">
                    {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ') ||
                      selectedKunde?.fields.firma || '–'}
                  </span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                  <span className="text-sm font-medium">{auftragsnummer}</span>
                </div>
                <div className="flex justify-between px-4 py-3 bg-secondary/20">
                  <span className="text-sm text-muted-foreground">Auftragsdatum</span>
                  <span className="text-sm font-medium">{auftragsdatum}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Positionen</span>
                  <span className="text-sm font-medium">
                    {positions.length} {positions.length === 1 ? 'Position' : 'Positionen'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={handleReset}>
                Neuen Auftrag anlegen
              </Button>
              <Button variant="outline" asChild>
                <a href="#/">Zurück zum Dashboard</a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die vorherigen Schritte.</p>
            <Button variant="outline" onClick={() => navigateToStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
