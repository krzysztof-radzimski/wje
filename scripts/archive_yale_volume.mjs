#!/usr/bin/env node

import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPreflight } from "./lib/archive_preflight.mjs";
import { saveCompletePageWithEdge } from "./lib/mac_edge_save_page.mjs";
import {
  assertArchiveDestinationSafe,
  assertRawTargetAbsent,
  captureMetrics,
  discoverTopLevelSections,
  loadManifest,
  localStem,
  metricsAreComplete,
  pathExists,
  replaceManifestEntry,
  resumeDecision,
  saveManifest,
  validateArchiveOptions,
} from "./lib/yale_archive_core.mjs";

export const HELP = `
Natywny archiwizator pojedynczego tomu WJE przez widoczny Microsoft Edge na macOS.

Użycie:
  npm run archive -- --volume NN --source-url URL --destination HTML/VOLUMENN \\
    [--resume] [--delay-ms 2500] [--visible-window] [--retries 3]
  npm run archive:smoke

Opcje:
  --volume NN          Numer tomu 01–99.
  --source-url URL     Adres nawigacji tomu zapisywanej jako 000.html.
  --destination PATH  Nowy katalog HTML/VOLUMENN; tomy 01–16 są chronione.
  --resume             Pomija tylko kompletne wpisy; ponawia błędne i niekompletne.
  --delay-ms MS        Minimalny odstęp między stronami (domyślnie 2500 ms).
  --visible-window     Jawnie wybiera wymagane, widoczne okno Microsoft Edge.
  --no-visible-window  Kończy się błędem; archiwizacja bez widocznego okna jest zabroniona.
  --retries N          Liczba prób na stronę, 1–10 (domyślnie 3).
  --smoke-test         Zapisuje lokalną stronę testową w odrębnym katalogu tymczasowym.
  --help               Pokazuje tę pomoc.

Wymagania:
  macOS z aktywną sesją graficzną, Microsoft Edge pod ścieżką
  /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge oraz uprawnienie
  Ustawienia systemowe → Prywatność i ochrona → Dostępność dla Terminala lub procesu
  uruchamiającego Node. Microsoft Edge musi oferować format „Kompletna strona
  internetowa” w systemowym oknie „Zapisz jako”. Brak wymagania kończy pracę błędem.
`;

export function parseArguments(argv) {
  const options = {
    resume: false,
    delayMs: 2500,
    retries: 3,
    visibleWindow: true,
    smokeTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`Brak wartości dla ${argument}.`);
      }
      index += 1;
      return argv[index];
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--volume") options.volume = value();
    else if (argument === "--source-url") options.sourceUrl = value();
    else if (argument === "--destination") options.destination = value();
    else if (argument === "--delay-ms") options.delayMs = Number.parseInt(value(), 10);
    else if (argument === "--retries") options.retries = Number.parseInt(value(), 10);
    else if (argument === "--resume") options.resume = true;
    else if (argument === "--visible-window") options.visibleWindow = true;
    else if (argument === "--no-visible-window") options.visibleWindow = false;
    else if (argument === "--smoke-test") options.smokeTest = true;
    else throw new Error(`Nieznany argument: ${argument}`);
  }
  return options;
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function stabilizeDocument(page) {
  const measurements = [];
  let stableAtBottom = 0;
  let reachedBottom = false;
  for (let step = 0; step < 500; step += 1) {
    const measurement = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const height = Math.max(
        root.scrollHeight,
        root.offsetHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
      );
      const bottom = Math.ceil(window.scrollY + window.innerHeight) >= height;
      if (!bottom) window.scrollBy(0, Math.max(180, Math.floor(window.innerHeight * 0.35)));
      return {
        height,
        scrollY: Math.round(window.scrollY),
        viewportHeight: window.innerHeight,
        bottom,
      };
    });
    measurements.push({ ...measurement, measuredAt: new Date().toISOString() });
    reachedBottom ||= measurement.bottom;
    const previous = measurements.at(-2);
    stableAtBottom = measurement.bottom && previous?.bottom && measurement.height === previous.height
      ? stableAtBottom + 1
      : 0;
    if (stableAtBottom >= 3) {
      return {
        reachedBottom,
        stabilized: true,
        stabilizedHeight: measurement.height,
        stableSamples: stableAtBottom + 1,
        measurementCount: measurements.length,
        measurements,
      };
    }
    await pause(120);
  }
  const final = measurements.at(-1);
  return {
    reachedBottom,
    stabilized: false,
    stabilizedHeight: final?.height ?? null,
    stableSamples: stableAtBottom,
    measurementCount: measurements.length,
    measurements,
  };
}

