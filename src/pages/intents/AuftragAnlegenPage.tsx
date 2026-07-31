/**
 * AuftragAnlegenPage — 3-Schritt-Wizard zum Anlegen eines neuen Auftrags.
 * Steps: 1) Kunde wählen → 2) Auftragsdetails eingeben & Auftrag anlegen →
 *        3) Auftragspositionen (Materialien) hinzufügen & abschließen.
 * Reads: kunden, material. Writes: auftraege (createAuftraegeEntry),
 *        auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep.
 */
import { useState, useCallback } from 'react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Kunden, Material } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconPlus, IconTrash, IconCheck, IconPackage, IconUser } from '@tabler/icons-react';

const STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];
const VERFUEGBARKEIT_OPTIONS = LOOKUP_OPTIONS['material']?.['verfuegbarkeit'] ?? [];
const NICHT_VERFUEGBAR_KEY = VERFUEGBARKEIT_OPTIONS.find(o => o.key === 'nicht_verfuegbar')?.key ?? 'nicht_verfuegbar';

const WIZARD_STEPS = [
  { label: 'Kunde wählen' },
  { label: 'Auftragsdetails' },
  { label: 'Positionen' },
];

interface PositionEntry {
  materialId: string;
  materialName: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

export default function AuftragAnlegenPage() {
  const { kunden, material, loading, error, fetchAll } = useDashboardData();

  // Wizard navigation
  const [step, setStep] = useState(1);

  // Step 1 — Kunde
  const [selectedKunde, setSelectedKunde] = useState<Kunden | null>(null);
  const [showKundeCreate, setShowKundeCreate] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');
  const [kundeCreateLoading, setKundeCreateLoading] = useState(false);

  // Step 2 — Auftragsdetails
  const [auftragsnummer, setAuftragsnummer] = useState('');
  const [auftragsdatum, setAuftragsdatum] = useState('');
  const [auftragStatus, setAuftragStatus] = useState(STATUS_OPTIONS[0]?.key ?? '');
  const [prioritaet, setPrioritaet] = useState('');
  const [auftragsbeschreibung, setAuftragsbeschreibung] = useState('');
  const [wunschtermin, setWunschtermin] = useState('');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Step 2 result
  const [createdAuftragId, setCreatedAuftragId] = useState<string | null>(null);
  const [createdAuftragsnummer, setCreatedAuftragsnummer] = useState('');

  // Step 3 — Positionen
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  // --- Handlers ---

  const handleKundeSelect = useCallback((id: string) => {
    const found = kunden.find(k => k.record_id === id) ?? null;
    setSelectedKunde(found);
    setStep(2);
  }, [kunden]);

  const handleKundeCreate = useCallback(async () => {
    if (!newKundeVorname.trim() || !newKundeNachname.trim()) return;
    setKundeCreateLoading(true);
    try {
      const created = await LivingAppsService.createKundenEntry({
        vorname: newKundeVorname.trim(),
        nachname: newKundeNachname.trim(),
        telefon: newKundeTelefon.trim() || undefined,
      });
      await fetchAll();
      setShowKundeCreate(false);
      setNewKundeVorname('');
      setNewKundeNachname('');
      setNewKundeTelefon('');
      // auto-select the new record via the id
      const nowStr = new Date().toLocaleString('sv').replace(' ', 'T');
      const newRecord: Kunden = {
        record_id: created.record_id,
        created_at: nowStr,
        updated_at: null,
        createdat: nowStr,
        updatedat: null,
        fields: {
          vorname: newKundeVorname.trim(),
          nachname: newKundeNachname.trim(),
          telefon: newKundeTelefon.trim() || undefined,
        },
      };
      setSelectedKunde(newRecord);
      setStep(2);
    } finally {
      setKundeCreateLoading(false);
    }
  }, [newKundeVorname, newKundeNachname, newKundeTelefon, fetchAll]);

  const handleAuftragCreate = useCallback(async () => {
    if (!auftragsnummer.trim() || !auftragsdatum || !auftragStatus || !auftragsbeschreibung.trim() || !selectedKunde) return;
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const payload: Parameters<typeof LivingAppsService.createAuftraegeEntry>[0] = {
        auftragsnummer: auftragsnummer.trim(),
        auftragsdatum,
        status: auftragStatus,
        auftragsbeschreibung: auftragsbeschreibung.trim(),
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
      };
      if (prioritaet && prioritaet !== '') {
        payload.prioritaet = prioritaet;
      }
      if (wunschtermin) {
        payload.wunschtermin = wunschtermin;
      }
      const result = await LivingAppsService.createAuftraegeEntry(payload);
      setCreatedAuftragId(result.record_id);
      setCreatedAuftragsnummer(auftragsnummer.trim());
      setStep(3);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Fehler beim Anlegen des Auftrags');
    } finally {
      setDetailsLoading(false);
    }
  }, [auftragsnummer, auftragsdatum, auftragStatus, auftragsbeschreibung, prioritaet, wunschtermin, selectedKunde]);

