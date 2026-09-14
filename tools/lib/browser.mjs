// Chrome via playwright-core (locally installed Chrome, channel "chrome"; never downloads browsers).
import { chromium } from "playwright-core";

export async function launchChrome({ headless = true, extraArgs = [] } = {}) {
  const args = [
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader", // WebGL fallback when no GPU is available to headless Chrome
    "--enable-precise-memory-info", // unquantized performance.memory for --perf
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
    ...extraArgs,
  ];
  try {
    return await chromium.launch({ channel: "chrome", headless, args });
  } catch (err) {
    throw new Error(
      `Could not launch the locally installed Chrome (playwright-core channel "chrome"). Install Google Chrome; ` +
        `do not run "playwright install".\n${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Waits for window.__game and its ready promise; surfaces page errors while waiting. */
export async function waitForGame(page, timeoutMs = 60_000) {
  await page.waitForFunction(() => !!window.__game, null, { timeout: timeoutMs });
  await page.evaluate(() => window.__game.ready);
}

/** Collects console errors/warnings and page errors for meta.json. */
export function collectConsole(page) {
  const messages = [];
  page.on("console", (m) => {
    const type = m.type();
    if (type === "error" || type === "warning") messages.push({ type, text: m.text().slice(0, 500) });
  });
  page.on("pageerror", (e) => messages.push({ type: "pageerror", text: String(e?.stack || e).slice(0, 800) }));
  return messages;
}
