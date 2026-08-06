/**
 * Auftrag abschließen — 4-Schritt-Wizard (Auswahl → Prüfprotokoll → Zusammenfassung → Ergebnis).
 * Steps: 1) Auftrag auswählen (status offen|in_bearbeitung) → 2) Prüfprotokoll erfassen →
 *        3) Zusammenfassung prüfen & bestätigen → 4) Ergebnis.
 * Reads: auftraege, auftragspositionen. Writes: pruefprotokoll (createPruefprotokollEntry),
 *        auftraege (updateAuftraegeEntry — status + liefertermin).
 * Composes: IntentWizardShell, EntitySelectStep, SummaryStep, SuccessStep.
 */

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconCheck,
  IconX,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { IntentWizardShell, clearIntentDraft } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useIntentSubmit } from '@/hooks/useIntentSubmit';
import type { Auftraege } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { lookupKey } from '@/lib/formatters';

const PRUEFERGEBNIS_OPTIONS = LOOKUP_OPTIONS['pruefprotokoll']?.['pruefergebnis'] ?? [];
const DRAFT_KEY = 'intent:auftrag-abschliessen';

interface DraftState {
  auftragId: string;
  monteurVorname: string;
  monteurNachname: string;
  pruefungsdatum: string;
  pruefergebnis: string;
  maengelbeschreibung: string;
  massnahmen: string;
  bemerkungen: string;
}

const initialDraft: DraftState = {
  auftragId: '',
  monteurVorname: '',
  monteurNachname: '',
  pruefungsdatum: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  pruefergebnis: PRUEFERGEBNIS_OPTIONS[0]?.key ?? '',
  maengelbeschreibung: '',
  massnahmen: '',
  bemerkungen: '',
};

function auftragLabel(a: Auftraege): string {
  return a.fields.auftragsnummer ?? a.record_id;
}

