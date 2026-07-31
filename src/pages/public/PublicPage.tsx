import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import PublicFormPage from '@/pages/public/PublicFormPage';
import { PUBLIC_PAGES } from '@/pages/public/registry';

// Route target for /#/public/:slug. Resolution order: a bespoke page from
// the registry wins; otherwise the generic config-driven form renderer
// takes over. Both read the same runtime config, so upgrading a page never
// changes its shared link.
export default function PublicPage() {
  const { slug } = useParams<{ slug: string }>();
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
