import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { IconAlertCircle, IconArrowLeft, IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';

interface WizardStep {
  label: string;
}

interface WizardIntro {
  /** One or two sentences: what this flow does. */
  description?: string;
  /** "Du brauchst: …" — what the user must have at hand before starting. */
  requirements?: string[];
  startLabel?: string;
}

interface IntentWizardShellProps {
  /** Omit inside a PublicShell that already carries the title — otherwise the
   *  page shows the same heading twice (both render an <h1>). */
  title?: string;
  subtitle?: string;
  steps: WizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Header back link. Defaults to the dashboard; pass false to hide it
   *  (public pages have no dashboard to go back to). */
  back?: { href: string; label: string } | false;
  /** Start card shown before step 1: step list, description, requirements.
   *  Skipped automatically on deep links and restored drafts. */
  intro?: WizardIntro;
  /** Answers so far — rendered as a persistent context bar above the step,
   *  so the user recognizes instead of remembering ("Kunde: Müller GmbH"). */
  answers?: { label: string; value: ReactNode }[];
  /** localStorage key enabling draft persistence, e.g. 'intent:auftrag-anlegen'.
   *  Call clearIntentDraft(draftKey) after the final successful write. */
  draftKey?: string;
  /** JSON-serializable snapshot of the wizard's state; saved on every change. */
  draft?: unknown;
  /** Receives the saved snapshot on mount — restore your state from it. */
  onDraftRestore?: (data: unknown) => void;
  children: ReactNode;
}

/** All dashboards share the my.living-apps.de origin, so a bare slug key
 *  ('intent:auftrag-abschliessen') collides across dashboards that carry a
 *  flow with the same slug — a draft from one app would be restored into
 *  another app's flow, with record ids of the wrong app. The pathname
 *  (/objects/<id>/) is unique per dashboard and namespaces the key. */
function draftStorageKey(draftKey: string): string {
  return `${window.location.pathname}#${draftKey}`;
}

/** Remove a flow's saved draft — call this after the final successful write
 *  (or pass `draftKey` to useIntentSubmit, which then clears it for you),
 *  otherwise the next visit resumes a flow that is already finished. */
export function clearIntentDraft(draftKey: string): void {
  try {
    localStorage.removeItem(draftStorageKey(draftKey));
  } catch {
    // storage unavailable — nothing to clear
  }
}

export function IntentWizardShell({
  title,
  subtitle,
  steps,
  currentStep,
  onStepChange,
  loading,
  error,
  onRetry,
  back,
  intro,
  answers,
  draftKey,
  draft,
  onDraftRestore,
  children,
}: IntentWizardShellProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [started, setStarted] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  // Sync step to URL params
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (currentStep > 1) {
      params.set('step', String(currentStep));
    } else {
      params.delete('step');
    }
    setSearchParams(params, { replace: true });
  }, [currentStep, searchParams, setSearchParams]);

  // On mount: restore a saved draft (state AND step), else honor ?step=N.
  // The draft wins — a deep link without the restored state would land on
  // empty steps.
  useEffect(() => {
    let restoredStep: number | null = null;
    if (draftKey && onDraftRestore) {
      try {
        const raw = localStorage.getItem(draftStorageKey(draftKey));
        if (raw) {
          const saved = JSON.parse(raw) as { step?: number; data?: unknown };
          if (saved && saved.data !== undefined) {
            onDraftRestore(saved.data);
            setDraftRestored(true);
            if (typeof saved.step === 'number') restoredStep = saved.step;
          }
        }
      } catch {
        // corrupt or unavailable storage — start fresh
      }
    }
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    const target = restoredStep ?? (urlStep >= 1 ? urlStep : null);
    if (target != null && target >= 1 && target <= steps.length && target !== currentStep) {
      onStepChange(target);
    }
    if ((target != null && target > 1) || restoredStep != null) setStarted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft after every change — the field reality of this app's
  // users is interruptions (phone call, dead spot), not tidy sessions.
  useEffect(() => {
    if (!draftKey || draft === undefined) return;
    try {
      localStorage.setItem(draftStorageKey(draftKey), JSON.stringify({ step: currentStep, data: draft }));
    } catch {
      // storage full or unavailable — the wizard still works, just without resume
    }
  }, [draftKey, draft, currentStep]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="flex gap-2">
          {steps.map((_, i) => <Skeleton key={i} className="h-2 flex-1 rounded-full" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <IconAlertCircle size={22} className="text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
            <p className="text-sm text-muted-foreground max-w-xs">{error.message}</p>
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>Erneut versuchen</Button>
          )}
        </div>
      </div>
    );
  }

  const header = (
    <div>
      {back !== false && (
        <a href={back?.href ?? '#/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
          <IconArrowLeft size={14} className="shrink-0" />
          {back?.label ?? 'Zurück zum Dashboard'}
        </a>
      )}
      {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );

  // Start card: expectations before commitment (steps, description, needs).
  if (intro && !started && currentStep === 1) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {header}
        <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-6 max-w-xl">
          {intro.description && (
            <p className="text-sm text-muted-foreground">{intro.description}</p>
          )}
          <ol className="space-y-2.5">
            {steps.map((step, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                  {idx + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
          {intro.requirements && intro.requirements.length > 0 && (
            <div className="rounded-xl bg-secondary/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary-foreground mb-1.5">Das brauchst du</p>
              <ul className="space-y-1">
                {intro.requirements.map((req, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground">{req}</li>
                ))}
              </ul>
            </div>
          )}
          <Button className="w-full h-12 text-base" onClick={() => setStarted(true)}>
            {intro.startLabel ?? 'Jetzt starten'}
          </Button>
        </div>
      </div>
    );
  }

  const stepsLeft = steps.length - currentStep;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {header}

      {/* Step Indicator — visited circles are buttons: free jumps backwards */}
      <div>
        <div className="flex items-center gap-0">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={idx + 1 < currentStep ? () => onStepChange(idx + 1) : undefined}
                  disabled={idx + 1 > currentStep}
                  aria-current={idx + 1 === currentStep ? 'step' : undefined}
                  aria-label={`${step.label} (${idx + 1}/${steps.length})`}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                    idx + 1 < currentStep
                      ? 'bg-primary text-primary-foreground cursor-pointer hover:ring-4 hover:ring-primary/20 focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none'
                      : idx + 1 === currentStep
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {idx + 1 < currentStep ? <IconCheck size={14} stroke={2.5} /> : idx + 1}
                </button>
                <span className={`text-xs font-medium whitespace-nowrap hidden sm:block ${
                  idx + 1 === currentStep ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-2 mb-5 transition-colors ${
                  idx + 1 < currentStep ? 'bg-primary' : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
        </div>
        {stepsLeft > 0 && (
          <p className="text-xs text-muted-foreground mt-2 text-right">
            {stepsLeft === 1 ? 'Noch 1 Schritt' : 'Noch {n} Schritte'.replace('{n}', String(stepsLeft))}
          </p>
        )}
      </div>

      {/* Resumed-draft hint */}
      {draftRestored && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <IconInfoCircle size={16} className="shrink-0" />
          <span>Entwurf wiederhergestellt — du kannst weitermachen.</span>
          <button
            type="button"
            className="ml-auto shrink-0 hover:text-foreground"
            onClick={() => setDraftRestored(false)}
            aria-label="Ausblenden"
          >
            <IconX size={16} />
          </button>
        </div>
      )}

      {/* Context bar: answers so far — recognition instead of recall */}
      {answers && answers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-secondary/60 px-4 py-2.5">
          {answers.map((a, idx) => (
            <span key={idx} className="text-sm">
              <span className="text-muted-foreground">{a.label}: </span>
              <span className="font-medium">{a.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Step Content */}
      <div>{children}</div>

      {/* Navigation — hidden by default; steps provide their own action buttons */}
    </div>
  );
}
