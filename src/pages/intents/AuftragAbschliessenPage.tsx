/**
 * AuftragAbschliessenPage — 3-Schritt-Wizard zum Abschließen eines Auftrags.
 * Steps: 1) Auftrag wählen (nur nicht-abgeschlossene) → 2) Auftragspositionen prüfen (read-only) → 3) Prüfprotokoll erstellen & Auftrag abschließen.
 * Reads: auftraege, auftragspositionen. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge.
 */

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege, Auftragspositionen } from '@/types/app';
import { IconClipboardCheck, IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';

const AUFTRAEGE_STATUS = LOOKUP_OPTIONS['auftraege']?.['status'] ?? [];
const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

// The "closed" key for auftraege status
const ABGESCHLOSSEN_KEY = AUFTRAEGE_STATUS.find(o => o.key === 'abgeschlossen')?.key ?? 'abgeschlossen';

const WIZARD_STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Positionen prüfen' },
  { label: 'Protokoll & Abschluss' },
];

export default function AuftragAbschliessenPage() {
  const { auftraege, auftragspositionen, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedAuftrag, setSelectedAuftrag] = useState<Auftraege | null>(null);

  // Step 3 form state
  const [vorname, setVorname] = useState('');
  const [nachname, setNachname] = useState('');
  const [pruefungsdatum, setPruefungsdatum] = useState('');
  const [pruefergebnis, setPruefergebnis] = useState(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
  const [maengelbeschreibung, setMaengelbeschreibung] = useState('');
  const [massnahmen, setMassnahmen] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [protokollId, setProtokollId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Filter: only non-abgeschlossen orders
  const eligibleAuftraege = useMemo(
    () => auftraege.filter(a => a.fields.status?.key !== ABGESCHLOSSEN_KEY),
    [auftraege]
  );

  // Positions for the selected order
  const positionen = useMemo<Auftragspositionen[]>(() => {
    if (!selectedAuftrag) return [];
    return auftragspositionen.filter(pos => {
      const refId = extractRecordId(pos.fields.auftrag ?? '');
      return refId === selectedAuftrag.record_id;
    });
  }, [auftragspositionen, selectedAuftrag]);

  const handleAuftragSelect = (id: string) => {
    const found = auftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!selectedAuftrag) return;
    if (!vorname.trim() || !nachname.trim() || !pruefungsdatum || !pruefergebnis) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Idempotency guard: only create if not yet created (retry safety)
      let pid = protokollId;
      if (!pid) {
        const protokoll = await LivingAppsService.createPruefprotokollEntry({
          auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
          monteur_name_vorname: vorname.trim(),
          monteur_name_nachname: nachname.trim(),
          pruefungsdatum: pruefungsdatum, // datetime-local value passed straight through
          pruefergebnis: pruefergebnis,
          maengelbeschreibung: maengelbeschreibung.trim() || undefined,
          massnahmen: massnahmen.trim() || undefined,
          bemerkungen_pruef: bemerkungen.trim() || undefined,
        });
        pid = protokoll.record_id;
        setProtokollId(pid);
      }

      // Update order status to abgeschlossen
      await LivingAppsService.updateAuftraegeEntry(selectedAuftrag.record_id, {
        status: ABGESCHLOSSEN_KEY,
      });

      await fetchAll();
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Abschließen des Auftrags');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedAuftrag(null);
    setVorname('');
    setNachname('');
    setPruefungsdatum('');
    setPruefergebnis(PRUEFERGEBNIS_OPTIONS[0]?.key ?? '');
    setMaengelbeschreibung('');
    setMassnahmen('');
    setBemerkungen('');
    setProtokollId(null);
    setSubmitError(null);
    setSuccess(false);
    setStep(1);
  };

  const isStep3Valid = vorname.trim() && nachname.trim() && pruefungsdatum && pruefergebnis;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftrag als abgeschlossen markieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Auftrag wählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map(a => ({
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
              ? [{ label: 'Datum', value: a.fields.auftragsdatum }]
              : [],
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleAuftragSelect}
          searchPlaceholder="Auftrag suchen…"
          emptyText="Keine offenen Aufträge gefunden."
          emptyIcon={<IconClipboardCheck size={32} />}
        />
      )}

      {/* ── Step 2: Auftragspositionen prüfen ── */}
      {step === 2 && (
        selectedAuftrag ? (
          <div className="space-y-4">
            {/* Selected order header */}
            <div className="rounded-2xl border bg-card p-4 flex items-start gap-3 overflow-hidden">
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
                {selectedAuftrag.fields.auftragsbeschreibung && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {selectedAuftrag.fields.auftragsbeschreibung}
                  </p>
                )}
              </div>
            </div>

            {/* Positions review */}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h2 className="text-sm font-semibold">Auftragspositionen</h2>
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {positionen.length} {positionen.length === 1 ? 'Position' : 'Positionen'}
                </span>
              </div>
              {positionen.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Keine Positionen für diesen Auftrag gefunden.
                </div>
              ) : (
                <div className="divide-y">
                  {positionen.map(pos => (
                    <div key={pos.record_id} className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {pos.fields.positionsbeschreibung ?? '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                          {(pos.fields.menge !== undefined || pos.fields.einheit_position) && (
                            <span>
                              Menge: <span className="font-medium text-foreground">
                                {pos.fields.menge ?? '—'}{pos.fields.einheit_position ? ` ${pos.fields.einheit_position.label}` : ''}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="w-full sm:w-auto">
                Zurück
              </Button>
              <Button onClick={() => setStep(3)} className="w-full sm:w-auto">
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

      {/* ── Step 3: Prüfprotokoll & Abschluss ── */}
      {step === 3 && (
        selectedAuftrag ? (
          success ? (
            // Success screen
            <div className="rounded-2xl border bg-card p-8 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <IconCircleCheck size={32} className="text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Auftrag abgeschlossen!</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Auftrag <span className="font-medium text-foreground">
                    {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id.slice(-6)}
                  </span> wurde erfolgreich abgeschlossen.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Prüfprotokoll von {vorname} {nachname} wurde angelegt.
                  Ergebnis: <span className="font-medium text-foreground">
                    {PRUEFERGEBNIS_OPTIONS.find(o => o.key === pruefergebnis)?.label ?? pruefergebnis}
                  </span>
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mt-2">
                <Button onClick={handleReset} variant="outline">
                  Weiteren Auftrag abschließen
                </Button>
                <a href="#/">
                  <Button>Zurück zum Dashboard</Button>
                </a>
              </div>
            </div>
          ) : (
            // Mini-form
            <div className="space-y-4">
              {/* Selected order reminder */}
              <div className="rounded-xl border bg-secondary/50 px-4 py-3 flex items-center gap-2 overflow-hidden">
                <IconClipboardCheck size={16} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedAuftrag.fields.auftragsnummer ?? `Auftrag ${selectedAuftrag.record_id.slice(-6)}`}
                </span>
                {selectedAuftrag.fields.status && (
                  <StatusBadge
                    statusKey={selectedAuftrag.fields.status.key}
                    label={selectedAuftrag.fields.status.label}
                  />
                )}
              </div>

              <div className="rounded-2xl border bg-card p-5 space-y-4">
                <h2 className="text-base font-semibold">Prüfprotokoll erstellen</h2>

                {/* Monteur name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="vorname">Vorname Monteur <span className="text-destructive">*</span></Label>
                    <Input
                      id="vorname"
                      value={vorname}
                      onChange={e => setVorname(e.target.value)}
                      placeholder="Vorname"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nachname">Nachname Monteur <span className="text-destructive">*</span></Label>
                    <Input
                      id="nachname"
                      value={nachname}
                      onChange={e => setNachname(e.target.value)}
                      placeholder="Nachname"
                    />
                  </div>
                </div>

                {/* Prüfungsdatum */}
                <div className="space-y-1.5">
                  <Label htmlFor="pruefungsdatum">Prüfungsdatum & Uhrzeit <span className="text-destructive">*</span></Label>
                  <Input
                    id="pruefungsdatum"
                    type="datetime-local"
                    value={pruefungsdatum}
                    onChange={e => setPruefungsdatum(e.target.value)}
                    className="w-full max-w-xs"
                  />
                </div>

                {/* Prüfergebnis as radio tiles */}
                <div className="space-y-2">
                  <Label>Prüfergebnis <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {PRUEFERGEBNIS_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPruefergebnis(opt.key)}
                        className={`rounded-xl border px-3 py-3 text-sm font-medium text-left transition-colors ${
                          pruefergebnis === opt.key
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-foreground border-border hover:border-primary/50 hover:bg-accent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mängelbeschreibung */}
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
                    value={maengelbeschreibung}
                    onChange={e => setMaengelbeschreibung(e.target.value)}
                    placeholder="Beschreibung der festgestellten Mängel (optional)"
                    rows={3}
                  />
                </div>

                {/* Maßnahmen */}
                <div className="space-y-1.5">
                  <Label htmlFor="massnahmen">Maßnahmen</Label>
                  <Textarea
                    id="massnahmen"
                    value={massnahmen}
                    onChange={e => setMassnahmen(e.target.value)}
                    placeholder="Eingeleitete oder empfohlene Maßnahmen (optional)"
                    rows={3}
                  />
                </div>

                {/* Bemerkungen */}
                <div className="space-y-1.5">
                  <Label htmlFor="bemerkungen">Bemerkungen</Label>
                  <Textarea
                    id="bemerkungen"
                    value={bemerkungen}
                    onChange={e => setBemerkungen(e.target.value)}
                    placeholder="Weitere Bemerkungen (optional)"
                    rows={2}
                  />
                </div>

                {submitError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                    <IconAlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{submitError}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <Button variant="outline" onClick={() => setStep(2)} disabled={submitting} className="w-full sm:w-auto">
                    Zurück
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={!isStep3Valid || submitting}
                    className="w-full sm:w-auto"
                  >
                    {submitting ? 'Wird abgeschlossen…' : 'Auftrag abschließen'}
                  </Button>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">Dieser Schritt braucht die Auswahl aus Schritt 1.</p>
            <Button variant="outline" onClick={() => setStep(1)}>Neu starten</Button>
          </div>
        )
      )}
    </IntentWizardShell>
  );
}
