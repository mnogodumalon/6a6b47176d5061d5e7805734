/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen → 3) Bestätigen & abschließen.
 * Reads: auftraege, kunden (via kundenMap). Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { IconClipboardCheck, IconCircleCheck, IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { CreatePruefprotokoll } from '@/types/app';
import type { EnrichedAuftraege } from '@/types/enriched';
import { lookupKey, formatDate, formatDateTime } from '@/lib/formatters';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfprotokoll' },
  { label: 'Abschließen' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);

  // Step 1 state
  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);

  // Step 2 state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(() =>
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState('');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 3 idempotency guard — protokollId is set after create to prevent duplicate creation on retry
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Enrich auftraege with kunden name
  const enrichedAuftraege = useMemo<EnrichedAuftraege[]>(() => {
    return auftraege.map(a => {
      let kundeName = '';
      if (a.fields.kunde) {
        const match = a.fields.kunde.match(/([a-f0-9]{24})$/i);
        if (match) {
          const k = kundenMap.get(match[1]);
          if (k) {
            kundeName = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
          }
        }
      }
      return { ...a, kundeName };
    });
  }, [auftraege, kundenMap]);

  // Filter: only offen or in_bearbeitung
  const offeneAuftraege = useMemo(() =>
    enrichedAuftraege.filter(a => {
      const key = lookupKey(a.fields.status);
      return key === 'offen' || key === 'in_bearbeitung';
    }),
    [enrichedAuftraege]
  );

  const showMaengel =
    pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  function handleSelectAuftrag(id: string) {
    const found = offeneAuftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setStep(2);
  }

  function handleResetWizard() {
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis('');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setSubmitting(false);
    setSubmitError(null);
    setProtokollId(null);
    setDone(false);
    setStep(1);
  }

  async function handleAbschliessen() {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency guard: only create Prüfprotokoll if not already created
      let pid = protokollId;
      if (!pid) {
        const fields: CreatePruefprotokoll = {
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname,
          monteur_name_nachname: nachname,
          pruefungsdatum: pruefungsdatum,
          pruefergebnis: pruefergebnis,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungen || undefined,
          maengelbeschreibung: showMaengel && maengelbeschreibung ? maengelbeschreibung : undefined,
        };
        const result = await LivingAppsService.createPruefprotokollEntry(fields);
        pid = result.record_id;
        setProtokollId(pid);
      }
      // Update Auftrag status to abgeschlossen
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, { status: 'abgeschlossen' });
      await fetchAll();
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  const step2Valid =
    vorname.trim() !== '' &&
    nachname.trim() !== '' &&
    pruefungsdatum !== '' &&
    pruefergebnis !== '';

  const pruefergebnisLabel =
    PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag als abgeschlossen markieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* STEP 1: Auftrag wählen */}
      {step === 1 && (
        <EntitySelectStep
          items={offeneAuftraege.map(a => ({
            id: a.record_id,
            title: a.fields.auftragsnummer ?? '(ohne Nummer)',
            subtitle: [
              a.kundeName ? `Kunde: ${a.kundeName}` : null,
              a.fields.auftragsdatum ? `Datum: ${formatDate(a.fields.auftragsdatum)}` : null,
            ].filter(Boolean).join(' · ') || undefined,
            status: a.fields.status
              ? { key: lookupKey(a.fields.status) ?? '', label: String((a.fields.status as { label?: string }).label ?? lookupKey(a.fields.status) ?? '') }
              : undefined,
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftragsnummer oder Kundenname suchen …"
          emptyText="Keine offenen oder laufenden Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} className="text-muted-foreground" />}
        />
      )}

      {/* STEP 2: Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-6">
            {/* Auftrag context card */}
            <div className="rounded-2xl border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">Gewählter Auftrag</p>
                <p className="font-semibold text-foreground truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? '(ohne Nummer)'}
                </p>
                {selectedAuftrag.kundeName && (
                  <p className="text-sm text-muted-foreground truncate">{selectedAuftrag.kundeName}</p>
                )}
              </div>
              {selectedAuftrag.fields.status && (
                <StatusBadge
                  statusKey={lookupKey(selectedAuftrag.fields.status)}
                  label={String((selectedAuftrag.fields.status as { label?: string }).label ?? lookupKey(selectedAuftrag.fields.status) ?? '')}
                />
              )}
            </div>

            {/* Mini-form */}
            <div className="rounded-2xl border bg-card p-5 space-y-5">
              <h2 className="font-semibold text-foreground">Prüfprotokoll erfassen</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname des Monteurs <span className="text-destructive">*</span></Label>
                  <Input
                    id="vorname"
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname des Monteurs <span className="text-destructive">*</span></Label>
                  <Input
                    id="nachname"
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum & -uhrzeit <span className="text-destructive">*</span></Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              <div className="space-y-2">
                <Label>Prüfergebnis <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnis(opt.key)}
                      className={[
                        'rounded-xl border p-3 text-left transition-colors',
                        pruefergebnis === opt.key
                          ? opt.key === 'bestanden'
                            ? 'border-green-500 bg-green-50 text-green-800'
                            : opt.key === 'bestanden_mit_maengeln'
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-red-500 bg-red-50 text-red-800'
                          : 'border-border bg-card text-foreground hover:border-primary/50',
                      ].join(' ')}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {showMaengel && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibe die festgestellten Mängel …"
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="massnahmen">Maßnahmen</Label>
                <Textarea
                  id="massnahmen"
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Geplante oder durchgeführte Maßnahmen …"
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={bemerkungen}
                  onChange={e => setBemerkungen(e.target.value)}
                  placeholder="Weitere Bemerkungen …"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="w-full sm:w-auto"
              >
                Zurück
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!step2Valid}
                className="w-full sm:w-auto"
              >
                Weiter zu Schritt 3
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}

      {/* STEP 3: Bestätigen & abschließen */}
      {step === 3 && (
        selectedAuftrag && pruefergebnis ? (
          done ? (
            <div className="flex flex-col items-center text-center py-12 space-y-5">
              <div className="rounded-full bg-green-50 p-4">
                <IconCircleCheck size={48} className="text-green-600" stroke={1.5} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Auftrag abgeschlossen!</h2>
                <p className="text-muted-foreground mt-1">
                  Auftrag <span className="font-medium">{selectedAuftrag.fields.auftragsnummer}</span> wurde erfolgreich abgeschlossen.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={handleResetWizard} variant="outline">
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/">
                  <Button>Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary card */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-foreground">Zusammenfassung</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Auftragsnummer</dt>
                    <dd className="font-medium text-foreground">
                      {selectedAuftrag.fields.auftragsnummer ?? '—'}
                    </dd>
                  </div>
                  {selectedAuftrag.kundeName && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Kunde</dt>
                      <dd className="font-medium text-foreground">{selectedAuftrag.kundeName}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Monteur</dt>
                    <dd className="font-medium text-foreground">
                      {vorname} {nachname}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Prüfungsdatum</dt>
                    <dd className="font-medium text-foreground">
                      {formatDateTime(pruefungsdatum)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground mb-1">Prüfergebnis</dt>
                    <dd>
                      <span
                        className={[
                          'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium',
                          pruefergebnis === 'bestanden'
                            ? 'bg-green-100 text-green-800'
                            : pruefergebnis === 'bestanden_mit_maengeln'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800',
                        ].join(' ')}
                      >
                        {pruefergebnis === 'bestanden' ? null : (
                          <IconAlertTriangle size={14} className="mr-1" stroke={2} />
                        )}
                        {pruefergebnisLabel}
                      </span>
                    </dd>
                  </div>
                  {showMaengel && maengelbeschreibung && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Mängelbeschreibung</dt>
                      <dd className="text-sm text-foreground mt-0.5">{maengelbeschreibung}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Confirmation notice */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <strong>Bitte bestätigen:</strong> Der Auftrag{' '}
                <span className="font-semibold">{selectedAuftrag.fields.auftragsnummer}</span> wird
                als <span className="font-semibold">Abgeschlossen</span> markiert. Diese Aktion
                kann nicht rückgängig gemacht werden.
              </div>

              {submitError && (
                <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                  <IconAlertTriangle size={16} className="shrink-0 mt-0.5" stroke={2} />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <IconRefresh size={16} className="animate-spin" stroke={2} />
                      Wird abgeschlossen …
                    </span>
                  ) : (
                    'Auftrag abschließen'
                  )}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Eingaben aus den vorherigen Schritten.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
