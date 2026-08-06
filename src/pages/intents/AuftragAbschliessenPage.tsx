/**
 * Auftrag abschließen — 3-Schritt-Wizard.
 * Steps: 1) Auftrag auswählen → 2) Prüfprotokoll erfassen → 3) Prüfen & abschließen → 4) Fertig.
 * Reads: auftraege, auftragspositionen, kunden. Writes: pruefprotokoll (createPruefprotokollEntry), auftraege (updateAuftraegeEntry).
 * Composes: IntentWizardShell, EntitySelectStep, SummaryStep, SuccessStep.
 */
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useIntentSubmit } from '@/hooks/useIntentSubmit';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import type { Auftraege } from '@/types/app';
import { lookupKey, formatDateTime } from '@/lib/formatters';
import { undoToast } from '@/lib/polish';
import { IconClipboardCheck, IconAlertTriangle } from '@tabler/icons-react';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];

const WIZARD_STEPS = [
  { label: 'Auftrag' },
  { label: 'Prüfprotokoll' },
  { label: 'Prüfen' },
  { label: 'Fertig' },
];

const DRAFT_KEY = 'intent:auftrag-abschliessen';

type PruefergebnisKey = 'bestanden' | 'bestanden_mit_maengeln' | 'nicht_bestanden';

interface WizardState {
  auftragId: string;
  monteurVorname: string;
  monteurNachname: string;
  pruefungsdatum: string;
  ergebnis: PruefergebnisKey | null;
  maengelbeschreibung: string;
  massnahmen: string;
  bemerkungen: string;
}

const DEFAULT_STATE: WizardState = {
  auftragId: '',
  monteurVorname: '',
  monteurNachname: '',
  pruefungsdatum: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  ergebnis: null,
  maengelbeschreibung: '',
  massnahmen: '',
  bemerkungen: '',
};

