import { Suspense, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import PublicFormPage from '@/pages/public/PublicFormPage';
import { PUBLIC_PAGES } from '@/pages/public/registry';
import { loadPublicPagesConfig, type PublicPagesConfig } from '@/lib/publicClient';

const APP_TITLE = 'Handwerk Pro';

// One config read per SPA session is enough for tab titles — the page
// components below do their own fresh read for the actual content.
let configForTitle: Promise<PublicPagesConfig | null> | undefined;

// Route target for /#/public/:slug. Resolution order: a bespoke page from
// the registry wins; otherwise the generic config-driven form renderer
// takes over. Both read the same runtime config, so upgrading a page never
// changes its shared link.
export default function PublicPage() {
  const { slug } = useParams<{ slug: string }>();

  // Public pages mount outside <Layout>, so its document.title effect never
  // runs here — without this one the tab keeps the static shell's default.
  useEffect(() => {
    let cancelled = false;
    document.title = APP_TITLE;
    configForTitle ??= loadPublicPagesConfig();
    configForTitle.then((cfg) => {
      const title = slug ? cfg?.pages[slug]?.title : undefined;
      if (!cancelled && title) document.title = `${title} – ${APP_TITLE}`;
    });
    return () => { cancelled = true; };
  }, [slug]);

  const Custom = slug ? PUBLIC_PAGES[slug] : undefined;
  if (Custom) {
    return (
      <Suspense fallback={null}>
        <Custom />
      </Suspense>
    );
  }
  return <PublicFormPage />;
}
