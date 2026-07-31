/**
 * Intent: Auftrag abschließen
 * Workflow: Auftrag auswählen → Prüfdaten erfassen → Protokoll erstellen → Abgeschlossen
 * Steps: 1) Auftrag wählen → 2) Prüfdaten erfassen → 3) Prüfprotokoll erstellen & Status setzen → 4) Abgeschlossen
 * Reads: auftraege. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  IconClipboardCheck,
  IconCheck,
  IconAlertTriangle,
  IconArrowRight,
  IconArrowLeft,
  IconCircleCheck,
  IconFileDescription,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Auftraege } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];
const AUFTRAEGE_STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];

// Pick the "most completed" status as default: last in the list or one named "abgeschlossen"
const DEFAULT_ABSCHLUSS_STATUS =
  AUFTRAEGE_STATUS_OPTIONS.find(o => o.key === 'abgeschlossen')?.key ??
  AUFTRAEGE_STATUS_OPTIONS[AUFTRAEGE_STATUS_OPTIONS.length - 1]?.key ??
  '';

function getPruefergebnisStyle(key: string): string {
  if (key === 'bestanden') return 'border-green-400 bg-green-50 text-green-800 ring-green-400';
  if (key === 'nicht_bestanden') return 'border-red-400 bg-red-50 text-red-800 ring-red-400';
  return 'border-amber-400 bg-amber-50 text-amber-800 ring-amber-400';
}

function getPruefergebnisIcon(key: string) {
  if (key === 'bestanden') return <IconCheck size={18} className="text-green-600" />;
  if (key === 'nicht_bestanden') return <IconAlertTriangle size={18} className="text-red-600" />;
  return <IconAlertTriangle size={18} className="text-amber-600" />;
}

function hasMaengel(key: string): boolean {
  return key !== 'bestanden' && key !== '';
}

export default function AuftragAbschliessenPage() {
  const { auftraege, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Step state (1-based)
  const [step, setStep] = useState(1);

  // Step 1: selected Auftrag
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Step 2: Prüfdaten form state
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');

  // Step 3: action state
  const [abschlussStatus, setAbschlussStatus] = useState(DEFAULT_ABSCHLUSS_STATUS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdProtokollId, setCreatedProtokollId] = useState<string | null>(null);

  // Deep-link: if ?auftragId=xxx, pre-select and advance to step 2
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (!auftragId || auftraege.length === 0) return;
    const found = auftraege.find(a => a.record_id === auftragId);
    if (found && !selectedAuftrag) {
      setSelectedAuftrag(found);
      // Prefill monteur from auftrag
      const monteur = found.fields.monteur ?? '';
      const parts = monteur.split(' ');
      setMonteurVorname(parts[0] ?? '');
      setMonteurNachname(parts.slice(1).join(' '));
      setStep(2);
    }
  }, [auftraege, searchParams, selectedAuftrag]);

  // Prefill monteur fields when auftrag is selected
  const handleSelectAuftrag = useCallback((id: string) => {
    const auftrag = auftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(auftrag);
    if (auftrag) {
      const monteur = auftrag.fields.monteur ?? '';
      const parts = monteur.trim().split(/\s+/);
      setMonteurVorname(parts[0] ?? '');
      setMonteurNachname(parts.slice(1).join(' '));
    }
    setStep(2);
  }, [auftraege]);

  const handleSubmit = async () => {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: monteurVorname,
        monteur_name_nachname: monteurNachname,
        pruefungsdatum: pruefungsdatum,
        pruefergebnis: pruefergebnis,
        maengelbeschreibung: hasMaengel(pruefergebnis) ? maengelbeschreibung : undefined,
        massnahmen: massnahmen || undefined,
        bemerkungen_pruef: bemerkungenPruef || undefined,
      });
      setCreatedProtokollId(result.record_id);

      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: abschlussStatus,
      });

      await fetchAll();
      setStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftrag(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setAbschlussStatus(DEFAULT_ABSCHLUSS_STATUS);
    setSubmitError(null);
    setCreatedProtokollId(null);
    setStep(1);
  };

  const pruefStep2Valid =
    monteurVorname.trim() !== '' &&
    monteurNachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnis !== '';

  const abschlussStatusOption = AUFTRAEGE_STATUS_OPTIONS.find(o => o.key === abschlussStatus);

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag als abgeschlossen markieren"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfdaten' },
        { label: 'Abschließen' },
        { label: 'Fertig' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* STEP 1: Auftrag wählen */}
      {step === 1 && (
        <div className="space-y-4">
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
              stats: a.fields.monteur ? [{ label: 'Monteur', value: a.fields.monteur }] : [],
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectAuftrag}
            searchPlaceholder="Auftrag suchen..."
            emptyText="Keine Aufträge gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
          />
        </div>
      )}

      {/* STEP 2: Prüfdaten erfassen */}
      {step === 2 && selectedAuftrag && (
        <div className="space-y-6">
          {/* Context card */}
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">Ausgewählter Auftrag</p>
                  <p className="font-semibold text-foreground truncate">
                    {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                  </p>
                  {selectedAuftrag.fields.auftragsbeschreibung && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      {selectedAuftrag.fields.auftragsbeschreibung}
                    </p>
                  )}
                  {selectedAuftrag.fields.monteur && (
                    <p className="text-xs text-muted-foreground mt-1">Monteur: {selectedAuftrag.fields.monteur}</p>
                  )}
                </div>
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Mini-form */}
          <div className="space-y-5">
            <h2 className="font-semibold text-foreground">Prüfdaten erfassen</h2>

            {/* Monteur name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="monteur-vorname">
                  Vorname Monteur <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="monteur-vorname"
                  value={monteurVorname}
                  onChange={e => setMonteurVorname(e.target.value)}
                  placeholder="Vorname"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monteur-nachname">
                  Nachname Monteur <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="monteur-nachname"
                  value={monteurNachname}
                  onChange={e => setMonteurNachname(e.target.value)}
                  placeholder="Nachname"
                />
              </div>
            </div>

            {/* Prüfungsdatum */}
            <div className="space-y-1.5">
              <Label htmlFor="pruefungsdatum">
                Prüfungsdatum & Uhrzeit <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pruefungsdatum"
                type="datetime-local"
                value={pruefungsdatum}
                onChange={e => setPruefungsdatum(e.target.value)}
                className="max-w-sm"
              />
            </div>

            {/* Prüfergebnis — tile-style radio */}
            <div className="space-y-2">
              <Label>
                Prüfergebnis <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRUEFERGEBNIS_OPTIONS.map(option => {
                  const isSelected = pruefergebnis === option.key;
                  const style = getPruefergebnisStyle(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setPruefergebnis(option.key)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left w-full ${
                        isSelected
                          ? `${style} ring-2`
                          : 'border-border bg-card hover:bg-accent text-foreground'
                      }`}
                    >
                      <span className="shrink-0">{getPruefergebnisIcon(option.key)}</span>
                      <span className="font-medium text-sm">{option.label}</span>
                      {isSelected && (
                        <IconCheck size={14} className="ml-auto shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mängelbeschreibung — only when there are issues */}
            {hasMaengel(pruefergebnis) && (
              <div className="space-y-1.5">
                <Label htmlFor="maengelbeschreibung">Mängelbeschreibung</Label>
                <Textarea
                  id="maengelbeschreibung"
                  value={maengelbeschreibung}
                  onChange={e => setMaengelbeschreibung(e.target.value)}
                  placeholder="Beschreibe die festgestellten Mängel..."
                  rows={3}
                />
              </div>
            )}

            {/* Maßnahmen */}
            <div className="space-y-1.5">
              <Label htmlFor="massnahmen">Maßnahmen</Label>
              <Textarea
                id="massnahmen"
                value={massnahmen}
                onChange={e => setMassnahmen(e.target.value)}
                placeholder="Welche Maßnahmen wurden ergriffen oder sind geplant?"
                rows={3}
              />
            </div>

            {/* Bemerkungen */}
            <div className="space-y-1.5">
              <Label htmlFor="bemerkungen">Bemerkungen</Label>
              <Textarea
                id="bemerkungen"
                value={bemerkungenPruef}
                onChange={e => setBemerkungenPruef(e.target.value)}
                placeholder="Weitere Bemerkungen (optional)"
                rows={2}
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              <IconArrowLeft size={16} className="mr-1.5" />
              Zurück
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={!pruefStep2Valid}
              className="gap-1.5"
            >
              Weiter zur Bestätigung
              <IconArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Bestätigen & Abschließen */}
      {step === 3 && selectedAuftrag && (
        <div className="space-y-6">
          <div>
            <h2 className="font-semibold text-foreground text-lg">Prüfprotokoll erstellen & Auftrag abschließen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Überprüfe alle Angaben und schließe den Auftrag ab.
            </p>
          </div>

          {/* Summary */}
          <Card className="overflow-hidden">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b">
                <IconFileDescription size={18} className="text-primary shrink-0" />
                <span className="font-semibold text-foreground">
                  Prüfprotokoll für Auftrag{' '}
                  {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Monteur</p>
                  <p className="font-medium">{monteurVorname} {monteurNachname}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Prüfungsdatum</p>
                  <p className="font-medium">
                    {pruefungsdatum
                      ? format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm') + ' Uhr'
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Prüfergebnis</p>
                  <div className="mt-0.5">
                    <StatusBadge
                      statusKey={pruefergebnis}
                      label={PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                    />
                  </div>
                </div>
                {hasMaengel(pruefergebnis) && maengelbeschreibung && (
                  <div className="sm:col-span-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Mängelbeschreibung</p>
                    <p className="font-medium">{maengelbeschreibung}</p>
                  </div>
                )}
                {massnahmen && (
                  <div className="sm:col-span-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Maßnahmen</p>
                    <p className="font-medium">{massnahmen}</p>
                  </div>
                )}
                {bemerkungenPruef && (
                  <div className="sm:col-span-2">
                    <p className="text-muted-foreground text-xs mb-0.5">Bemerkungen</p>
                    <p className="font-medium">{bemerkungenPruef}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status selector */}
          <div className="space-y-2">
            <Label className="font-semibold">Status nach Abschluss</Label>
            <div className="flex flex-wrap gap-2">
              {AUFTRAEGE_STATUS_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setAbschlussStatus(option.key)}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    abschlussStatus === option.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {abschlussStatusOption && (
              <p className="text-xs text-muted-foreground">
                Auftrag wird auf "<strong>{abschlussStatusOption.label}</strong>" gesetzt.
              </p>
            )}
          </div>

          {/* Error */}
          {submitError && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
              <IconAlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Fehler beim Abschließen</p>
                <p className="text-xs text-destructive/80 mt-0.5">{submitError}</p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
              <IconArrowLeft size={16} className="mr-1.5" />
              Zurück
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !abschlussStatus}
              className="gap-1.5"
            >
              {submitting ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Wird gespeichert...
                </>
              ) : (
                <>
                  <IconCircleCheck size={16} />
                  Jetzt abschließen
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Abgeschlossen */}
      {step === 4 && selectedAuftrag && (
        <div className="space-y-6 text-center py-8">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <IconCheck size={36} className="text-green-600" stroke={2.5} />
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">Auftrag erfolgreich abgeschlossen!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Das Prüfprotokoll wurde erstellt und der Auftragsstatus aktualisiert.
            </p>
          </div>

          {/* Done summary */}
          <Card className="overflow-hidden text-left max-w-md mx-auto">
            <CardContent className="p-5 space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <IconCheck size={14} className="text-green-600" stroke={2.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Prüfprotokoll erstellt</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {monteurVorname} {monteurNachname} ·{' '}
                      {pruefungsdatum ? format(new Date(pruefungsdatum), 'dd.MM.yyyy HH:mm') + ' Uhr' : ''}
                    </p>
                    <div className="mt-1">
                      <StatusBadge
                        statusKey={pruefergebnis}
                        label={PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                      />
                    </div>
                    {createdProtokollId && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono">ID: {createdProtokollId.slice(-8)}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <IconCheck size={14} className="text-green-600" stroke={2.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Auftrag {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)} aktualisiert
                    </p>
                    <div className="mt-1">
                      <StatusBadge
                        statusKey={abschlussStatus}
                        label={AUFTRAEGE_STATUS_OPTIONS.find(o => o.key === abschlussStatus)?.label ?? abschlussStatus}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button variant="outline" onClick={handleReset} className="gap-1.5">
              <IconClipboardCheck size={16} />
              Weiteren Auftrag abschließen
            </Button>
            <Button onClick={() => navigate('/')} className="gap-1.5">
              <IconArrowRight size={16} />
              Zurück zum Dashboard
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
