/**
 * @intent PruefprotokollErfassen
 * @description Prüfprotokoll in 4 Schritten erfassen: Auftrag wählen, Monteur & Datum, Prüfergebnis dokumentieren, Abschluss
 *
 * Steps:
 *   1) Auftrag wählen — pick existing order from Auftraege list
 *   2) Monteur & Datum — enter technician name and inspection datetime
 *   3) Prüfergebnis — select result, optionally document defects
 *   4) Abschluss — success summary with reset or back-to-dashboard
 *
 * Reads: auftraege
 * Writes: pruefprotokoll (createPruefprotokollEntry)
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IconClipboardCheck, IconAlertTriangle, IconCircleCheck, IconX } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Auftraege } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']['pruefergebnis'] ?? [];

const NEGATIVE_KEYS = new Set(['nicht_bestanden', 'bestanden_mit_maengeln']);

function isNegativeResult(key: string): boolean {
  return NEGATIVE_KEYS.has(key);
}

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Monteur & Datum' },
  { label: 'Prüfergebnis' },
  { label: 'Abschluss' },
];

export default function PruefprotokollErfassenPage() {
  const { auftraege, loading, error, fetchAll } = useDashboardData();
  const [searchParams, setSearchParams] = useSearchParams();

  // Wizard step state — initialized from URL ?step= param
  const [step, setStep] = useState<number>(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    if (urlStep >= 1 && urlStep <= 4) return urlStep;
    return 1;
  });

  // Step 1: Selected Auftrag
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Step 2: Monteur & Datum
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );

  // Step 3: Prüfergebnis
  const [pruefergebnis, setPruefergebnis] = useState('');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 4: Created record id
  const [createdProtokollId, setCreatedProtokollId] = useState<string | null>(null);

  // Deep-link: pre-select an Auftrag from ?auftragId= param
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (auftragId && auftraege.length > 0 && !selectedAuftrag) {
      const found = auftraege.find(a => a.record_id === auftragId);
      if (found) {
        setSelectedAuftrag(found);
        // Skip to step 2 only if currently on step 1
        setStep(prev => (prev === 1 ? 2 : prev));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auftraege]);

  // Sync step to URL
  function goToStep(newStep: number) {
    setStep(newStep);
    const params = new URLSearchParams(searchParams);
    if (newStep > 1) {
      params.set('step', String(newStep));
    } else {
      params.delete('step');
    }
    if (selectedAuftrag) {
      params.set('auftragId', selectedAuftrag.record_id);
    }
    setSearchParams(params, { replace: true });
  }

  function handleAuftragSelect(id: string) {
    const found = auftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    const params = new URLSearchParams(searchParams);
    params.set('auftragId', id);
    params.set('step', '2');
    setSearchParams(params, { replace: true });
    setStep(2);
  }

  async function handleSubmitProtokoll() {
    if (!selectedAuftrag || !pruefergebnis) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: monteurVorname,
        monteur_name_nachname: monteurNachname,
        pruefungsdatum: pruefungsdatum,
        pruefergebnis: pruefergebnis,
        maengelbeschreibung: isNegativeResult(pruefergebnis) ? maengelbeschreibung : undefined,
        massnahmen: isNegativeResult(pruefergebnis) ? massnahmen : undefined,
        bemerkungen_pruef: bemerkungenPruef || undefined,
      });
      setCreatedProtokollId(result.record_id);
      await fetchAll();
      goToStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Speichern des Protokolls');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftrag(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis('');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setCreatedProtokollId(null);
    setSubmitError(null);
    const params = new URLSearchParams();
    setSearchParams(params, { replace: true });
    setStep(1);
  }

  const pruefergebnisLabel =
    PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis;

  const formattedPruefungsdatum = pruefungsdatum
    ? (() => {
        try {
          return format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm');
        } catch {
          return pruefungsdatum;
        }
      })()
    : '–';

  return (
    <IntentWizardShell
      title="Prüfprotokoll erfassen"
      subtitle="Qualitätsprüfung für einen Auftrag dokumentieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={goToStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Auftrag wählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Auftrag wählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle den Auftrag aus, für den du ein Prüfprotokoll erfassen möchtest.
            </p>
          </div>
          <EntitySelectStep
            items={auftraege.map(a => ({
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: a.fields.auftragsbeschreibung
                ? a.fields.auftragsbeschreibung.length > 80
                  ? a.fields.auftragsbeschreibung.slice(0, 80) + '…'
                  : a.fields.auftragsbeschreibung
                : undefined,
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              stats: a.fields.auftragsdatum
                ? [
                    {
                      label: 'Datum',
                      value: (() => {
                        try {
                          return format(new Date(a.fields.auftragsdatum!), 'dd.MM.yyyy');
                        } catch {
                          return a.fields.auftragsdatum!;
                        }
                      })(),
                    },
                  ]
                : undefined,
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            }))}
            onSelect={handleAuftragSelect}
            searchPlaceholder="Auftrag suchen..."
            emptyText="Keine Aufträge gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
          />
        </div>
      )}

      {/* ── Step 2: Monteur & Datum ── */}
      {step === 2 && selectedAuftrag && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Monteur & Datum</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wer hat die Prüfung durchgeführt und wann?
            </p>
          </div>

          {/* Selected Auftrag summary */}
          <div className="rounded-xl border bg-secondary/40 p-4 flex items-start gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <IconClipboardCheck size={18} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </span>
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>
              {selectedAuftrag.fields.auftragsbeschreibung && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {selectedAuftrag.fields.auftragsbeschreibung}
                </p>
              )}
            </div>
          </div>

          {/* Monteur & Datum form */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="monteur-vorname">Vorname Monteur *</Label>
                <Input
                  id="monteur-vorname"
                  value={monteurVorname}
                  onChange={e => setMonteurVorname(e.target.value)}
                  placeholder="z. B. Max"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monteur-nachname">Nachname Monteur *</Label>
                <Input
                  id="monteur-nachname"
                  value={monteurNachname}
                  onChange={e => setMonteurNachname(e.target.value)}
                  placeholder="z. B. Mustermann"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pruefungsdatum">Prüfungsdatum & Uhrzeit *</Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={e => setPruefungsdatum(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => goToStep(1)} className="min-w-0">
              Zurück
            </Button>
            <Button
              onClick={() => goToStep(3)}
              disabled={!monteurVorname.trim() || !monteurNachname.trim() || !pruefungsdatum}
              className="flex-1"
            >
              Weiter zu Schritt 3
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Prüfergebnis ── */}
      {step === 3 && selectedAuftrag && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Prüfergebnis</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Dokumentiere das Ergebnis der Qualitätsprüfung.
            </p>
          </div>

          {/* Prüfergebnis tile-style radio */}
          <div className="space-y-2">
            <Label>Prüfergebnis *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRUEFERGEBNIS_OPTIONS.map(option => {
                const isSelected = pruefergebnis === option.key;
                const isNegative = isNegativeResult(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setPruefergebnis(option.key)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center w-full ${
                      isSelected
                        ? isNegative
                          ? 'border-red-400 bg-red-50 text-red-700'
                          : option.key === 'bestanden_mit_maengeln'
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-green-400 bg-green-50 text-green-700'
                        : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-secondary/50'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute top-2 right-2">
                        <IconCircleCheck size={16} className={isNegative ? 'text-red-500' : option.key === 'bestanden_mit_maengeln' ? 'text-amber-500' : 'text-green-500'} />
                      </span>
                    )}
                    {option.key === 'bestanden' && (
                      <IconCircleCheck size={28} stroke={1.5} className={isSelected ? 'text-green-500' : 'text-muted-foreground/50'} />
                    )}
                    {option.key === 'bestanden_mit_maengeln' && (
                      <IconAlertTriangle size={28} stroke={1.5} className={isSelected ? 'text-amber-500' : 'text-muted-foreground/50'} />
                    )}
                    {option.key === 'nicht_bestanden' && (
                      <IconX size={28} stroke={1.5} className={isSelected ? 'text-red-500' : 'text-muted-foreground/50'} />
                    )}
                    <span className="text-sm font-medium leading-tight">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional fields for negative results */}
          {pruefergebnis && isNegativeResult(pruefergebnis) && (
            <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                <IconAlertTriangle size={15} className="shrink-0" />
                Mängel dokumentieren
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={e => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibe die festgestellten Mängel..."
                  rows={3}
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Welche Maßnahmen wurden eingeleitet oder sind erforderlich?"
                  rows={3}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Optional remarks */}
          <div className="space-y-1.5">
            <Label htmlFor="bemerkungen-pruef">Bemerkungen (optional)</Label>
            <Textarea
              id="bemerkungen-pruef"
              value={bemerkungenPruef}
              onChange={e => setBemerkungenPruef(e.target.value)}
              placeholder="Weitere Anmerkungen zur Prüfung..."
              rows={2}
              className="w-full"
            />
          </div>

          {submitError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => goToStep(2)} disabled={submitting} className="min-w-0">
              Zurück
            </Button>
            <Button
              onClick={handleSubmitProtokoll}
              disabled={!pruefergebnis || submitting}
              className="flex-1"
            >
              {submitting ? 'Wird gespeichert…' : 'Protokoll speichern'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Abschluss ── */}
      {step === 4 && selectedAuftrag && (
        <div className="space-y-6">
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
              <IconCircleCheck size={30} className="text-green-600" stroke={1.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Protokoll gespeichert!</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Das Prüfprotokoll wurde erfolgreich angelegt.
                {createdProtokollId && (
                  <span className="block text-xs text-muted-foreground/70 mt-0.5">
                    ID: {createdProtokollId.slice(-8)}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Summary card */}
          <div className="rounded-2xl border bg-card overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b bg-secondary/30">
              <h3 className="text-sm font-semibold text-foreground">Zusammenfassung</h3>
            </div>
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Auftrag</span>
                <span className="text-sm font-medium text-right truncate min-w-0">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Monteur</span>
                <span className="text-sm font-medium text-right truncate min-w-0">
                  {monteurVorname} {monteurNachname}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Prüfungsdatum</span>
                <span className="text-sm font-medium text-right min-w-0">
                  {formattedPruefungsdatum}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Prüfergebnis</span>
                <StatusBadge
                  statusKey={pruefergebnis}
                  label={pruefergebnisLabel}
                />
              </div>
              {pruefergebnis && isNegativeResult(pruefergebnis) && maengelbeschreibung && (
                <div className="px-4 py-3 gap-2">
                  <p className="text-sm text-muted-foreground mb-1">Mängel</p>
                  <p className="text-sm text-foreground">{maengelbeschreibung}</p>
                </div>
              )}
              {pruefergebnis && isNegativeResult(pruefergebnis) && massnahmen && (
                <div className="px-4 py-3 gap-2">
                  <p className="text-sm text-muted-foreground mb-1">Maßnahmen</p>
                  <p className="text-sm text-foreground">{massnahmen}</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleReset} variant="outline" className="flex-1">
              Neues Protokoll erfassen
            </Button>
            <a href="#/" className="flex-1">
              <Button className="w-full">
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
