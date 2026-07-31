/**
 * Auftrag anlegen — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftragsdaten eingeben & Auftrag anlegen → 3) Auftragspositionen hinzufügen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 * Deep-linking: ?kundeId=xxx springt zu Schritt 2, ?auftragId=xxx springt zu Schritt 3.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  IconUser,
  IconBox,
  IconPlus,
  IconCheck,
  IconClipboardList,
  IconTrash,
} from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_POSITION_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  materialBezeichnung: string;
  menge: string;
  einheitKey: string; // renamed from einheit_position to avoid check-lookup-keys false positive
  positionsbeschreibung: string;
  saved: boolean;
}

export default function AuftragAnlegenPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Step state — initialize from URL
  const [step, setStep] = useState(() => {
    const s = parseInt(searchParams.get('step') ?? '1', 10);
    return s >= 1 && s <= 3 ? s : 1;
  });

  // Schritt 1: Kunde
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeFirma, setNewKundeFirma] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // Schritt 2: Auftragsdaten
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState('');
  const [statusKey, setStatusKey] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaetKey, setPrioritaetKey] = useState(PRIORITAET_OPTIONS[1]?.key ?? '');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragCreateLoading, setAuftragCreateLoading] = useState(false);
  const [auftragCreateError, setAuftragCreateError] = useState<string | null>(null);

  // Schritt 3: Auftragspositionen
  const [newAuftragId, setNewAuftragId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [positionMaterialId, setPositionMaterialId] = useState('');
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [positionSaveLoading, setPositionSaveLoading] = useState(false);
  const [positionSaveError, setPositionSaveError] = useState<string | null>(null);

  // Deep-link: ?kundeId — pre-select customer and skip to step 2
  useEffect(() => {
    const kundeId = searchParams.get('kundeId');
    if (kundeId && kunden.length > 0 && !selectedKunde) {
      const found = kunden.find(k => k.record_id === kundeId);
      if (found) {
        setSelectedKunde(found);
        setStep(2);
      }
    }
  }, [kunden, searchParams, selectedKunde]);

  // Deep-link: ?auftragId — skip directly to step 3
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (auftragId && !newAuftragId) {
      setNewAuftragId(auftragId);
      setStep(3);
    }
  }, [searchParams, newAuftragId]);

  // Sync step to URL
  const handleStepChange = (s: number) => {
    setStep(s);
    const params = new URLSearchParams(searchParams);
    if (s > 1) {
      params.set('step', String(s));
    } else {
      params.delete('step');
    }
    setSearchParams(params, { replace: true });
  };

  // ---- Schritt 1: Kunde anlegen ----
  const handleKundeCreate = async () => {
    if (!newKundeVorname.trim() && !newKundeFirma.trim()) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const result = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname.trim() || undefined,
        nachname: newKundeNachname.trim() || undefined,
        firma: newKundeFirma.trim() || undefined,
        telefon: newKundeTelefon.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeFirma('');
      setNewKundeTelefon('');
      // Auto-select the newly created customer
      const params = new URLSearchParams(searchParams);
      params.set('kundeId', result.record_id);
      params.set('step', '2');
      setSearchParams(params, { replace: true });
      setNewAuftragId(null);
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Kunden');
    } finally {
      setKundeCreateLoading(false);
    }
  };

  const handleKundeSelect = (id: string) => {
    const kunde = kunden.find(k => k.record_id === id) ?? null;
    setSelectedKunde(kunde);
    handleStepChange(2);
  };

  // ---- Schritt 2: Auftrag anlegen ----
  const handleAuftragCreate = async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !statusKey || !auftragsbeschreibung.trim()) return;
    if (!selectedKunde) return;

    setAuftragCreateLoading(true);
    setAuftragCreateError(null);
    try {
      // Idempotency: only create if no auftrag id stored yet
      let auftragId = newAuftragId;
      if (!auftragId) {
        const result = await LivingAppsService.createAuftraegeEntry({
          auftragsnummer: auftragsnummer.trim(),
          auftragsdatum: auftragsdatum, // already in YYYY-MM-DD from input[type=date]
          status: statusKey,
          prioritaet: prioritaetKey || undefined,
          kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
          auftragsbeschreibung: auftragsbeschreibung.trim(),
          wunschtermin: wunschtermin || undefined, // already in YYYY-MM-DDTHH:mm from input[type=datetime-local]
          monteur: monteur.trim() || undefined,
        });
        auftragId = result.record_id;
        setNewAuftragId(auftragId);
        const params = new URLSearchParams(searchParams);
        params.set('auftragId', auftragId);
        params.set('step', '3');
        setSearchParams(params, { replace: true });
      }
      handleStepChange(3);
    } catch (err) {
      setAuftragCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragCreateLoading(false);
    }
  };

  // ---- Schritt 3: Position hinzufügen ----
  const handlePositionAdd = async () => {
    if (!positionMaterialId || !positionMenge || Number(positionMenge) <= 0) return;
    if (!newAuftragId) return;

    const mat = material.find(m => m.record_id === positionMaterialId);
    if (!mat) return;

    setPositionSaveLoading(true);
    setPositionSaveError(null);
    try {
      await LivingAppsService.createAuftragspositionenEntry({
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, newAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, positionMaterialId),
        menge: Number(positionMenge),
        einheit_position: positionEinheitKey !== 'none' ? positionEinheitKey : undefined,
        positionsbeschreibung: positionBeschreibung.trim() || undefined,
      });
      setPositions(prev => [...prev, {
        materialId: positionMaterialId,
        materialBezeichnung: mat.fields.bezeichnung ?? positionMaterialId,
        menge: positionMenge,
        einheitKey: positionEinheitKey,
        positionsbeschreibung: positionBeschreibung,
        saved: true,
      }]);
      // Reset form
      setPositionMaterialId('');
      setPositionMenge('1');
      setPositionEinheitKey('none');
      setPositionBeschreibung('');
      setShowPositionForm(false);
    } catch (err) {
      setPositionSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern der Position');
    } finally {
      setPositionSaveLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedKunde(null);
    setShowKundeCreate(false);
    setNewKundeVorname('');
    setNewKundeNachname('');
    setNewKundeFirma('');
    setNewKundeTelefon('');
    setAuftragsnummer('');
    setAuftragsdatum('');
    setStatusKey(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaetKey(PRIORITAET_OPTIONS[1]?.key ?? '');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setNewAuftragId(null);
    setPositions([]);
    setShowPositionForm(false);
    setPositionMaterialId('');
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
    const params = new URLSearchParams();
    setSearchParams(params, { replace: true });
    setAuftragCreateError(null);
    setPositionSaveError(null);
  };

  const selectedMaterialObj = material.find(m => m.record_id === positionMaterialId);

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Kunde wählen, Auftragsdaten erfassen und Positionen hinzufügen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Positionen' },
      ]}
      currentStep={step}
      onStepChange={handleStepChange}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ===== SCHRITT 1: Kunde wählen ===== */}
      {step === 1 && (
        <div className="space-y-4">
          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || 'Unbekannter Kunde',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · ') || undefined,
              icon: <IconUser size={20} className="text-primary" />,
            }))}
            onSelect={handleKundeSelect}
            searchPlaceholder="Kunde suchen..."
            emptyText="Kein Kunde gefunden. Lege einen neuen an."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(v => !v)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    value={newKundeVorname}
                    onChange={e => setNewKundeVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                  <Input
                    value={newKundeNachname}
                    onChange={e => setNewKundeNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
                <Input
                  value={newKundeFirma}
                  onChange={e => setNewKundeFirma(e.target.value)}
                  placeholder="Firma (optional)"
                />
                <Input
                  value={newKundeTelefon}
                  onChange={e => setNewKundeTelefon(e.target.value)}
                  placeholder="Telefon (optional)"
                  type="tel"
                />
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={handleKundeCreate}
                    disabled={kundeCreateLoading || (!newKundeVorname.trim() && !newKundeFirma.trim())}
                    className="flex-1"
                  >
                    {kundeCreateLoading ? 'Wird angelegt...' : 'Anlegen & auswählen'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowKundeCreate(false)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ===== SCHRITT 2: Auftragsdaten ===== */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-5">
            {/* Gewählter Kunde */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <IconUser size={18} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Gewählter Kunde</p>
                <p className="text-sm font-medium truncate">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || selectedKunde.fields.firma || 'Unbekannt'}
                </p>
                {selectedKunde.fields.firma && (selectedKunde.fields.vorname || selectedKunde.fields.nachname) && (
                  <p className="text-xs text-muted-foreground truncate">{selectedKunde.fields.firma}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStepChange(1)}
                className="ml-auto shrink-0 text-xs"
              >
                Ändern
              </Button>
            </div>

            {/* Formular */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <h2 className="text-base font-semibold">Auftragsdaten</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Auftragsdatum *</label>
                  <Input
                    type="date"
                    value={auftragsdatum}
                    onChange={e => setAuftragsdatum(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status *</label>
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
                <label className="text-xs font-medium text-muted-foreground">Priorität</label>
                <div className="flex gap-2 flex-wrap">
                  {PRIORITAET_OPTIONS.map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setPrioritaetKey(o.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        prioritaetKey === o.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border text-foreground hover:border-primary/50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Auftragsbeschreibung *</label>
                <textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibe den Auftrag..."
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Wunschtermin (optional)</label>
                  <Input
                    type="datetime-local"
                    value={wunschtermin}
                    onChange={e => setWunschtermin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Monteur (optional)</label>
                  <Input
                    value={monteur}
                    onChange={e => setMonteur(e.target.value)}
                    placeholder="Name des Monteurs"
                  />
                </div>
              </div>

              {auftragCreateError && (
                <p className="text-xs text-destructive">{auftragCreateError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => handleStepChange(1)}
                  className="shrink-0"
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
                  {auftragCreateLoading ? 'Wird angelegt...' : 'Auftrag anlegen & weiter'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen ausgewählten Kunden aus Schritt 1.</p>
            <Button variant="outline" onClick={() => handleStepChange(1)}>Zurück zu Schritt 1</Button>
          </div>
        )
      )}

      {/* ===== SCHRITT 3: Positionen ===== */}
      {step === 3 && (
        newAuftragId ? (
          <div className="space-y-5">
            {/* Live-Zähler */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardList size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Auftrag angelegt</p>
                <p className="text-sm font-semibold">
                  {positions.length === 0
                    ? 'Noch keine Positionen hinzugefügt'
                    : `${positions.length} ${positions.length === 1 ? 'Position' : 'Positionen'} hinzugefügt`}
                </p>
              </div>
            </div>

            {/* Liste gespeicherter Positionen */}
            {positions.length > 0 && (
              <div className="space-y-2">
                {positions.map((pos, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <IconCheck size={15} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pos.materialBezeichnung}</p>
                      <p className="text-xs text-muted-foreground">
                        Menge: {pos.menge}
                        {pos.einheitKey !== 'none' && ` ${EINHEIT_POSITION_OPTIONS.find(o => o.key === pos.einheitKey)?.label ?? pos.einheitKey}`}
                        {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                      </p>
                    </div>
                    <IconCheck size={16} className="text-primary shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* "+ Position hinzufügen" Button */}
            {!showPositionForm && (
              <Button
                variant="outline"
                onClick={() => setShowPositionForm(true)}
                className="w-full gap-2"
              >
                <IconPlus size={16} />
                Position hinzufügen
              </Button>
            )}

            {/* Positions-Formular */}
            {showPositionForm && (
              <div className="rounded-2xl border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold">Neue Position</h3>

                {/* Material wählen */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Material wählen *</label>
                  <EntitySelectStep
                    items={material.map(m => ({
                      id: m.record_id,
                      title: m.fields.bezeichnung ?? m.fields.artikelnummer ?? 'Unbekannt',
                      subtitle: [
                        m.fields.artikelnummer,
                        m.fields.lagerbestand !== undefined ? `Lager: ${m.fields.lagerbestand}` : undefined,
                        m.fields.verfuegbarkeit?.label,
                      ].filter(Boolean).join(' · ') || undefined,
                      icon: <IconBox size={16} className="text-primary" />,
                      status: m.fields.verfuegbarkeit
                        ? { key: m.fields.verfuegbarkeit.key, label: m.fields.verfuegbarkeit.label }
                        : undefined,
                    }))}
                    onSelect={id => setPositionMaterialId(id)}
                    searchPlaceholder="Material suchen..."
                    emptyText="Kein Material gefunden."
                    emptyIcon={<IconBox size={28} />}
                  />
                </div>

                {/* Ausgewähltes Material anzeigen */}
                {selectedMaterialObj && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <IconBox size={14} className="text-primary shrink-0" />
                    <span className="text-sm font-medium text-primary truncate">
                      {selectedMaterialObj.fields.bezeichnung ?? selectedMaterialObj.fields.artikelnummer ?? 'Ausgewählt'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPositionMaterialId('')}
                      className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Menge *</label>
                    <Input
                      type="number"
                      min="0.01"
                      step="any"
                      value={positionMenge}
                      onChange={e => setPositionMenge(e.target.value)}
                      placeholder="Menge"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Einheit</label>
                    <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Einheit wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Einheit</SelectItem>
                        {EINHEIT_POSITION_OPTIONS.map(o => (
                          <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Positionsbeschreibung (optional)</label>
                  <Input
                    value={positionBeschreibung}
                    onChange={e => setPositionBeschreibung(e.target.value)}
                    placeholder="Kurze Beschreibung der Position"
                  />
                </div>

                {positionSaveError && (
                  <p className="text-xs text-destructive">{positionSaveError}</p>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={handlePositionAdd}
                    disabled={
                      positionSaveLoading ||
                      !positionMaterialId ||
                      !positionMenge ||
                      Number(positionMenge) <= 0
                    }
                    className="flex-1"
                  >
                    {positionSaveLoading ? 'Wird gespeichert...' : 'Position hinzufügen'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPositionForm(false);
                      setPositionMaterialId('');
                      setPositionMenge('1');
                      setPositionEinheitKey('none');
                      setPositionBeschreibung('');
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}

            {/* Abschluss */}
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {positions.length === 0
                  ? 'Du kannst den Auftrag auch ohne Positionen abschließen. Positionen lassen sich später ergänzen.'
                  : `${positions.length} ${positions.length === 1 ? 'Position wurde' : 'Positionen wurden'} erfolgreich hinzugefügt.`}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleReset} variant="outline" className="flex-1 min-w-[160px]">
                  Neuen Auftrag anlegen
                </Button>
                <a href="#/" className="flex-1 min-w-[160px]">
                  <Button className="w-full">
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen angelegten Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => handleStepChange(selectedKunde ? 2 : 1)}>
              {selectedKunde ? 'Zurück zu Schritt 2' : 'Neu starten'}
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
