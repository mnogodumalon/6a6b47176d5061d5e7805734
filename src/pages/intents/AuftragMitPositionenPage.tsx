/**
 * Auftrag mit Positionen anlegen — 5-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftragsdaten erfassen → 3) Materialposition(en) hinzufügen → 4) Zusammenfassung prüfen → 5) Fertig.
 * Reads: kunden, material, auftraege, auftragspositionen.
 * Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, SummaryStep, SuccessStep.
 */
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell, clearIntentDraft } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useIntentSubmit } from '@/hooks/useIntentSubmit';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { lookupKey } from '@/lib/formatters';
import { undoToast } from '@/lib/polish';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  IconUser,
  IconPackage,
  IconAlertTriangle,
  IconTrash,
  IconPlus,
} from '@tabler/icons-react';

const DRAFT_KEY = 'intent:auftrag-mit-positionen';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  menge: string;
  einheitKey: string;
  positionsbeschreibung: string;
  bemerkung: string;
}

interface WizardState {
  kundeId: string;
  auftragsbeschreibung: string;
  prioritaet: string;
  wunschtermin: string;
  monteur: string;
  positionen: PositionDraft[];
}

function kundeName(k: Kunden): string {
  const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
  return k.fields.firma ? (parts ? `${parts} (${k.fields.firma})` : k.fields.firma) : (parts || k.record_id);
}

