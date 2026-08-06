import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconCircleCheck, IconCheck } from '@tabler/icons-react';

export interface SuccessAction {
  label: string;
  /** Hash link ('#/…' or '#/intents/…') — used when onClick is not given. */
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
}

interface SuccessStepProps {
  /** Name the result, with its number: "Auftrag AU-2026-001 angelegt". */
  title: string;
  /** One fact per line: what the flow caused ("3 Positionen reserviert"). */
  details?: ReactNode[];
  /** 2–3 follow-up actions. The FIRST one is the primary button — make it
   *  the next logical step of the work, not a plain "back to list". */
  actions?: SuccessAction[];
  children?: ReactNode;
}

/** Final wizard step after a successful write. The flow does NOT jump back
 *  to a list — it names the result and offers the next steps. */
export function SuccessStep({ title, details, actions, children }: SuccessStepProps) {
  return (
    <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 text-center space-y-5">
      <IconCircleCheck size={44} stroke={1.5} className="mx-auto text-primary" aria-hidden="true" />
      <h2 className="text-xl font-semibold">{title}</h2>

      {details && details.length > 0 && (
        <ul className="inline-block text-left space-y-1.5">
          {details.map((d, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
              <IconCheck size={16} className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}

      {children}

      {actions && actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
          {actions.map((action, idx) => (
            <Button
              key={idx}
              variant={idx === 0 ? 'default' : 'outline'}
              className={idx === 0 ? 'h-12 text-base sm:min-w-48' : 'h-12'}
              onClick={
                action.onClick ??
                (() => {
                  window.location.href = action.href ?? '#/';
                })
              }
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