export default function AuftragAbschliessenPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { auftraege, auftragspositionen, loading, error, fetchAll } = useDashboardData();

  const initialStep = Number(searchParams.get('step') ?? '1') || 1;
  const [step, setStep] = useState(initialStep);
  const [state, setState] = useState<DraftState>(() => {
    const urlAuftragId = searchParams.get('auftragId') ?? '';
    return { ...initialDraft, auftragId: urlAuftragId };
  });
  const [protokollId, setProtokollId] = useState<string>('');

  // Sync step into URL params
  useEffect(() => {
    const params: Record<string, string> = { step: String(step) };
    if (state.auftragId) params.auftragId = state.auftragId;
    setSearchParams(params, { replace: true });
  }, [step, state.auftragId, setSearchParams]);

  // Auto-advance to step 2 when auftragId is pre-set via URL
  useEffect(() => {
    if (!loading && state.auftragId && step === 1) {
      const found = auftraege.find(a => a.record_id === state.auftragId);
      if (found) {
        const st = lookupKey(found.fields.status);
        if (st === 'offen' || st === 'in_bearbeitung') {
          // Prefill monteur from auftrag
          const monteur = found.fields.monteur ?? '';
          const parts = monteur.split(' ');
          setState(s => ({
            ...s,
            monteurVorname: s.monteurVorname || (parts[0] ?? ''),
            monteurNachname: s.monteurNachname || (parts.slice(1).join(' ') ?? ''),
          }));
          setStep(2);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Eligible auftraege: only offen|in_bearbeitung
  const eligibleAuftraege = useMemo(
    () => auftraege.filter(a => {
      const st = lookupKey(a.fields.status);
      return st === 'offen' || st === 'in_bearbeitung';
    }),
    [auftraege]
  );

  // Count positions per auftrag
  const positionCountMap = useMemo(() => {
    const m = new Map<string, number>();
    auftragspositionen.forEach(p => {
      const auftragUrl = p.fields.auftrag;
      const id = extractRecordId(auftragUrl ?? '');
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    });
    return m;
  }, [auftragspositionen]);

  const selectedAuftrag = useMemo(
    () => auftraege.find(a => a.record_id === state.auftragId) ?? null,
    [auftraege, state.auftragId]
  );

  const pruefergebnisBestanden = state.pruefergebnis === 'bestanden' || state.pruefergebnis === 'bestanden_mit_maengeln';
  const showMaengel = state.pruefergebnis === 'nicht_bestanden' || state.pruefergebnis === 'bestanden_mit_maengeln';

  const handleSelectAuftrag = (id: string) => {
    const found = auftraege.find(a => a.record_id === id);
    const monteur = found?.fields.monteur ?? '';
    const parts = monteur.split(' ');
    setState(s => ({
      ...s,
      auftragId: id,
      monteurVorname: parts[0] ?? '',
      monteurNachname: parts.slice(1).join(' ') ?? '',
    }));
    setStep(2);
  };

  const { submit, submitting, error: submitError, done, reset } = useIntentSubmit(async () => {
    if (!state.auftragId) throw new Error('Kein Auftrag ausgewählt');

    // Step A: If status is still 'offen', update to 'in_bearbeitung' first
    const currentStatus = lookupKey(selectedAuftrag?.fields.status);
    if (currentStatus === 'offen') {
      await LivingAppsService.updateAuftraegeEntry(state.auftragId, { status: 'in_bearbeitung' });
    }

    // Step B: Create Prüfprotokoll (idempotent guard with stored id)
    let pid = protokollId;
    if (!pid) {
      const payload: Record<string, unknown> = {
        auftrag_pruef: createRecordUrl(APP_IDS.AUFTRAEGE, state.auftragId),
        monteur_name_vorname: state.monteurVorname,
        monteur_name_nachname: state.monteurNachname,
        pruefungsdatum: state.pruefungsdatum,
        pruefergebnis: state.pruefergebnis,
        massnahmen: state.massnahmen || undefined,
        bemerkungen_pruef: state.bemerkungen || undefined,
      };
      if (showMaengel && state.maengelbeschreibung) {
        payload.maengelbeschreibung = state.maengelbeschreibung;
      }
      const created = await LivingAppsService.createPruefprotokollEntry(payload as Parameters<typeof LivingAppsService.createPruefprotokollEntry>[0]);
      pid = created.record_id;
      setProtokollId(pid);
    }

    // Step C: Close the order only if passed
    if (pruefergebnisBestanden) {
      await LivingAppsService.updateAuftraegeEntry(state.auftragId, {
        status: 'abgeschlossen',
        liefertermin: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      });
    }

    await fetchAll();
    clearIntentDraft(DRAFT_KEY);
  });

  const handleConfirm = async () => {
    if (await submit()) setStep(4);
  };

  const resetWizard = () => {
    setProtokollId('');
    setState(initialDraft);
    reset();
    setStep(1);
  };

  const wizardSteps = [
    { label: 'Auftrag' },
    { label: 'Prüfprotokoll' },
    { label: 'Prüfen' },
    { label: 'Ergebnis' },
  ];

  const answers = step > 1 && selectedAuftrag
    ? [
        {
          label: 'Auftrag',
          value: `${auftragLabel(selectedAuftrag)}${selectedAuftrag.fields.auftragsdatum ? ` · ${selectedAuftrag.fields.auftragsdatum}` : ''}`,
        },
      ]
    : undefined;

  const pruefergebnisFull =
    PRUEFERGEBNIS_OPTIONS.find(o => o.key === state.pruefergebnis)?.label ?? state.pruefergebnis;

  return (
    <IntentWizardShell
      title="Auftrag abschließen"
      subtitle="Prüfprotokoll erstellen und Auftrag abschließen"
      steps={wizardSteps}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
      intro={{
        description:
          'Wähle einen offenen Auftrag, erfasse das Prüfprotokoll und schließe den Auftrag ab — oder halte ihn offen, wenn Mängel behoben werden müssen.',
        requirements: ['Offener oder in Bearbeitung befindlicher Auftrag', 'Monteurdaten', 'Prüfergebnis'],
      }}
      answers={answers}
      draftKey={DRAFT_KEY}
      draft={state}
      onDraftRestore={(d) => setState(d as DraftState)}
    >
      {/* ── Schritt 1: Auftrag auswählen ── */}
      {step === 1 && (
        <EntitySelectStep
          items={eligibleAuftraege.map(a => ({
            id: a.record_id,
            title: auftragLabel(a),
            subtitle: `${a.fields.auftragsdatum ?? '—'} · Priorität: ${a.fields.prioritaet?.label ?? '—'}`,
            status: a.fields.status
              ? { key: a.fields.status.key, label: a.fields.status.label }
              : undefined,
            stats: [
              { label: 'Positionen', value: positionCountMap.get(a.record_id) ?? 0 },
            ],
            icon: <IconClipboardCheck size={20} className="text-primary" />,
          }))}
          onSelect={handleSelectAuftrag}
          searchPlaceholder="Auftrag suchen …"
          emptyText="Keine offenen Aufträge vorhanden."
        />
      )}

      {/* ── Schritt 2: Prüfprotokoll erfassen ── */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">
              Prüfprotokoll für Auftrag {auftragLabel(selectedAuftrag!)}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Erfasse die Prüfdaten für diesen Auftrag.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Vorname Monteur *</Label>
              <Input
                value={state.monteurVorname}
                onChange={e => setState(s => ({ ...s, monteurVorname: e.target.value }))}
                placeholder="z. B. Max"
              />
            </div>
            <div className="space-y-1">
              <Label>Nachname Monteur *</Label>
              <Input
                value={state.monteurNachname}
                onChange={e => setState(s => ({ ...s, monteurNachname: e.target.value }))}
                placeholder="z. B. Mustermann"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Prüfungsdatum *</Label>
            <Input
              type="datetime-local"
              value={state.pruefungsdatum}
              onChange={e => setState(s => ({ ...s, pruefungsdatum: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Prüfergebnis *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRUEFERGEBNIS_OPTIONS.map(opt => {
                const isSelected = state.pruefergebnis === opt.key;
                const colorClass =
                  opt.key === 'bestanden'
                    ? isSelected
                      ? 'border-green-500 bg-green-50 dark:bg-green-950'
                      : 'border-border'
                    : opt.key === 'bestanden_mit_maengeln'
                    ? isSelected
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950'
                      : 'border-border'
                    : isSelected
                    ? 'border-destructive bg-destructive/10'
                    : 'border-border';

                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setState(s => ({ ...s, pruefergebnis: opt.key, maengelbeschreibung: '' }))}
                    className={`rounded-xl border-2 p-3 text-left transition-colors ${colorClass}`}
                  >
                    <div className="flex items-center gap-2">
                      {opt.key === 'bestanden' && <IconCheck size={16} className="text-green-600" />}
                      {opt.key === 'bestanden_mit_maengeln' && <IconAlertTriangle size={16} className="text-amber-600" />}
                      {opt.key === 'nicht_bestanden' && <IconX size={16} className="text-destructive" />}
                      <span className="text-sm font-medium">{opt.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {showMaengel && (
            <div className="space-y-1">
              <Label>Mängelbeschreibung *</Label>
              <Textarea
                value={state.maengelbeschreibung}
                onChange={e => setState(s => ({ ...s, maengelbeschreibung: e.target.value }))}
                placeholder="Beschreibe die festgestellten Mängel …"
                rows={3}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>Maßnahmen</Label>
            <Textarea
              value={state.massnahmen}
              onChange={e => setState(s => ({ ...s, massnahmen: e.target.value }))}
              placeholder="Geplante oder durchgeführte Maßnahmen …"
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label>Bemerkungen</Label>
            <Textarea
              value={state.bemerkungen}
              onChange={e => setState(s => ({ ...s, bemerkungen: e.target.value }))}
              placeholder="Sonstige Bemerkungen …"
              rows={2}
            />
          </div>

          {state.pruefergebnis === 'nicht_bestanden' && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 flex gap-2 items-start">
              <IconAlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">
                Bei <strong>Nicht bestanden</strong> wird der Auftrag <strong>nicht abgeschlossen</strong> — er bleibt offen für Nachbesserung.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
            >
              Zurück
            </Button>
            <Button
              disabled={
                !state.monteurVorname ||
                !state.monteurNachname ||
                !state.pruefungsdatum ||
                (showMaengel && !state.maengelbeschreibung)
              }
              onClick={() => setStep(3)}
              className="flex-1"
            >
              Weiter zur Zusammenfassung
            </Button>
          </div>
        </div>
      )}

      {/* ── Schritt 3: Zusammenfassung ── */}
      {step === 3 && !done && (
        <SummaryStep
          items={[
            {
              label: 'Auftrag',
              value: selectedAuftrag
                ? `${auftragLabel(selectedAuftrag)} · ${selectedAuftrag.fields.auftragsdatum ?? '—'}`
                : '—',
              step: 1,
            },
            {
              label: 'Monteur',
              value: `${state.monteurVorname} ${state.monteurNachname}`,
              step: 2,
            },
            {
              label: 'Prüfungsdatum',
              value: state.pruefungsdatum,
              step: 2,
            },
            {
              label: 'Prüfergebnis',
              value: pruefergebnisFull,
              step: 2,
            },
            ...(showMaengel && state.maengelbeschreibung
              ? [{ label: 'Mängel', value: state.maengelbeschreibung, step: 2 }]
              : []),
            ...(state.massnahmen ? [{ label: 'Maßnahmen', value: state.massnahmen, step: 2 }] : []),
            {
              label: 'Ergebnis für Auftrag',
              value: pruefergebnisBestanden
                ? 'Auftrag wird auf „Abgeschlossen" gesetzt'
                : 'Auftrag bleibt offen — Nachbesserung erforderlich',
            },
          ]}
          onEdit={setStep}
          whatHappensNext={
            pruefergebnisBestanden
              ? 'Das Prüfprotokoll wird gespeichert und der Auftrag auf „Abgeschlossen" gesetzt.'
              : 'Das Prüfprotokoll wird gespeichert. Der Auftrag bleibt auf „In Bearbeitung" — es sind Nachbesserungen erforderlich.'
          }
          confirmLabel={pruefergebnisBestanden ? 'Auftrag abschließen' : 'Protokoll speichern'}
          onConfirm={handleConfirm}
          submitting={submitting}
          error={submitError ?? undefined}
        />
      )}

      {/* ── Schritt 4: Ergebnis ── */}
      {step === 4 && done && (
        <SuccessStep
          title={
            pruefergebnisBestanden
              ? `Auftrag ${auftragLabel(selectedAuftrag!)} abgeschlossen`
              : `Prüfprotokoll für ${auftragLabel(selectedAuftrag!)} gespeichert`
          }
          details={[
            `Prüfer: ${state.monteurVorname} ${state.monteurNachname}`,
            `Ergebnis: ${pruefergebnisFull}`,
            ...(pruefergebnisBestanden
              ? ['Auftragsstatus: Abgeschlossen', `Liefertermin gesetzt: ${format(new Date(), 'dd.MM.yyyy HH:mm')}`]
              : ['Auftragsstatus: In Bearbeitung — Nachbesserung erforderlich']),
          ]}
          actions={[
            {
              label: 'Neuen Auftrag anlegen',
              href: '#/intents/auftrag-mit-positionen',
            },
            {
              label: 'Weiteren Auftrag abschließen',
              onClick: resetWizard,
            },
            {
              label: 'Zurück zum Dashboard',
              href: '#/',
            },
          ]}
        />
      )}

      {/* Fallback when deep-linking to step 2+ without auftragId */}
      {step === 2 && !state.auftragId && (
        <div className="rounded-xl border p-4 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Kein Auftrag ausgewählt.</p>
          <Button onClick={() => setStep(1)}>Zurück zur Auftragsauswahl</Button>
        </div>
      )}
      {step === 3 && !state.auftragId && (
        <div className="rounded-xl border p-4 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Kein Auftrag ausgewählt.</p>
          <Button onClick={() => setStep(1)}>Zurück zur Auftragsauswahl</Button>
        </div>
      )}
    </IntentWizardShell>
  );
}
