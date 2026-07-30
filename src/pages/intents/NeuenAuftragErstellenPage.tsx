/**
 * NeuenAuftragErstellenPage — 3-Schritt-Wizard zum Anlegen eines neuen Auftrags mit Materialpositionen.
 * Steps: 1) Kunde auswählen (oder neu anlegen) → 2) Auftragsdaten erfassen & Auftrag anlegen
 *        → 3) Materialpositionen hinzufügen → Fertigstellen.
 * Reads: kunden, material. Writes: kunden (createKundenEntry), auftraege (createAuftraegeEntry),
 *        auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
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
import { Card, CardContent } from '@/components/ui/card';
import {
  IconPlus,
  IconCheck,
  IconPackage,
  IconUser,
  IconClipboardList,
} from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftrag' },
  { label: 'Positionen' },
];

interface AddedPosition {
  materialId: string;
  materialBezeichnung: string;
  materialArtikelnummer: string;
  menge: number;
  einheit_position: string;
  positionsbeschreibung: string;
}

export default function NeuenAuftragErstellenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Step navigation
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neuerTelefon, setNeuerTelefon] = useState('');
  const [neuerEmail, setNeuerEmail] = useState('');
  const [neuerFirma, setNeuerFirma] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeError, setKundeError] = useState<string | null>(null);

  // Step 2 — Auftrag
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState('');
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreating, setAuftragCreating] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);
  const [newAuftragId, setNewAuftragId] = useState<string | null>(null);

  // Step 3 — Materialpositionen
  const [materialSearch, setMaterialSearch] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [menge, setMenge] = useState('');
  const [einheitPosition, setEinheitPosition] = useState('none');
  const [positionsbeschreibung, setPositionsbeschreibung] = useState('');
  const [addedPositions, setAddedPositions] = useState<AddedPosition[]>([]);
  const [positionAdding, setPositionAdding] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Derived
  const selectedKunde = useMemo(
    () => kunden.find((k: Kunden) => k.record_id === selectedKundeId) ?? null,
    [kunden, selectedKundeId]
  );

  const filteredMaterial = useMemo(() => {
    const q = materialSearch.toLowerCase();
    if (!q) return material;
    return material.filter(
      (m: Material) =>
        (m.fields.bezeichnung ?? '').toLowerCase().includes(q) ||
        (m.fields.artikelnummer ?? '').toLowerCase().includes(q)
    );
  }, [material, materialSearch]);

  const selectedMaterial = useMemo(
    () => material.find((m: Material) => m.record_id === selectedMaterialId) ?? null,
    [material, selectedMaterialId]
  );

  // Step 1 handlers
  const handleKundeSelect = (id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  };

  const handleKundeCreate = async () => {
    if (!neuerVorname.trim() || !neuerNachname.trim() || !neuerTelefon.trim()) return;
    setKundeCreating(true);
    setKundeError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim(),
        nachname: neuerNachname.trim(),
        telefon: neuerTelefon.trim(),
        email: neuerEmail.trim() || undefined,
        firma: neuerFirma.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeuerTelefon('');
      setNeuerEmail('');
      setNeuerFirma('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreating(false);
    }
  };

  // Step 2 handler
  const handleAuftragCreate = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim()) return;
    if (!selectedKundeId) return;
    setAuftragCreating(true);
    setAuftragError(null);
    try {
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
      if (wunschtermin) {
        payload.wunschtermin = wunschtermin;
      }
      if (monteur.trim()) {
        payload.monteur = monteur.trim();
      }
      const result = await LivingAppsService.createAuftraegeEntry(payload);
      setNewAuftragId(result.record_id);
      setStep(3);
    } catch (err) {
      setAuftragError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreating(false);
    }
  };

  // Step 3 handler
  const handlePositionAdd = async () => {
    if (!selectedMaterialId || !menge || !newAuftragId) return;
    const mengeNum = parseFloat(menge);
    if (isNaN(mengeNum) || mengeNum <= 0) return;
    setPositionAdding(true);
    setPositionError(null);
    try {
      const posPayload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, newAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterialId),
        menge: mengeNum,
      };
      if (einheitPosition && einheitPosition !== 'none') {
        posPayload.einheit_position = einheitPosition;
      }
      if (positionsbeschreibung.trim()) {
        posPayload.positionsbeschreibung = positionsbeschreibung.trim();
      }
      await LivingAppsService.createAuftragspositionenEntry(posPayload);
      const mat = selectedMaterial;
      setAddedPositions(prev => [
        ...prev,
        {
          materialId: selectedMaterialId,
          materialBezeichnung: mat?.fields.bezeichnung ?? '',
          materialArtikelnummer: mat?.fields.artikelnummer ?? '',
          menge: mengeNum,
          einheit_position: einheitPosition !== 'none' ? einheitPosition : '',
          positionsbeschreibung: positionsbeschreibung.trim(),
        },
      ]);
      // Reset position form
      setSelectedMaterialId(null);
      setMaterialSearch('');
      setMenge('');
      setEinheitPosition('none');
      setPositionsbeschreibung('');
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPositionAdding(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKundeId(null);
    setAuftragsnummer('');
    setAuftragsdatum('');
    setStatusKey(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setNewAuftragId(null);
    setAddedPositions([]);
    setDone(false);
    setSelectedMaterialId(null);
    setMaterialSearch('');
    setMenge('');
    setEinheitPosition('none');
    setPositionsbeschreibung('');
    setAuftragError(null);
    setPositionError(null);
    setKundeError(null);
  };

  const kundeName = selectedKunde
    ? `${selectedKunde.fields.vorname ?? ''} ${selectedKunde.fields.nachname ?? ''}`.trim()
    : '';

  return (
    <IntentWizardShell
      title="Neuen Auftrag erstellen"
      subtitle="Kunden wählen, Auftrag anlegen und Materialpositionen erfassen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* STEP 1 — Kunde auswählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map((k: Kunden) => ({
            id: k.record_id,
            title: `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim(),
            subtitle: k.fields.firma,
            stats: k.fields.telefon ? [{ label: 'Telefon', value: k.fields.telefon }] : undefined,
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleKundeSelect}
          searchPlaceholder="Kunden suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowKundeCreate(true)}
          createDialog={
            showKundeCreate ? (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="neuerVorname">Vorname *</Label>
                    <Input
                      id="neuerVorname"
                      value={neuerVorname}
                      onChange={e => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuerNachname">Nachname *</Label>
                    <Input
                      id="neuerNachname"
                      value={neuerNachname}
                      onChange={e => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuerTelefon">Telefon *</Label>
                    <Input
                      id="neuerTelefon"
                      value={neuerTelefon}
                      onChange={e => setNeuerTelefon(e.target.value)}
                      placeholder="Telefonnummer"
                      type="tel"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuerEmail">E-Mail</Label>
                    <Input
                      id="neuerEmail"
                      value={neuerEmail}
                      onChange={e => setNeuerEmail(e.target.value)}
                      placeholder="E-Mail-Adresse"
                      type="email"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="neuerFirma">Firma</Label>
                    <Input
                      id="neuerFirma"
                      value={neuerFirma}
                      onChange={e => setNeuerFirma(e.target.value)}
                      placeholder="Firmenname (optional)"
                    />
                  </div>
                </div>
                {kundeError && (
                  <p className="text-sm text-destructive">{kundeError}</p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    disabled={
                      !neuerVorname.trim() ||
                      !neuerNachname.trim() ||
                      !neuerTelefon.trim() ||
                      kundeCreating
                    }
                    onClick={handleKundeCreate}
                  >
                    <IconPlus size={16} className="mr-1" />
                    {kundeCreating ? 'Wird angelegt …' : 'Kunden anlegen & auswählen'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowKundeCreate(false);
                      setKundeError(null);
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : null
          }
        />
      )}

      {/* STEP 2 — Auftrag anlegen */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Context header */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconUser size={16} />
            <span>Kunde: <span className="font-medium text-foreground">{kundeName}</span></span>
          </div>

          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <IconClipboardList size={16} />
              Auftragsdaten erfassen
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                <Input
                  id="auftragsnummer"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder="z. B. A-2026-001"
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
              <div className="space-y-1">
                <Label htmlFor="status">Status *</Label>
                <Select value={statusKey} onValueChange={setStatusKey}>
                  <SelectTrigger id="status">
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
              <div className="space-y-1">
                <Label htmlFor="prioritaet">Priorität</Label>
                <Select value={prioritaetKey} onValueChange={setPrioritaetKey}>
                  <SelectTrigger id="prioritaet">
                    <SelectValue placeholder="Priorität wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine Priorität</SelectItem>
                    {PRIORITAET_OPTIONS.map(opt => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="auftragsbeschreibung">Auftragsbeschreibung *</Label>
                <Textarea
                  id="auftragsbeschreibung"
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibung des Auftrags …"
                  rows={4}
                />
              </div>
            </div>

            {auftragError && (
              <p className="text-sm text-destructive">{auftragError}</p>
            )}

            <div className="flex gap-2 flex-wrap pt-1">
              <Button
                disabled={
                  !auftragsnummer.trim() ||
                  !auftragsdatum ||
                  !statusKey ||
                  !auftragsbeschreibung.trim() ||
                  auftragCreating
                }
                onClick={handleAuftragCreate}
              >
                <IconCheck size={16} className="mr-1" />
                {auftragCreating ? 'Wird angelegt …' : 'Auftrag anlegen & weiter'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 — Materialpositionen */}
      {step === 3 && !done && (
        <div className="space-y-6">
          {/* Context header */}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconClipboardList size={16} />
              Auftrag: <span className="font-medium text-foreground ml-1">{auftragsnummer}</span>
            </span>
            <span className="flex items-center gap-1">
              <IconUser size={16} />
              Kunde: <span className="font-medium text-foreground ml-1">{kundeName}</span>
            </span>
          </div>

          {/* Position count */}
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <IconPackage size={16} className="text-primary" />
            {addedPositions.length === 0
              ? 'Noch keine Positionen hinzugefügt'
              : `${addedPositions.length} Position${addedPositions.length === 1 ? '' : 'en'} hinzugefügt`}
          </div>

          {/* Already added positions */}
          {addedPositions.length > 0 && (
            <div className="space-y-2">
              {addedPositions.map((pos, idx) => (
                <Card key={idx} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {pos.materialBezeichnung}
                          {pos.materialArtikelnummer && (
                            <span className="text-muted-foreground font-normal ml-1">
                              ({pos.materialArtikelnummer})
                            </span>
                          )}
                        </p>
                        {pos.positionsbeschreibung && (
                          <p className="text-xs text-muted-foreground truncate">{pos.positionsbeschreibung}</p>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-primary shrink-0">
                        {pos.menge}{pos.einheit_position ? ` ${EINHEIT_OPTIONS.find(e => e.key === pos.einheit_position)?.label ?? pos.einheit_position}` : ''}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Add position form */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground">Neue Position hinzufügen</p>

            {/* Material search */}
            <div className="space-y-2">
              <Label>Material *</Label>
              <Input
                value={materialSearch}
                onChange={e => {
                  setMaterialSearch(e.target.value);
                  setSelectedMaterialId(null);
                }}
                placeholder="Material suchen …"
              />
              {materialSearch && filteredMaterial.length > 0 && !selectedMaterialId && (
                <div className="rounded-xl border bg-secondary max-h-48 overflow-y-auto">
                  {filteredMaterial.map((m: Material) => (
                    <button
                      key={m.record_id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-card transition-colors text-sm"
                      onClick={() => {
                        setSelectedMaterialId(m.record_id);
                        setMaterialSearch(
                          `${m.fields.bezeichnung ?? ''}${m.fields.artikelnummer ? ` (${m.fields.artikelnummer})` : ''}`
                        );
                      }}
                    >
                      <span className="font-medium">{m.fields.bezeichnung}</span>
                      {m.fields.artikelnummer && (
                        <span className="text-muted-foreground ml-2">{m.fields.artikelnummer}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {materialSearch && filteredMaterial.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">Kein Material gefunden.</p>
              )}
              {selectedMaterialId && selectedMaterial && (
                <p className="text-xs text-primary px-1 flex items-center gap-1">
                  <IconCheck size={12} />
                  {selectedMaterial.fields.bezeichnung} ausgewählt
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="menge">Menge *</Label>
                <Input
                  id="menge"
                  type="number"
                  min="0.01"
                  step="any"
                  value={menge}
                  onChange={e => setMenge(e.target.value)}
                  placeholder="Menge"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="einheitPosition">Einheit</Label>
                <Select value={einheitPosition} onValueChange={setEinheitPosition}>
                  <SelectTrigger id="einheitPosition">
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
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="positionsbeschreibung">Positionsbeschreibung</Label>
                <Input
                  id="positionsbeschreibung"
                  value={positionsbeschreibung}
                  onChange={e => setPositionsbeschreibung(e.target.value)}
                  placeholder="Beschreibung dieser Position (optional)"
                />
              </div>
            </div>

            {positionError && (
              <p className="text-sm text-destructive">{positionError}</p>
            )}

            <Button
              disabled={
                !selectedMaterialId ||
                !menge ||
                parseFloat(menge) <= 0 ||
                positionAdding
              }
              onClick={handlePositionAdd}
              variant="outline"
            >
              <IconPlus size={16} className="mr-1" />
              {positionAdding ? 'Wird hinzugefügt …' : 'Position hinzufügen'}
            </Button>
          </div>

          {/* Finish */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setDone(true)}>
              <IconCheck size={16} className="mr-1" />
              Fertigstellen
            </Button>
          </div>
        </div>
      )}

      {/* SUCCESS SCREEN */}
      {step === 3 && done && (
        <div className="space-y-6 text-center">
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <IconCheck size={32} className="text-primary" stroke={2} />
            </div>
            <h2 className="text-xl font-bold text-foreground">Auftrag erfolgreich angelegt!</h2>
            <p className="text-muted-foreground text-sm max-w-sm">
              Der Auftrag <span className="font-semibold text-foreground">{auftragsnummer}</span> für{' '}
              <span className="font-semibold text-foreground">{kundeName}</span> wurde mit{' '}
              {addedPositions.length === 0
                ? 'keinen Positionen'
                : `${addedPositions.length} Position${addedPositions.length === 1 ? '' : 'en'}`}{' '}
              angelegt.
            </p>
          </div>

          {addedPositions.length > 0 && (
            <div className="text-left space-y-2">
              <p className="text-sm font-medium text-foreground">Erfasste Positionen:</p>
              {addedPositions.map((pos, idx) => (
                <Card key={idx} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <p className="text-sm truncate min-w-0">
                        {pos.materialBezeichnung}
                        {pos.materialArtikelnummer && (
                          <span className="text-muted-foreground font-normal ml-1">
                            ({pos.materialArtikelnummer})
                          </span>
                        )}
                      </p>
                      <span className="text-sm font-semibold text-primary shrink-0">
                        {pos.menge}{pos.einheit_position ? ` ${EINHEIT_OPTIONS.find(e => e.key === pos.einheit_position)?.label ?? pos.einheit_position}` : ''}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-3 justify-center pt-2">
            <Button onClick={handleReset}>
              <IconPlus size={16} className="mr-1" />
              Neuen Auftrag anlegen
            </Button>
            <a href="#/">
              <Button variant="outline">Zurück zum Dashboard</Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
