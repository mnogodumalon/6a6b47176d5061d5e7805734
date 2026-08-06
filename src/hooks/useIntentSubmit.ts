import { useCallback, useRef, useState } from 'react';
import { clearIntentDraft } from '@/components/blocks/IntentWizardShell';

/** Write-state for a wizard's final submit.
 *
 *  Centralizes the rules every flow used to hand-roll:
 *    · retry guard — a second click while submitting (or after success)
 *      never fires the write again; the stored result IS the idempotency key
 *    · failed writes keep the entered data — the error is state, not an alert;
 *      pair it with SummaryStep's `error`/`onRetry` props
 *    · success is a state transition — flip your wizard to the SuccessStep
 *      when `done` turns true (or await the `submit()` promise)
 *    · pass the SAME `draftKey` you gave the shell — the hook clears the
 *      draft on success. A draft that survives its flow resurrects a
 *      finished wizard on the next visit (live-seen: a phantom "angelegt"
 *      screen with a freshly recomputed order number).
 *
 *  const { submit, submitting, error, done, result } =
 *    useIntentSubmit(async () => {
 *      const auftrag = await service.createAuftraegeEntry({ ... });
 *      return auftrag; // becomes `result` — render the SuccessStep from it
 *    }, { draftKey: 'intent:auftrag-anlegen' });
 */
export function useIntentSubmit<T = unknown>(
  fn: () => Promise<T>,
  options?: { draftKey?: string },
) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  // Latest fn without re-creating submit — steps update state every keystroke.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const busyRef = useRef(false);

  const submit = useCallback(async (): Promise<T | null> => {
    if (busyRef.current) return null; // guard: submitting or already done
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fnRef.current();
      setResult(r);
      setDone(true);
      if (optionsRef.current?.draftKey) clearIntentDraft(optionsRef.current.draftKey);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      busyRef.current = false; // a failed write may be retried
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  /** Start over (e.g. "weiteren Auftrag anlegen" on the SuccessStep). */
  const reset = useCallback(() => {
    busyRef.current = false;
    setSubmitting(false);
    setError(null);
    setDone(false);
    setResult(null);
  }, []);

  return { submit, submitting, error, done, result, reset };
}