export default function AuftragAbschliessenPage() {
  const [searchParams] = useSearchParams();
  const { auftraege, auftragspositionen, kunden, kundenMap, loading, error, fetchAll } = useDashboardData();

  const urlAuftragId = searchParams.get('auftragId') ?? '';

  const [step, setStep] = useState(() => {
    if (urlAuftragId) return 2;
    return 1;
  });

  const [state, setState] = useState<WizardState>(() => ({
    ...DEFAULT_STATE,
    auftragId: urlAuftragId,
  }));

  // Idempotency: store created protokoll id to avoid double-create on retry
  const [protokollId, setProtokollId] = useState<string>('');

  const { submit, submitting, error: submitError, result, reset } = useIntentSubmit(async () => {
    const auftrag = offeneAuftraege.find(a => a.record_id === state.auftragId);
    if (!auftrag) throw new Error('Kein Auftrag ausgewählt.');

    // Idempotent: only create Prüfprotokoll if not already created
    let pid = protokollId;
    if (!pid) {
      const payload: Record<string, unknown> = {
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, auftrag.record_id),
        monteur_name_vorname: state.monteurVorname.trim(),
        monteur_name_nachname: state.monteurNachname.trim(),
        pruefungsdatum: state.pruefungsdatum,
        pruefergebnis: state.ergebnis,
        bemerkungen_pruef: state.bemerkungen.trim() || undefined,
      };
      if (state.ergebnis !== 'bestanden') {
        payload.maengelbeschreibung = state.maengelbeschreibung.trim() || undefined;
      }
      if (state.ergebnis === 'nicht_bestanden' || state.ergebnis === 'bestanden_mit_maengeln') {
        payload.massnahmen = state.massnahmen.trim() || undefined;
      }
      const created = await LivingAppsService.createPruefprotokollEntry(payload as Parameters<typeof LivingAppsService.createPruefprotokollEntry>[0]);
      pid = created.record_id;
      setProtokollId(pid);
    }

    // Update Auftrag status only if bestanden or bestanden_mit_maengeln
    if (state.ergebnis === 'bestanden' || state.ergebnis === 'bestanden_mit_maengeln') {
      await LivingAppsService.updateAuftraegeEntry(auftrag.record_id, { status: 'abgeschlossen' });
    }

    await fetchAll();

    const kundeName = resolveKundeName(auftrag);
    const ergebnisLabel = PRUEFERGEBNIS_OPTIONS.find(o => o.key === state.ergebnis)?.label ?? state.ergebnis;
    const statusChanged = state.ergebnis === 'bestanden' || state.ergebnis === 'bestanden_mit_maengeln';

    return {
      auftragsnummer: auftrag.fields.auftragsnummer ?? auftrag.record_id,
      kundeName,
      ergebnisLabel,
      statusChanged,
      pruefergebnis: state.ergebnis,
    };
  }, { draftKey: DRAFT_KEY });

  // Derived: eligible auftraege = only offen or in_bearbeitung
  const offeneAuftraege = useMemo(() =>
    auftraege.filter(a => {
      const s = lookupKey(a.fields.status);
      return s === 'offen' || s === 'in_bearbeitung';
    }),
    [auftraege]
  );

  const selectedAuftrag: Auftraege | undefined = offeneAuftraege.find(a => a.record_id === state.auftragId);

  function resolveKundeName(auftrag: Auftraege): string {
    if (!auftrag.fields.kunde) return '—';
    const kundeId = extractRecordId(auftrag.fields.kunde);
    if (!kundeId) return '—';
    const kunde = kundenMap.get(kundeId);
    if (!kunde) return '—';
    const parts = [kunde.fields.vorname, kunde.fields.nachname].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : (kunde.fields.firma ?? '—');
  }

  function positionCount(auftragId: string): number {
    return auftragspositionen.filter(p => {
      const ref = extractRecordId(p.fields.auftrag);
      return ref === auftragId;
    }).length;
  }

  function handleAuftragSelect(id: string) {
    setState(s => ({ ...s, auftragId: id }));
    setStep(2);
  }

  function handleReset() {
    setState(DEFAULT_STATE);
    setProtokollId('');
    reset();
    setStep(1);
  }

  const pruefergebnisMissing: string[] = [];
  if (!state.monteurVorname.trim()) pruefergebnisMissing.push('Vorname Monteur');
  if (!state.monteurNachname.trim()) pruefergebnisMissing.push('Nachname Monteur');
  if (!state.pruefungsdatum) pruefergebnisMissing.push('Prüfungsdatum');
  if (!state.ergebnis) pruefergebnisMissing.push('Prüfergebnis');

  const answers = selectedAuftrag
    ? [
        { label: 'Auftrag', value: selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id },
        { label: 'Kunde', value: resolveKundeName(selectedAuftrag) },
      ]
    : undefined;

  const ergebnisLabel = PRUEFERGEBNIS_OPTIONS.find(o => o.key === state.ergebnis)?.label ?? '—';
  const statusWirdGeaendert = state.ergebnis === 'bestanden' || state.ergebnis === 'bestanden_mit_maengeln';

  // Kunden lookup for display
  function kundeNameForId(kundeUrl: string | undefined): string {
    if (!kundeUrl) return '—';
    const id = extractRecordId(kundeUrl);
    if (!id) return '—';
    const k = kundenMap.get(id);
    if (!k) return '—';
    const parts = [k.fields.vorname, k.fields.nachname].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : (k.fields.firma ?? '—');
  }

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erfassen und Auftragsstatus setzen"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
      intro={{
        description: 'Wähle einen offenen Auftrag aus, erfasse das Prüfprotokoll und schließe den Auftrag ab.',
        requirements: ['Auftrag mit Status „Offen" oder „In Bearbeitung"', 'Name des Monteurs', 'Prüfergebnis'],
      }}
      answers={step > 1 ? answers : undefined}
      draftKey={DRAFT_KEY}
      draft={state}
      onDraftRestore={(d) => setState(d as WizardState)}
    >
      {/* Step 1: Auftrag auswählen */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <IconClipboardCheck size={20} className="text-primary" />
              Auftrag auswählen
            </h2>
            <p className="text-sm text-muted-foreground">
              Nur Aufträge mit Status „Offen" oder „In Bearbeitung" können abgeschlossen werden.
              {offeneAuftraege.length === 0 && (
                <span className="block mt-1 text-amber-600 font-medium">Aktuell gibt es keine offenen Aufträge.</span>
              )}
            </p>
            <EntitySelectStep
              items={offeneAuftraege.map(a => ({
                id: a.record_id,
                title: a.fields.auftragsnummer ?? a.record_id,
                subtitle: [
                  kundeNameForId(a.fields.kunde),
                  a.fields.prioritaet?.label,
                ].filter(Boolean).join(' · '),
                status: a.fields.status
                  ? { key: a.fields.status.key, label: a.fields.status.label }
                  : undefined,
                stats: [
                  { label: 'Positionen', value: positionCount(a.record_id) },
                ],
                icon: <IconClipboardCheck size={18} className="text-primary" />,
              }))}
              onSelect={handleAuftragSelect}
              searchPlaceholder="Auftragsnummer oder Kunde suchen..."
              emptyText="Keine offenen Aufträge gefunden."
              emptyIcon={<IconClipboardCheck size={32} />}
            />
          </div>
        </div>
      )}

      {/* Step 2: Prüfprotokoll erfassen */}
      {step === 2 && (
        <div className="space-y-4">
          {!selectedAuftrag ? (
            <div className="rounded-[27px] bg-card shadow-lg p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Kein Auftrag ausgewählt.</p>
              <Button variant="outline" onClick={() => setStep(1)}>Zurück zu Schritt 1</Button>
            </div>
          ) : (
            <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-semibold">
                Prüfprotokoll für {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
              </h2>
              <p className="text-sm text-muted-foreground">
                Kunde: <span className="font-medium text-foreground">{resolveKundeName(selectedAuftrag)}</span>
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vorname">Vorname Monteur *</Label>
                  <Input
                    id="vorname"
                    value={state.monteurVorname}
                    onChange={e => setState(s => ({ ...s, monteurVorname: e.target.value }))}
                    placeholder="Vorname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nachname">Nachname Monteur *</Label>
                  <Input
                    id="nachname"
                    value={state.monteurNachname}
                    onChange={e => setState(s => ({ ...s, monteurNachname: e.target.value }))}
                    placeholder="Nachname"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pruefungsdatum">Prüfungsdatum *</Label>
                <Input
                  id="pruefungsdatum"
                  type="datetime-local"
                  value={state.pruefungsdatum}
                  onChange={e => setState(s => ({ ...s, pruefungsdatum: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Prüfergebnis *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRUEFERGEBNIS_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setState(s => ({ ...s, pruefergebnis: opt.key }))}
                      className={`rounded-xl border-2 p-3 text-sm font-medium transition-colors text-left ${
                        state.ergebnis === opt.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {state.ergebnis && state.ergebnis !== 'bestanden' && (
                <div className="space-y-1.5">
                  <Label htmlFor="maengel">Mängelbeschreibung</Label>
                  <Textarea
                    id="maengel"
                    value={state.maengelbeschreibung}
                    onChange={e => setState(s => ({ ...s, maengelbeschreibung: e.target.value }))}
                    placeholder="Beschreibe die festgestellten Mängel..."
                    rows={3}
                  />
                </div>
              )}

              {(state.ergebnis === 'nicht_bestanden' || state.ergebnis === 'bestanden_mit_maengeln') && (
                <div className="space-y-1.5">
                  <Label htmlFor="massnahmen">Maßnahmen</Label>
                  <Textarea
                    id="massnahmen"
                    value={state.massnahmen}
                    onChange={e => setState(s => ({ ...s, massnahmen: e.target.value }))}
                    placeholder="Welche Maßnahmen sind erforderlich?"
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="bemerkungen">Bemerkungen</Label>
                <Textarea
                  id="bemerkungen"
                  value={state.bemerkungen}
                  onChange={e => setState(s => ({ ...s, bemerkungen: e.target.value }))}
                  placeholder="Weitere Bemerkungen (optional)"
                  rows={2}
                />
              </div>

              {state.ergebnis === 'nicht_bestanden' && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <IconAlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700">
                    Bei „Nicht bestanden" bleibt der Auftragsstatus auf „In Bearbeitung".
                  </p>
                </div>
              )}

              {state.ergebnis && (state.ergebnis === 'bestanden' || state.ergebnis === 'bestanden_mit_maengeln') && (
                <div className="flex items-start gap-2 rounded-xl bg-green-50 border border-green-200 p-3">
                  <IconClipboardCheck size={16} className="text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-700">
                    Der Auftrag wird nach dem Abschluss auf „Abgeschlossen" gesetzt.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  Zurück
                </Button>
                <Button
                  className="flex-1"
                  disabled={pruefergebnisMissing.length > 0}
                  onClick={() => setStep(3)}
                >
                  Weiter zur Prüfung
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Summary + Submit */}
      {step === 3 && !result && (
        <SummaryStep
          title="Alles richtig?"
          items={[
            {
              label: 'Auftrag',
              value: selectedAuftrag
                ? <span className="flex items-center gap-2">
                    {selectedAuftrag.fields.auftragsnummer ?? selectedAuftrag.record_id}
                    {selectedAuftrag.fields.status && (
                      <StatusBadge statusKey={selectedAuftrag.fields.status.key} label={selectedAuftrag.fields.status.label} />
                    )}
                  </span>
                : '—',
              step: 1,
            },
            {
              label: 'Kunde',
              value: selectedAuftrag ? resolveKundeName(selectedAuftrag) : '—',
            },
            {
              label: 'Monteur',
              value: [state.monteurVorname, state.monteurNachname].filter(Boolean).join(' ') || '—',
              step: 2,
            },
            {
              label: 'Prüfungsdatum',
              value: state.pruefungsdatum ? formatDateTime(state.pruefungsdatum) : '—',
              step: 2,
            },
            {
              label: 'Prüfergebnis',
              value: ergebnisLabel,
              step: 2,
            },
            ...(state.ergebnis !== 'bestanden' && state.maengelbeschreibung.trim() ? [{
              label: 'Mängelbeschreibung',
              value: state.maengelbeschreibung,
              step: 2,
            }] : []),
            ...(state.massnahmen.trim() ? [{
              label: 'Maßnahmen',
              value: state.massnahmen,
              step: 2,
            }] : []),
            {
              label: 'Statusänderung',
              value: statusWirdGeaendert
                ? 'Auftrag wird auf „Abgeschlossen" gesetzt'
                : 'Status bleibt „In Bearbeitung"',
            },
          ]}
          onEdit={setStep}
          whatHappensNext={
            statusWirdGeaendert
              ? 'Das Prüfprotokoll wird angelegt und der Auftrag als abgeschlossen markiert.'
              : 'Das Prüfprotokoll wird angelegt. Der Auftrag bleibt in Bearbeitung, da die Prüfung nicht bestanden wurde.'
          }
          confirmLabel="Jetzt abschließen"
          onConfirm={async () => {
            const r = await submit();
            if (r) setStep(4);
          }}
          submitting={submitting}
          missing={pruefergebnisMissing}
          error={submitError}
        />
      )}

      {/* Step 4: Success */}
      {step === 4 && result && (
        <SuccessStep
          title={
            result.statusChanged
              ? `Auftrag ${result.auftragsnummer} abgeschlossen`
              : `Prüfprotokoll für ${result.auftragsnummer} erfasst`
          }
          details={[
            `Prüfergebnis: ${result.ergebnisLabel}`,
            result.statusChanged
              ? 'Auftragsstatus auf „Abgeschlossen" gesetzt'
              : 'Auftragsstatus bleibt „In Bearbeitung" (nicht bestanden)',
            `Prüfprotokoll angelegt für ${result.kundeName}`,
          ]}
          actions={[
            { label: 'Neuen Auftrag anlegen', href: '#/intents/neuer-auftrag' },
            { label: 'Weiteren Auftrag abschließen', onClick: () => {
              handleReset();
              undoToast('Wizard zurückgesetzt');
            }},
            { label: 'Zurück zum Dashboard', href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
