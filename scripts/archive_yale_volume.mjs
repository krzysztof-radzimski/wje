#!/usr/bin/env node

import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPreflight } from "./lib/archive_preflight.mjs";
import { saveCompletePageWithChrome } from "./lib/mac_chrome_save_page.mjs";
import {
  assertRawTargetAbsent,
  captureMetrics,
  discoverTopLevelSections,
  loadManifest,
  localStem,
  metricsAreComplete,
  replaceManifestEntry,
  resumeDecision,
  saveManifest,
  pathExists,
  volumeName,
} from "./lib/yale_archive_core.mjs";

const HELP = `
Natywny archiwizator pojedynczego tomu WJE przez widoczny Google Chrome na macOS.

Użycie:
  node scripts/archive_yale_volume.mjs --volume NN --source-url URL \\
    --destination HTML/VOLUMENN [--resume] [--delay-ms 2500] [--visible-window]
  node scripts/archive_yale_volume.mjs --smoke-test

Opcje:
  --volume NN          Numer tomu 01–99.
  --source-url URL     Adres strony nawigacyjnej tomu, zapisywanej jako 000.html.
  --destination PATH  Nowy katalog HTML/VOLUMENN. Tomy 01–16 są chronione.
  --resume             Pomija wyłącznie kompletne wpisy i ponawia bezpieczne błędy.
  --delay-ms MS        Minimalny odstęp między stronami (domyślnie 2500 ms).
  --visible-window     Jawne potwierdzenie widocznego okna (tryb domyślny i wymagany).
  --retries N          Liczba prób na stronę (domyślnie 3).
  --smoke-test         Archiwizuje dwie lokalne strony do odrębnego katalogu tymczasowego.
  --help               Pokazuje tę pomoc.

Wymagania:
  macOS, Google Chrome w /Applications oraz uprawnienie Accessibility dla Terminala
  lub procesu uruchamiającego Node. Chrome musi udostępniać format kompletnej strony
  w systemowym oknie „Zapisz jako”. Brak wymagania kończy pracę bez trybu zastępczego.
`;

function parseArguments(argv) {
  const options = { resume: false, delayMs: 2500, retries: 3, visibleWindow: true, smokeTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`Brak wartości dla ${argument}.`);
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

function validateOptions(options, { smoke = false } = {}) {
  if (!options.visibleWindow) throw new Error("Natywny zapis Chrome wymaga widocznego okna; usuń --no-visible-window.");
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) throw new Error("--delay-ms musi być nieujemną liczbą całkowitą.");
  if (!Number.isInteger(options.retries) || options.retries < 1 || options.retries > 10) throw new Error("--retries musi należeć do zakresu 1–10.");
  if (!options.volume || !options.sourceUrl || !options.destination) {
    throw new Error("Wymagane są --volume, --source-url i --destination.");
  }
  const volume = volumeName(options.volume);
  const parsedUrl = new URL(options.sourceUrl);
  if (!smoke && !["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("--source-url musi używać HTTP lub HTTPS.");
  const destination = path.resolve(options.destination);
  if (!smoke) {
    const expectedParent = path.resolve("HTML");
    if (path.dirname(destination) !== expectedParent || path.basename(destination) !== volume) {
      throw new Error(`--destination musi wskazywać dokładnie HTML/${volume}.`);
    }
    const numericVolume = Number.parseInt(String(options.volume), 10);
    if (numericVolume <= 16) throw new Error("Tych danych nie wolno zapisywać do istniejących HTML/VOLUME01–VOLUME16.");
  }
  return { ...options, volume, sourceUrl: parsedUrl.href, destination };
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function stabilizeDocument(page) {
  const measurements = [];
  let stableAtBottom = 0;
  let reachedBottom = false;
  for (let step = 0; step < 500; step += 1) {
    const measurement = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const height = Math.max(root.scrollHeight, root.offsetHeight, body?.scrollHeight ?? 0, body?.offsetHeight ?? 0);
      const bottom = Math.ceil(window.scrollY + window.innerHeight) >= height;
      if (!bottom) window.scrollBy(0, Math.max(180, Math.floor(window.innerHeight * 0.35)));
      return { height, scrollY: Math.round(window.scrollY), viewportHeight: window.innerHeight, bottom };
    });
    measurements.push({ ...measurement, measuredAt: new Date().toISOString() });
    reachedBottom ||= measurement.bottom;
    const previous = measurements.at(-2);
    stableAtBottom = measurement.bottom && previous?.bottom && measurement.height === previous.height ? stableAtBottom + 1 : 0;
    if (stableAtBottom >= 3) {
      return { reachedBottom, stabilized: true, stabilizedHeight: measurement.height, measurementCount: measurements.length, measurements };
    }
    await pause(120);
  }
  const final = measurements.at(-1);
  return { reachedBottom, stabilized: false, stabilizedHeight: final?.height ?? null, measurementCount: measurements.length, measurements };
}

async function waitForCompleteSave(destination, stem, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let previousSignature = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const metrics = await captureMetrics(destination, stem);
    const signature = JSON.stringify(metrics);
    stableCount = metricsAreComplete(metrics) && signature === previousSignature ? stableCount + 1 : 0;
    if (stableCount >= 2) return metrics;
    previousSignature = signature;
    await pause(250);
  }
  const metrics = await captureMetrics(destination, stem);
  throw new Error(`Chrome nie utworzył kompletnego ${stem}.html i ${stem}_files (stan: ${JSON.stringify(metrics)}).`);
}