async function waitForCompleteSave(destination, stem, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let previousSignature = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const metrics = await captureMetrics(destination, stem);
    const signature = JSON.stringify(metrics);
    stableCount = metricsAreComplete(metrics) && signature === previousSignature ? stableCount + 1 : 0;
    if (stableCount >= 3) return metrics;
    previousSignature = signature;
    await pause(300);
  }
  const metrics = await captureMetrics(destination, stem);
  throw new Error(
    `Microsoft Edge nie utworzył kompletnego ${stem}.html i ${stem}_files ` +
    `(stan: ${JSON.stringify(metrics)}).`,
  );
}

async function preparePage(page, url, log) {
  await log(`navigation:start ${url}`);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (response && !response.ok()) {
    throw new Error(`Microsoft Edge otrzymał odpowiedź ${response.status()} podczas nawigacji.`);
  }
  await page.waitForLoadState("load", { timeout: 30_000 });
  const scroll = await stabilizeDocument(page);
  await log(
    `scroll:${scroll.stabilized ? "stable" : "unstable"} ` +
    `height=${scroll.stabilizedHeight} samples=${scroll.measurementCount}`,
  );
  if (!scroll.stabilized) {
    throw new Error("Wysokość dokumentu nie ustabilizowała się po przewinięciu do dołu.");
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    await log("resources:network-idle-timeout; final grace period");
  }
  await pause(1_000);
  return { finalUrl: page.url(), scroll };
}

async function archiveOne({
  page,
  destination,
  stem,
  requestedUrl,
  title,
  manifest,
  resume,
  retries,
  delayMs,
  log,
  evidenceDirectory,
}) {
  const localFile = `${stem}.html`;
  const prior = manifest.entries.find((entry) => entry.localFile === localFile);
  if (resume) {
    const decision = await resumeDecision(destination, prior);
    if (decision.skip) {
      await log(`resume:skip ${localFile}`);
      return prior;
    }
    await log(`resume:retry ${localFile} reason=${decision.reason}`);
  }

  const priorAttempts = Number.isInteger(prior?.attempts) ? prior.attempts : 0;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let navigation = null;
    const evidencePath = path.join(evidenceDirectory, `${stem}.png`);
    try {
      await assertRawTargetAbsent(destination, stem);
      await log(`attempt:${attempt}/${retries} ${localFile}`);
      navigation = await preparePage(page, requestedUrl, log);
      await page.bringToFront();
      await page.screenshot({ path: evidencePath, fullPage: false });
      await saveCompletePageWithEdge(destination, stem);
      const files = await waitForCompleteSave(destination, stem);
      const entry = {
        localFile,
        title,
        requestedUrl,
        finalUrl: navigation.finalUrl,
        archivedAt: new Date().toISOString(),
        scroll: navigation.scroll,
        files,
        evidence: path.relative(destination, evidencePath),
        attempts: priorAttempts + attempt,
        status: "complete",
        error: null,
      };
      replaceManifestEntry(manifest, entry);
      await saveManifest(destination, manifest);
      await log(`complete:${localFile} html=${files.htmlBytes} assets=${files.assetCount}`);
      return entry;
    } catch (error) {
      lastError = error;
      const files = await captureMetrics(destination, stem);
      const entry = {
        localFile,
        title,
        requestedUrl,
        finalUrl: navigation?.finalUrl ?? page.url(),
        archivedAt: new Date().toISOString(),
        scroll: navigation?.scroll ?? null,
        files,
        evidence: await pathExists(evidencePath) ? path.relative(destination, evidencePath) : null,
        attempts: priorAttempts + attempt,
        status: "error",
        error: error.message,
      };
      replaceManifestEntry(manifest, entry);
      await saveManifest(destination, manifest);
      await log(`error:${localFile} ${error.message}`);
      if (files.htmlExists || files.assetsDirectoryExists || attempt === retries) break;
      const backoff = Math.max(500, delayMs) * (2 ** (attempt - 1));
      await log(`retry:wait ${backoff}ms`);
      await pause(backoff);
    }
  }
  throw lastError;
}

