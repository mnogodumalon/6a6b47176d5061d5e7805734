/**
 * AuftragAnlegenPage — Neuen Auftrag anlegen (4-Schritt-Wizard).
 * Schritte: 1) Kunde wählen → 2) Auftragsdaten erfassen → 3) Materialpositionen → 4) Zusammenfassung.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material, CreateAuftraege, CreateAuftragspositionen } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { IconUser, IconPackage, IconPlus, IconTrash, IconCheck } from '@tabler/icons-react';

// Lookup options from schema
const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionItem {
  materialId: string;
  materialName: string;
  menge: number;
  einheit_position: string;
  positionsbeschreibung: string;
}

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftrag' },
  { label: 'Positionen' },
  { label: 'Fertig' },
];

export default function AuftragAnlegenPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Step state — initialize from URL
  const [step, setStep] = useState(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    return urlStep >= 1 && urlStep <= 4 ? urlStep : 1;
  });

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(() => {
    return searchParams.get('kundeId') ?? null;
  });
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neuerTelefon, setNeuerTelefon] = useState('');
  const [neuerEmail, setNeuerEmail] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeError, setKundeError] = useState<string | null>(null);

  // Step 2 — Auftragsdaten
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [auftragStatus, setAuftragStatus] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [prioritaet, setPrioritaet] = useState('');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreating, setAuftragCreating] = useState(false);
  const [auftragError, setAuftragError] = useState<string | null>(null);

  // Step 3 — Positionen
  const [auftragId, setAuftragId] = useState<string | null>(null);
  const [auftragsnummerCreated, setAuftragsnummerCreated] = useState('');
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [posSearchMaterial, setPosSearchMaterial] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [menge, setMenge] = useState('');
  const [einheitPosition, setEinheitPosition] = useState('none');
  const [positionsbeschreibung, setPositionsbeschreibung] = useState('');
  const [posAdding, setPosAdding] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);

  // Deep-link: if kundeId param is set, jump to step 2
  useEffect(() => {
    const kundeId = searchParams.get('kundeId');
    if (kundeId && step === 1) {
      setSelectedKundeId(kundeId);
      setStep(2);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync step to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (step > 1) {
      params.set('step', String(step));
    } else {
      params.delete('step');
    }
    if (selectedKundeId) {
      params.set('kundeId', selectedKundeId);
    } else {
      params.delete('kundeId');
    }
    setSearchParams(params, { replace: true });
  }, [step, selectedKundeId, searchParams, setSearchParams]);

  const handleStepChange = useCallback((newStep: number) => {
    setStep(newStep);
  }, []);

  // Derive selected customer for display
  const selectedKunde: Kunden | undefined = selectedKundeId
    ? kunden.find(k => k.record_id === selectedKundeId)
    : undefined;

  // Step 1 handlers
  const handleSelectKunde = (id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  };

  const handleCreateKunde = async () => {
    if (!neuerVorname.trim() || !neuerNachname.trim() || !neuerTelefon.trim()) {
      setKundeError('Vorname, Nachname und Telefon sind Pflichtfelder.');
      return;
    }
    setKundeCreating(true);
    setKundeError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname.trim(),
        nachname: neuerNachname.trim(),
        telefon: neuerTelefon.trim(),
        email: neuerEmail.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeuerTelefon('');
      setNeuerEmail('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden.');
    } finally {
      setKundeCreating(false);
    }
  };

  // Step 2 handlers
  const handleCreateAuftrag = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !auftragStatus || !auftragsbeschreibung.trim()) {
      setAuftragError('Auftragsnummer, Datum, Status und Beschreibung sind Pflichtfelder.');
      return;
    }
    if (!selectedKundeId) {
      setAuftragError('Kein Kunde ausgewählt.');
      return;
    }
    setAuftragCreating(true);
    setAuftragError(null);
    try {
      const payload: CreateAuftraege = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum,
        status: auftragStatus,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaet && prioritaet !== 'none') payload.prioritaet = prioritaet;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur.trim()) payload.monteur = monteur.trim();

      const created = await LivingAppsService.createAuftraegeEntry(payload);
      setAuftragId(created.record_id);
      setAuftragsnummerCreated(auftragsnummer.trim());
      setStep(3);
    } catch (err) {
      setAuftragError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags.');
    } finally {
      setAuftragCreating(false);
    }
  };

  // Step 3 handlers
  const filteredMaterial = posSearchMaterial
    ? material.filter(m =>
        (m.fields.bezeichnung ?? '').toLowerCase().includes(posSearchMaterial.toLowerCase()) ||
        (m.fields.artikelnummer ?? '').toLowerCase().includes(posSearchMaterial.toLowerCase())
      )
    : material;

  const handleAddPosition = async () => {
    if (!selectedMaterialId || !menge || parseFloat(menge) <= 0) {
      setPosError('Material und Menge sind Pflichtfelder.');
      return;
    }
    if (!auftragId) {
      setPosError('Kein Auftrag vorhanden.');
      return;
    }
    setPosAdding(true);
    setPosError(null);
    try {
      const materialRecord = material.find(m => m.record_id === selectedMaterialId);
      const payload: CreateAuftragspositionen = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, auftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterialId),
        menge: parseFloat(menge),
      };
      if (einheitPosition && einheitPosition !== 'none') payload.einheit_position = einheitPosition;
      if (positionsbeschreibung.trim()) payload.positionsbeschreibung = positionsbeschreibung.trim();

      await LivingAppsService.createAuftragspositionenEntry(payload);

      setPositions(prev => [...prev, {
        materialId: selectedMaterialId,
        materialName: materialRecord?.fields.bezeichnung ?? selectedMaterialId,
        menge: parseFloat(menge),
        einheit_position: einheitPosition !== 'none' ? einheitPosition : '',
        positionsbeschreibung: positionsbeschreibung.trim(),
      }]);

      // Reset position form
      setSelectedMaterialId('');
      setMenge('');
      setEinheitPosition('none');
      setPositionsbeschreibung('');
      setPosSearchMaterial('');
    } catch (err) {
      setPosError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position.');
    } finally {
      setPosAdding(false);
    }
  };

  const handleRemovePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKundeId(null);
    setShowKundeCreate(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeuerTelefon('');
    setNeuerEmail('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setAuftragStatus(STATUS_OPTIONS[0]?.key ?? 'offen');
    setPrioritaet('');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragId(null);
    setAuftragsnummerCreated('');
    setPositions([]);
    setSelectedMaterialId('');
    setMenge('');
    setEinheitPosition('none');
    setPositionsbeschreibung('');
    setPosSearchMaterial('');
    setAuftragError(null);
    setPosError(null);
    setKundeError(null);
  };

  const getEinheitLabel = (key: string) => {
    return EINHEIT_OPTIONS.find(o => o.key === key)?.label ?? key;
  };

  return (
    <IntentWizardShell
      title="Neuen Auftrag anlegen"
      subtitle="Kunde wählen, Auftragsdaten erfassen und Materialpositionen hinzufügen."
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={handleStepChange}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── Schritt 1: Kunde wählen ─────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Kunde wählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Wähle einen bestehenden Kunden oder lege einen neuen an.</p>
          </div>
          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)',
              subtitle: k.fields.firma || k.fields.telefon || undefined,
              icon: <IconUser size={20} className="text-primary" />,
              stats: [],
            }))}
            onSelect={handleSelectKunde}
            searchPlaceholder="Kunden suchen..."
            emptyText="Kein Kunde gefunden. Lege einen neuen an."
            emptyIcon={<IconUser size={28} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(true)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-semibold text-sm">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="neuer-vorname">Vorname *</Label>
                    <Input
                      id="neuer-vorname"
                      value={neuerVorname}
                      onChange={e => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuer-nachname">Nachname *</Label>
                    <Input
                      id="neuer-nachname"
                      value={neuerNachname}
                      onChange={e => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuer-telefon">Telefon *</Label>
                    <Input
                      id="neuer-telefon"
                      type="tel"
                      value={neuerTelefon}
                      onChange={e => setNeuerTelefon(e.target.value)}
                      placeholder="+49 123 456789"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="neuer-email">E-Mail</Label>
                    <Input
                      id="neuer-email"
                      type="email"
                      value={neuerEmail}
                      onChange={e => setNeuerEmail(e.target.value)}
                      placeholder="max@beispiel.de"
                    />
                  </div>
                </div>
                {kundeError && (
                  <p className="text-sm text-destructive">{kundeError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateKunde}
                    disabled={kundeCreating || !neuerVorname.trim() || !neuerNachname.trim() || !neuerTelefon.trim()}
                  >
                    {kundeCreating ? 'Wird angelegt…' : 'Kunden anlegen'}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowKundeCreate(false); setKundeError(null); }}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ─── Schritt 2: Auftragsdaten ────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Auftragsdaten erfassen</h2>
            {selectedKunde && (
              <p className="text-sm text-muted-foreground mt-0.5">
                Kunde: <span className="font-medium text-foreground">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')}
                </span>
                {selectedKunde.fields.firma ? ` · ${selectedKunde.fields.firma}` : ''}
              </p>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                <Input
                  id="auftragsnummer"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder="z.B. AU-2026-001"
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="auftrag-status">Status *</Label>
                <Select value={auftragStatus} onValueChange={setAuftragStatus}>
                  <SelectTrigger id="auftrag-status">
                    <SelectValue placeholder="Status wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="prioritaet">Priorität</Label>
                <Select value={prioritaet || 'none'} onValueChange={v => setPrioritaet(v === 'none' ? '' : v)}>
                  <SelectTrigger id="prioritaet">
                    <SelectValue placeholder="Priorität wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine Priorität</SelectItem>
                    {PRIORITAET_OPTIONS.map(o => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
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
                onChange={e => setAuftragsbeschreibung(e.target.value)}
                placeholder="Kurze Beschreibung des Auftrags…"
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

            <div className="flex gap-2 flex-wrap pt-1">
              <Button
                onClick={handleCreateAuftrag}
                disabled={auftragCreating || !auftragsnummer.trim() || !auftragsdatum || !auftragStatus || !auftragsbeschreibung.trim()}
              >
                {auftragCreating ? 'Auftrag wird angelegt…' : 'Weiter zu Schritt 3'}
              </Button>
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Schritt 3: Materialpositionen ───────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Materialpositionen hinzufügen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Kunde: <span className="font-medium text-foreground">
                {selectedKunde ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') : '—'}
              </span>
              {' · '}Auftrag: <span className="font-medium text-foreground">{auftragsnummerCreated}</span>
            </p>
          </div>

          {/* Live position list */}
          {positions.length > 0 && (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-secondary/30">
                <span className="text-sm font-medium">{positions.length} {positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt</span>
              </div>
              <ul className="divide-y">
                {positions.map((pos, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <IconPackage size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pos.materialName}</p>
                      <p className="text-xs text-muted-foreground">
                        {pos.menge} {pos.einheit_position ? getEinheitLabel(pos.einheit_position) : 'Stk.'}
                        {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemovePosition(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                      title="Position entfernen"
                    >
                      <IconTrash size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Add position form */}
          <div className="rounded-2xl border bg-card p-4 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <IconPlus size={15} className="text-primary" />
              Position hinzufügen
            </h3>

            {/* Material search & pick */}
            <div className="space-y-1">
              <Label>Material *</Label>
              <Input
                value={posSearchMaterial}
                onChange={e => { setPosSearchMaterial(e.target.value); setSelectedMaterialId(''); }}
                placeholder="Material suchen…"
              />
              {posSearchMaterial && (
                <div className="border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  {filteredMaterial.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-3 py-2">Kein Material gefunden.</p>
                  ) : (
                    filteredMaterial.map((m: Material) => (
                      <button
                        key={m.record_id}
                        onClick={() => {
                          setSelectedMaterialId(m.record_id);
                          setPosSearchMaterial(m.fields.bezeichnung ?? '');
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2 ${selectedMaterialId === m.record_id ? 'bg-primary/10 font-medium' : ''}`}
                      >
                        <span className="truncate">{m.fields.bezeichnung ?? '(Kein Name)'}</span>
                        {m.fields.artikelnummer && (
                          <span className="text-xs text-muted-foreground shrink-0">#{m.fields.artikelnummer}</span>
                        )}
                        {selectedMaterialId === m.record_id && (
                          <IconCheck size={14} className="text-primary ml-auto shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedMaterialId && !posSearchMaterial && (
                <p className="text-xs text-muted-foreground">Material ausgewählt</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="menge">Menge *</Label>
                <Input
                  id="menge"
                  type="number"
                  min="0"
                  step="0.01"
                  value={menge}
                  onChange={e => setMenge(e.target.value)}
                  placeholder="z.B. 5"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="einheit-position">Einheit</Label>
                <Select value={einheitPosition} onValueChange={setEinheitPosition}>
                  <SelectTrigger id="einheit-position">
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

            <div className="space-y-1">
              <Label htmlFor="pos-beschreibung">Positionsbeschreibung</Label>
              <Input
                id="pos-beschreibung"
                value={positionsbeschreibung}
                onChange={e => setPositionsbeschreibung(e.target.value)}
                placeholder="Optionale Beschreibung…"
              />
            </div>

            {posError && (
              <p className="text-sm text-destructive">{posError}</p>
            )}

            <Button
              onClick={handleAddPosition}
              disabled={posAdding || !selectedMaterialId || !menge || parseFloat(menge) <= 0}
              variant="outline"
              className="w-full gap-2"
            >
              <IconPlus size={15} />
              {posAdding ? 'Wird hinzugefügt…' : 'Position hinzufügen'}
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setStep(4)}>
              Weiter zur Zusammenfassung
            </Button>
          </div>
        </div>
      )}

      {/* ─── Schritt 4: Zusammenfassung ──────────────────────────── */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconCheck size={24} className="text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Auftrag erfolgreich angelegt!</h2>
                <p className="text-sm text-muted-foreground">Alle Daten wurden gespeichert.</p>
              </div>
            </div>

            {/* Customer info */}
            <div className="rounded-xl border bg-secondary/20 p-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kunde</p>
              <p className="font-medium">
                {selectedKunde
                  ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ')
                  : '—'}
              </p>
              {selectedKunde?.fields.firma && (
                <p className="text-sm text-muted-foreground">{selectedKunde.fields.firma}</p>
              )}
            </div>

            {/* Order info */}
            <div className="rounded-xl border bg-secondary/20 p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auftrag</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{auftragsnummerCreated}</span>
                <StatusBadge statusKey={auftragStatus} label={STATUS_OPTIONS.find(o => o.key === auftragStatus)?.label} />
              </div>
              <p className="text-sm text-muted-foreground">Datum: {auftragsdatum}</p>
              {prioritaet && prioritaet !== 'none' && (
                <p className="text-sm text-muted-foreground">
                  Priorität: {PRIORITAET_OPTIONS.find(o => o.key === prioritaet)?.label ?? prioritaet}
                </p>
              )}
              {monteur && <p className="text-sm text-muted-foreground">Monteur: {monteur}</p>}
            </div>

            {/* Positions */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Positionen ({positions.length})
              </p>
              {positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Positionen hinzugefügt.</p>
              ) : (
                <ul className="space-y-2">
                  {positions.map((pos, i) => (
                    <li key={i} className="flex items-center gap-3 rounded-xl border bg-secondary/20 px-4 py-3">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <IconPackage size={14} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pos.materialName}</p>
                        {pos.positionsbeschreibung && (
                          <p className="text-xs text-muted-foreground truncate">{pos.positionsbeschreibung}</p>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {pos.menge} {pos.einheit_position ? getEinheitLabel(pos.einheit_position) : 'Stk.'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleReset} variant="outline">
              Neuen Auftrag anlegen
            </Button>
            <a href="#/">
              <Button>Zurück zum Dashboard</Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
