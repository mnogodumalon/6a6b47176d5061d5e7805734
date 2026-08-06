import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconAlertCircle, IconLoader2 } from '@tabler/icons-react';

export interface SummaryItem {
  label: string;
  value: ReactNode;
  /** 1-based wizard step that edits this value — renders the change-link. */
  step?: number;
}

interface SummaryStepProps {
  /** Defaults to "Alles richtig?". */
  title?: string;
  items: SummaryItem[];
  /** Jump back to the step that owns a row. Wire to the wizard's setStep. */
  onEdit?: (step: number) => void;
  /** ONE sentence: what happens after confirming ("Der Auftrag geht an die
   *  Disposition, der Kunde erhält eine Bestätigung."). This is the flow's
   *  process knowledge — write it, don't leave it out. */
  whatHappensNext?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  submitting?: boolean;
  /** Labels of REQUIRED answers that are still empty (the brief's `!` fields).
   *  Non-empty list = confirm is disabled and the row names what is missing.
   *  Pass [] when everything required is filled — the API never rejects an
   *  empty required field, this prop is the only enforcement there is. */
  missing: string[];
  /** Failed write: the entered data stays, the row explains, retry re-runs. */
  error?: Error | null;
  onRetry?: () => void;
  /** Extra content between the list and the confirm button (totals, warnings). */
  children?: ReactNode;
}

/** Check-answers step — the last step BEFORE anything is written.
 *  Shows every answer with a change-link; the confirm button does the write. */
export function SummaryStep({
  title,
  items,
  onEdit,
  whatHappensNext,
  confirmLabel,
  onConfirm,
  submitting,
  missing,
  error,
  onRetry,
  children,
}: SummaryStepProps) {
  return (
    <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 space-y-6">
      <h2 className="text-lg font-semibold">{title ?? 'Alles richtig?'}</h2>

      <dl>
        {items.map((item, idx) => (
          <div
            key={idx}
            className={`grid grid-cols-[1fr_auto] sm:grid-cols-[12rem_1fr_auto] gap-x-4 gap-y-1 py-3 ${
              idx < items.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-sm font-medium col-span-2 sm:col-span-1">{item.value}</dd>
            {item.step != null && onEdit ? (
              <div className="row-start-1 col-start-2 sm:col-start-3">
                <button
                  type="button"
                  onClick={() => onEdit(item.step!)}
                  className="text-sm text-primary hover:underline"
                  aria-label={`Ändern: ${item.label}`}
                >
                  Ändern
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </dl>

      {children}

      {whatHappensNext && (
        <p className="text-sm text-muted-foreground">{whatHappensNext}</p>
      )}

      {missing.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Noch offen: {missing.join(', ')}
        </p>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <IconAlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-destructive">Das hat nicht geklappt — deine Eingaben sind noch da.</p>
            <p className="text-muted-foreground">{error.message}</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onRetry ?? onConfirm}>
            Erneut versuchen
          </Button>
        </div>
      )}

      <Button
        className="w-full h-12 text-base"
        onClick={onConfirm}
        disabled={!!submitting || missing.length > 0}
      >
        {submitting && <IconLoader2 size={18} className="animate-spin" />}
        {confirmLabel}
      </Button>
    </div>
  );
}