export async function runArchive(options) {
  const preflight = await runPreflight({ visibleWindow: options.visibleWindow });
  await assertArchiveDestinationSafe(options.destination, { resume: options.resume });
  await mkdir(options.destination, { recursive: true });
  const manifest = await loadManifest(options.destination, options.volume, options.sourceUrl);
  const evidenceDirectory = path.join(options.destination, ".archive-evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const logPath = path.join(evidenceDirectory, "archive.log");
  const log = async (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    process.stdout.write(line);
    await appendFile(logPath, line, "utf8");
  };
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: preflight.edgePath,
    headless: false,
    args: ["--start-maximized"],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  context.on("page", async (openedPage) => {
    if (openedPage !== page) await openedPage.close().catch(() => {});
  });
  try {
    await log(`archive:start volume=${options.volume} source=${options.sourceUrl}`);
    await archiveOne({
      page,
      destination: options.destination,
      stem: "000",
      requestedUrl: options.sourceUrl,
      title: "Volume navigation",
      manifest,
      resume: options.resume,
      retries: options.retries,
      delayMs: options.delayMs,
      log,
      evidenceDirectory,
    });

    const navigationHtml = await readFile(path.join(options.destination, "000.html"), "utf8");
    const navigationEntry = manifest.entries.find((entry) => entry.localFile === "000.html");
    const sections = discoverTopLevelSections(navigationHtml, navigationEntry.finalUrl);
    if (sections.length === 0) {
      throw new Error("000.html nie zawiera linków nawigacji tomu; nie można ustalić kolejności sekcji.");
    }
    await log(`discovery:sections ${sections.length}`);
    for (const section of sections) {
      await pause(options.delayMs);
      await archiveOne({
        page,
        destination: options.destination,
        stem: localStem(section.index),
        requestedUrl: section.url,
        title: section.title,
        manifest,
        resume: options.resume,
        retries: options.retries,
        delayMs: options.delayMs,
        log,
        evidenceDirectory,
      });
    }
    await log("archive:complete");
    return { destination: options.destination, manifest, logPath };
  } finally {
    await browser.close();
  }
}

async function createSmokeOptions() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wje-edge-archive-smoke-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "HTML", "VOLUME99");
  await mkdir(source, { recursive: true });
  await writeFile(
    path.join(source, "style.css"),
    "body { font: 18px system-ui; color: #18243a; } .spacer { height: 1600px; }\n",
    "utf8",
  );
  await writeFile(
    path.join(source, "mark.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#234"/></svg>\n',
    "utf8",
  );
  await writeFile(
    path.join(source, "index.html"),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><h1>Edge smoke navigation</h1><img src="mark.svg" alt="mark"><span class="navlevel1"><a href="section.html">Local section</a></span><div class="spacer"></div>',
    "utf8",
  );
  await writeFile(
    path.join(source, "section.html"),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><h1>Edge local section</h1><img src="mark.svg" alt="mark"><div class="spacer"></div><p>End.</p>',
    "utf8",
  );
  return validateArchiveOptions({
    volume: "99",
    sourceUrl: pathToFileURL(path.join(source, "index.html")).href,
    destination,
    resume: false,
    delayMs: 100,
    retries: 2,
    visibleWindow: true,
  }, { smoke: true });
}

async function verifySmokeResult(result) {
  const entry = result.manifest.entries.find((candidate) => candidate.localFile === "001.html");
  if (!entry || entry.status !== "complete" || !entry.scroll?.stabilized || !entry.scroll.stabilizedHeight) {
    throw new Error("Smoke-test nie zapisał kompletnego wpisu 001.html z ustabilizowaną wysokością.");
  }
  if (!entry.finalUrl) throw new Error("Smoke-test nie zapisał adresu końcowego.");
  const metrics = await captureMetrics(result.destination, "001");
  if (!metricsAreComplete(metrics)) {
    throw new Error(`Smoke-test nie utworzył kompletnego 001.html/001_files: ${JSON.stringify(metrics)}.`);
  }
  const evidencePath = entry.evidence ? path.join(result.destination, entry.evidence) : "";
  if (!evidencePath || !(await pathExists(evidencePath)) || !(await pathExists(result.logPath))) {
    throw new Error("Smoke-test nie utworzył zrzutu ekranu i logu dowodowego.");
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const options = parsed.smokeTest
    ? await createSmokeOptions()
    : validateArchiveOptions(parsed);
  const result = await runArchive(options);
  if (parsed.smokeTest) {
    await verifySmokeResult(result);
    process.stdout.write(`SMOKE TEST EDGE OK: ${result.destination}\nEvidence: ${result.logPath}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`BŁĄD: ${error.message}\n`);
    process.exitCode = 1;
  });
}