async function preparePage(page, url, log) {
  await log(`navigation:start ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load", { timeout: 30_000 });
  const scroll = await stabilizeDocument(page);
  await log(`scroll:${scroll.stabilized ? "stable" : "unstable"} height=${scroll.stabilizedHeight} samples=${scroll.measurementCount}`);
  if (!scroll.stabilized) throw new Error("Wysokość dokumentu nie ustabilizowała się po przewinięciu do dołu.");
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    await log("resources:network-idle-timeout; using final grace period");
  }
  await pause(800);
  return { finalUrl: page.url(), scroll };
}

async function archiveOne({ page, destination, stem, requestedUrl, title, manifest, resume, retries, delayMs, log, evidenceDirectory }) {
  const localFile = `${stem}.html`;
  const prior = manifest.entries.find((entry) => entry.localFile === localFile);
  if (resume) {
    const decision = await resumeDecision(destination, prior);
    if (decision.skip) {
      await log(`resume:skip ${localFile}`);
      return prior;
    }
  }
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let navigation = null;
    const evidencePath = path.join(evidenceDirectory, `${stem}.png`);
    try {
      await assertRawTargetAbsent(destination, stem);
      await log(`attempt:${attempt}/${retries} ${localFile}`);
      navigation = await preparePage(page, requestedUrl, log);
      await page.screenshot({ path: evidencePath, fullPage: false });
      await saveCompletePageWithChrome(destination, stem);
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
        attempts: attempt,
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
        attempts: attempt,
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

async function runArchive(options) {
  const preflight = await runPreflight();
  await mkdir(options.destination, { recursive: true });
  const evidenceDirectory = path.join(options.destination, ".archive-evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const logPath = path.join(evidenceDirectory, "archive.log");
  const log = async (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    process.stdout.write(line);
    await appendFile(logPath, line, "utf8");
  };
  const manifest = await loadManifest(options.destination, options.volume, options.sourceUrl);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: preflight.chromePath, headless: false, args: ["--start-maximized"] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  try {
    await log(`archive:start volume=${options.volume} source=${options.sourceUrl}`);
    await archiveOne({
      page, destination: options.destination, stem: "000", requestedUrl: options.sourceUrl, title: "Volume navigation",
      manifest, resume: options.resume, retries: options.retries, delayMs: options.delayMs, log, evidenceDirectory,
    });
    const navigationHtml = await readFile(path.join(options.destination, "000.html"), "utf8");
    const navigationEntry = manifest.entries.find((entry) => entry.localFile === "000.html");
    const sections = discoverTopLevelSections(navigationHtml, navigationEntry.finalUrl);
    if (sections.length === 0) throw new Error("000.html nie zawiera linków nawigacji tomu; nie można ustalić kolejności sekcji.");
    await log(`discovery:sections ${sections.length}`);
    for (const section of sections) {
      await pause(options.delayMs);
      await archiveOne({
        page, destination: options.destination, stem: localStem(section.index), requestedUrl: section.url, title: section.title,
        manifest, resume: options.resume, retries: options.retries, delayMs: options.delayMs, log, evidenceDirectory,
      });
    }
    await log("archive:complete");
    return { destination: options.destination, manifest, logPath };
  } finally {
    await browser.close();
  }
}

async function createSmokeOptions() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wje-archive-smoke-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "HTML", "VOLUME99");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "style.css"), "body { font: 18px system-ui; } .spacer { height: 1600px; }\n", "utf8");
  await writeFile(path.join(source, "mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#234"/></svg>\n', "utf8");
  await writeFile(path.join(source, "index.html"), '<!doctype html><link rel="stylesheet" href="style.css"><h1>Smoke navigation</h1><img src="mark.svg" alt="mark"><span class="navlevel1"><a href="section.html">Local section</a></span><div class="spacer"></div>', "utf8");
  await writeFile(path.join(source, "section.html"), '<!doctype html><link rel="stylesheet" href="style.css"><h1>Local section</h1><img src="mark.svg" alt="mark"><div class="spacer"></div><p>End.</p>', "utf8");
  return validateOptions({
    volume: "99", sourceUrl: pathToFileURL(path.join(source, "index.html")).href, destination,
    resume: false, delayMs: 100, retries: 2, visibleWindow: true,
  }, { smoke: true });
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const options = parsed.smokeTest ? await createSmokeOptions() : validateOptions(parsed);
  const result = await runArchive(options);
  if (parsed.smokeTest) {
    const entry = result.manifest.entries.find((candidate) => candidate.localFile === "001.html");
    if (!entry || entry.status !== "complete" || !entry.scroll?.stabilized || !entry.finalUrl) {
      throw new Error("Smoke-test nie zapisał kompletnego wpisu 001.html.");
    }
    process.stdout.write(`SMOKE TEST OK: ${result.destination}\nEvidence: ${result.logPath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`BŁĄD: ${error.message}\n`);
  process.exitCode = 1;
});
