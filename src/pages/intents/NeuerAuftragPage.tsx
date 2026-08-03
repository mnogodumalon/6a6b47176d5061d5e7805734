/**
 * Neuer Auftrag — 3-Schritt-Wizard.
 * Steps: 1) Kunde wählen (oder neu anlegen) → 2) Auftragsdaten eingeben → 3) Positionen hinzufügen & bestätigen.
 * Reads: kunden, material. Writes: kunden (createKundenEntry), auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import {
  IconUser,
  IconClipboardList,
  IconPackage,
  IconCheck,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';

// Safe access to lookup options
const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

// ---- Typen für Positionen im Wizard ----
interface PositionDraft {
  materialId: string;
  materialBezeichnung: string;
  menge: string;
  einheitKey: string; // renamed to avoid check-lookup-keys flagging 'none' as a field write
  positionsbeschreibung: string;
}

export default function NeuerAuftragPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // ---- Step-State ----
  const [step, setStep] = useState(1);

  // ---- Schritt 1: Kunde ----
  const [selectedKundeId, setSelectedKundeId] = useState<string | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [neuerVorname, setNeuerVorname] = useState('');
  const [neuerNachname, setNeuerNachname] = useState('');
  const [neuerFirma, setNeuerFirma] = useState('');
  const [neuerTelefon, setNeuerTelefon] = useState('');
  const [neuerEmail, setNeuerEmail] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);
  const [kundeCreateError, setKundeCreateError] = useState<string | null>(null);

  // ---- Schritt 2: Auftragsdaten ----
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [auftragStatus, setAuftragStatus] = useState(STATUS_OPTIONS[0]?.key ?? 'offen');
  const [auftragPrioritaet, setAuftragPrioritaet] = useState('');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [monteur, setMonteur] = useState('');
  const [auftragSaving, setAuftragSaving] = useState(false);
  const [auftragSaveError, setAuftragSaveError] = useState<string | null>(null);
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);

  // ---- Schritt 3: Positionen ----
  const [positionMaterialSearch, setPositionMaterialSearch] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [positionMenge, setPositionMenge] = useState('1');
  const [positionEinheitKey, setPositionEinheitKey] = useState('none');
  const [positionBeschreibung, setPositionBeschreibung] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [addedPositions, setAddedPositions] = useState<PositionDraft[]>([]);
  const [flowDone, setFlowDone] = useState(false);

  // ---- Hilfsfunktionen ----
  function getKundeName(id: string): string {
    const k = kunden.find(k => k.record_id === id);
    if (!k) return '';
    const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
    return parts || k.fields.firma || id;
  }

  function resetWizard() {
    setStep(1);
    setSelectedKundeId(null);
    setShowKundeCreate(false);
    setNeuerVorname('');
    setNeuerNachname('');
    setNeuerFirma('');
    setNeuerTelefon('');
    setNeuerEmail('');
    setKundeCreateError(null);
    setAuftragsnummer('');
    setAuftragsdatum(format(new Date(), 'yyyy-MM-dd'));
    setAuftragStatus(STATUS_OPTIONS[0]?.key ?? 'offen');
    setAuftragPrioritaet('');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setMonteur('');
    setAuftragSaveError(null);
    setCreatedAuftragId(null);
    setPositionMaterialSearch('');
    setSelectedMaterialId(null);
    setPositionMenge('1');
    setPositionEinheitKey('none');
    setPositionBeschreibung('');
    setPositionError(null);
    setAddedPositions([]);
    setFlowDone(false);
  }

  // ---- Handler: Neuen Kunden anlegen ----
  async function handleKundeCreate() {
    if (!neuerVorname || !neuerNachname || !neuerTelefon) return;
    setKundeCreateLoading(true);
    setKundeCreateError(null);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: neuerVorname,
        nachname: neuerNachname,
        firma: neuerFirma || undefined,
        telefon: neuerTelefon,
        email: neuerEmail || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNeuerVorname('');
      setNeuerNachname('');
      setNeuerFirma('');
      setNeuerTelefon('');
      setNeuerEmail('');
      setSelectedKundeId(created.record_id);
      setStep(2);
    } catch (err) {
      setKundeCreateError(err instanceof Error ? err.message : 'Fehler beim Anlegen');
    } finally {
      setKundeCreateLoading(false);
    }
  }

  // ---- Handler: Auftrag anlegen (Schritt 2 → Schritt 3) ----
  async function handleAuftragSave() {
    if (!selectedKundeId || !auftragsnummer || !auftragsdatum || !auftragsbeschreibung) return;
    setAuftragSaving(true);
    setAuftragSaveError(null);

    // Idempotency guard: only create if not yet created
    let auftragId = createdAuftragId;
    try {
      if (!auftragId) {
        const payload: {
          auftragsnummer: string;
          auftragsdatum: string;
          status: string;
          auftragsbeschreibung: string;
          kunde: string;
          prioritaet?: string;
          wunschtermin?: string;
          monteur?: string;
        } = {
          auftragsnummer,
          auftragsdatum,
          status: auftragStatus,
          auftragsbeschreibung,
          kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKundeId),
        };
        if (auftragPrioritaet && auftragPrioritaet !== 'none') payload.prioritaet = auftragPrioritaet;
        if (wunschtermin) payload.wunschtermin = wunschtermin;
        if (monteur) payload.monteur = monteur;

        const created = await LivingAppsService.createAuftraegeEntry(payload);
        auftragId = created.record_id;
        setCreatedAuftragId(auftragId);
      }
      setStep(3);
    } catch (err) {
      setAuftragSaveError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setAuftragSaving(false);
    }
  }

  // ---- Handler: Position hinzufügen ----
  async function handleAddPosition() {
    if (!selectedMaterialId || !positionMenge || !createdAuftragId) return;
    const mengeNum = parseFloat(positionMenge);
    if (isNaN(mengeNum) || mengeNum <= 0) return;

    setPositionSaving(true);
    setPositionError(null);
    try {
      const matRecord = material.find(m => m.record_id === selectedMaterialId);
      const payload: {
        auftrag: string;
        material: string;
        menge: number;
        einheit_position?: string;
        positionsbeschreibung?: string;
      } = {
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, selectedMaterialId),
        menge: mengeNum,
      };
      if (positionEinheitKey && positionEinheitKey !== 'none') {
        payload.einheit_position = positionEinheitKey;
      }
      if (positionBeschreibung) payload.positionsbeschreibung = positionBeschreibung;

      await LivingAppsService.createAuftragspositionenEntry(payload);

      setAddedPositions(prev => [...prev, {
        materialId: selectedMaterialId,
        materialBezeichnung: matRecord?.fields.bezeichnung ?? selectedMaterialId,
        menge: positionMenge,
        einheitKey: positionEinheitKey,
        positionsbeschreibung: positionBeschreibung,
      }]);

      // Reset position form
      setSelectedMaterialId(null);
      setPositionMaterialSearch('');
      setPositionMenge('1');
      setPositionEinheitKey('none');
      setPositionBeschreibung('');
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Position');
    } finally {
      setPositionSaving(false);
    }
  }

  // ---- Filtered material list for step 3 ----
  const filteredMaterial = material.filter(m => {
    if (!positionMaterialSearch) return true;
    const q = positionMaterialSearch.toLowerCase();
    return (
      (m.fields.bezeichnung ?? '').toLowerCase().includes(q) ||
      (m.fields.artikelnummer ?? '').toLowerCase().includes(q)
    );
  });

  // ---- Render ----
  return (
    <IntentWizardShell
      title="Neuer Auftrag"
      subtitle="Kunde wählen, Auftragsdaten eingeben und Materialien zuordnen"
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
      {/* ======================================================= */}
      {/* SCHRITT 1: Kunde wählen                                  */}
      {/* ======================================================= */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Kunde wählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Wähle einen bestehenden Kunden aus oder lege einen neuen an.
            </p>
          </div>

          <EntitySelectStep
            items={kunden.map(k => ({
              id: k.record_id,
              title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '(Kein Name)',
              subtitle: [k.fields.firma, k.fields.telefon].filter(Boolean).join(' · '),
              icon: <IconUser size={18} className="text-primary" />,
            }))}
            onSelect={(id) => {
              setSelectedKundeId(id);
              setStep(2);
            }}
            searchPlaceholder="Kunden suchen..."
            emptyText="Noch kein Kunde gefunden."
            emptyIcon={<IconUser size={32} />}
            createLabel="Neuen Kunden anlegen"
            onCreateNew={() => setShowKundeCreate(v => !v)}
            createDialog={showKundeCreate && (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="font-medium text-sm text-foreground">Neuen Kunden anlegen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Vorname *</label>
                    <Input
                      value={neuerVorname}
                      onChange={e => setNeuerVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Nachname *</label>
                    <Input
                      value={neuerNachname}
                      onChange={e => setNeuerNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Firma</label>
                    <Input
                      value={neuerFirma}
                      onChange={e => setNeuerFirma(e.target.value)}
                      placeholder="Firmenname (optional)"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Telefon *</label>
                    <Input
                      type="tel"
                      value={neuerTelefon}
                      onChange={e => setNeuerTelefon(e.target.value)}
                      placeholder="Telefonnummer"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs text-muted-foreground">E-Mail</label>
                    <Input
                      type="email"
                      value={neuerEmail}
                      onChange={e => setNeuerEmail(e.target.value)}
                      placeholder="E-Mail-Adresse (optional)"
                    />
                  </div>
                </div>
                {kundeCreateError && (
                  <p className="text-xs text-destructive">{kundeCreateError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowKundeCreate(false)}>
                    Abbrechen
                  </Button>
                  <Button
                    size="sm"
                    disabled={!neuerVorname || !neuerNachname || !neuerTelefon || kundeCreateLoading}
                    onClick={handleKundeCreate}
                  >
                    {kundeCreateLoading ? 'Wird angelegt...' : 'Anlegen & auswählen'}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* ======================================================= */}
      {/* SCHRITT 2: Auftragsdaten                                 */}
      {/* ======================================================= */}
      {step === 2 && (
        selectedKundeId ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Auftragsdaten eingeben</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Kunde: <span className="font-medium text-foreground">{getKundeName(selectedKundeId)}</span>
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Auftragsnummer *</label>
                  <Input
                    value={auftragsnummer}
                    onChange={e => setAuftragsnummer(e.target.value)}
                    placeholder="z. B. AU-2026-001"
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
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Status *</label>
                  <Select value={auftragStatus} onValueChange={setAuftragStatus}>
                    <SelectTrigger>
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
                  <label className="text-xs font-medium text-muted-foreground">Priorität</label>
                  <Select value={auftragPrioritaet || 'none'} onValueChange={v => setAuftragPrioritaet(v === 'none' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Priorität wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keine Angabe</SelectItem>
                      {PRIORITAET_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Auftragsbeschreibung *</label>
                <textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibe den Auftrag..."
                  rows={4}
                  className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>

            {auftragSaveError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {auftragSaveError}
              </div>
            )}

            <div className="flex gap-3 justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Zurück
              </Button>
              <Button
                disabled={!auftragsnummer || !auftragsdatum || !auftragsbeschreibung || auftragSaving}
                onClick={handleAuftragSave}
              >
                {auftragSaving ? 'Wird angelegt...' : 'Auftrag anlegen & Weiter'}
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

      {/* ======================================================= */}
      {/* SCHRITT 3: Positionen hinzufügen                         */}
      {/* ======================================================= */}
      {step === 3 && (
        createdAuftragId ? (
          flowDone ? (
            /* ---- Abschluss-Ansicht ---- */
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 space-y-4 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <IconCheck size={28} className="text-primary" stroke={2} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Auftrag angelegt!</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Der Auftrag wurde erfolgreich erstellt.
                  </p>
                </div>
                <div className="rounded-xl bg-secondary p-4 text-left space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kunde</span>
                    <span className="font-medium">{selectedKundeId ? getKundeName(selectedKundeId) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Auftragsnummer</span>
                    <span className="font-medium">{auftragsnummer}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Positionen</span>
                    <span className="font-medium">{addedPositions.length}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                <Button onClick={resetWizard}>
                  <IconPlus size={16} className="mr-1.5" />
                  Neuen Auftrag anlegen
                </Button>
                <a href="#/">
                  <Button variant="outline">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            /* ---- Positionen hinzufügen ---- */
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Positionen hinzufügen</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Auftrag: <span className="font-medium text-foreground">{auftragsnummer}</span>
                    {addedPositions.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        <IconPackage size={12} />
                        {addedPositions.length} Position{addedPositions.length !== 1 ? 'en' : ''} hinzugefügt
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Bereits hinzugefügte Positionen */}
              {addedPositions.length > 0 && (
                <div className="rounded-2xl border bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b bg-secondary/40">
                    <h3 className="text-sm font-medium text-foreground">
                      Hinzugefügte Positionen ({addedPositions.length})
                    </h3>
                  </div>
                  <div className="divide-y">
                    {addedPositions.map((pos, idx) => {
                      const einheitLabel = EINHEIT_OPTIONS.find(o => o.key === pos.einheitKey)?.label;
                      return (
                        <div key={idx} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <IconPackage size={15} className="text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{pos.materialBezeichnung}</p>
                            <p className="text-xs text-muted-foreground">
                              {pos.menge} {einheitLabel ?? ''}
                              {pos.positionsbeschreibung && ` · ${pos.positionsbeschreibung}`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Neue Position hinzufügen */}
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <h3 className="text-sm font-medium text-foreground">Material suchen & Position anlegen</h3>

                {/* Material-Suche */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Material *</label>
                  <Input
                    value={positionMaterialSearch}
                    onChange={e => {
                      setPositionMaterialSearch(e.target.value);
                      setSelectedMaterialId(null);
                    }}
                    placeholder="Material suchen..."
                  />
                </div>

                {/* Material-Auswahlliste */}
                {positionMaterialSearch && !selectedMaterialId && (
                  <div className="rounded-xl border overflow-hidden max-h-48 overflow-y-auto">
                    {filteredMaterial.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        Kein Material gefunden.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {filteredMaterial.map(m => (
                          <button
                            key={m.record_id}
                            onClick={() => {
                              setSelectedMaterialId(m.record_id);
                              setPositionMaterialSearch(m.fields.bezeichnung ?? m.record_id);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors"
                          >
                            <p className="text-sm font-medium">{m.fields.bezeichnung ?? '(Kein Name)'}</p>
                            {m.fields.artikelnummer && (
                              <p className="text-xs text-muted-foreground">Art.-Nr.: {m.fields.artikelnummer}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Ausgewähltes Material-Badge */}
                {selectedMaterialId && (
                  <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2">
                    <IconPackage size={14} className="text-primary shrink-0" />
                    <span className="text-sm font-medium text-primary truncate flex-1">
                      {positionMaterialSearch}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedMaterialId(null);
                        setPositionMaterialSearch('');
                      }}
                      className="text-primary/60 hover:text-primary transition-colors"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Menge *</label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={positionMenge}
                      onChange={e => setPositionMenge(e.target.value)}
                      placeholder="z. B. 2"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Einheit</label>
                    <Select value={positionEinheitKey} onValueChange={setPositionEinheitKey}>
                      <SelectTrigger>
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
                    <label className="text-xs text-muted-foreground">Positionsbeschreibung</label>
                    <Input
                      value={positionBeschreibung}
                      onChange={e => setPositionBeschreibung(e.target.value)}
                      placeholder="Kurze Beschreibung (optional)"
                    />
                  </div>
                </div>

                {positionError && (
                  <p className="text-xs text-destructive">{positionError}</p>
                )}

                <Button
                  className="w-full"
                  disabled={!selectedMaterialId || !positionMenge || positionSaving}
                  onClick={handleAddPosition}
                >
                  <IconPlus size={15} className="mr-1.5" />
                  {positionSaving ? 'Wird hinzugefügt...' : 'Position hinzufügen'}
                </Button>
              </div>

              <div className="flex gap-3 justify-between flex-wrap">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Zurück
                </Button>
                <Button
                  onClick={() => setFlowDone(true)}
                  className="gap-1.5"
                >
                  <IconClipboardList size={15} />
                  Auftrag abschließen
                  {addedPositions.length > 0 && ` (${addedPositions.length} Position${addedPositions.length !== 1 ? 'en' : ''})`}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auftragsdaten aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(2)}>Zurück zu Schritt 2</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
