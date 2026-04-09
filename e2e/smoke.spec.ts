import { expect, test, type Page } from "@playwright/test";

type Diagnostics = NonNullable<Window["__GET_TILTED_DIAGNOSTICS__"]>;

async function getDiagnostics(page: Page): Promise<Diagnostics> {
  await page.waitForFunction(() => Boolean(window.__GET_TILTED_DIAGNOSTICS__), undefined, {
    timeout: 15_000,
  });
  return page.evaluate(() => {
    const diagnostics = window.__GET_TILTED_DIAGNOSTICS__;
    if (!diagnostics) {
      throw new Error("Get Tilted diagnostics are not available on window.");
    }
    return diagnostics;
  });
}

async function waitForDiagnostics(
  page: Page,
  predicate: (diagnostics: Diagnostics) => boolean,
  timeout = 15_000,
): Promise<Diagnostics> {
  await page.waitForFunction(
    ({ predicateSource }) => {
      const diagnostics = window.__GET_TILTED_DIAGNOSTICS__;
      if (!diagnostics) {
        return false;
      }
      const runPredicate = new Function(
        "diagnostics",
        `return (${predicateSource})(diagnostics);`,
      ) as (diagnostics: Diagnostics) => boolean;
      return runPredicate(diagnostics);
    },
    { predicateSource: predicate.toString() },
    { timeout },
  );
  return getDiagnostics(page);
}

function installPageErrorCollector(page: Page): () => string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });
  return () => pageErrors;
}

async function revisitWithRetry(page: Page, url: string, attempts = 3): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_500);
    }
  }
  throw lastError;
}

async function expectCompactSoloHud(page: Page, limits?: {
  maxWidth: number;
  maxHeight: number;
  maxTop: number;
}): Promise<void> {
  const hud = page.getByTestId("solo-course-hud");
  await expect(hud).toBeVisible();
  const box = await hud.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(limits?.maxWidth ?? 260);
  expect(box!.height).toBeLessThan(limits?.maxHeight ?? 110);
  expect(box!.y).toBeLessThan(limits?.maxTop ?? 90);
}

test("main menu renders and options persist across reload", async ({ page }) => {
  test.setTimeout(90_000);
  const getErrors = installPageErrorCollector(page);
  await page.goto("/?debug=1&gyro=0&seed=playwright_seed");

  await expect(page.getByTestId("version-badge")).toContainText("Version");
  await expect(page.getByTestId("mode-picker-card")).toBeVisible();

  await page.getByTestId("main-menu-options").click();
  const playerNameInput = page.getByTestId("options-player-name");
  await expect(page.getByTestId("options-card")).toBeVisible();
  await expect(playerNameInput).toBeVisible();
  await playerNameInput.fill("Playwright Pilot");
  await expect(playerNameInput).toHaveValue("Playwright Pilot");

  await revisitWithRetry(page, "/?debug=1&gyro=0&seed=playwright_seed");
  await expect(page.getByTestId("mode-picker-card")).toBeVisible();
  await page.getByTestId("main-menu-options").click();
  await expect(page.getByTestId("options-card")).toBeVisible();
  await expect(page.getByTestId("options-player-name")).toHaveValue("Playwright Pilot");
  await expect(page.getByTestId("options-debug-enabled")).toBeChecked();
  expect(getErrors(), getErrors().join("\n")).toEqual([]);
});

test("singleplayer enters an active race flow", async ({ page }) => {
  test.setTimeout(90_000);
  const getErrors = installPageErrorCollector(page);
  await page.goto("/?debug=1&gyro=0&seed=solo_seed");

  await page.getByTestId("main-menu-singleplayer").click();
  await expectCompactSoloHud(page);

  const diagnostics = await waitForDiagnostics(
    page,
    (value) => value.gameMode === "solo" && value.racePhase !== "waiting",
  );

  expect(diagnostics.gameMode).toBe("solo");
  expect(["countdown", "racing"]).toContain(diagnostics.racePhase);
  expect(diagnostics.soloCourseName).toBeTruthy();
  expect(getErrors(), getErrors().join("\n")).toEqual([]);
});

test("singleplayer stays readable on portrait mobile", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await browser.newPage({
    viewport: {
      width: 390,
      height: 844,
    },
  });
  const getErrors = installPageErrorCollector(page);

  await page.goto("/?debug=1&gyro=0&seed=solo_mobile_seed");
  await expect(page.getByTestId("mode-picker-card")).toBeVisible();
  await expect(page.getByTestId("solo-feature-card")).toBeHidden();

  await page.getByTestId("main-menu-singleplayer").click();
  await expectCompactSoloHud(page, {
    maxWidth: 210,
    maxHeight: 90,
    maxTop: 45,
  });

  const diagnostics = await waitForDiagnostics(
    page,
    (value) => value.gameMode === "solo" && value.racePhase !== "waiting",
  );

  expect(diagnostics.gameMode).toBe("solo");
  expect(["countdown", "racing"]).toContain(diagnostics.racePhase);
  expect(getErrors(), getErrors().join("\n")).toEqual([]);

  await page.close();
});

test("multiplayer host lobby boots and receives a room code", async ({ browser }) => {
  const hostPage = await browser.newPage();
  const getHostErrors = installPageErrorCollector(hostPage);

  await hostPage.goto("/?debug=1&gyro=0&name=Host");
  await hostPage.getByTestId("main-menu-multiplayer").click();

  const hostLobby = await waitForDiagnostics(
    hostPage,
    (value) =>
      value.gameMode === "multiplayer" &&
      value.roomCode.length === 6,
    20_000,
  );

  await expect(hostPage.getByTestId("multiplayer-lobby-card")).toBeVisible();
  expect(hostLobby.roomCode).toHaveLength(6);
  expect(getHostErrors(), getHostErrors().join("\n")).toEqual([]);
});
