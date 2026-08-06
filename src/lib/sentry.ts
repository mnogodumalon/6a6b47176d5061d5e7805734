import * as Sentry from '@sentry/react';

const DSN = "https://a0a6a937e751b39ecf7303042f45cd6e@sentry.livinglogic.de/42";
const ENVIRONMENT = "dashboard-6a6b47176d5061d5e7805734";
/** The service version this bundle was built as — the SAME value that lands in
 *  the deployment's `version.json`. Exported so `lib/stale-bundle.ts` can tell a
 *  tab that is merely older than the live deployment apart from one whose asset
 *  is genuinely gone. One source for the fact; do not inject it a second time. */
export const BUNDLE_VERSION = "0.0.296";
const APPGROUP_ID = "6a6b47176d5061d5e7805734";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT || undefined,
    release: BUNDLE_VERSION || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  if (APPGROUP_ID) {
    Sentry.setTag('appgroup_id', APPGROUP_ID);
  }
}

export { Sentry };
