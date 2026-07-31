import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { INTENTS, INTENTS_PENDING } from '@/config/intents';

/**
 * IntentsNav — Drawer-Sektion für Intent-Workflow-Seiten ("Abläufe").
 *
 * Rendert eine <la-nav> (LivingApps Web Component) im select-Modus aus dem
 * `src/config/intents.ts`-Registry: sobald der Intents-Orchestrator dort eine
 * Seite registriert, taucht sie hier auf — kein Layout-Edit nötig. Der
 * Aktiv-Zustand läuft über das `here`-Flag der Items (host-kontrolliert: bei
 * jedem Routenwechsel wird data-nav neu gesetzt, was die interne Auswahl der
 * la-nav zurücksetzt). `nav:select` wird auf React-Routers navigate() gemappt.
 *
 * Während INTENTS_PENDING (Phase-1-Deploy-Fenster) zeigt die la-nav ihr
 * eingebautes pending-Rendering (pulsierende Zeile). Leer UND nicht pending
 * → nichts.
 */
const HEADING = 'Abläufe';
const PENDING_TEXT = 'Werden erstellt …';

type LaNavItem = { title: string; url?: string; here?: boolean; pending?: boolean; meta?: { path: string } };

export function IntentsNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Die Gruppe startet ZUgeklappt (Figma-Muster). Das Widget kennt kein
  // steuerbares collapsed-Attribut (foldable/collapsed sind in der aktuellen
  // Release wirkungslos) — deshalb einmalig beim Mount den aria-Toggle im
  // Shadow klicken; der [aria-expanded="true"]-Guard trifft nur eine offene
  // Sektion. Interval-Fallback, weil der Loader asynchron lädt. Während
  // INTENTS_PENDING bleibt die Gruppe offen (Ghost-Zeile sichtbar).
  useEffect(() => {
    if (INTENTS.length === 0 || INTENTS_PENDING) return;
    const collapse = () => {
      const btn = sectionRef.current?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
      if (!btn) return false;
      btn.click();
      return true;
    };
    if (collapse()) return;
    const timer = window.setInterval(() => { if (collapse()) window.clearInterval(timer); }, 250);
    const stop = window.setTimeout(() => window.clearInterval(timer), 5000);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); };
  }, []);

  const itemsJson = useMemo(() => {
    let items: LaNavItem[];
    if (INTENTS.length === 0) {
      items = INTENTS_PENDING ? [{ title: PENDING_TEXT, pending: true }] : [];
    } else {
      items = INTENTS.map(intent => ({
        title: intent.label,
        url: `#${intent.path}`,
        here: location.pathname === intent.path,
        meta: { path: intent.path },
      }));
    }
    return JSON.stringify(items);
  }, [location.pathname]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ meta?: { path?: string } }>).detail?.meta?.path;
      if (!path) return;
      navigate(path);
      // select-Modus verhindert den nativen Klick, daher kollabiert der
      // Drawer sein mobiles Vollbild-Overlay nicht selbst — hier nachziehen.
      if (window.matchMedia('(max-width: 767.98px)').matches) {
        el.closest('la-drawer')?.setAttribute('collapsed', '');
      }
    };
    el.addEventListener('nav:select', handler);
    return () => el.removeEventListener('nav:select', handler);
  }, [navigate]);

  if (INTENTS.length === 0 && !INTENTS_PENDING) return null;

  return (
    // primary = aufklappbare Gruppe INNERHALB der Aktionen-Sektion (Layout),
    // gleiches Muster wie „Datenverwaltung" unter Darstellung. dense = die
    // kleinere Unterpunkt-Schrift (--la-nav-text-size), wie im Gateway.
    <la-nav-section ref={sectionRef} type="primary" label={HEADING} dense="">
      <la-nav ref={navRef} mode="select" data-nav={itemsJson} />
    </la-nav-section>
  );
}
