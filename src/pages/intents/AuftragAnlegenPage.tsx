/**
 * Auftrag anlegen — 4-Schritt-Wizard.
 * Steps: 1) Kunde auswählen → 2) Auftrag anlegen → 3) Materialpositionen hinzufügen → 4) Zusammenfassung.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import {
  IconUser,
  IconPlus,
  IconTrash,
  IconPackage,
  IconCheck,
  IconClipboardList,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionItem {
  materialId: string;
  materialName: string;
  menge: number;
  einheitKey: string; // sentinel 'none' means no einheit
  positionsbeschreibung: string;
  bemerkung: string;
}

const TODAY = format(new Date(), 'yyyy-MM-dd');

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Step management
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerKundeVorname, setNeuerKundeVorname] = useState('');
  const [neuerKundeNachname, setNeuerKundeNachname] = useState('');
  const [neuerKundeTelefon, setNeuerKundeTelefon] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2 — Auftrag
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(TODAY);
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaetKey, setPrioritaetKey] = useState('none');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragNotizen, setAuftragNotizen] = useState('');
  const [auftragCreateLoading, setAuftragCreateLoading] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);
  const [savedAuftragId, setSavedAuftragId] = useState<string | null>(null);

  // Step 3 — Positionen
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [positionMaterialId, setPositionMaterialId] = useState('');
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [positionBemerkung, setPositionBemerkung] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);

  // Helpers
  const selectedKunde = kunden.find((k: Kunden) => k.record_id === selectedKundeId) ?? null;
  const kundeName = selectedKunde
    ? `${selectedKunde.fields.vorname ?? ''} ${selectedKunde.fields.nachname ?? ''}`.trim()
    : '';

  const selectedMaterial = material.find((m: Material) => m.record_id === positionMaterialId) ?? null;

  // Step 1 handlers
  const handleKundeSelect = (id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  };

  const handleKundeCreate = async () => {
    if (!neuerKundeVorname.trim() || !neuerKundeNachname.trim() || !neuerKundeTelefon.trim()) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerKundeVorname.trim(),
        nachname: neuerKundeNachname.trim(),
        telefon: neuerKundeTelefon.trim(),
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNeuerKundeVorname('');
      setNeuerKundeNachname('');
      setNeuerKundeTelefon('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreateLoading(false);
    }
  };

  // Step 2 handler — idempotency: create once, use savedAuftragId on retry
  const handleAuftragCreate = async () => {
    if (!selectedKundeId) return;
    if (!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim()) return;

    // Idempotency guard: if already created, just advance
    if (savedAuftragId) {
      setStep(3);
      return;
    }

    setAuftragCreateLoading(true);
    setAuftragCreateError(null);
    try {
      const payload: Parameters<typeof LivingAppsService.createAuftraegeEntry>[0] = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum: auftragsdatum,
        status: statusKey,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaetKey && prioritaetKey !== 'none') payload.prioritaet = prioritaetKey;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur.trim()) payload.monteur = monteur.trim();
      if (auftragNotizen.trim()) payload.auftrag_notizen = auftragNotizen.trim();

      const created = await LivingAppsService.createAuftraegeEntry(payload);
      setSavedAuftragId(created.record_id);
      setStep(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreateLoading(false);
    }
  };

  // Step 3 handlers
  const handleAddPosition = async () => {
    if (!savedAuftragId || !positionMaterialId || !positionMenge) return;
    const mengeNum = parseFloat(positionMenge);
    if (isNaN(mengeNum) || mengeNum <= 0) return;

    setPositionSaving(true);
    setPositionError(null);
    try {
      const posPayload: Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0] = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, savedAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, positionMaterialId),
        menge: mengeNum,
      };
      if (positionEinheitKey && positionEinheitKey !== 'none') posPayload.einheit_position = positionEinheitKey;
      if (positionBeschreibung.trim()) posPayload.positionsbeschreibung = positionBeschreibung.trim();
      if (positionBemerkung.trim()) posPayload.bemerkung = positionBemerkung.trim();

      await LivingAppsService.createAuftragspositionenEntry(posPayload);

      const materialName = selectedMaterial?.fields.bezeichnung ?? positionMaterialId;
      setPositions(prev => [...prev, {
        materialId: positionMaterialId,
        materialName,
        menge: mengeNum,
        einheitKey: positionEinheitKey,
        positionsbeschreibung: positionBeschreibung.trim(),
        bemerkung: positionBemerkung.trim(),
      }]);

      // Reset form
      setPositionMaterialId('');
      setPositionMenge('1');
      setPositionEinheitKey('none');
      setPositionBeschreibung('');
      setPositionBemerkung('');
      setShowPositionForm(false);
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPositionSaving(false);
    }
  };

  const handleRemovePosition = (index: number) => {
    setPositions(prev => prev.filter((_, i) => i !== index));
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKundeId(null);
    setShowKundeCreate(false);
    setNeuerKundeVorname('');
    setNeuerKundeNachname('');
    setNeuerKundeTelefon('');
    setAuftragsnummer('');
    setAuftragsdatum(TODAY);
    setStatusKey(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaetKey('none');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragNotizen('');
    setAuftragCreateError(null);
    setSavedAuftragId(null);
    setPositions([]);
    setShowPositionForm(false);
    setPositionMaterialId('');
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
    setPositionBemerkung('');
    setPositionError(null);
  };

  const statusLabel = STATUS_OPTIONS.find(o => o.key === statusKey)?.label ?? statusKey;
  const prioritaetLabel = PRIORITAET_OPTIONS.find(o => o.key === prioritaetKey)?.label ?? '';

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Erstelle einen neuen Auftrag mit Kunde und Materialpositionen"
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
      {/* ── Schritt 1: Kunde auswählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Kunde auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Wähle einen bestehenden Kunden aus oder lege einen neuen an.
            </p>
          </div>
          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() || '(Kein Name)',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden. Lege einen neuen an."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(true)}
            createDialog={showKundeCreate ? (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-medium text-sm text-foreground">Neuen Kunden anlegen</h3>
                <p className="text-xs text-muted-foreground">
                  Nur die wichtigsten Felder — weitere Details kannst du später auf der Kundenseite ergänzen.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="Vorname *"
                    value={neuerKundeVorname}
                    onChange={e => setNeuerKundeVorname(e.target.value)}
                  />
                  <Input
                    placeholder="Nachname *"
                    value={neuerKundeNachname}
                    onChange={e => setNeuerKundeNachname(e.target.value)}
                  />
                </div>
                <Input
                  placeholder="Telefon *"
                  value={neuerKundeTelefon}
                  onChange={e => setNeuerKundeTelefon(e.target.value)}
                />
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={handleKundeCreate}
                    disabled={
                      kundeCreateLoading ||
                      !neuerKundeVorname.trim() ||
                      !neuerKundeNachname.trim() ||
                      !neuerKundeTelefon.trim()
                    }
                    className="flex-1"
                  >
                    {kundeCreateLoading ? 'Wird angelegt...' : 'Kunden anlegen & auswählen'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowKundeCreate(false);
                      setKundeCreateError(null);
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : null}
          />
        </div>
      )}

      {/* ── Schritt 2: Auftrag anlegen ── */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Auftragsdetails</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag für <span className="font-medium text-foreground">{kundeName}</span>
              </p>
            </div>

            {savedAuftragId && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-center gap-2 text-sm text-green-700">
                <IconCheck size={16} />
                Auftrag wurde bereits angelegt. Klicke auf "Weiter" um fortzufahren.
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Auftragsnummer *
                </label>
                <Input
                  placeholder="z.B. AU-2026-001"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  disabled={!!savedAuftragId}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Auftragsdatum *
                  </label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                    disabled={!!savedAuftragId}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Wunschtermin
                  </label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                    disabled={!!savedAuftragId}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Status *
                  </label>
                  <Select
                    value={statusKey}
                    onValueChange={setStatusKey}
                    disabled={!!savedAuftragId}
                  >
                    <SelectTrigger className="w-full">
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
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Priorität
                  </label>
                  <Select
                    value={prioritaetKey}
                    onValueChange={setPrioritaetKey}
                    disabled={!!savedAuftragId}
                  >
                    <SelectTrigger className="w-full">
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
              </div>

              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Auftragsbeschreibung *
                </label>
                <Textarea
                  placeholder="Beschreibe den Auftrag..."
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  rows={3}
                  disabled={!!savedAuftragId}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Monteur
                </label>
                <Input
                  placeholder="Name des Monteurs"
                  value={monteur}
                  onChange={e => setMonteur(e.target.value)}
                  disabled={!!savedAuftragId}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  Notizen
                </label>
                <Textarea
                  placeholder="Interne Notizen zum Auftrag..."
                  value={auftragNotizen}
                  onChange={e => setAuftragNotizen(e.target.value)}
                  rows={2}
                  disabled={!!savedAuftragId}
                />
              </div>
            </div>

            {auftragCreateError && (
              <p className="text-sm text-destructive">{auftragCreateError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
              >
                Zurück
              </Button>
              <Button
                onClick={handleAuftragCreate}
                disabled={
                  auftragCreateLoading ||
                  !auftragsnummer.trim() ||
                  !auftragsdatum ||
                  !statusKey ||
                  !auftragsbeschreibung.trim()
                }
                className="flex-1"
              >
                {auftragCreateLoading
                  ? 'Wird angelegt...'
                  : savedAuftragId
                  ? 'Weiter zu Positionen'
                  : 'Auftrag anlegen & weiter'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen ausgewählten Kunden aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Schritt 3: Materialpositionen ── */}
      {step === 3 && (
        savedAuftragId ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Materialpositionen</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Füge Materialien zum Auftrag <span className="font-medium text-foreground">{auftragsnummer}</span> hinzu.
                </p>
              </div>
              <div className="shrink-0 rounded-xl border bg-card px-3 py-2 text-center">
                <div className="text-2xl font-bold text-primary">{positions.length}</div>
                <div className="text-xs text-muted-foreground">Position{positions.length !== 1 ? 'en' : ''}</div>
              </div>
            </div>

            {/* Added positions list */}
            {positions.length > 0 && (
              <div className="space-y-2">
                {positions.map((pos, idx) => {
                  const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border bg-card p-3 flex items-start gap-3 overflow-hidden"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <IconPackage size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{pos.materialName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {pos.menge} {einheitLabel ?? ''}
                          {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemovePosition(idx)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                        title="Position entfernen (nur lokal — gespeicherte Position bleibt im System)"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add position form */}
            {showPositionForm ? (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-medium text-sm text-foreground">Neue Position hinzufügen</h3>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Material *
                  </label>
                  <Select value={positionMaterialId} onValueChange={setPositionMaterialId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Material wählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {material.map((m: Material) => (
                        <SelectItem key={m.record_id} value={m.record_id}>
                          {m.fields.bezeichnung ?? m.record_id}
                          {m.fields.artikelnummer ? ` (${m.fields.artikelnummer})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground block mb-1">
                      Menge *
                    </label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="1"
                      value={positionMenge}
                      onChange={e => setPositionMenge(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground block mb-1">
                      Einheit
                    </label>
                    <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Einheit" />
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
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Positionsbeschreibung
                  </label>
                  <Input
                    placeholder="Kurze Beschreibung der Position"
                    value={positionBeschreibung}
                    onChange={e => setPositionBeschreibung(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1">
                    Bemerkung
                  </label>
                  <Textarea
                    placeholder="Optionale Bemerkung..."
                    value={positionBemerkung}
                    onChange={e => setPositionBemerkung(e.target.value)}
                    rows={2}
                  />
                </div>

                {positionError && (
                  <p className="text-xs text-destructive">{positionError}</p>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={handleAddPosition}
                    disabled={
                      positionSaving ||
                      !positionMaterialId ||
                      !positionMenge ||
                      parseFloat(positionMenge) <= 0
                    }
                    className="flex-1"
                  >
                    {positionSaving ? 'Wird gespeichert...' : 'Position hinzufügen'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPositionForm(false);
                      setPositionError(null);
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowPositionForm(true)}
                className="w-full gap-2"
              >
                <IconPlus size={16} />
                Position hinzufügen
              </Button>
            )}

            {positions.length === 0 && !showPositionForm && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Du kannst den Auftrag auch ohne Positionen abschließen.
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Zurück
              </Button>
              <Button onClick={() => setStep(4)} className="flex-1">
                Weiter zur Zusammenfassung
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen angelegten Auftrag aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Schritt 4: Zusammenfassung ── */}
      {step === 4 && (
        savedAuftragId ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <IconClipboardList size={24} className="text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Auftrag erfolgreich angelegt!</h2>
                <p className="text-sm text-muted-foreground">Hier ist die Zusammenfassung deines Auftrags.</p>
              </div>
            </div>

            {/* Kunde */}
            <div className="rounded-2xl border bg-card p-4 space-y-2 overflow-hidden">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Kunde</h3>
              <p className="font-medium text-foreground">{kundeName}</p>
              {selectedKunde?.fields.firma && (
                <p className="text-sm text-muted-foreground">{selectedKunde.fields.firma}</p>
              )}
              {selectedKunde?.fields.telefon && (
                <p className="text-sm text-muted-foreground">{selectedKunde.fields.telefon}</p>
              )}
            </div>

            {/* Auftrag */}
            <div className="rounded-2xl border bg-card p-4 space-y-3 overflow-hidden">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Auftrag</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Auftragsnummer</p>
                  <p className="font-medium text-foreground">{auftragsnummer}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Datum</p>
                  <p className="font-medium text-foreground">{auftragsdatum}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge statusKey={statusKey} label={statusLabel} />
                </div>
                {prioritaetKey && prioritaetKey !== 'none' && (
                  <div>
                    <p className="text-xs text-muted-foreground">Priorität</p>
                    <p className="font-medium text-foreground">{prioritaetLabel}</p>
                  </div>
                )}
                {monteur && (
                  <div>
                    <p className="text-xs text-muted-foreground">Monteur</p>
                    <p className="font-medium text-foreground">{monteur}</p>
                  </div>
                )}
                {wunschtermin && (
                  <div>
                    <p className="text-xs text-muted-foreground">Wunschtermin</p>
                    <p className="font-medium text-foreground">{wunschtermin.replace('T', ' ')}</p>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Beschreibung</p>
                <p className="text-sm text-foreground mt-0.5">{auftragsbeschreibung}</p>
              </div>
              {auftragNotizen && (
                <div>
                  <p className="text-xs text-muted-foreground">Notizen</p>
                  <p className="text-sm text-foreground mt-0.5">{auftragNotizen}</p>
                </div>
              )}
            </div>

            {/* Positionen */}
            <div className="rounded-2xl border bg-card p-4 space-y-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Materialpositionen
                </h3>
                <span className="text-sm font-medium text-foreground">{positions.length} Position{positions.length !== 1 ? 'en' : ''}</span>
              </div>
              {positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Positionen hinzugefügt.</p>
              ) : (
                <div className="space-y-2">
                  {positions.map((pos, idx) => {
                    const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                    return (
                      <div key={idx} className="flex items-start gap-3 py-2 border-t first:border-t-0">
                        <IconPackage size={15} className="text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{pos.materialName}</p>
                          <p className="text-xs text-muted-foreground">
                            {pos.menge} {einheitLabel ?? ''}
                            {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button onClick={handleReset} variant="outline" className="flex-1">
                Neuen Auftrag anlegen
              </Button>
              <a href="#/" className="flex-1">
                <Button className="w-full gap-2">
                  <IconCheck size={16} />
                  Zurück zum Dashboard
                </Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt benötigt einen angelegten Auftrag aus Schritt 2.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
