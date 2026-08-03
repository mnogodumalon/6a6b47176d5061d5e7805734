/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen oder anlegen → 2) Auftrag erfassen → 3) Positionen mit Material hinzufügen → Abschließen.
 * Reads: kunden, material. Writes: kunden (createKundenEntry), auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  IconUser,
  IconPackage,
  IconCheck,
  IconPlus,
  IconTrash,
  IconAlertCircle,
  IconClipboardList,
} from '@tabler/icons-react';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionEntry {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  bemerkung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard step (1-based)
  const [step, setStep] = useState(1);

  // Step 1: Kunde
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [newVorname, setNewVorname] = useState('');
  const [newNachname, setNewNachname] = useState('');
  const [newFirma, setNewFirma] = useState('');
  const [newTelefon, setNewTelefon] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Step 2: Auftrag
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [prioritaet, setPrioritaet] = useState(PRIORITAET_OPTIONS[1]?.key ?? '');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreateLoading, setAuftragCreateLoading] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);

  // Step 3: Positionen
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [posMenge, setPosMenge] = useState('1');
  const [posEinheitKey, setPosEinheitKey] = useState('none');
  const [posBemerkung, setPosBemerkung] = useState('');
  const [posAddLoading, setPosAddLoading] = useState(false);
  const [posAddError, setPosAddError] = useState<string | null>(null);
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Helpers
  const selectedKunde = kunden.find((k: Kunden) => k.record_id === selectedKundeId) ?? null;

  const handleKundeSelect = useCallback((id: string) => {
    setSelectedKundeId(id);
    setStep(2);
  }, []);

  const handleCreateKunde = useCallback(async () => {
    if (!newVorname || !newNachname || !newTelefon) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newVorname,
        nachname: newNachname,
        firma: newFirma || undefined,
        telefon: newTelefon,
        email: newEmail || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNewVorname('');
      setNewNachname('');
      setNewFirma('');
      setNewTelefon('');
      setNewEmail('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreateLoading(false);
    }
  }, [newVorname, newNachname, newFirma, newTelefon, newEmail, fetchAll]);

  const handleCreateAuftrag = useCallback(async () => {
    if (!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || !selectedKundeId) return;
    setAuftragCreateLoading(true);
    setAuftragCreateError(null);
    try {
      const payload: Record<string, unknown> = {
        auftragsnummer,
        auftragsdatum,
        auftragsbeschreibung,
        status: 'offen',
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
      };
      if (prioritaet) payload.prioritaet = prioritaet;
      if (wunschtermin) payload.wunschtermin = wunschtermin;
      if (monteur) payload.monteur = monteur;

      const created = await LivingAppsService.createAuftraegeEntry(payload as Parameters<typeof LivingAppsService.createAuftraegeEntry>[0]);
      setCreatedAuftragId(created.record_id);
      setStep(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreateLoading(false);
    }
  }, [auftragsnummer, auftragsdatum, auftragsbeschreibung, selectedKundeId, prioritaet, wunschtermin, monteur]);

  const handleAddPosition = useCallback(async () => {
    if (!selectedMaterialId || !posMenge || !createdAuftragId) return;
    setPosAddLoading(true);
    setPosAddError(null);
    try {
      const mat = material.find((m: Material) => m.record_id === selectedMaterialId);
      const payload: Record<string, unknown> = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterialId),
        menge: parseFloat(posMenge),
      };
      if (posEinheitKey && posEinheitKey !== 'none') payload.einheit_position = posEinheitKey;
      if (posBemerkung) payload.bemerkung = posBemerkung;

      await LivingAppsService.createAuftragspositionenEntry(payload as Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0]);

      setPositions(prev => [...prev, {
        materialId: selectedMaterialId,
        materialName: mat?.fields.bezeichnung ?? selectedMaterialId,
        menge: posMenge,
        einheitKey: posEinheitKey,
        bemerkung: posBemerkung,
      }]);
      // Reset position form
      setSelectedMaterialId(null);
      setPosMenge('1');
      setPosEinheitKey('none');
      setPosBemerkung('');
      setShowPositionForm(false);
    } catch (err) {
      setPosAddError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPosAddLoading(false);
    }
  }, [selectedMaterialId, posMenge, posEinheitKey, posBemerkung, createdAuftragId, material]);

  const handleRemovePosition = useCallback((idx: number) => {
    setPositions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleFinish = useCallback(async () => {
    setFinishLoading(true);
    setFinishError(null);
    try {
      setDone(true);
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Fehler beim Abschließen');
    } finally {
      setFinishLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedKundeId(null);
    setShowKundeCreate(false);
    setNewVorname('');
    setNewNachname('');
    setNewFirma('');
    setNewTelefon('');
    setNewEmail('');
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setAuftragsbeschreibung('');
    setPrioritaet(PRIORITAET_OPTIONS[1]?.key ?? '');
    setWunschtermin('');
    setMonteur('');
    setCreatedAuftragId(null);
    setPositions([]);
    setShowPositionForm(false);
    setSelectedMaterialId(null);
    setPosMenge('1');
    setPosEinheitKey('none');
    setPosBemerkung('');
    setDone(false);
    setAuftragCreateError(null);
    setFinishError(null);
    setPosAddError(null);
    setKundeCreateError(null);
  }, []);

  if (done) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <IconCheck size={32} className="text-primary" stroke={2} />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground mb-2">Auftrag angelegt!</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Der Auftrag <span className="font-semibold text-foreground">{auftragsnummer}</span> wurde erfolgreich mit {positions.length} Position{positions.length !== 1 ? 'en' : ''} angelegt.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <Button onClick={handleReset}>Neuen Auftrag anlegen</Button>
            <a href="#/">
              <Button variant="outline" className="w-full">Zurück zum Dashboard</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Kunde wählen, Auftrag erfassen und Positionen hinzufügen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Positionen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Schritt 1: Kunde wählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Kunde wählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Wähle einen bestehenden Kunden oder leg einen neuen an.</p>
          </div>
          <EntitySelectStep
            items={kunden.map((k: Kunden) => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || 'Unbekannt',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · ') || undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunden suchen..."
            emptyText="Kein Kunde gefunden. Leg einen neuen an."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(v => !v)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-semibold text-sm text-foreground">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Vorname *</label>
                    <Input
                      value={newVorname}
                      onChange={e => setNewVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Nachname *</label>
                    <Input
                      value={newNachname}
                      onChange={e => setNewNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Firma</label>
                    <Input
                      value={newFirma}
                      onChange={e => setNewFirma(e.target.value)}
                      placeholder="Firma (optional)"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Telefon *</label>
                    <Input
                      type="tel"
                      value={newTelefon}
                      onChange={e => setNewTelefon(e.target.value)}
                      placeholder="Telefon"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">E-Mail</label>
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="E-Mail (optional)"
                    />
                  </div>
                </div>
                {kundeCreateError && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    <IconAlertCircle size={15} />
                    {kundeCreateError}
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowKundeCreate(false)}>Abbrechen</Button>
                  <Button
                    disabled={!newVorname || !newNachname || !newTelefon || kundeCreateLoading}
                    onClick={handleCreateKunde}
                  >
                    {kundeCreateLoading ? 'Wird angelegt...' : 'Anlegen & wählen'}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ── Schritt 2: Auftrag erfassen ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Auftrag erfassen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Kunde: <span className="font-medium text-foreground">
                  {selectedKunde
                    ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma || '—'
                    : '—'}
                </span>
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>Kunden ändern</Button>
          </div>

          {!selectedKundeId && (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen ausgewählten Kunden aus Schritt 1.</p>
              <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
            </div>
          )}

          {selectedKundeId && (
            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z.B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Auftragsbeschreibung *</label>
                <Textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Was soll erledigt werden?"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Priorität</label>
                <div className="flex flex-wrap gap-2">
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setPrioritaet(opt.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        prioritaet === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Monteur</label>
                  <Input
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragCreateError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <IconAlertCircle size={15} />
                  {auftragCreateError}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>Zurück</Button>
                <Button
                  disabled={!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || auftragCreateLoading}
                  onClick={handleCreateAuftrag}
                >
                  {auftragCreateLoading ? 'Wird angelegt...' : 'Auftrag anlegen & weiter'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Schritt 3: Positionen hinzufügen ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Positionen hinzufügen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auftrag: <span className="font-medium text-foreground">{auftragsnummer || '—'}</span>
              </p>
            </div>
            {positions.length > 0 && (
              <Badge variant="secondary" className="shrink-0">
                {positions.length} Position{positions.length !== 1 ? 'en' : ''}
              </Badge>
            )}
          </div>

          {!createdAuftragId && (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen angelegten Auftrag aus Schritt 2.</p>
              <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
            </div>
          )}

          {createdAuftragId && (
            <div className="space-y-3">
              {/* Added positions list */}
              {positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((pos, idx) => {
                    const einheitLabel = EINHEIT_OPTIONS.find(e => e.key === pos.einheitKey)?.label;
                    return (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border bg-card overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <IconPackage size={16} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{pos.materialName}</p>
                          <p className="text-xs text-muted-foreground">
                            {pos.menge} {einheitLabel ?? ''}{pos.bemerkung ? ` · ${pos.bemerkung}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemovePosition(idx)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                        >
                          <IconTrash size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add position button */}
              {!showPositionForm && (
                <button
                  onClick={() => setShowPositionForm(true)}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                >
                  <IconPlus size={16} />
                  <span className="text-sm font-medium">Position hinzufügen</span>
                </button>
              )}

              {/* Position form */}
              {showPositionForm && (
                <div className="rounded-2xl border bg-card p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Material wählen</h3>

                  {/* Material selection */}
                  {!selectedMaterialId ? (
                    <EntitySelectStep
                      items={material.map((m: Material) => ({
                        id: m.record_id,
                        title: m.fields.bezeichnung ?? 'Unbekannt',
                        subtitle: [
                          m.fields.artikelnummer ? `Art.-Nr. ${m.fields.artikelnummer}` : null,
                          m.fields.lagerbestand !== undefined ? `Lager: ${m.fields.lagerbestand} ${m.fields.einheit?.label ?? ''}` : null,
                        ].filter(Boolean).join(' · ') || undefined,
                        icon: <IconPackage size={18} className="text-primary" />,
                      }))}
                      onSelect={(id) => setSelectedMaterialId(id)}
                      searchPlaceholder="Material suchen..."
                      emptyText="Kein Material gefunden."
                      emptyIcon={<IconPackage size={28} />}
                    />
                  ) : (
                    <div className="space-y-3">
                      {/* Selected material chip */}
                      <div className="flex items-center gap-2 p-3 rounded-xl border bg-secondary">
                        <IconPackage size={16} className="text-primary shrink-0" />
                        <span className="text-sm font-medium flex-1 min-w-0 truncate">
                          {material.find((m: Material) => m.record_id === selectedMaterialId)?.fields.bezeichnung ?? selectedMaterialId}
                        </span>
                        <button
                          onClick={() => setSelectedMaterialId(null)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          Ändern
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Menge *</label>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={posMenge}
                            onChange={e => setPosMenge(e.target.value)}
                            placeholder="Menge"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Einheit</label>
                          <Select value={posEinheitKey} onValueChange={setPosEinheitKey}>
                            <SelectTrigger>
                              <SelectValue placeholder="Einheit wählen" />
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
                        <label className="text-xs font-medium text-muted-foreground">Bemerkung</label>
                        <Textarea
                          value={posBemerkung}
                          onChange={e => setPosBemerkung(e.target.value)}
                          placeholder="Optionale Bemerkung zur Position"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  {posAddError && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                      <IconAlertCircle size={15} />
                      {posAddError}
                    </div>
                  )}

                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowPositionForm(false);
                        setSelectedMaterialId(null);
                        setPosMenge('1');
                        setPosEinheitKey('none');
                        setPosBemerkung('');
                        setPosAddError(null);
                      }}
                    >
                      Abbrechen
                    </Button>
                    {selectedMaterialId && (
                      <Button
                        disabled={!posMenge || parseFloat(posMenge) <= 0 || posAddLoading}
                        onClick={handleAddPosition}
                      >
                        {posAddLoading ? 'Wird hinzugefügt...' : 'Position hinzufügen'}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Summary card */}
              {!showPositionForm && (
                <div className="rounded-2xl border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <IconClipboardList size={18} className="text-primary" />
                    <span className="text-sm font-semibold text-foreground">Zusammenfassung</span>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Kunde</span>
                      <span className="font-medium text-foreground">
                        {selectedKunde
                          ? [selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma || '—'
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Auftragsnummer</span>
                      <span className="font-medium text-foreground">{auftragsnummer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Auftragsdatum</span>
                      <span className="font-medium text-foreground">{auftragsdatum}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Positionen</span>
                      <span className="font-medium text-foreground">{positions.length}</span>
                    </div>
                  </div>

                  {finishError && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                      <IconAlertCircle size={15} />
                      {finishError}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={finishLoading}
                    onClick={handleFinish}
                  >
                    {finishLoading ? 'Wird abgeschlossen...' : positions.length > 0 ? 'Auftrag abschließen' : 'Auftrag ohne Positionen abschließen'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
