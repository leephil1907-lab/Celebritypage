/**
 * scripts/lib/browser.mjs — one place to get a Chromium driver.
 *
 * Playwright is a QA tool, not a runtime dependency: the site must build, boot and deploy without
 * it. Resolution order: $PLAYWRIGHT_PATH → a sibling toolchain install → a normal package resolve.
 * If none exists we do NOT fail the run; callers skip the browser stage and say so.
 */
const CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  '/home/user/tools/node_modules/playwright/index.mjs',
  'playwright',
].filter(Boolean);

export async function loadChromium() {
  for (const spec of CANDIDATES) {
    try {
      const mod = await import(spec);
      if (mod.chromium) return { chromium: mod.chromium, from: spec };
    } catch { /* try the next one */ }
  }
  return null;
}
