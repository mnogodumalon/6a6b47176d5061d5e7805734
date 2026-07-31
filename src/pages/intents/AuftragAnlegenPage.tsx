/**
 * Intent: Auftrag anlegen
 * Workflow: Kunde auswählen → Auftrag anlegen → Positionen erfassen → Zusammenfassung
 * Steps:
 *   1) Kunde wählen (aus Kunden-Liste oder neu anlegen)
 *   2) Auftrag anlegen (Mini-Form mit Status, Priorität, Beschreibung, Wunschtermin, Monteur)
 *   3) Positionen erfassen (Material wählen, Menge/Einheit, mehrfach hinzufügen)
 *   4) Zusammenfassung (Übersicht aller angelegten Daten)
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
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
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  IconUser,
  IconPackage,
  IconPlus,
  IconCheck,
  IconClipboardList,
  IconArrowRight,
  IconArrowLeft,
  IconRefresh,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Kunde' },
  { label: 'Auftrag' },
  { label: 'Positionen' },
  { label: 'Fertig' },
];

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface AddedPosition {
  record_id: string;
  materialId: string;
  materialName: string;
  menge: number;
  einheit: string;
  einheitLabel: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Wizard state
  const [step, setStep] = useState(1);

  // Step 1: Kunde
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [newVorname, setNewVorname] = useState('');
  const [newNachname, setNewNachname] = useState('');
  const [newTelefon, setNewTelefon] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [kundeCreating, setKundeCreating] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState('');

  // Step 2: Auftrag
  const today = format(new Date(), 'yyyy-MM-dd');
  const [auftragsnummer, setAuftragsnummer] = useState(`AU-${today}-001`);
  const [auftragsdatum, setAuftragsdatum] = useState(today);
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaetKey, setPrioritaetKey] = useState(PRIORITAET_OPTIONS[1]?.key ?? '');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreating, setAuftragCreating] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState('');
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // Step 3: Positionen
  const [addedPositionen, setAddedPositionen] = useState<AddedPosition[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [menge, setMenge] = useState('1');
  const [einheitPosition, setEinheitPosition] = useState(EINHEIT_POSITION_OPTIONS[0]?.key ?? '');
  const [positionsbeschreibung, setPositionsbeschreibung] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [positionCreating, setPositionCreating] = useState(false);
  const [positionCreateError, setPositionCreateError] = useState('');

  // Deep-linking: auto-select customer from URL param
  const autoSelectKunde = useCallback((kundeId: string, kundenList: Kunden[]) => {
    const found = kundenList.find(k => k.record_id === kundeId);
    if (found) {
      setSelectedKunde(found);
      setStep(2);
    }
  }, []);

  useEffect(() => {
    const kundeId = searchParams.get('kundeId');
    if (kundeId && kunden.length > 0 && !selectedKunde) {
      autoSelectKunde(kundeId, kunden);
    }
  }, [kunden, searchParams, selectedKunde, autoSelectKunde]);

  // Reset position form
  const resetPositionForm = useCallback(() => {
    setSelectedMaterial(null);
    setMenge('1');
    setEinheitPosition(EINHEIT_POSITION_OPTIONS[0]?.key ?? '');
    setPositionsbeschreibung('');
    setBemerkung('');
    setPositionCreateError('');
  }, []);

  // Reset the entire wizard
  const resetWizard = useCallback(() => {
    setStep(1);
    setSelectedKunde(null);
    setShowKundeCreate(false);
    setNewVorname('');
    setNewNachname('');
    setNewTelefon('');
    setNewEmail('');
    setKundeCreateError('');
    setAuftragsnummer(`AU-${format(new Date(), 'yyyy-MM-dd')}-001`);
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setStatusKey(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaetKey(PRIORITAET_OPTIONS[1]?.key ?? '');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragCreateError('');
    setCreatedAuftragId(null);
    setAddedPositionen([]);
    resetPositionForm();
  }, [resetPositionForm]);

  // --- Step 1 Handlers ---
  const handleKundeSelect = useCallback((id: string) => {
    const found = kunden.find(k => k.record_id === id);
    if (found) {
      setSelectedKunde(found);
      setStep(2);
    }
  }, [kunden]);

  const handleKundeCreate = useCallback(async () => {
    if (!newVorname.trim() || !newNachname.trim() || !newTelefon.trim()) return;
    setKundeCreating(true);
    setKundeCreateError('');
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newVorname.trim(),
        nachname: newNachname.trim(),
        telefon: newTelefon.trim(),
        email: newEmail.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNewVorname('');
      setNewNachname('');
      setNewTelefon('');
      setNewEmail('');
      // Find the freshly created record and select it
      setSelectedKunde({
        record_id: created.record_id,
        created_at: created.created_at ?? '',
        updated_at: null,
        createdat: created.created_at ?? '',
        updatedat: null,
        fields: {
          vorname: newVorname.trim(),
          nachname: newNachname.trim(),
          telefon: newTelefon.trim(),
          email: newEmail.trim() || undefined,
        },
      });
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen');
    } finally {
      setKundeCreating(false);
    }
  }, [newVorname, newNachname, newTelefon, newEmail, fetchAll]);

  // --- Step 2 Handlers ---
  const handleAuftragCreate = useCallback(async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim() || !selectedKunde) return;
    setAuftragCreating(true);
    setAuftragCreateError('');
    try {
      const payload: Record<string, unknown> = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum: auftragsdatum, // already yyyy-MM-dd from input[type=date]
        status: statusKey,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
      };
      if (prioritaetKey) payload.prioritaet = prioritaetKey;
      if (monteur.trim()) payload.monteur = monteur.trim();
      if (wunschtermin) {
        // wunschtermin comes from datetime-local input: already "yyyy-MM-dd'T'HH:mm"
        payload.wunschtermin = wunschtermin;
      }
      const created = await LivingAppsService.createAuftraegeEntry(payload as Parameters<typeof LivingAppsService.createAuftraegeEntry>[0]);
      setCreatedAuftragId(created.record_id);
      setStep(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreating(false);
    }
  }, [auftragsnummer, auftragsdatum, statusKey, auftragsbeschreibung, selectedKunde, prioritaetKey, monteur, wunschtermin]);

  // --- Step 3 Handlers ---
  const handlePositionAdd = useCallback(async () => {
    if (!selectedMaterial || !menge || !createdAuftragId) return;
    const mengeNum = parseFloat(menge);
    if (isNaN(mengeNum) || mengeNum <= 0) return;
    setPositionCreating(true);
    setPositionCreateError('');
    try {
      const payload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterial.record_id),
        menge: mengeNum,
      };
      if (einheitPosition) payload.einheit_position = einheitPosition;
      if (positionsbeschreibung.trim()) payload.positionsbeschreibung = positionsbeschreibung.trim();
      if (bemerkung.trim()) payload.bemerkung = bemerkung.trim();

      const created = await LivingAppsService.createAuftragspositionenEntry(payload as Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0]);

      const einheitLabel = EINHEIT_POSITION_OPTIONS.find(o => o.key === einheitPosition)?.label ?? einheitPosition;
      setAddedPositionen(prev => [...prev, {
        record_id: created.record_id,
        materialId: selectedMaterial.record_id,
        materialName: selectedMaterial.fields.bezeichnung ?? selectedMaterial.fields.artikelnummer ?? '—',
        menge: mengeNum,
        einheit: einheitPosition,
        einheitLabel,
      }]);
      resetPositionForm();
    } catch (err) {
      setPositionCreateError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPositionCreating(false);
    }
  }, [selectedMaterial, menge, createdAuftragId, einheitPosition, positionsbeschreibung, bemerkung, resetPositionForm]);

  const statusLabel = STATUS_OPTIONS.find(o => o.key === statusKey)?.label ?? statusKey;

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Schritt für Schritt einen neuen Serviceauftrag erstellen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ───── SCHRITT 1: Kunde wählen ───── */}
      {step === 1 && (
        <div className="space-y-4">
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: `${k.fields.vorname ?? ''} ${k.fields.nachname ?? ''}`.trim() || '(Kein Name)',
              subtitle: k.fields.firma || k.fields.email || undefined,
              status: k.fields.telefon ? undefined : undefined,
              stats: k.fields.telefon ? [{ label: 'Telefon', value: k.fields.telefon }] : undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunden suchen..."
            emptyText="Kein Kunde gefunden. Lege einen neuen an."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => { setShowKundeCreate(v => !v); }}
            createDialog={showKundeCreate ? (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-semibold text-sm text-foreground">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="new-vorname">Vorname *</Label>
                    <Input
                      id="new-vorname"
                      value={newVorname}
                      onChange={e => setNewVorname(e.target.value)}
                      placeholder="Max"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-nachname">Nachname *</Label>
                    <Input
                      id="new-nachname"
                      value={newNachname}
                      onChange={e => setNewNachname(e.target.value)}
                      placeholder="Mustermann"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-telefon">Telefon *</Label>
                    <Input
                      id="new-telefon"
                      type="tel"
                      value={newTelefon}
                      onChange={e => setNewTelefon(e.target.value)}
                      placeholder="+49 123 456789"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-email">E-Mail</Label>
                    <Input
                      id="new-email"
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="max@beispiel.de"
                    />
                  </div>
                </div>
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    disabled={!newVorname.trim() || !newNachname.trim() || !newTelefon.trim() || kundeCreating}
                    onClick={handleKundeCreate}
                    className="gap-1.5"
                  >
                    {kundeCreating ? 'Wird angelegt...' : <><IconPlus size={15} /> Kunden anlegen</>}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowKundeCreate(false)}>Abbrechen</Button>
                </div>
              </div>
            ) : null}
          />
        </div>
      )}

      {/* ───── SCHRITT 2: Auftrag anlegen ───── */}
      {step === 2 && selectedKunde && (
        <div className="space-y-6">
          {/* Selected customer info */}
          <Card className="overflow-hidden">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <IconUser size={20} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {`${selectedKunde.fields.vorname ?? ''} ${selectedKunde.fields.nachname ?? ''}`.trim()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {selectedKunde.fields.firma && <span>{selectedKunde.fields.firma} · </span>}
                    {selectedKunde.fields.telefon}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(1)}
                  className="ml-auto shrink-0 gap-1 text-muted-foreground"
                >
                  <IconArrowLeft size={14} /> Ändern
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Auftrag form */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="auftragsnummer">Auftragsnummer *</Label>
                <Input
                  id="auftragsnummer"
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder={`AU-${today}-001`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auftragsdatum">Auftragsdatum *</Label>
                <Input
                  id="auftragsdatum"
                  type="date"
                  value={auftragsdatum}
                  onChange={e => setAuftragsdatum(e.target.value)}
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label>Status *</Label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setStatusKey(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      statusKey === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priorität */}
            <div className="space-y-1.5">
              <Label>Priorität</Label>
              <div className="flex flex-wrap gap-2">
                {PRIORITAET_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPrioritaetKey(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      prioritaetKey === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auftragsbeschreibung">Auftragsbeschreibung *</Label>
              <Textarea
                id="auftragsbeschreibung"
                value={auftragsbeschreibung}
                onChange={e => setAuftragsbeschreibung(e.target.value)}
                placeholder="Beschreibe den Auftrag..."
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="wunschtermin">Wunschtermin</Label>
                <Input
                  id="wunschtermin"
                  type="datetime-local"
                  value={wunschtermin}
                  onChange={e => setWunschtermin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monteur">Monteur</Label>
                <Input
                  id="monteur"
                  value={monteur}
                  onChange={e => setMonteur(e.target.value)}
                  placeholder="Name des Monteurs"
                />
              </div>
            </div>

            {auftragCreateError && (
              <p className="text-sm text-destructive">{auftragCreateError}</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <IconArrowLeft size={15} /> Zurück
              </Button>
              <Button
                disabled={!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim() || auftragCreating}
                onClick={handleAuftragCreate}
                className="gap-1.5"
              >
                {auftragCreating ? 'Wird angelegt...' : <><IconArrowRight size={15} /> Auftrag anlegen</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ───── SCHRITT 3: Positionen erfassen ───── */}
      {step === 3 && createdAuftragId && (
        <div className="space-y-5">
          {/* Running summary */}
          <Card className="overflow-hidden bg-primary/5 border-primary/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <IconClipboardList size={20} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {addedPositionen.length} {addedPositionen.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Füge Material-Positionen zum Auftrag hinzu oder schließe direkt ab
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Added positions list */}
          {addedPositionen.length > 0 && (
            <div className="space-y-2">
              {addedPositionen.map((pos, idx) => (
                <div
                  key={pos.record_id}
                  className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden"
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pos.materialName}</p>
                    <p className="text-xs text-muted-foreground">
                      {pos.menge} {pos.einheitLabel}
                    </p>
                  </div>
                  <IconCheck size={16} className="text-green-600 shrink-0" />
                </div>
              ))}
            </div>
          )}

          {/* Material selection or position form */}
          {!selectedMaterial ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-foreground">Material auswählen</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {material.map(mat => (
                  <button
                    key={mat.record_id}
                    type="button"
                    onClick={() => setSelectedMaterial(mat)}
                    className="text-left p-4 rounded-xl border bg-card hover:bg-accent hover:border-primary/30 transition-colors overflow-hidden"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <IconPackage size={18} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {mat.fields.bezeichnung ?? '(kein Name)'}
                        </p>
                        {mat.fields.artikelnummer && (
                          <p className="text-xs text-muted-foreground">Nr. {mat.fields.artikelnummer}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {mat.fields.lagerbestand !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              Lager: {mat.fields.lagerbestand}
                            </span>
                          )}
                          {mat.fields.verfuegbarkeit && (
                            <StatusBadge
                              statusKey={mat.fields.verfuegbarkeit.key}
                              label={mat.fields.verfuegbarkeit.label}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {material.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <IconPackage size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Kein Material vorhanden</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border bg-card p-4">
              {/* Selected material header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <IconPackage size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {selectedMaterial.fields.bezeichnung ?? '(kein Name)'}
                  </p>
                  {selectedMaterial.fields.artikelnummer && (
                    <p className="text-xs text-muted-foreground">Nr. {selectedMaterial.fields.artikelnummer}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMaterial(null)}
                  className="shrink-0 text-muted-foreground gap-1"
                >
                  <IconArrowLeft size={14} /> Ändern
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="menge">Menge *</Label>
                  <Input
                    id="menge"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={menge}
                    onChange={e => setMenge(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Einheit</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {EINHEIT_POSITION_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setEinheitPosition(opt.key)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          einheitPosition === opt.key
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-foreground border-border hover:bg-accent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="positionsbeschreibung">Positionsbeschreibung</Label>
                <Input
                  id="positionsbeschreibung"
                  value={positionsbeschreibung}
                  onChange={e => setPositionsbeschreibung(e.target.value)}
                  placeholder="Optionale Beschreibung..."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bemerkung">Bemerkung</Label>
                <Textarea
                  id="bemerkung"
                  value={bemerkung}
                  onChange={e => setBemerkung(e.target.value)}
                  placeholder="Optionale Bemerkung..."
                  rows={2}
                />
              </div>

              {positionCreateError && (
                <p className="text-sm text-destructive">{positionCreateError}</p>
              )}

              <Button
                disabled={!menge || parseFloat(menge) <= 0 || positionCreating}
                onClick={handlePositionAdd}
                className="gap-1.5 w-full"
              >
                {positionCreating ? 'Wird hinzugefügt...' : <><IconPlus size={15} /> Position hinzufügen</>}
              </Button>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setStep(4)}
              className="gap-1.5"
            >
              Abschließen <IconArrowRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* ───── SCHRITT 4: Zusammenfassung ───── */}
      {step === 4 && selectedKunde && (
        <div className="space-y-5">
          <div className="rounded-2xl border bg-card overflow-hidden">
            {/* Kunde */}
            <div className="p-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <IconUser size={16} className="text-primary" />
                <h3 className="font-semibold text-sm">Kunde</h3>
              </div>
              <div className="space-y-1">
                <p className="font-medium">
                  {`${selectedKunde.fields.vorname ?? ''} ${selectedKunde.fields.nachname ?? ''}`.trim()}
                </p>
                {selectedKunde.fields.firma && (
                  <p className="text-sm text-muted-foreground">{selectedKunde.fields.firma}</p>
                )}
                {selectedKunde.fields.telefon && (
                  <p className="text-sm text-muted-foreground">{selectedKunde.fields.telefon}</p>
                )}
              </div>
            </div>

            {/* Auftrag */}
            <div className="p-4 border-b">
              <div className="flex items-center gap-2 mb-3">
                <IconClipboardList size={16} className="text-primary" />
                <h3 className="font-semibold text-sm">Auftrag</h3>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{auftragsnummer}</p>
                  <StatusBadge statusKey={statusKey} label={statusLabel} />
                </div>
                <p className="text-sm text-muted-foreground">Datum: {auftragsdatum}</p>
                {monteur && (
                  <p className="text-sm text-muted-foreground">Monteur: {monteur}</p>
                )}
                {wunschtermin && (
                  <p className="text-sm text-muted-foreground">Wunschtermin: {wunschtermin.replace('T', ' ')}</p>
                )}
                <p className="text-sm text-foreground mt-2 whitespace-pre-line">{auftragsbeschreibung}</p>
              </div>
            </div>

            {/* Positionen */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconPackage size={16} className="text-primary" />
                <h3 className="font-semibold text-sm">
                  Positionen ({addedPositionen.length})
                </h3>
              </div>
              {addedPositionen.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Positionen hinzugefügt</p>
              ) : (
                <div className="space-y-2">
                  {addedPositionen.map((pos, idx) => (
                    <div key={pos.record_id} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                      <span className="font-medium truncate flex-1">{pos.materialName}</span>
                      <span className="text-muted-foreground shrink-0">
                        {pos.menge} {pos.einheitLabel}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Success message */}
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-green-50 border border-green-200">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <IconCheck size={18} className="text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-sm text-green-800">Auftrag erfolgreich angelegt</p>
              <p className="text-xs text-green-700">
                Auftrag {auftragsnummer} wurde mit {addedPositionen.length} {addedPositionen.length === 1 ? 'Position' : 'Positionen'} angelegt.
              </p>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <Button onClick={resetWizard} variant="outline" className="gap-1.5">
              <IconRefresh size={15} /> Neuen Auftrag anlegen
            </Button>
            <a href="#/">
              <Button variant="ghost" className="w-full sm:w-auto">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
