/**
 * server/host.js — how the two apps are put on the network.
 *
 * Locally and in Docker the desk console gets its own port (:8001). A single-origin host
 * (Vercel, any platform that runs one function) cannot split ports, so the console rides the
 * site's own origin under /admin. Both modes use the same two apps — nothing is duplicated, and
 * every URL the console emits is relative to whichever mount it was given (see res.locals.base).
 */
import { createPublicApp } from './app.js';
import { createAdminApp } from './admin.js';

/** the path the console lives under when it shares the site's origin */
export const ADMIN_MOUNT = '/admin';

export const COMBINED = ['1', 'true', 'yes'].includes(String(process.env.COMBINED || '').toLowerCase());

/** public site at the root, desk console under /admin, one port */
export function createCombinedApp() {
  return createPublicApp({ extra: (app) => app.use(ADMIN_MOUNT, createAdminApp({ mounted: true })) });
}

/** what the process entry point should listen on */
export function createApps() {
  if (COMBINED) return { app: createCombinedApp(), adminApp: null, mount: ADMIN_MOUNT };
  return { app: createPublicApp(), adminApp: createAdminApp(), mount: '' };
}
