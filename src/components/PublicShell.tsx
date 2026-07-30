import type { ReactNode } from 'react';
import { IconLoader2 } from '@tabler/icons-react';

// Layout shell for public (anonymous) pages — the public counterpart to
// IntentWizardShell. Owns the page chrome every public page shares: centered
// mobile-first column, header, powered-by footer, and the loading /
// unavailable states. Pages own their content (cards, forms, lists) — the
// shell never wraps children in a card.
//
// Used by agent-built bespoke pages (see the public-builder skill); the
// generic PublicFormPage predates it and renders its own identical chrome.

interface PublicShellProps {
  title?: string;
  description?: string;
  /** Wider column for list/booking layouts (max-w-2xl instead of max-w-lg). */
  wide?: boolean;
  /** Landing mode: children own the FULL page width — build full-bleed
   *  sections (hero bands, card grids) with their own inner max-w
   *  containers. The form columns above are far too narrow for that.
   *  Loading/unavailable states still render centered. */
  fullBleed?: boolean;
  loading?: boolean;
  /** Renders the friendly "not available" card instead of children. */
  unavailable?: boolean;
  children?: ReactNode;
}

export function PublicShell({ title, description, wide, fullBleed, loading, unavailable, children }: PublicShellProps) {
  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex justify-center pt-16">
        <IconLoader2 size={28} stroke={1.5} className="animate-spin text-muted-foreground" />
      </div>
    );
  } else if (unavailable) {
    body = (
      <div className="rounded-[27px] bg-card shadow-lg p-6 sm:p-8 text-center">
        <h1 className="text-xl font-medium mb-2">Nicht verfügbar</h1>
        <p className="text-muted-foreground">Diese Seite ist derzeit nicht verfügbar.</p>
      </div>
    );
  } else {
    body = (
      <>
        {title ? (
          <header className="mb-6">
            <h1 className="text-2xl font-normal">{title}</h1>
            {description ? <p className="text-base text-muted-foreground mt-1">{description}</p> : null}
          </header>
        ) : null}
        {children}
      </>
    );
  }

  // States always render in the centered column; full-bleed applies only
  // to real page content.
  const constrained = !fullBleed || loading || unavailable;
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className={`flex-1 w-full ${constrained ? `${wide ? 'max-w-2xl' : 'max-w-lg'} mx-auto px-4 py-8 sm:py-12` : ''}`}>
        {body}
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">
        Powered by Klar
      </footer>
    </div>
  );
}
