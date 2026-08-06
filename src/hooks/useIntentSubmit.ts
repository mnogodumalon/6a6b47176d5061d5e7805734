import { useCallback, useRef, useState } from 'react';

/** Write-state for a wizard's final submit.
 *
 *  Centralizes the three rules every flow used to hand-roll:
 *    · retry guard — a second click while submitting (or after success)
 *      never fires the write again; the stored result IS the idempotency key
 *    · failed writes keep the entered data — the error is state, not an alert;
 *      pair it with SummaryStep's `error`/`onRetry` props
 *    · success is a state transition — flip your wizard to the SuccessStep
 *      when `done` turns true (or await the `submit()` promise)
 *
 *  const { submit, submitting, error, done, result } =
 *    useIntentSubmit(async () => {
 *      const auftrag = await service.createAuftraegeEntry({ ... });
 *      return auftrag; // becomes `result`
 *    });
 */
export function useIntentSubmit<T = unknown>(fn: () => Promise<T>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  // Latest fn without re-creating submit — steps update state every keystroke.
  const fnRef = useRef(fn);
  fnRef.current = fn;
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
