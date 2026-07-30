import '@/lib/sentry';
import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorBusProvider } from '@/components/ErrorBus';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import PublicPagesAdmin from '@/pages/PublicPagesAdmin';
import KundenPage from '@/pages/KundenPage';
import KundenDetailPage from '@/pages/KundenDetailPage';
import MaterialPage from '@/pages/MaterialPage';
import MaterialDetailPage from '@/pages/MaterialDetailPage';
import AuftraegePage from '@/pages/AuftraegePage';
import AuftraegeDetailPage from '@/pages/AuftraegeDetailPage';
import AuftragspositionenPage from '@/pages/AuftragspositionenPage';
import AuftragspositionenDetailPage from '@/pages/AuftragspositionenDetailPage';
import PruefprotokollPage from '@/pages/PruefprotokollPage';
import PruefprotokollDetailPage from '@/pages/PruefprotokollDetailPage';
// <custom:imports>
const AuftragAnlegenPage = lazy(() => import('@/pages/intents/AuftragAnlegenPage'));
const PruefprotokollErstellenPage = lazy(() => import('@/pages/intents/PruefprotokollErstellenPage'));
// </custom:imports>

// Lazy: public pages live outside <Layout> and only load on /#/public/:slug —
// dashboard users never pay for them, anonymous visitors skip the dashboard.
const PublicPage = lazy(() => import('@/pages/public/PublicPage'));

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBusProvider>
        <HashRouter>
          <ActionsProvider>
            <Routes>
              <Route path="public/:slug" element={<Suspense fallback={null}><PublicPage /></Suspense>} />
              <Route element={<Layout />}>
                <Route index element={<DashboardOverview />} />
                <Route path="kunden" element={<KundenPage />} />
                <Route path="kunden/:id" element={<KundenDetailPage />} />
                <Route path="material" element={<MaterialPage />} />
                <Route path="material/:id" element={<MaterialDetailPage />} />
                <Route path="auftraege" element={<AuftraegePage />} />
                <Route path="auftraege/:id" element={<AuftraegeDetailPage />} />
                <Route path="auftragspositionen" element={<AuftragspositionenPage />} />
                <Route path="auftragspositionen/:id" element={<AuftragspositionenDetailPage />} />
                <Route path="pruefprotokoll" element={<PruefprotokollPage />} />
                <Route path="pruefprotokoll/:id" element={<PruefprotokollDetailPage />} />
                <Route path="admin" element={<AdminPage />} />
                <Route path="verwaltung/oeffentliche-seiten" element={<PublicPagesAdmin />} />
                {/* <custom:routes> */}
                <Route path="intents/auftrag-anlegen" element={<Suspense fallback={null}><AuftragAnlegenPage /></Suspense>} />
                <Route path="intents/pruefprotokoll-erstellen" element={<Suspense fallback={null}><PruefprotokollErstellenPage /></Suspense>} />
                {/* </custom:routes> */}
              </Route>
            </Routes>
          </ActionsProvider>
        </HashRouter>
      </ErrorBusProvider>
    </ErrorBoundary>
  );
}
