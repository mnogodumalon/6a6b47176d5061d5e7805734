/**
 * PruefprotokollErstellenPage
 *
 * Intent: Prüfprotokoll für Auftrag erstellen
 * Flow: Auftrag auswählen → Prüfer & Datum → Zusammenfassung & Absenden
 * Entities: Aufträge (read), Prüfprotokoll (create)
 * Composes: IntentWizardShell, EntitySelectStep, StatusBadge
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichAuftraege } from '@/lib/enrich';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { EnrichedAuftraege } from '@/types/enriched';
import { IconClipboardCheck, IconUser, IconCalendar, IconFileCheck } from '@tabler/icons-react';

const STEPS = [
  { label: 'Auftrag wählen' },
  { label: 'Prüfer & Datum' },
  { label: 'Bestätigen' },
];

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']['pruefergebnis'] ?? [];
const PASSING_KEY = 'bestanden';

interface FormData {
  vorname: string;
  nachname: string;
  pruefungsdatum: string;
  pruefergebnis: string | undefined;
  maengelbeschreibung: string;
  massnahmen: string;
  bemerkungen: string;
}

const INITIAL_FORM: FormData = {
  vorname: '',
  nachname: '',
  pruefungsdatum: '',
  pruefergebnis: undefined as string | undefined,
  maengelbeschreibung: '',
  massnahmen: '',
  bemerkungen: '',
};

export default function PruefprotokollErstellenPage() {
  const { auftraege, kunden, kundenMap, loading, error, fetchAll } = useDashboardData();
  const [searchParams] = useSearchParams();

  // All hooks before any early returns
  const [step, setStep] = useState<number>(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    return urlStep >= 1 && urlStep <= 3 ? urlStep : 1;
  });

  const [selectedAuftrag, setSelectedAuftrag] = useState<EnrichedAuftraege | null>(null);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successProtokollId, setSuccessProtokollId] = useState<string | null>(null);

  const enrichedAuftraege = useMemo(
    () => enrichAuftraege(auftraege, { kundenMap }),
    [auftraege, kundenMap]
  );

  // Deep-link: if auftragId param is present, pre-select and jump to step 2
  useEffect(() => {
    const auftragId = searchParams.get('auftragId');
    if (auftragId && enrichedAuftraege.length > 0 && !selectedAuftrag) {
      const found = enrichedAuftraege.find(a => a.record_id === auftragId);
      if (found) {
        setSelectedAuftrag(found);
        setStep(prev => (prev === 1 ? 2 : prev));
      }
    }
  }, [searchParams, enrichedAuftraege, selectedAuftrag]);

  // Build the kunden display name for the selected auftrag
  const selectedKundeName = useMemo(() => {
    if (!selectedAuftrag) return '';
    const k = kunden.find(ku => {
      const urlPart = selectedAuftrag.fields.kunde ?? '';
      return urlPart.includes(ku.record_id);
    });
    if (k) return [k.fields.vorname, k.fields.nachname].filter(Boolean).join(' ');
    return selectedAuftrag.kundeName || '—';
  }, [selectedAuftrag, kunden]);

  const isStep2Valid =
    formData.vorname.trim() !== '' &&
    formData.nachname.trim() !== '' &&
    formData.pruefungsdatum !== '' &&
    formData.pruefergebnis !== '';

  const needsMaengel =
    formData.pruefergebnis !== '' && formData.pruefergebnis !== PASSING_KEY;

  function handleSelectAuftrag(id: string) {
    const found = enrichedAuftraege.find(a => a.record_id === id) ?? null;
    setSelectedAuftrag(found);
    setStep(2);
  }

  function handleFormChange(field: keyof FormData, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!selectedAuftrag) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const protokoll = await LivingAppsService.createPruefprotokollEntry({
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, selectedAuftrag.record_id),
        monteur_name_vorname: formData.vorname,
        monteur_name_nachname: formData.nachname,
        pruefungsdatum: formData.pruefungsdatum,
        pruefergebnis: formData.pruefergebnis,
        maengelbeschreibung: formData.maengelbeschreibung || undefined,
        massnahmen: formData.massnahmen || undefined,
        bemerkungen_pruef: formData.bemerkungen || undefined,
      });
      await fetchAll();
      setSuccessProtokollId(protokoll.record_id);
      setStep(3);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedAuftrag(null);
    setFormData(INITIAL_FORM);
    setSubmitError(null);
    setSuccessProtokollId(null);
    setStep(1);
  }

  const pruefergebnisLabel = PRUEFERGEBNIS_OPTIONS.find(o => o.key === formData.pruefergebnis)?.label ?? formData.pruefergebnis;

  return (
    <IntentWizardShell
      title="Prüfprotokoll erstellen"
      subtitle="Prüfergebnis für einen Auftrag dokumentieren"
      steps={STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Auftrag auswählen ───────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Auftrag auswählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle den Auftrag, für den du ein Prüfprotokoll anlegen möchtest.
            </p>
          </div>
          <EntitySelectStep
            items={enrichedAuftraege.map(a => ({
              id: a.record_id,
              title: a.fields.auftragsnummer ?? `Auftrag ${a.record_id.slice(-6)}`,
              subtitle: [
                a.fields.auftragsbeschreibung,
                a.kundeName ? `Kunde: ${a.kundeName}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              status: a.fields.status
                ? { key: a.fields.status.key, label: a.fields.status.label }
                : undefined,
              stats: [
                ...(a.fields.prioritaet ? [{ label: 'Priorität', value: a.fields.prioritaet.label }] : []),
                ...(a.fields.auftragsdatum ? [{ label: 'Datum', value: a.fields.auftragsdatum }] : []),
              ],
              icon: <IconClipboardCheck size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectAuftrag}
            searchPlaceholder="Auftrag suchen..."
            emptyText="Kein passender Auftrag gefunden."
            emptyIcon={<IconClipboardCheck size={32} />}
          />
        </div>
      )}

      {/* ── Step 2: Prüfer & Datum ──────────────────────────────────── */}
      {step === 2 && selectedAuftrag && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Prüfer & Datum</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Trage die Prüferdaten und das Ergebnis ein.
            </p>
          </div>

          {/* Auftrag-Kontext */}
          <div className="rounded-2xl border bg-card p-4 space-y-2 overflow-hidden">
            <div className="flex items-center gap-2">
              <IconClipboardCheck size={18} className="text-primary shrink-0" />
              <span className="font-semibold text-sm truncate">
                {selectedAuftrag.fields.auftragsnummer ?? 'Auftrag'}
              </span>
              {selectedAuftrag.fields.status && (
                <StatusBadge
                  statusKey={selectedAuftrag.fields.status.key}
                  label={selectedAuftrag.fields.status.label}
                />
              )}
            </div>
            {selectedAuftrag.fields.auftragsbeschreibung && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {selectedAuftrag.fields.auftragsbeschreibung}
              </p>
            )}
            {selectedKundeName && (
              <p className="text-xs text-muted-foreground">
                Kunde: <span className="font-medium text-foreground">{selectedKundeName}</span>
              </p>
            )}
          </div>

          {/* Prüferformular */}
          <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <IconUser size={17} className="text-primary shrink-0" />
              <span className="font-medium text-sm">Prüfer</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Vorname <span className="text-destructive">*</span>
                </label>
                <Input
                  value={formData.vorname}
                  onChange={e => handleFormChange('vorname', e.target.value)}
                  placeholder="Vorname des Prüfers"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Nachname <span className="text-destructive">*</span>
                </label>
                <Input
                  value={formData.nachname}
                  onChange={e => handleFormChange('nachname', e.target.value)}
                  placeholder="Nachname des Prüfers"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <IconCalendar size={14} />
                Prüfungsdatum & -uhrzeit <span className="text-destructive">*</span>
              </label>
              <Input
                type="datetime-local"
                value={formData.pruefungsdatum}
                onChange={e => handleFormChange('pruefungsdatum', e.target.value)}
                className="max-w-xs"
              />
            </div>
          </div>

          {/* Prüfergebnis Tiles */}
          <div className="rounded-2xl border bg-card p-5 space-y-3 overflow-hidden">
            <div className="flex items-center gap-2">
              <IconFileCheck size={17} className="text-primary shrink-0" />
              <span className="font-medium text-sm">
                Prüfergebnis <span className="text-destructive">*</span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PRUEFERGEBNIS_OPTIONS.map(option => {
                const isSelected = formData.pruefergebnis === option.key;
                const colorClass =
                  option.key === 'bestanden'
                    ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                    : option.key === 'bestanden_mit_maengeln'
                    ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                    : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400';
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleFormChange('pruefergebnis', option.key)}
                    className={`w-full rounded-xl border-2 p-3 text-sm font-medium transition-all text-left ${
                      isSelected ? colorClass : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mängelbeschreibung — nur wenn nicht bestanden */}
          {needsMaengel && (
            <div className="rounded-2xl border bg-card p-5 space-y-3 overflow-hidden">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Mängelbeschreibung
                </label>
                <Textarea
                  value={formData.maengelbeschreibung}
                  onChange={e => handleFormChange('maengelbeschreibung', e.target.value)}
                  placeholder="Welche Mängel wurden festgestellt?"
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Maßnahmen & Bemerkungen */}
          <div className="rounded-2xl border bg-card p-5 space-y-4 overflow-hidden">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Maßnahmen
              </label>
              <Textarea
                value={formData.massnahmen}
                onChange={e => handleFormChange('massnahmen', e.target.value)}
                placeholder="Welche Maßnahmen wurden eingeleitet oder empfohlen?"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Bemerkungen
              </label>
              <Textarea
                value={formData.bemerkungen}
                onChange={e => handleFormChange('bemerkungen', e.target.value)}
                placeholder="Weitere Anmerkungen zur Prüfung"
                rows={2}
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Zurück
            </Button>
            <Button
              disabled={!isStep2Valid}
              onClick={() => setStep(3)}
            >
              Weiter zur Zusammenfassung
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Zusammenfassung & Absenden ─────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          {successProtokollId ? (
            /* Erfolgsmeldung */
            <div className="rounded-2xl border bg-card p-8 flex flex-col items-center text-center space-y-4 overflow-hidden">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center">
                <IconFileCheck size={28} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Protokoll erstellt</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Das Prüfprotokoll für Auftrag{' '}
                  <span className="font-semibold text-foreground">
                    {selectedAuftrag?.fields.auftragsnummer ?? ''}
                  </span>{' '}
                  wurde erfolgreich angelegt.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-center">
                <Button onClick={handleReset}>
                  Neues Protokoll anlegen
                </Button>
                <a href="#/">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Zurück zum Dashboard
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Zusammenfassung</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Überprüfe die Eingaben und erstelle das Protokoll.
                </p>
              </div>

              {/* Auftrag */}
              <div className="rounded-2xl border bg-card p-5 space-y-2 overflow-hidden">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auftrag</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">
                    {selectedAuftrag?.fields.auftragsnummer ?? '—'}
                  </span>
                  {selectedAuftrag?.fields.status && (
                    <StatusBadge
                      statusKey={selectedAuftrag.fields.status.key}
                      label={selectedAuftrag.fields.status.label}
                    />
                  )}
                </div>
                {selectedAuftrag?.fields.auftragsbeschreibung && (
                  <p className="text-sm text-muted-foreground">
                    {selectedAuftrag.fields.auftragsbeschreibung}
                  </p>
                )}
                {selectedKundeName && (
                  <p className="text-sm text-muted-foreground">
                    Kunde: <span className="font-medium text-foreground">{selectedKundeName}</span>
                  </p>
                )}
              </div>

              {/* Prüfer & Datum */}
              <div className="rounded-2xl border bg-card p-5 space-y-3 overflow-hidden">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prüfer & Datum</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name: </span>
                    <span className="font-medium text-foreground">
                      {formData.vorname} {formData.nachname}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Datum: </span>
                    <span className="font-medium text-foreground">
                      {formData.pruefungsdatum
                        ? formData.pruefungsdatum.replace('T', ' ').slice(0, 16)
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Ergebnis */}
              <div className="rounded-2xl border bg-card p-5 space-y-3 overflow-hidden">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ergebnis</p>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Prüfergebnis: </span>
                    <span className="font-semibold text-foreground">{pruefergebnisLabel || '—'}</span>
                  </div>
                  {formData.maengelbeschreibung && (
                    <div>
                      <span className="text-muted-foreground">Mängel: </span>
                      <span className="text-foreground">{formData.maengelbeschreibung}</span>
                    </div>
                  )}
                  {formData.massnahmen && (
                    <div>
                      <span className="text-muted-foreground">Maßnahmen: </span>
                      <span className="text-foreground">{formData.massnahmen}</span>
                    </div>
                  )}
                  {formData.bemerkungen && (
                    <div>
                      <span className="text-muted-foreground">Bemerkungen: </span>
                      <span className="text-foreground">{formData.bemerkungen}</span>
                    </div>
                  )}
                </div>
              </div>

              {submitError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  Fehler: {submitError}
                </div>
              )}

              {/* Navigation */}
              <div className="flex flex-col sm:flex-row gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                  Zurück
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !isStep2Valid}
                >
                  {submitting ? 'Wird erstellt...' : 'Protokoll erstellen'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
