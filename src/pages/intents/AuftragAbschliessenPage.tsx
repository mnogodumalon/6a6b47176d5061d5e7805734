/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag wählen (nur offen/in_bearbeitung) → 2) Prüfprotokoll erfassen → 3) Bestätigen & Auftrag abschließen.
 * Reads: auftraege, kunden (via kundenMap for enrichment). Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 * Deep-link: ?auftragId=xxx pre-selects the Auftrag and jumps to step 2.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { EnrichedAuftraege } from '@/types/enriched';
import {
  IconClipboardCheck,
  IconAlertCircle,
  IconCheck,
  IconFileCheck,
} from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];
const AUFTRAEGE_STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];

const ELIGIBLE_STATUS = new Set(['offen', 'in_bearbeitung']);

export default function AuftragAbschliessenPage() {
  const { auftraege, kundenMap, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // Wizard state
  const [step, setStep] = useState(1);
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2 form state
  const [monteurVorname, setMonteurVorname] = useState('');
  const [monteurNachname, setMonteurNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(
    format(new Date(), "yyyy-MM-dd'T'HH:mm")
  );
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');

  // Step 3 / submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // Deep-link: read ?auftragId from URL and pre-select
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (auftragId && !selectedAuftragId) {
      setSelectedAuftragId(auftragId);
      setStep(2);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enrich auftraege with kundeName
  const enrichedAuftraege: EnrichedAuftraege[] = auftraege.map(a => {
    const kundeUrl = a.fields.kunde;
    const kundeId = kundeUrl ? extractRecordId(kundeUrl) : null;
    const kunde = kundeId ? kundenMap.get(kundeId) : null;
    const kundeName = kunde
      ? [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean).join(' ') || kunde.fields.firma || ''
      : '';
    return { ...a, kundeName };
  });

  // Only show eligible orders (offen or in_bearbeitung)
  const eligibleAuftraege = enrichedAuftraege.filter(
    a => a.fields.status && ELIGIBLE_STATUS.has(a.fields.status.key)
  );

  // Selected auftrag (resolved)
  const selectedAuftrag = selectedAuftragId
    ? enrichedAuftraege.find(a => a.record_id === selectedAuftragId) ?? null
    : null;

  const handleSelectAuftrag = useCallback((id: string) => {
    setSelectedAuftragId(id);
    setStep(2);
    setProtokollId(null);
    setCompleted(false);
    setSubmitError(null);
  }, []);

  const handleSubmitProtokoll = useCallback(async () => {
    if (!selectedAuftragId) return;
    if (!monteurVorname.trim() || !monteurNachname.trim() || !pruefungsdatum || !pruefergebnis) {
      setSubmitError('Bitte alle Pflichtfelder ausfüllen.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Create protokoll (idempotency: only if not yet created)
      let pid = protokollId;
      if (!pid) {
        const showMaengel =
          pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';
        const proto = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: monteurVorname.trim(),
          monteur_name_nachname: monteurNachname.trim(),
          pruefungsdatum,
          pruefergebnis,
          maengelbeschreibung: showMaengel ? maengelbeschreibung : undefined,
          massnahmen: massnahmen || undefined,
          bemerkungen_pruef: bemerkungenPruef || undefined,
        });
        pid = proto.record_id;
        setProtokollId(pid);
      }

      // Update Auftrag status to 'abgeschlossen'
      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, { status: 'abgeschlossen' });

      await fetchAll();
      setCompleted(true);
      setStep(3);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Fehler beim Speichern. Bitte erneut versuchen.'
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedAuftragId,
    monteurVorname,
    monteurNachname,
    pruefungsdatum,
    pruefergebnis,
    maengelbeschreibung,
    massnahmen,
    bemerkungenPruef,
    protokollId,
    fetchAll,
  ]);

  const handleReset = useCallback(() => {
    setSelectedAuftragId(null);
    setMonteurVorname('');
    setMonteurNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setProtokollId(null);
    setCompleted(false);
    setSubmitError(null);
    setStep(1);
  }, []);

  const showMaengelfeld =
    pruefergebnis === 'nicht_bestanden' || pruefergebnis === 'bestanden_mit_maengeln';

  const step2Valid =
    monteurVorname.trim().length > 0 &&
    monteurNachname.trim().length > 0 &&
    pruefungsdatum.length > 0 &&
    pruefergebnis.length > 0;

  const auftragStatusLabel = (key: string) =>
    AUFTRAEGE_STATUS.find(o => o.key === key)?.label ?? key;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftrag als abgeschlossen markieren"
      steps={[
        { label: 'Auftrag wählen' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschließen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Auftrag wählen */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-4">
            <h2 className="font-semibold text-base mb-1">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Nur offene und in Bearbeitung befindliche Aufträge werden angezeigt.
            </p>
            <EntitySelectStep
              items={eligibleAuftraege.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
                subtitle: [
                  a.fields.auftragsdatum
                    ? `Datum: ${a.fields.auftragsdatum}`
                    : null,
                  a.kundeName ? `Kunde: ${a.kundeName}` : null,
                  a.fields.monteur ? `Monteur: ${a.fields.monteur}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                status: a.fields.status
                  ? { key: a.fields.status.key, label: a.fields.status.label }
                  : undefined,
                stats: a.fields.prioritaet
                  ? [{ label: 'Priorität', value: a.fields.prioritaet.label }]
                  : [],
                icon: <IconClipboardCheck size={20} className="text-primary" />,
              }))}
              onSelect={handleSelectAuftrag}
              searchPlaceholder="Auftrag suchen..."
              emptyText="Keine offenen Aufträge gefunden."
              emptyIcon={<IconClipboardCheck size={36} />}
            />
          </div>
        </div>
      )}

      {/* Step 2: Prüfprotokoll erfassen */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-4">
            {/* Selected order context */}
            <div className="rounded-2xl border bg-secondary/40 p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardCheck size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm truncate">
                    {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                  </span>
                  {selectedAuftrag.fields.status && (
                    <StatusBadge
                      statusKey={selectedAuftrag.fields.status.key}
                      label={selectedAuftrag.fields.status.label}
                    />
                  )}
                </div>
                {selectedAuftrag.kundeName && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Kunde: {selectedAuftrag.kundeName}
                  </p>
                )}
                {selectedAuftrag.fields.monteur && (
                  <p className="text-xs text-muted-foreground">
                    Monteur: {selectedAuftrag.fields.monteur}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
                className="shrink-0 text-xs"
              >
                Ändern
              </Button>
            </div>

            {/* Prüfprotokoll mini-form */}
            <div className="rounded-2xl border bg-card p-5 space-y-5">
              <div>
                <h2 className="font-semibold text-base">Prüfprotokoll erfassen</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Alle Pflichtfelder (mit *) müssen ausgefüllt werden.
                </p>
              </div>

              {/* Monteur Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname *</Label>
                  <Input
                    id="vorname"
                    value={monteurVorname}
                    onChange={e => setMonteurVorname(e.target.value)}
                    placeholder="Vorname des Monteurs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname *</Label>
                  <Input
                    id="nachname"
                    value={monteurNachname}
                    onChange={e => setMonteurNachname(e.target.value)}
                    placeholder="Nachname des Monteurs"
                  />
                </div>
              </div>

              {/* Prüfungsdatum */}
              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum und -uhrzeit *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                  className="w-full max-w-xs"
                />
              </div>

              {/* Prüfergebnis */}
              <div className="space-y-2">
                <Label>Prüfergebnis *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPruefergebnis(opt.key)}
                      className={`rounded-xl border p-3 text-sm font-medium text-left transition-colors ${
                        pruefergebnis === opt.key
                          ? opt.key === 'bestanden'
                            ? 'bg-green-100 border-green-400 text-green-800'
                            : opt.key === 'nicht_bestanden'
                            ? 'bg-red-100 border-red-400 text-red-800'
                            : 'bg-amber-100 border-amber-400 text-amber-800'
                          : 'bg-card hover:bg-accent hover:border-primary/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mängelbeschreibung — only when not passed */}
              {showMaengelfeld && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
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
                  placeholder="Welche Maßnahmen wurden eingeleitet oder empfohlen?"
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
                  placeholder="Weitere Bemerkungen zum Prüfvorgang..."
                  rows={2}
                />
              </div>

              {submitError && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3">
                  <IconAlertCircle size={16} className="text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{submitError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleSubmitProtokoll}
                  disabled={!step2Valid || submitting}
                  className="flex-1 sm:flex-none"
                >
                  {submitting ? 'Wird gespeichert...' : 'Auftrag abschließen'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht einen ausgewählten Auftrag aus Schritt 1.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Zu Schritt 1
            </Button>
          </div>
        )
      )}

      {/* Step 3: Abgeschlossen / Zusammenfassung */}
      {step === 3 && (
        completed && selectedAuftrag ? (
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card p-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto">
                <IconCheck size={28} className="text-green-700" stroke={2.5} />
              </div>
              <div>
                <h2 className="text-lg font-bold">Auftrag abgeschlossen!</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Das Prüfprotokoll wurde erstellt und der Auftrag als abgeschlossen markiert.
                </p>
              </div>

              {/* Summary */}
              <div className="rounded-xl border bg-secondary/40 p-4 text-left space-y-3 mt-2">
                <div className="flex items-center gap-2">
                  <IconFileCheck size={16} className="text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Zusammenfassung
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Auftragsnummer</span>
                    <span className="text-sm font-medium truncate">
                      {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                    </span>
                  </div>
                  {selectedAuftrag.kundeName && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Kunde</span>
                      <span className="text-sm font-medium truncate">{selectedAuftrag.kundeName}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <StatusBadge
                      statusKey="abgeschlossen"
                      label={auftragStatusLabel('abgeschlossen')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Prüfergebnis</span>
                    <StatusBadge
                      statusKey={pruefergebnis}
                      label={
                        PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Geprüft von</span>
                    <span className="text-sm font-medium">
                      {monteurVorname} {monteurNachname}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center">
                <Button onClick={handleReset} variant="outline">
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/">
                  <Button className="w-full sm:w-auto">Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">
              Dieser Schritt braucht die Daten aus den vorherigen Schritten.
            </p>
            <Button variant="outline" onClick={() => setStep(1)}>
              Neu starten
            </Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