  const addPosition = useCallback((mat: Material) => {
    setPositions(prev => {
      if (prev.some(p => p.materialId === mat.record_id)) return prev;
      return [...prev, {
        materialId: mat.record_id,
        materialName: mat.fields.bezeichnung ?? mat.fields.artikelnummer ?? mat.record_id,
        menge: '1',
        einheitKey: '',
        positionsbeschreibung: '',
      }];
    });
  }, []);

  const removePosition = useCallback((materialId: string) => {
    setPositions(prev => prev.filter(p => p.materialId !== materialId));
  }, []);

  const updatePosition = useCallback((materialId: string, field: keyof Omit<PositionEntry, 'materialId' | 'materialName'>, value: string) => {
    setPositions(prev => prev.map(p => p.materialId === materialId ? { ...p, [field]: value } : p));
  }, []);

  const handleAbschliessen = useCallback(async () => {
    if (!createdAuftragId || positions.length === 0) return;
    setPositionsLoading(true);
    setPositionsError(null);
    try {
      for (const pos of positions) {
        const menge = parseFloat(pos.menge);
        if (isNaN(menge) || menge <= 0) continue;
        const posPayload: Parameters<typeof LivingAppsService.createAuftragspositionenEntry>[0] = {
          auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, createdAuftragId),
          material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
          menge,
        };
        if (pos.einheitKey) {
          posPayload.einheit_position = pos.einheitKey;
        }
        if (pos.positionsbeschreibung.trim()) {
          posPayload.positionsbeschreibung = pos.positionsbeschreibung.trim();
        }
        await LivingAppsService.createAuftragspositionenEntry(posPayload);
      }
      setFinished(true);
    } catch (err) {
      setPositionsError(err instanceof Error ? err.message : 'Fehler beim Speichern der Positionen');
    } finally {
      setPositionsLoading(false);
    }
  }, [createdAuftragId, positions]);

  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedKunde(null);
    setShowKundeCreate(false);
    setNewKundeVorname('');
    setNewKundeNachname('');
    setNewKundeTelefon('');
    setAuftragsnummer('');
    setAuftragsdatum('');
    setAuftragStatus(STATUS_OPTIONS[0]?.key ?? '');
    setPrioritaet('');
    setAuftragsbeschreibung('');
    setWunschtermin('');
    setDetailsError(null);
    setCreatedAuftragId(null);
    setCreatedAuftragsnummer('');
    setPositions([]);
    setPositionsError(null);
    setFinished(false);
  }, []);

  // Filtered material: exclude nicht_verfuegbar
  const availableMaterial = material.filter(m => m.fields.verfuegbarkeit?.key !== NICHT_VERFUEGBAR_KEY);

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Kunde wählen, Details erfassen und Materialien zuordnen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Kunde wählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map(k => ({
            id: k.record_id,
            title: [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)',
            subtitle: k.fields.firma ?? undefined,
            stats: k.fields.telefon ? [{ label: 'Telefon', value: k.fields.telefon }] : undefined,
            icon: <IconUser size={20} className="text-primary" />,
          }))}
          onSelect={handleKundeSelect}
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowKundeCreate(true)}
          searchPlaceholder="Kunden suchen …"
          emptyText="Keine Kunden gefunden"
          createDialog={showKundeCreate && (
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Neuen Kunden anlegen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  value={newKundeVorname}
                  onChange={e => setNewKundeVorname(e.target.value)}
                  placeholder="Vorname"
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
                placeholder="Telefon (optional)"
              />
              <div className="flex gap-2">
                <Button
                  disabled={!newKundeVorname.trim() || !newKundeNachname.trim() || kundeCreateLoading}
                  onClick={handleKundeCreate}
                  className="flex-1"
                >
                  {kundeCreateLoading ? 'Wird angelegt …' : 'Kunden anlegen & auswählen'}
                </Button>
                <Button variant="outline" onClick={() => setShowKundeCreate(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        />
      )}

      {/* ── Step 2: Auftragsdetails ── */}
      {step === 2 && (
        selectedKunde ? (
          <div className="space-y-5">
            {/* Ausgewählter Kunde */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
              <IconUser size={20} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">
                  {[selectedKunde.fields.vorname, selectedKunde.fields.nachname].filter(Boolean).join(' ') || '(Kein Name)'}
                </p>
                {selectedKunde.fields.firma && (
                  <p className="text-sm text-muted-foreground truncate">{selectedKunde.fields.firma}</p>
                )}
              </div>
              <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => setStep(1)}>
                Ändern
              </Button>
            </div>

            {/* Mini-Form */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground">Auftragsdetails</p>

              {/* Auftragsnummer (required) */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Auftragsnummer *</label>
                <Input
                  value={auftragsnummer}
                  onChange={e => setAuftragsnummer(e.target.value)}
                  placeholder="z. B. AU-2026-001"
                />
              </div>

              {/* Auftragsdatum (required) */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Auftragsdatum *</label>
                <Input
                  type="date"
                  value={auftragsdatum}
                  onChange={e => setAuftragsdatum(e.target.value)}
                />
              </div>

              {/* Status (required) */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Status *</label>
                <Select value={auftragStatus} onValueChange={setAuftragStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Status wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priorität (optional) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Priorität (optional)</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPrioritaet('')}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                      prioritaet === ''
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-secondary'
                    }`}
                  >
                    Keine
                  </button>
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPrioritaet(opt.key)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        prioritaet === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground border-border hover:bg-secondary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auftragsbeschreibung (required) */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Auftragsbeschreibung *</label>
                <textarea
                  value={auftragsbeschreibung}
                  onChange={e => setAuftragsbeschreibung(e.target.value)}
                  placeholder="Beschreibung des Auftrags …"
                  rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Wunschtermin (optional) */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Wunschtermin (optional)</label>
                <Input
                  type="datetime-local"
                  value={wunschtermin}
                  onChange={e => setWunschtermin(e.target.value)}
                />
              </div>

              {detailsError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                  {detailsError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Zurück
                </Button>
                <Button
                  className="flex-1"
                  disabled={
                    !auftragsnummer.trim() ||
                    !auftragsdatum ||
                    !auftragStatus ||
                    !auftragsbeschreibung.trim() ||
                    detailsLoading
                  }
                  onClick={handleAuftragCreate}
                >
                  {detailsLoading ? 'Wird angelegt …' : 'Auftrag anlegen & weiter'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Bitte zuerst einen Kunden auswählen.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* ── Step 3: Auftragspositionen ── */}
      {step === 3 && (
        createdAuftragId ? (
          finished ? (
            /* Erfolg */
            <div className="rounded-2xl border bg-card p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <IconCheck size={28} className="text-primary" stroke={2} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold text-foreground">Auftrag abgeschlossen!</p>
                <p className="text-sm text-muted-foreground">
                  Auftrag <span className="font-medium text-foreground">{createdAuftragsnummer}</span> wurde mit{' '}
                  {positions.length} {positions.length === 1 ? 'Position' : 'Positionen'} angelegt.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <Button onClick={handleReset}>Neuen Auftrag anlegen</Button>
                <a href="#/">
                  <Button variant="outline" className="w-full sm:w-auto">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Auftrag-Übersicht */}
              <div className="rounded-2xl border bg-secondary/40 p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">Auftrag: {createdAuftragsnummer}</p>
                  <p className="text-sm text-muted-foreground">
                    Kunde: {[selectedKunde?.fields.vorname, selectedKunde?.fields.nachname].filter(Boolean).join(' ')}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">{positions.length} Position{positions.length !== 1 ? 'en' : ''}</span>
              </div>

              {/* Positionen-Liste (bereits hinzugefügt) */}
              {positions.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">Hinzugefügte Positionen</p>
                  {positions.map(pos => (
                    <div key={pos.materialId} className="rounded-xl border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <IconPackage size={16} className="text-primary shrink-0" />
                          <span className="font-medium text-sm truncate">{pos.materialName}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePosition(pos.materialId)}
                          className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Menge *</label>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={pos.menge}
                            onChange={e => updatePosition(pos.materialId, 'menge', e.target.value)}
                            placeholder="Menge"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Einheit</label>
                          <Select
                            value={pos.einheitKey}
                            onValueChange={v => updatePosition(pos.materialId, 'einheitKey', v)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Einheit wählen" />
                            </SelectTrigger>
                            <SelectContent>
                              {EINHEIT_OPTIONS.map(opt => (
                                <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Beschreibung</label>
                          <Input
                            value={pos.positionsbeschreibung}
                            onChange={e => updatePosition(pos.materialId, 'positionsbeschreibung', e.target.value)}
                            placeholder="Optionale Beschreibung"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Verfügbares Material */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Material hinzufügen</p>
                {availableMaterial.length === 0 ? (
                  <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
                    Kein verfügbares Material vorhanden.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableMaterial.map(mat => {
                      const alreadyAdded = positions.some(p => p.materialId === mat.record_id);
                      return (
                        <button
                          key={mat.record_id}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => addPosition(mat)}
                          className={`rounded-xl border p-3 text-left transition-colors w-full ${
                            alreadyAdded
                              ? 'bg-primary/5 border-primary/30 opacity-60 cursor-default'
                              : 'bg-card hover:bg-secondary border-border'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <IconPackage size={16} className={alreadyAdded ? 'text-primary' : 'text-muted-foreground'} />
                            <span className="text-sm font-medium truncate">
                              {mat.fields.bezeichnung ?? mat.fields.artikelnummer ?? mat.record_id}
                            </span>
                            {alreadyAdded ? (
                              <IconCheck size={14} className="text-primary ml-auto shrink-0" />
                            ) : (
                              <IconPlus size={14} className="text-muted-foreground ml-auto shrink-0" />
                            )}
                          </div>
                          {(mat.fields.artikelnummer || mat.fields.verfuegbarkeit) && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate pl-6">
                              {[mat.fields.artikelnummer, mat.fields.verfuegbarkeit?.label].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {positionsError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                  {positionsError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Zurück
                </Button>
                <Button
                  className="flex-1"
                  disabled={positions.length === 0 || positionsLoading}
                  onClick={handleAbschliessen}
                >
                  {positionsLoading
                    ? 'Wird gespeichert …'
                    : `${positions.length} Position${positions.length !== 1 ? 'en' : ''} speichern & abschließen`
                  }
                </Button>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline underline-offset-2"
                  onClick={() => setFinished(true)}
                >
                  Ohne Positionen abschließen
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht einen angelegten Auftrag aus Schritt 2.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
