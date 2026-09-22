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

let lastError = '';
const reasons = [];

/**
 * A driver is only useful if it opens a window. A resolved `playwright` package with no browser
 * download, or one missing system libraries, would otherwise be reported as "Playwright is not
 * installed" — so the launch is attempted here and the real reason travels with the null.
 */
export async function loadChromium({ prove = true } = {}) {
  lastError = 'no Playwright package found — npm i -D playwright, or set PLAYWRIGHT_PATH';
  reasons.length = 0;
  for (const spec of CANDIDATES) {
    let mod;
    try { mod = await import(spec); } catch (e) { lastError = `${spec} cannot be imported: ${String(e.message).split('\n')[0]}`; reasons.push(lastError); continue; }
    if (!mod.chromium) { lastError = `${spec} has no chromium export`; continue; }
    if (!prove) return { chromium: mod.chromium, from: spec };
    try {
      const b = await mod.chromium.launch({ args: ['--no-sandbox'] });
      await b.close();
      return { chromium: mod.chromium, from: spec };
    } catch (e) {
      lastError = `${spec} resolves but Chromium will not launch: ${String(e.message).split('\n')[0]} `
        + '— fetch the browser with `npx playwright install chromium`, its libraries with `npx playwright install-deps chromium`';
      reasons.push(lastError);
    }
  }
  return null;
}

export const lastBrowserError = () => (reasons.length > 1 ? `${lastError} (also: ${reasons.filter((r) => r !== lastError).join('; ')})` : lastError);
