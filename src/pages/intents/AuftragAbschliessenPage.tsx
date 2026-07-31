/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offenen Auftrag auswählen → 2) Prüfprotokoll erstellen → 3) Auftrag abschließen & bestätigen.
 * Reads: auftraege (EnrichedAuftraege via useDashboardData + kunden), pruefprotokoll.
 * Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 * Deep-link: ?auftragId=xxx prefills step 1 and jumps to step 2.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { EnrichedAuftraege } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { IconClipboardCheck, IconCircleCheck, IconAlertTriangle, IconUser } from '@tabler/icons-react';

// Read lookup options safely
const AUFTRAG_STATUS_OPTIONS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

// Determine the "abgeschlossen" key by looking for the exact match in LOOKUP_OPTIONS
const ABGESCHLOSSEN_KEY = AUFTRAG_STATUS_OPTIONS.find(o => o.key === 'abgeschlossen')?.key ?? 'abgeschlossen';
// Keys that mean "done" — exclude these from the eligible Aufträge list
const DONE_KEYS = new Set(['abgeschlossen', 'storniert']);

export default function AuftragAbschliessenPage() {
  const { auftraege, kunden, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // --- ALL HOOKS BEFORE EARLY RETURNS ---
  const [step, setStep] = useState(1);
  const [selectedAuftragId, setSelectedAuftragId] = useState<string | null>(null);

  // Step 2 — Prüfprotokoll form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungenPruef, setBemerkungenPruef] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Idempotency guard: store the created Prüfprotokoll id so retries don't duplicate
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Deep-link: read ?auftragId from URL params on mount
  useEffect(() => {
    const paramId = searchParams.get('auftragId');
    if (paramId) {
      setSelectedAuftragId(paramId);
      setStep(2);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build enriched Auftraege list (add kundeName)
  const kundenMap = useMemo(() => {
    const m = new Map<string, string>();
    kunden.forEach(k => {
      const name = [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ') || k.fields.firma || '—';
      m.set(k.record_id, name);
    });
    return m;
  }, [kunden]);

  const enrichedAuftraege = useMemo<EnrichedAuftraege[]>(() => {
    return auftraege.map(a => {
      const kundeId = extractRecordId(a.fields.kunde) ?? '';
      return {
        ...a,
        kundeName: kundenMap.get(kundeId) ?? '—',
      };
    });
  }, [auftraege, kundenMap]);

  // Only show open/in-progress Aufträge in step 1
  const eligibleAuftraege = useMemo(() => {
    return enrichedAuftraege.filter(a => {
      const key = a.fields.status?.key;
      return !key || !DONE_KEYS.has(key);
    });
  }, [enrichedAuftraege]);

  // Find the selected Auftrag
  const selectedAuftrag = useMemo(() => {
    if (!selectedAuftragId) return null;
    return enrichedAuftraege.find(a => a.record_id === selectedAuftragId) ?? null;
  }, [enrichedAuftraege, selectedAuftragId]);

  // Whether the Prüfergebnis means "not passed" (show Mängelbeschreibung)
  const showMaengel = pruefergebnis !== 'bestanden';

  // --- STEP HANDLERS ---

  function handleAuftragSelect(id: string) {
    setSelectedAuftragId(id);
    setStep(2);
  }

  async function handleCreateProtokoll() {
    if (!selectedAuftragId) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis) {
      setSubmitError('Bitte alle Pflichtfelder ausfüllen.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Idempotency: only create if not yet created
      if (!protokollId) {
        const result = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftragId),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum,
          pruefergebnis,
          maengelbeschreibung: maengelbeschreibung.trim() || undefined,
          massnahmen: massnahmen.trim() || undefined,
          bemerkungen_pruef: bemerkungenPruef.trim() || undefined,
        });
        setProtokollId(result.record_id);
      }
      await fetchAll();
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Prüfprotokolls.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAbschliessen() {
    if (!selectedAuftragId) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await LivingAppsService.updateAuftraegeEntry(selectedAuftragId, {
        status: ABGESCHLOSSEN_KEY,
      });
      await fetchAll();
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Abschließen des Auftrags.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftragId(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungenPruef('');
    setProtokollId(null);
    setSuccess(false);
    setSubmitError(null);
    setStep(1);
  }

  // --- RENDER ---

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftrag als erledigt markieren"
      steps={[
        { label: 'Auftrag' },
        { label: 'Prüfprotokoll' },
        { label: 'Abschließen' },
      ]}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── STEP 1: Auftrag auswählen ─── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Wähle einen offenen oder laufenden Auftrag aus, den du abschließen möchtest.
            </p>
          </div>
          <EntitySelectStep
            items={eligibleAuftraege.map(a => ({
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: `${a.kundeName}${a.fields.auftragsdatum ? ' · ' + a.fields.auftragsdatum : ''}`,
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              stats: a.fields.monteur ? [{ label: 'Monteur', value: a.fields.monteur }] : undefined,
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            }))}
            onSelect={handleAuftragSelect}
            searchPlaceholder="Auftrag suchen..."
            emptyText="Keine offenen Aufträge gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
          />
        </div>
      )}

      {/* ─── STEP 2: Prüfprotokoll erstellen ─── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Prüfprotokoll erstellen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Prüfprotokoll für Auftrag{' '}
                <span className="font-medium text-foreground">
                  {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)}
                </span>{' '}
                wird erstellt.
              </p>
            </div>

            {/* Auftrag-Kontext */}
            <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardCheck size={20} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {selectedAuftrag.fields.auftragsnummer ?? '—'}
                  </span>
                  {selectedAuftrag.fields.status && (
                    <StatusBadge
                      statusKey={selectedAuftrag.fields.status.key}
                      label={selectedAuftrag.fields.status.label}
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{selectedAuftrag.kundeName}</p>
              </div>
            </div>

            {/* Mini-Form */}
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Monteur Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1">
                    <IconUser size={14} className="text-muted-foreground" />
                    Vorname <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={vorname}
                    onChange={e => setVorname(e.target.value)}
                    placeholder="Vorname des Monteurs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1">
                    <IconUser size={14} className="text-muted-foreground" />
                    Nachname <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={nachname}
                    onChange={e => setNachname(e.target.value)}
                    placeholder="Nachname des Monteurs"
                  />
                </div>
              </div>

              {/* Prüfungsdatum */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Prüfungsdatum <span className="text-destructive">*</span>
                </label>
                <Input
                  type="datetime-local"
                  value={pruefungsdatum}
                  onChange={e => setPruefungsdatum(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Prüfergebnis */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Prüfergebnis <span className="text-destructive">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRUEFERGEBNIS_OPTIONS.map(option => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setPruefergebnis(option.key)}
                      className={`rounded-xl border p-3 text-sm font-medium text-left transition-colors ${
                        pruefergebnis === option.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card hover:bg-accent'
                      }`}
                    >
                      {option.key === 'bestanden' && (
                        <IconCircleCheck size={16} className="mb-1 text-green-600" />
                      )}
                      {option.key === 'bestanden_mit_maengeln' && (
                        <IconAlertTriangle size={16} className="mb-1 text-amber-500" />
                      )}
                      {option.key === 'nicht_bestanden' && (
                        <IconAlertTriangle size={16} className="mb-1 text-destructive" />
                      )}
                      <div>{option.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mängelbeschreibung — nur wenn nicht bestanden */}
              {showMaengel && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Mängelbeschreibung</label>
                  <Textarea
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibe die festgestellten Mängel..."
                    rows={3}
                  />
                </div>
              )}

              {/* Maßnahmen */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Maßnahmen</label>
                <Textarea
                  value={massnahmen}
                  onChange={e => setMassnahmen(e.target.value)}
                  placeholder="Eingeleitete oder geplante Maßnahmen..."
                  rows={3}
                />
              </div>

              {/* Bemerkungen */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Bemerkungen</label>
                <Textarea
                  value={bemerkungenPruef}
                  onChange={e => setBemerkungenPruef(e.target.value)}
                  placeholder="Weitere Bemerkungen..."
                  rows={2}
                />
              </div>
            </div>

            {submitError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="flex gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={() => { setSubmitError(null); setStep(1); }}
                disabled={submitting}
              >
                Zurück
              </Button>
              <Button
                onClick={handleCreateProtokoll}
                disabled={submitting || !vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis}
                className="flex-1 sm:flex-none"
              >
                {submitting ? 'Wird gespeichert...' : 'Prüfprotokoll erstellen'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Kein Auftrag ausgewählt. Bitte starte von vorne.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Zurück zu Schritt 1</Button>
          </div>
        )
      )}

      {/* ─── STEP 3: Auftrag abschließen ─── */}
      {step === 3 && (
        success ? (
          /* Success State */
          <div className="text-center py-12 space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
              <IconCircleCheck size={32} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Auftrag abgeschlossen!</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Auftrag{' '}
                <span className="font-medium text-foreground">
                  {selectedAuftrag?.fields.auftragsnummer ?? selectedAuftragId?.slice(-6) ?? '—'}
                </span>{' '}
                wurde erfolgreich abgeschlossen.
              </p>
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button onClick={handleReset}>
                Weiteren Auftrag abschließen
              </Button>
              <a href="#/">
                <Button variant="outline">Zurück zum Dashboard</Button>
              </a>
            </div>
          </div>
        ) : (
          selectedAuftrag ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Auftrag abschließen</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Überprüfe die Zusammenfassung und bestätige den Abschluss.
                </p>
              </div>

              {/* Zusammenfassung */}
              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Zusammenfassung
                </h3>

                {/* Auftrag Details */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auftrag</p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <IconClipboardCheck size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {selectedAuftrag.fields.auftragsnummer ?? '—'}
                        </span>
                        {selectedAuftrag.fields.status && (
                          <StatusBadge
                            statusKey={selectedAuftrag.fields.status.key}
                            label={selectedAuftrag.fields.status.label}
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{selectedAuftrag.kundeName}</p>
                      {selectedAuftrag.fields.auftragsdatum && (
                        <p className="text-xs text-muted-foreground">
                          Datum: {selectedAuftrag.fields.auftragsdatum}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t" />

                {/* Prüfprotokoll Details */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prüfprotokoll</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Monteur: </span>
                      <span className="font-medium">{vorname} {nachname}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Datum: </span>
                      <span className="font-medium">{pruefungsdatum.replace('T', ' ').slice(0, 16)}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">Ergebnis: </span>
                      <span className={`font-medium ${
                        pruefergebnis === 'bestanden' ? 'text-green-600'
                          : pruefergebnis === 'bestanden_mit_maengeln' ? 'text-amber-600'
                          : 'text-destructive'
                      }`}>
                        {PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                      </span>
                    </div>
                    {maengelbeschreibung && (
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Mängel: </span>
                        <span className="font-medium">{maengelbeschreibung}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t" />

                {/* Neue Status-Vorschau */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Neuer Status: </span>
                  <StatusBadge
                    statusKey={ABGESCHLOSSEN_KEY}
                    label={AUFTRAG_STATUS_OPTIONS.find(o => o.key === ABGESCHLOSSEN_KEY)?.label ?? 'Abgeschlossen'}
                  />
                </div>
              </div>

              {submitError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => { setSubmitError(null); setStep(2); }}
                  disabled={submitting}
                >
                  Zurück
                </Button>
                <Button
                  onClick={handleAbschliessen}
                  disabled={submitting}
                  className="flex-1 sm:flex-none"
                >
                  {submitting ? 'Wird abgeschlossen...' : 'Auftrag jetzt abschließen'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                Dieser Schritt braucht die Auswahl aus Schritt 1.
              </p>
              <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
            </div>
          )
        )
      )}
    </IntentWizardShell>
  );
}
