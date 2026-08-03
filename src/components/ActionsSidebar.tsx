import { useEffect, useRef } from 'react';
import { useActions } from '@/context/ActionsContext';
import { ActionsDrawer } from '@/components/ActionsDrawer';

const LABEL = 'Werkzeuge';

/**
 * ActionsSidebar — Drawer-Eintrag, der den ActionsDrawer öffnet.
 *
 * Rendert eine Ein-Item-<la-nav> im select-Modus (Item ohne url → nur Event,
 * kein Navigieren). Der Open-State lebt im ActionsContext, damit der
 * Code-Drawer zur Übersicht zurücknavigieren kann (und Fehler ihn einklappen
 * können). Solange der ActionsDrawer offen ist, bleibt der Eintrag über die
 * interne Auswahl der la-nav hervorgehoben; beim Schließen wird data-nav neu
 * gesetzt (setAttribute feuert auch bei gleichem Wert), was die Hervorhebung
 * zurücksetzt.
 */
export function ActionsSidebar() {
  const { actionsDrawerOpen, openActionsDrawer, closeActionsDrawer } = useActions();
  const navRef = useRef<HTMLElement>(null);

  // Immer sichtbar — eine leere Liste zeigt den Empty-State des Drawers mit
  // der Im-Chat-erstellen-CTA statt den Einstiegspunkt ganz zu verstecken.
  // Ohne Zähler: schlichter Eintrag im Figma-Muster der Aktionen-Sektion.
  const itemsJson = JSON.stringify([{ title: LABEL }]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const handler = () => {
      openActionsDrawer();
      // Mobil das Drawer-Overlay einklappen, damit der ActionsDrawer nicht
      // über dem Vollbild-Nav-Overlay hängt (select-Modus = kein Auto-Collapse).
      if (window.matchMedia('(max-width: 767.98px)').matches) {
        el.closest('la-drawer')?.setAttribute('collapsed', '');
      }
    };
    el.addEventListener('nav:select', handler);
    return () => el.removeEventListener('nav:select', handler);
  }, [openActionsDrawer]);

  useEffect(() => {
    if (!actionsDrawerOpen) navRef.current?.setAttribute('data-nav', itemsJson);
  }, [actionsDrawerOpen, itemsJson]);

  return (
    <>
      <la-nav ref={navRef} mode="select" data-nav={itemsJson} />
      <ActionsDrawer open={actionsDrawerOpen} onClose={closeActionsDrawer} />
    </>
  );
}
