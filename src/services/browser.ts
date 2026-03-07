// Use dynamic import for playwright-core (ESM compatibility)
let chromium: any;
async function getChromium() {
  if (!chromium) {
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  }
  return chromium;
}

let browserInstance: any = null;

/**
 * Get or create a shared browser instance.
 * Reuses across calls; auto-recovers if disconnected.
 */
async function getBrowser(): Promise<any> {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  const chromiumMod = await getChromium();
  const executablePath =
    process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";

  browserInstance = await chromiumMod.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  return browserInstance;
}

/**
 * Close the shared browser (for cleanup).
 */
export async function closeBrowser(): Promise<void> {
  authenticatedContext = null;
  if (browserInstance) {
    const browser = browserInstance;
    browserInstance = null;
    try {
      await browser.close();
    } catch {
      // Force-kill any remaining browser process
      try {
        const pid = browser.process?.()?.pid;
        if (pid) process.kill(pid, "SIGKILL");
      } catch { /* ignore */ }
    }
    // Small delay to ensure OS releases resources
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Cached authenticated browser context — reused across screenshot calls
// so we only log in once. Invalidated when session expires (login page detected).
let authenticatedContext: any = null;

/**
 * Log in to Metabase via the browser UI.
 * Returns an authenticated browser context with session cookies.
 */
async function loginAndCreateContext(
  metabaseUrl: string,
  username: string,
  password: string
): Promise<any> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  await page.goto(`${metabaseUrl}/auth/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // Wait for login form or SSO button to appear
  await page.locator('input[type="email"], input[name="username"], button, a').first().waitFor({
    timeout: 15000,
  });

  // Click "Sign in with email" if present (SSO-enabled instances show this link)
  const emailLink = page.locator('text="Sign in with email"');
  if (await emailLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailLink.click();
    await page.waitForTimeout(500);
  }

  // Fill in the email/password form
  await page.locator(
    'input[name="username"], input[type="email"], input[placeholder*="email" i]'
  ).fill(username);
  await page.locator('input[name="password"], input[type="password"]').fill(
    password
  );

  // Submit
  await page.locator('button[type="submit"]').click();

  // Wait for redirect away from login page
  await page.waitForURL(
    (url: URL) => !url.pathname.includes("/auth/login"),
    { timeout: 30000 }
  );

  await page.close();
  return context;
}

/**
 * Get a cached authenticated context, or create a new one.
 */
async function getAuthenticatedContext(
  metabaseUrl: string,
  username: string,
  password: string
): Promise<any> {
  if (authenticatedContext) {
    try {
      await authenticatedContext.pages();
      return authenticatedContext;
    } catch {
      authenticatedContext = null;
    }
  }

  authenticatedContext = await loginAndCreateContext(
    metabaseUrl,
    username,
    password
  );
  return authenticatedContext;
}

/**
 * Check if the current page is the login page (session expired).
 */
function isLoginPage(page: any): boolean {
  try {
    const url = page.url();
    return url.includes("/auth/login");
  } catch {
    return false;
  }
}

/**
 * Dismiss common Metabase modals/overlays that block the visualization.
 */
async function dismissModals(page: any): Promise<void> {
  // "It's okay to play around with saved questions" modal
  const startExploring = page.locator(
    'button:has-text("Start exploring"), a:has-text("Start exploring")'
  );
  if (await startExploring.isVisible({ timeout: 1000 }).catch(() => false)) {
    await startExploring.click();
    await page.waitForTimeout(500);
  }

  // Generic modal close button
  const modalClose = page.locator('.Modal .Icon-close, [data-testid="modal-close"]');
  if (await modalClose.isVisible({ timeout: 500 }).catch(() => false)) {
    await modalClose.click();
    await page.waitForTimeout(300);
  }
}

interface ScreenshotOptions {
  metabaseUrl: string;
  username: string;
  password: string;
  resourceType: "question" | "dashboard";
  resourceId: number;
  width?: number;
  height?: number;
}

/**
 * Take screenshot(s) of a Metabase question or dashboard.
 * For questions: returns a single screenshot.
 * For dashboards: scrolls through the page to trigger lazy loading,
 * then captures viewport-sized screenshots at each scroll position.
 */
export async function takeScreenshot(
  options: ScreenshotOptions
): Promise<Buffer[]> {
  const {
    metabaseUrl,
    username,
    password,
    resourceType,
    resourceId,
    width = 1200,
    height = 900,
  } = options;

  const urlPath =
    resourceType === "question"
      ? `/question/${resourceId}`
      : `/dashboard/${resourceId}`;
  const pageUrl = `${metabaseUrl}${urlPath}`;

  // Try up to 2 times: first with cached session, then with fresh login
  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await getAuthenticatedContext(
      metabaseUrl,
      username,
      password
    );

    const page = await context.newPage();
    if (width !== 1200 || height !== 900) {
      await page.setViewportSize({ width, height });
    }

    try {
      await page.goto(pageUrl, {
        waitUntil: "networkidle",
        timeout: 60000,
      });

      // If we landed on the login page, session expired — full reset and retry
      if (isLoginPage(page)) {
        await page.close();
        await closeBrowser();
        if (attempt === 0) continue;
        throw new Error("Failed to authenticate after re-login");
      }

      // Dismiss any modals/overlays
      await dismissModals(page);

      // Wait for visualization to render
      const selector =
        resourceType === "question"
          ? ".CardVisualization, .QueryVisualization"
          : ".DashboardGrid, .Dashboard";

      await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {
        // Fallback: visualization selector not found, proceed with what's rendered
      });

      // Settle delay for chart animations
      await page.waitForTimeout(2000);

      if (resourceType === "question") {
        const screenshot = await page.screenshot({ type: "png" });
        return [screenshot];
      }

      // Dashboard: scroll through to trigger lazy loading, then capture each viewport
      return await captureDashboardScreenshots(page, height);
    } catch (error) {
      await page.close().catch(() => {});
      if (attempt === 0) {
        await closeBrowser();
        continue;
      }
      throw error;
    }
  }

  throw new Error("Screenshot failed after retry");
}

/**
 * Scroll through a dashboard page and capture viewport-sized screenshots.
 * Scrolls incrementally to trigger lazy-loaded card rendering.
 */
async function captureDashboardScreenshots(
  page: any,
  viewportHeight: number
): Promise<Buffer[]> {
  const totalHeight: number = await page.evaluate(
    () => document.documentElement.scrollHeight
  );

  // If it fits in one viewport, just take one screenshot
  if (totalHeight <= viewportHeight * 1.1) {
    const screenshot = await page.screenshot({ type: "png" });
    return [screenshot];
  }

  // First pass: scroll through the entire page to trigger lazy loading
  let scrollY = 0;
  while (scrollY < totalHeight) {
    await page.evaluate((y: number) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(800);
    scrollY += viewportHeight;
  }

  // Wait for any final renders after scrolling
  await page.waitForTimeout(1500);

  // Re-measure in case content grew after lazy loading
  const finalHeight: number = await page.evaluate(
    () => document.documentElement.scrollHeight
  );

  // Second pass: scroll back through and capture screenshots
  const screenshots: Buffer[] = [];
  scrollY = 0;
  while (scrollY < finalHeight) {
    await page.evaluate((y: number) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot({ type: "png" });
    screenshots.push(screenshot);
    scrollY += viewportHeight;
  }

  return screenshots;
}

/**
 * Try to take screenshot(s). Returns base64 PNG strings, or null if
 * screenshots aren't configured or capture fails. Never throws.
 */
async function tryScreenshots(
  resourceType: "question" | "dashboard",
  resourceId: number
): Promise<string[] | null> {
  const metabaseUrl =
    process.env.METABASE_URL || "https://metabase.internal.classdojo.com";
  const username = process.env.METABASE_USERNAME;
  const password = process.env.METABASE_PASSWORD;
  if (!username || !password) return null;

  try {
    const buffers = await takeScreenshot({
      metabaseUrl,
      username,
      password,
      resourceType,
      resourceId,
    });
    return buffers.map((b) => b.toString("base64"));
  } catch {
    return null;
  }
}

/** Single screenshot for a card. Returns [base64] or null. */
export function tryScreenshotCard(cardId: number): Promise<string[] | null> {
  return tryScreenshots("question", cardId);
}

/** One or more screenshots for a dashboard (scrolls if needed). Returns [base64, ...] or null. */
export function tryScreenshotDashboard(dashboardId: number): Promise<string[] | null> {
  return tryScreenshots("dashboard", dashboardId);
}

/** Convert screenshot base64 strings to MCP image content blocks. */
export function screenshotsToContent(screenshots: string[] | null): any[] {
  if (!screenshots) return [];
  return screenshots.map((data) => ({
    type: "image",
    data,
    mimeType: "image/png",
  }));
}
