/**
 * Neuer Auftrag — 4-Schritt-Wizard.
 * Steps: 1) Kunde wählen → 2) Auftragsdaten erfassen → 3) Positionen hinzufügen → 4) Prüfen & Anlegen → 5) Fertig.
 * Reads: kunden, material, auftraege, auftragspositionen.
 * Writes: auftraege (createAuftraegeEntry), auftragspositionen (createAuftragspositionenEntry, mehrere).
 * Composes: IntentWizardShell, EntitySelectStep, SummaryStep, SuccessStep.
 */
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useIntentSubmit } from '@/hooks/useIntentSubmit';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Kunden, Material } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { undoToast } from '@/lib/polish';
import { lookupKey, formatDateTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconAlertTriangle, IconInfoCircle, IconPlus, IconTrash, IconUser } from '@tabler/icons-react';

const DRAFT_KEY = 'intent:neuer-auftrag';

const PRIORITAET_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['prioritaet'] ?? [];
const EINHEIT_OPTIONS = LOOKUP_OPTIONS['auftragspositionen']?.['einheit_position'] ?? [];

interface PositionDraft {
  materialId: string;
  mengeStr: string;
  einheitKey: string;
  positionsbeschreibung: string;
}

interface WizardState {
  kundeId: string;
  beschreibung: string;
  prioritaet: string;
  wunschtermin: string;
  monteur: string;
  positionen: PositionDraft[];
}

const INITIAL_STATE: WizardState = {
  kundeId: '',
  beschreibung: '',
  prioritaet: PRIORITAET_OPTIONS[1]?.key ?? '',
  wunschtermin: '',
  monteur: '',
  positionen: [],
};

function kundeName(k: Kunden): string {
  const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
  if (k.fields.firma) return k.fields.firma + (parts ? ` (${parts})` : '');
  return parts || k.record_id;
}

function materialName(m: Material): string {
  return m.fields.bezeichnung ?? m.record_id;
}