export default function AuftragMitPositionenPage() {
  const { kunden, material, auftraege, auftragspositionen, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>({
    kundeId: '',
    auftragsbeschreibung: '',
    prioritaet: PRIORITAET_OPTIONS[1]?.key ?? '',
    wunschtermin: '',
    monteur: '',
    positionen: [],
  });

  // New-Kunde mini-form state
  const [showNewKunde, setShowNewKunde] = useState(false);
  const [newKundeVorname, setNewKundeVorname] = useState('');
  const [newKundeNachname, setNewKundeNachname] = useState('');
  const [newKundeTelefon, setNewKundeTelefon] = useState('');

  // New-Position material state
  const [showNewPosition, setShowNewPosition] = useState(false);
  const [posMatId, setPosMatId] = useState('');
  const [posMenge, setPosMenge] = useState('1');
  const [posEinheitKey, setPosEinheitKey] = useState(EINHEIT_OPTIONS[0]?.key ?? '');
  const [posBeschreibung, setPosBeschreibung] = useState('');
  const [posBemerkung, setPosBemerkung] = useState('');

  // Stored ids for idempotency on retry
  const [createdAuftragId, setCreatedAuftragId] = useState('');

  const selectedKunde = useMemo(
    () => kunden.find(k => k.record_id === state.kundeId) ?? null,
    [kunden, state.kundeId],
  );

  const selectedMaterial = useMemo(
    () => material.find(m => m.record_id === posMatId) ?? null,
    [material, posMatId],
  );

  // Derived: count open auftraege per Kunde
  const offeneAuftraegeByKunde = useMemo(() => {
    const map = new Map<string, number>();
    auftraege.forEach(a => {
      const kid = extractRecordId(a.fields.kunde);
      if (!kid) return;
      const s = lookupKey(a.fields.status);
      if (s === 'offen' || s === 'in_bearbeitung') {
        map.set(kid, (map.get(kid) ?? 0) + 1);
      }
    });
    return map;
  }, [auftraege]);

  // Running number from count of all existing auftraege
  const auftragsnummer = useMemo(() => {
    const n = auftraege.length + 1;
    return `AU-${n}`;
  }, [auftraege]);

  // Today's date for auftragsdatum
  const today = format(new Date(), 'yyyy-MM-dd');

  // Total positionen count stats
  const positionenByAuftrag = useMemo(() => {
    const map = new Map<string, number>();
    auftragspositionen.forEach(p => {
      const aid = extractRecordId(p.fields.auftrag);
      if (!aid) return;
      map.set(aid, (map.get(aid) ?? 0) + 1);
    });
    return map;
  }, [auftragspositionen]);

  // Submit logic
  const { submit, submitting, error: submitError, result, reset } = useIntentSubmit(async () => {
    // Step 1: Create Auftrag (idempotency: only if not yet created)
    let auftragId = createdAuftragId;
    if (!auftragId) {
      const auftrag = await LivingAppsService.createAuftraegeEntry({
        auftragsnummer,
        auftragsdatum: today,
        status: 'offen',
        prioritaet: state.prioritaet || undefined,
        kunde: createRecordUrl(APP_IDS.KUNDEN, state.kundeId),
        auftragsbeschreibung: state.auftragsbeschreibung,
        wunschtermin: state.wunschtermin || undefined,
        monteur: state.monteur || undefined,
      });
      auftragId = auftrag.record_id;
      setCreatedAuftragId(auftragId);
    }

    // Step 2: Create all Positionen
    for (const pos of state.positionen) {
      await LivingAppsService.createAuftragspositionenEntry({
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, auftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
        menge: Number(pos.menge),
        einheit_position: pos.einheitKey !== 'none' ? pos.einheitKey : undefined,
        positionsbeschreibung: pos.positionsbeschreibung || undefined,
        bemerkung: pos.bemerkung || undefined,
      });
    }

    clearIntentDraft(DRAFT_KEY);
    return { auftragId, auftragsnummer };
  });

  const handleAddPosition = () => {
    if (!posMatId || !posMenge) return;
    const pos: PositionDraft = {
      materialId: posMatId,
      menge: posMenge,
      einheitKey: posEinheitKey,
      positionsbeschreibung: posBeschreibung,
      bemerkung: posBemerkung,
    };
    setState(s => ({ ...s, positionen: [...s.positionen, pos] }));
    // Reset position form
    setPosMatId('');
    setPosMenge('1');
    setPosEinheitKey(EINHEIT_OPTIONS[0]?.key ?? '');
    setPosBeschreibung('');
    setPosBemerkung('');
    setShowNewPosition(false);
    undoToast('Position hinzugefügt', () => {
      setState(s => ({ ...s, positionen: s.positionen.filter(p => p !== pos) }));
    });
  };

  const handleRemovePosition = (idx: number) => {
    const removed = state.positionen[idx];
    setState(s => ({ ...s, positionen: s.positionen.filter((_, i) => i !== idx) }));
    undoToast('Position entfernt', () => {
      setState(s => ({ ...s, positionen: [...s.positionen.slice(0, idx), removed, ...s.positionen.slice(idx)] }));
    });
  };

  const handleReset = () => {
    setStep(1);
    setState({
      kundeId: '',
      auftragsbeschreibung: '',
      prioritaet: PRIORITAET_OPTIONS[1]?.key ?? '',
      wunschtermin: '',
      monteur: '',
      positionen: [],
    });
    setCreatedAuftragId('');
    reset();
  };

  const getMaterialName = (id: string): string => {
    const m = material.find(mat => mat.record_id === id);
    return m?.fields.bezeichnung ?? id;
  };

  const getEinheitLabel = (key: string): string => {
    if (!key || key === 'none') return '';
    return EINHEIT_OPTIONS.find(o => o.key === key)?.label ?? key;
  };

  const getPrioritaetLabel = (key: string): string => {
    return PRIORITAET_OPTIONS.find(o => o.key === key)?.label ?? key;
  };

  const successData = result as { auftragId: string; auftragsnummer: string } | null;

  return (
    <IntentWizardShell
      title="Auftrag anlegen"
      subtitle="Neuen Auftrag für einen Kunden anlegen und Materialien direkt hinzufügen"
      steps={[
        { label: 'Kunde' },
        { label: 'Auftrag' },
        { label: 'Material' },
        { label: 'Prüfen' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
      intro={{
        description: 'Wähle einen Kunden, erfasse die Auftragsdaten und füge direkt mehrere Materialpositionen hinzu.',
        requirements: ['Kundenname bekannt', 'Materialien aus dem Lager auswählen'],
      }}
      answers={[
        ...(state.kundeId && selectedKunde ? [{ label: 'Kunde', value: kundeName(selectedKunde) }] : []),
        ...(state.auftragsbeschreibung ? [{ label: 'Auftrag', value: state.auftragsbeschreibung.slice(0, 60) + (state.auftragsbeschreibung.length > 60 ? '…' : '') }] : []),
        ...(state.positionen.length > 0 ? [{ label: 'Positionen', value: `${state.positionen.length}` }] : []),
      ]}
      draftKey={DRAFT_KEY}
      draft={state}
      onDraftRestore={d => setState(d as WizardState)}
    >
      {/* Step 1: Kunde wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map(k => ({
            id: k.record_id,
            title: kundeName(k),
            subtitle: [k.fields.telefon, k.fields.ort].filter(Boolean).join(' · ') || undefined,
            icon: <IconUser size={20} className="text-primary" />,
            stats: [
              {
                label: 'Offene Aufträge',
                value: offeneAuftraegeByKunde.get(k.record_id) ?? 0,
              },
            ],
          }))}
          onSelect={id => {
            setState(s => ({ ...s, kundeId: id }));
            setStep(2);
          }}
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowNewKunde(true)}
          searchPlaceholder="Kunde suchen …"
          emptyText="Kein Kunde gefunden"
          createDialog={showNewKunde ? (
            <div className="rounded-2xl border p-4 space-y-3">
              <p className="text-sm font-medium">Neuen Kunden anlegen</p>
              <div className="grid grid-cols-2 gap-2">
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
                value={newKundeTelefon}
                onChange={e => setNewKundeTelefon(e.target.value)}
                placeholder="Telefon (optional)"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowNewKunde(false); setNewKundeVorname(''); setNewKundeNachname(''); setNewKundeTelefon(''); }}
                >
                  Abbrechen
                </Button>
                <Button
                  disabled={!newKundeVorname && !newKundeNachname}
                  onClick={async () => {
                    const created = await LivingAppsService.createKundenEntry({
                      vorname: newKundeVorname || undefined,
                      nachname: newKundeNachname || undefined,
                      telefon: newKundeTelefon || undefined,
                    });
                    await fetchAll();
                    setShowNewKunde(false);
                    setNewKundeVorname('');
                    setNewKundeNachname('');
                    setNewKundeTelefon('');
                    setState(s => ({ ...s, kundeId: created.record_id }));
                    setStep(2);
                  }}
                >
                  Anlegen
                </Button>
              </div>
            </div>
          ) : undefined}
        />
      )}

      {/* Step 2: Auftragsdaten erfassen */}
      {step === 2 && (
        <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Auftragsdaten für {selectedKunde ? kundeName(selectedKunde) : '—'}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Auftragsnummer <b>{auftragsnummer}</b> · Datum <b>{format(new Date(), 'dd.MM.yyyy')}</b> · Status „Offen"
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Auftragsbeschreibung *</label>
              <textarea
                className="w-full min-h-[90px] rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.auftragsbeschreibung}
                onChange={e => setState(s => ({ ...s, auftragsbeschreibung: e.target.value }))}
                placeholder="Was soll gemacht werden?"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Priorität</label>
              <div className="flex flex-wrap gap-2">
                {PRIORITAET_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setState(s => ({ ...s, prioritaet: opt.key }))}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      state.prioritaet === opt.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border hover:bg-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Wunschtermin (optional)</label>
                <Input
                  type="datetime-local"
                  value={state.wunschtermin}
                  onChange={e => setState(s => ({ ...s, wunschtermin: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Monteur (optional)</label>
                <Input
                  value={state.monteur}
                  onChange={e => setState(s => ({ ...s, monteur: e.target.value }))}
                  placeholder="Name des Monteurs"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setStep(1)}>Zurück</Button>
            <Button
              disabled={!state.auftragsbeschreibung.trim()}
              onClick={() => setStep(3)}
              className="flex-1"
            >
              Weiter zu Materialien
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Materialposition(en) hinzufügen */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Materialien für „{state.auftragsbeschreibung.slice(0, 50)}{state.auftragsbeschreibung.length > 50 ? '…' : ''}"</h2>
              <p className="text-sm text-muted-foreground mt-1">Füge alle benötigten Materialien hinzu. Du kannst mehrere Positionen hinzufügen.</p>
            </div>

            {/* Existing positions */}
            {state.positionen.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{state.positionen.length} Position{state.positionen.length !== 1 ? 'en' : ''} hinzugefügt</p>
                {state.positionen.map((pos, idx) => {
                  const mat = material.find(m => m.record_id === pos.materialId);
                  return (
                    <div key={idx} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2">
                      <IconPackage size={16} className="text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mat?.fields.bezeichnung ?? pos.materialId}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.menge} {getEinheitLabel(pos.einheitKey)}{pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePosition(idx)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                        aria-label="Position entfernen"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add position form */}
            {showNewPosition ? (
              <NewPositionForm
                material={material}
                posMatId={posMatId}
                setPosMatId={setPosMatId}
                selectedMaterial={selectedMaterial}
                posMenge={posMenge}
                setPosMenge={setPosMenge}
                posEinheitKey={posEinheitKey}
                setPosEinheitKey={setPosEinheitKey}
                einheitOptions={EINHEIT_OPTIONS}
                posBeschreibung={posBeschreibung}
                setPosBeschreibung={setPosBeschreibung}
                posBemerkung={posBemerkung}
                setPosBemerkung={setPosBemerkung}
                onAdd={handleAddPosition}
                onCancel={() => { setShowNewPosition(false); setPosMatId(''); setPosMenge('1'); }}
              />
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowNewPosition(true)}
              >
                <IconPlus size={16} />
                Position hinzufügen
              </Button>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>Zurück</Button>
            <Button
              disabled={state.positionen.length === 0}
              onClick={() => setStep(4)}
              className="flex-1"
            >
              Weiter zur Zusammenfassung ({state.positionen.length} Position{state.positionen.length !== 1 ? 'en' : ''})
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Zusammenfassung */}
      {step === 4 && !result && (
        <SummaryStep
          items={[
            {
              label: 'Kunde',
              value: selectedKunde ? kundeName(selectedKunde) : '—',
              step: 1,
            },
            {
              label: 'Auftragsnummer',
              value: auftragsnummer,
            },
            {
              label: 'Datum',
              value: format(new Date(), 'dd.MM.yyyy'),
            },
            {
              label: 'Beschreibung',
              value: state.auftragsbeschreibung,
              step: 2,
            },
            {
              label: 'Priorität',
              value: getPrioritaetLabel(state.prioritaet),
              step: 2,
            },
            ...(state.wunschtermin ? [{
              label: 'Wunschtermin',
              value: state.wunschtermin.replace('T', ' '),
              step: 2,
            }] : []),
            ...(state.monteur ? [{
              label: 'Monteur',
              value: state.monteur,
              step: 2,
            }] : []),
            {
              label: 'Positionen',
              value: (
                <ul className="space-y-1">
                  {state.positionen.map((pos, idx) => (
                    <li key={idx} className="text-sm">
                      {getMaterialName(pos.materialId)} — {pos.menge} {getEinheitLabel(pos.einheitKey)}
                      {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                    </li>
                  ))}
                </ul>
              ),
              step: 3,
            },
          ]}
          onEdit={setStep}
          whatHappensNext="Der Auftrag wird mit Status &quot;Offen&quot; angelegt und alle Positionen werden direkt zugewiesen. Der Monteur kann den Auftrag danach abschliessen."
          confirmLabel="Auftrag jetzt anlegen"
          onConfirm={async () => {
            const r = await submit();
            if (r) setStep(5);
          }}
          submitting={submitting}
          error={submitError}
        />
      )}

      {/* Step 5: Fertig */}
      {step === 5 && result && (
        <SuccessStep
          title={`Auftrag ${successData?.auftragsnummer ?? auftragsnummer} angelegt`}
          details={[
            `${state.positionen.length} Position${state.positionen.length !== 1 ? 'en' : ''} hinzugefügt`,
            `Kunde: ${selectedKunde ? kundeName(selectedKunde) : '—'}`,
            'Status „Offen" gesetzt',
            `Priorität: ${getPrioritaetLabel(state.prioritaet)}`,
          ]}
          actions={[
            {
              label: 'Auftrag abschließen',
              href: `#/intents/auftrag-abschliessen?auftragId=${successData?.auftragId ?? ''}`,
            },
            {
              label: 'Weiteren Auftrag anlegen',
              onClick: handleReset,
            },
            {
              label: 'Zum Dashboard',
              href: '#/',
            },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}

// ─── Extracted sub-component (presentational, no data access) ───────────────

interface NewPositionFormProps {
  material: import('@/types/app').Material[];
  posMatId: string;
  setPosMatId: (id: string) => void;
  selectedMaterial: import('@/types/app').Material | null;
  posMenge: string;
  setPosMenge: (v: string) => void;
  posEinheitKey: string;
  setPosEinheitKey: (v: string) => void;
  einheitOptions: { key: string; label: string }[];
  posBeschreibung: string;
  setPosBeschreibung: (v: string) => void;
  posBemerkung: string;
  setPosBemerkung: (v: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}

function NewPositionForm({
  material,
  posMatId,
  setPosMatId,
  selectedMaterial,
  posMenge,
  setPosMenge,
  posEinheitKey,
  setPosEinheitKey,
  einheitOptions,
  posBeschreibung,
  setPosBeschreibung,
  posBemerkung,
  setPosBemerkung,
  onAdd,
  onCancel,
}: NewPositionFormProps) {
  const [matSearch, setMatSearch] = useState('');

  const filtered = material.filter(m => {
    const q = matSearch.toLowerCase();
    return (
      m.fields.bezeichnung?.toLowerCase().includes(q) ||
      m.fields.artikelnummer?.toLowerCase().includes(q)
    );
  });

  const menge = Number(posMenge);
  const lagerbestand = selectedMaterial?.fields.lagerbestand ?? 0;
  const mindestbestand = selectedMaterial?.fields.mindestbestand ?? 0;
  const ueberBestand = menge > lagerbestand;
  const unterMindest = lagerbestand - menge < mindestbestand;

  return (
    <div className="rounded-2xl border border-border p-4 space-y-4 bg-secondary/20">
      <p className="text-sm font-medium">Neue Position</p>

      {/* Material search + select */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Material *</label>
        <Input
          value={matSearch}
          onChange={e => { setMatSearch(e.target.value); setPosMatId(''); }}
          placeholder="Material suchen …"
        />
        {matSearch && !posMatId && (
          <div className="max-h-48 overflow-y-auto rounded-xl border divide-y divide-border bg-card">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3 py-2">Kein Material gefunden</p>
            ) : (
              filtered.map(m => (
                <button
                  key={m.record_id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors"
                  onClick={() => {
                    setPosMatId(m.record_id);
                    setMatSearch(m.fields.bezeichnung ?? m.record_id);
                  }}
                >
                  <p className="text-sm font-medium">{m.fields.bezeichnung}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.fields.artikelnummer ? `Nr. ${m.fields.artikelnummer} · ` : ''}
                    Lager: {m.fields.lagerbestand ?? 0} {m.fields.einheit ? (m.fields.einheit as { label?: string }).label ?? '' : ''}
                  </p>
                </button>
              ))
            )}
          </div>
        )}
        {posMatId && selectedMaterial && (
          <div className="rounded-xl bg-secondary/50 px-3 py-2 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <IconPackage size={14} className="text-muted-foreground shrink-0" />
              <span className="font-medium">{selectedMaterial.fields.bezeichnung}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Lagerbestand: <b>{lagerbestand}</b>
              {selectedMaterial.fields.mindestbestand != null
                ? ` · Mindestbestand: ${mindestbestand}`
                : ''}
            </p>
          </div>
        )}
      </div>

      {/* Menge + Einheit */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium mb-1 block">Menge *</label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={posMenge}
            onChange={e => setPosMenge(e.target.value)}
          />
          {posMatId && ueberBestand && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
              <IconAlertTriangle size={12} />
              Übersteigt den Lagerbestand ({lagerbestand}) — trotzdem möglich.
            </p>
          )}
          {posMatId && !ueberBestand && unterMindest && menge > 0 && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <IconAlertTriangle size={12} />
              Lagerbestand fällt unter Mindestbestand ({mindestbestand}).
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Einheit</label>
          <Select value={posEinheitKey} onValueChange={setPosEinheitKey}>
            <SelectTrigger>
              <SelectValue placeholder="Einheit wählen" />
            </SelectTrigger>
            <SelectContent>
              {einheitOptions.map(opt => (
                <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Optional fields */}
      <div>
        <label className="text-sm font-medium mb-1 block">Positionsbeschreibung (optional)</label>
        <Input
          value={posBeschreibung}
          onChange={e => setPosBeschreibung(e.target.value)}
          placeholder="Kurze Beschreibung der Position"
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Bemerkung (optional)</label>
        <Input
          value={posBemerkung}
          onChange={e => setPosBemerkung(e.target.value)}
          placeholder="Interne Bemerkung"
        />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
        <Button
          disabled={!posMatId || !posMenge || Number(posMenge) <= 0}
          onClick={onAdd}
          className="flex-1"
        >
          Position hinzufügen
        </Button>
      </div>
    </div>
  );
}