export default function NeuerAuftragPage() {
  const { kunden, material, auftraege, fetchAll, loading, error } = useDashboardData();

  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Neue-Kunden-Formular
  const [showNewKunde, setShowNewKunde] = useState(false);
  const [newVorname, setNewVorname] = useState('');
  const [newNachname, setNewNachname] = useState('');
  const [newFirma, setNewFirma] = useState('');
  const [newTelefon, setNewTelefon] = useState('');
  const [creatingKunde, setCreatingKunde] = useState(false);

  // Positions-Zwischenformular
  const [newMatId, setNewMatId] = useState('');
  const [newMengeStr, setNewMengeStr] = useState('1');
  const [newEinheitKey, setNewEinheitKey] = useState(EINHEIT_OPTIONS[0]?.key ?? '');
  const [newPosBeschr, setNewPosBeschr] = useState('');

  // Retry-Idempotenz: gespeicherte IDs
  const [savedAuftragId, setSavedAuftragId] = useState<string | null>(null);

  const { submit, submitting, error: submitError, result, reset } = useIntentSubmit(async () => {
    const selectedKunde = kunden.find(k => k.record_id === state.kundeId)!;
    const heute = format(new Date(), 'yyyy-MM-dd');
    const nummer = `AU-${heute}-${String(auftraege.length + 1).padStart(3, '0')}`;

    // Idempotenz: Auftrag nur anlegen wenn noch nicht geschehen
    let auftragId = savedAuftragId;
    if (!auftragId) {
      const auftrag = await LivingAppsService.createAuftraegeEntry({
        auftragsnummer: nummer,
        auftragsdatum: heute,
        status: 'offen',
        kunde: createRecordUrl(APP_IDS.KUNDEN, selectedKunde.record_id),
        auftragsbeschreibung: state.beschreibung,
        prioritaet: state.prioritaet || undefined,
        wunschtermin: state.wunschtermin || undefined,
        monteur: state.monteur || undefined,
      });
      auftragId = auftrag.record_id;
      setSavedAuftragId(auftragId);
    }

    // Positionen anlegen
    for (const pos of state.positionen) {
      const menge = parseFloat(pos.mengeStr);
      await LivingAppsService.createAuftragspositionenEntry({
        auftrag: createRecordUrl(APP_IDS.AUFTRAEGE, auftragId),
        material: createRecordUrl(APP_IDS.MATERIAL, pos.materialId),
        menge: isNaN(menge) ? 1 : menge,
        einheit_position: pos.einheitKey !== 'none' ? pos.einheitKey : undefined,
        positionsbeschreibung: pos.positionsbeschreibung || undefined,
      });
    }

    await fetchAll();
    return { auftragId, nummer, kundeName: kundeName(selectedKunde), posCount: state.positionen.length };
  }, { draftKey: DRAFT_KEY });

  // Abgeleitete Werte
  const heute = format(new Date(), 'yyyy-MM-dd');
  const auftragsnummer = `AU-${heute}-${String(auftraege.length + 1).padStart(3, '0')}`;

  const selectedKunde = useMemo(
    () => kunden.find(k => k.record_id === state.kundeId) ?? null,
    [kunden, state.kundeId]
  );

  // Verfügbares Material (nicht 'nicht_verfuegbar')
  const verfuegbaresMaterial = useMemo(
    () => material.filter(m => {
      const key = lookupKey(m.fields.verfuegbarkeit);
      return key !== 'nicht_verfuegbar';
    }),
    [material]
  );

  const selectedMaterial = useMemo(
    () => newMatId ? material.find(m => m.record_id === newMatId) ?? null : null,
    [material, newMatId]
  );

  function resetWizard() {
    setState(INITIAL_STATE);
    setStep(1);
    setShowNewKunde(false);
    setNewVorname(''); setNewNachname(''); setNewFirma(''); setNewTelefon('');
    setNewMatId(''); setNewMengeStr('1'); setNewEinheitKey(EINHEIT_OPTIONS[0]?.key ?? ''); setNewPosBeschr('');
    setSavedAuftragId(null);
    reset();
  }

  function addPosition() {
    if (!newMatId) return;
    const pos: PositionDraft = {
      materialId: newMatId,
      mengeStr: newMengeStr,
      einheitKey: newEinheitKey,
      positionsbeschreibung: newPosBeschr,
    };
    setState(s => ({ ...s, positionen: [...s.positionen, pos] }));
    setNewMatId('');
    setNewMengeStr('1');
    setNewEinheitKey(EINHEIT_OPTIONS[0]?.key ?? '');
    setNewPosBeschr('');
  }

  function removePosition(idx: number) {
    const removed = state.positionen[idx];
    const mat = material.find(m => m.record_id === removed.materialId);
    setState(s => ({ ...s, positionen: s.positionen.filter((_, i) => i !== idx) }));
    undoToast(
      `Position "${mat ? materialName(mat) : 'Unbekannt'}" entfernt`,
      () => setState(s => ({ ...s, positionen: [...s.positionen.slice(0, idx), removed, ...s.positionen.slice(idx)] }))
    );
  }

  const missingFields: string[] = [];
  if (!state.beschreibung.trim()) missingFields.push('Auftragsbeschreibung');

  const steps = [
    { label: 'Kunde' },
    { label: 'Auftrag' },
    { label: 'Positionen' },
    { label: 'Prüfen' },
    { label: 'Fertig' },
  ];

  return (
    <IntentWizardShell
      title="Neuer Auftrag"
      subtitle="Kunde wählen, Auftrag erfassen und Positionen hinzufügen"
      steps={steps}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
      intro={{
        description: 'Legt einen neuen Auftrag an, verknüpft ihn mit einem Kunden und fügt beliebig viele Materialpositionen hinzu.',
        requirements: ['Kundendaten', 'Auftragsbeschreibung', 'Gewünschtes Material'],
      }}
      answers={
        step > 1 && selectedKunde
          ? [{ label: 'Kunde', value: kundeName(selectedKunde) }]
          : undefined
      }
      draftKey={DRAFT_KEY}
      draft={state}
      onDraftRestore={(d) => setState(d as WizardState)}
    >
      {/* Schritt 1: Kunde wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={kunden.map(k => ({
            id: k.record_id,
            title: kundeName(k),
            subtitle: [k.fields.telefon, k.fields.email].filter(Boolean).join(' · ') || undefined,
            icon: <IconUser size={20} className="text-primary" />,
            stats: [
              {
                label: 'Aufträge',
                value: auftraege.filter(a => extractRecordId(a.fields.kunde) === k.record_id).length,
              },
            ],
          }))}
          onSelect={(id) => {
            setState(s => ({ ...s, kundeId: id }));
            setStep(2);
          }}
          searchPlaceholder="Nach Vorname, Nachname oder Firma suchen …"
          createLabel="Neuen Kunden anlegen"
          onCreateNew={() => setShowNewKunde(true)}
          createDialog={
            showNewKunde ? (
              <div className="rounded-2xl border bg-card p-4 space-y-3">
                <p className="text-sm font-medium">Neuen Kunden anlegen</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newVorname}
                    onChange={e => setNewVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                  <Input
                    value={newNachname}
                    onChange={e => setNewNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
                <Input
                  value={newFirma}
                  onChange={e => setNewFirma(e.target.value)}
                  placeholder="Firma (optional)"
                />
                <Input
                  value={newTelefon}
                  onChange={e => setNewTelefon(e.target.value)}
                  placeholder="Telefon (optional)"
                  type="tel"
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={(!newVorname.trim() && !newNachname.trim() && !newFirma.trim()) || creatingKunde}
                    onClick={async () => {
                      setCreatingKunde(true);
                      try {
                        const created = await LivingAppsService.createKundenEntry({
                          vorname: newVorname.trim() || undefined,
                          nachname: newNachname.trim() || undefined,
                          firma: newFirma.trim() || undefined,
                          telefon: newTelefon.trim() || undefined,
                        });
                        await fetchAll();
                        setShowNewKunde(false);
                        setNewVorname(''); setNewNachname(''); setNewFirma(''); setNewTelefon('');
                        setState(s => ({ ...s, kundeId: created.record_id }));
                        setStep(2);
                      } finally {
                        setCreatingKunde(false);
                      }
                    }}
                  >
                    {creatingKunde ? 'Wird angelegt …' : 'Anlegen & auswählen'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowNewKunde(false)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : undefined
          }
        />
      )}

      {/* Schritt 2: Auftragsdaten erfassen */}
      {step === 2 && (
        <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-5">
          {selectedKunde ? (
            <h2 className="text-lg font-semibold">
              Auftrag für {kundeName(selectedKunde)} erfassen
            </h2>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Kein Kunde ausgewählt.</p>
              <Button variant="outline" onClick={() => setStep(1)}>Zurück zu Schritt 1</Button>
            </div>
          )}

          {selectedKunde && (
            <>
              <div className="rounded-xl bg-secondary/50 px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                <span>Auftragsnummer:</span>
                <span className="font-medium text-foreground">{auftragsnummer}</span>
                <span className="mx-2">·</span>
                <span>Datum:</span>
                <span className="font-medium text-foreground">{heute}</span>
                <span className="mx-2">·</span>
                <span>Status:</span>
                <span className="font-medium text-foreground">Offen</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Auftragsbeschreibung <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={state.beschreibung}
                  onChange={e => setState(s => ({ ...s, beschreibung: e.target.value }))}
                  placeholder="Was ist zu tun?"
                  rows={3}
                  className="min-w-0 w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priorität</label>
                <div className="flex flex-wrap gap-2">
                  {PRIORITAET_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setState(s => ({ ...s, prioritaet: opt.key }))}
                      className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                        state.prioritaet === opt.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border text-foreground hover:border-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Wunschtermin</label>
                  <Input
                    type="datetime-local"
                    value={state.wunschtermin}
                    onChange={e => setState(s => ({ ...s, wunschtermin: e.target.value }))}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Monteur</label>
                  <Input
                    value={state.monteur}
                    onChange={e => setState(s => ({ ...s, monteur: e.target.value }))}
                    placeholder="Name des Monteurs"
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  className="flex-1 h-12"
                  disabled={!state.beschreibung.trim()}
                  onClick={() => setStep(3)}
                >
                  Weiter zu Positionen
                </Button>
                <Button variant="outline" onClick={() => setStep(1)}>
                  Zurück
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Schritt 3: Positionen hinzufügen */}
      {step === 3 && (
        <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-5">
          <h2 className="text-lg font-semibold">
            Positionen für {selectedKunde ? kundeName(selectedKunde) : 'den Auftrag'} hinzufügen
          </h2>

          {/* Bereits hinzugefügte Positionen */}
          {state.positionen.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                {state.positionen.length} {state.positionen.length === 1 ? 'Position' : 'Positionen'} hinzugefügt
              </p>
              <div className="space-y-2">
                {state.positionen.map((pos, idx) => {
                  const mat = material.find(m => m.record_id === pos.materialId);
                  const einheitLabel = EINHEIT_OPTIONS.find(o => o.key === pos.einheitKey)?.label ?? pos.einheitKey;
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 rounded-xl border bg-secondary/30 p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mat ? materialName(mat) : pos.materialId}</p>
                        <p className="text-xs text-muted-foreground">
                          {pos.mengeStr} {einheitLabel}
                          {pos.positionsbeschreibung ? ` · ${pos.positionsbeschreibung}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePosition(idx)}
                        className="text-muted-foreground hover:text-destructive p-1 rounded-lg flex-shrink-0"
                        aria-label="Position entfernen"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Neue Position hinzufügen */}
          <div className="rounded-2xl border p-4 space-y-3">
            <p className="text-sm font-medium">Neue Position</p>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Material <span className="text-destructive">*</span></label>
              <Select value={newMatId} onValueChange={setNewMatId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Material auswählen …" />
                </SelectTrigger>
                <SelectContent>
                  {verfuegbaresMaterial.map(m => (
                    <SelectItem key={m.record_id} value={m.record_id}>
                      {materialName(m)}
                      {m.fields.artikelnummer ? ` [${m.fields.artikelnummer}]` : ''}
                      {' · '}
                      {lookupKey(m.fields.verfuegbarkeit) === 'auf_bestellung' ? 'Auf Bestellung' : `${m.fields.lagerbestand ?? 0} auf Lager`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Lagerbestand-Info und Warnungen */}
            {selectedMaterial && (
              <div className="rounded-xl bg-secondary/50 p-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Lagerbestand:</span>
                  <span className="font-medium">{selectedMaterial.fields.lagerbestand ?? 0} {LOOKUP_OPTIONS['material']?.['einheit']?.find(o => o.key === lookupKey(selectedMaterial.fields.einheit))?.label ?? ''}</span>
                </div>
                {selectedMaterial.fields.mindestbestand != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Mindestbestand:</span>
                    <span className="font-medium">{selectedMaterial.fields.mindestbestand}</span>
                  </div>
                )}
                {lookupKey(selectedMaterial.fields.verfuegbarkeit) === 'auf_bestellung' && (
                  <div className="flex items-center gap-1.5 text-amber-600">
                    <IconInfoCircle size={14} />
                    <span className="text-xs">Artikel nur auf Bestellung verfügbar</span>
                  </div>
                )}
                {lookupKey(selectedMaterial.fields.verfuegbarkeit) === 'verfuegbar' &&
                  parseFloat(newMengeStr) > (selectedMaterial.fields.lagerbestand ?? 0) && (
                  <div className="flex items-center gap-1.5 text-destructive">
                    <IconAlertTriangle size={14} />
                    <span className="text-xs">
                      Gewünschte Menge übersteigt den Lagerbestand — trotzdem möglich.
                    </span>
                  </div>
                )}
                {selectedMaterial.fields.mindestbestand != null &&
                  selectedMaterial.fields.lagerbestand != null &&
                  (selectedMaterial.fields.lagerbestand - parseFloat(newMengeStr || '0')) < selectedMaterial.fields.mindestbestand && (
                  <div className="flex items-center gap-1.5 text-amber-600">
                    <IconAlertTriangle size={14} />
                    <span className="text-xs">
                      Lagerbestand fällt nach Entnahme unter den Mindestbestand ({selectedMaterial.fields.mindestbestand}).
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Menge <span className="text-destructive">*</span></label>
                <Input
                  type="number"
                  min="0.01"
                  step="any"
                  value={newMengeStr}
                  onChange={e => setNewMengeStr(e.target.value)}
                  placeholder="1"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Einheit</label>
                <Select value={newEinheitKey} onValueChange={setNewEinheitKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EINHEIT_OPTIONS.map(opt => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Positionsbeschreibung</label>
              <Input
                value={newPosBeschr}
                onChange={e => setNewPosBeschr(e.target.value)}
                placeholder="Kurze Beschreibung dieser Position (optional)"
              />
            </div>

            <Button
              className="w-full"
              variant="outline"
              disabled={!newMatId || !newMengeStr || parseFloat(newMengeStr) <= 0}
              onClick={addPosition}
            >
              <IconPlus size={16} className="mr-1.5" />
              Position hinzufügen
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              className="flex-1 h-12"
              onClick={() => setStep(4)}
            >
              Weiter zur Prüfung
            </Button>
            <Button variant="outline" onClick={() => setStep(2)}>
              Zurück
            </Button>
          </div>
        </div>
      )}

      {/* Schritt 4: SummaryStep */}
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
              label: 'Beschreibung',
              value: state.beschreibung || '—',
              step: 2,
            },
            {
              label: 'Priorität',
              value: (PRIORITAET_OPTIONS.find(o => o.key === state.prioritaet)?.label ?? state.prioritaet) || '—',
              step: 2,
            },
            ...(state.wunschtermin ? [{
              label: 'Wunschtermin',
              value: formatDateTime(state.wunschtermin),
              step: 2,
            }] : []),
            ...(state.monteur ? [{
              label: 'Monteur',
              value: state.monteur,
              step: 2,
            }] : []),
            {
              label: 'Positionen',
              value: state.positionen.length === 0
                ? 'Keine (Auftrag ohne Positionen)'
                : `${state.positionen.length} ${state.positionen.length === 1 ? 'Position' : 'Positionen'}`,
              step: 3,
            },
            ...(state.positionen.length > 0 ? state.positionen.map((pos, idx) => {
              const mat = material.find(m => m.record_id === pos.materialId);
              const einheitLabel = EINHEIT_OPTIONS.find(o => o.key === pos.einheitKey)?.label ?? pos.einheitKey;
              return {
                label: `Position ${idx + 1}`,
                value: `${mat ? materialName(mat) : pos.materialId} · ${pos.mengeStr} ${einheitLabel}`,
                step: 3,
              };
            }) : []),
          ]}
          onEdit={setStep}
          whatHappensNext="Der Auftrag wird mit Status 'Offen' angelegt und kann anschliessend direkt geprueft und abgeschlossen werden."
          confirmLabel="Auftrag anlegen"
          onConfirm={async () => {
            const r = await submit();
            if (r) setStep(5);
          }}
          submitting={submitting}
          missing={missingFields}
          error={submitError}
        />
      )}

      {/* Schritt 5: Fertig */}
      {step === 5 && result && (
        <SuccessStep
          title={`Auftrag ${result.nummer} angelegt`}
          details={[
            `Kunde: ${result.kundeName}`,
            result.posCount > 0
              ? `${result.posCount} ${result.posCount === 1 ? 'Position' : 'Positionen'} hinzugefügt`
              : 'Ohne Positionen angelegt — können jederzeit ergänzt werden',
            'Status auf „Offen" gesetzt',
          ]}
          actions={[
            {
              label: 'Auftrag prüfen & abschließen',
              href: `#/intents/auftrag-abschliessen?auftragId=${result.auftragId}`,
            },
            {
              label: 'Weiteren Auftrag anlegen',
              onClick: resetWizard,
            },
            {
              label: 'Zurück zum Dashboard',
              href: '#/',
            },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
