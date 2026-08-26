import { access, readFile, readdir, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_NAME = ".archive-manifest.json";

export function volumeName(value) {
  const raw = String(value);
  const parsed = /^\d{1,2}$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
    throw new Error("--volume musi być liczbą od 1 do 99.");
  }
  return `VOLUME${String(parsed).padStart(2, "0")}`;
}

export function localStem(index) {
  if (!Number.isInteger(index) || index < 0 || index > 999) {
    throw new Error("Numer lokalnego pliku musi należeć do zakresu 000–999.");
  }
  return String(index).padStart(3, "0");
}

export function validateArchiveOptions(options, { smoke = false, projectRoot = process.cwd() } = {}) {
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error("--delay-ms musi być nieujemną liczbą całkowitą.");
  }
  if (!Number.isInteger(options.retries) || options.retries < 1 || options.retries > 10) {
    throw new Error("--retries musi należeć do zakresu 1–10.");
  }
  if (!options.volume || !options.sourceUrl || !options.destination) {
    throw new Error("Wymagane są --volume, --source-url i --destination.");
  }

  const volume = volumeName(options.volume);
  const parsedUrl = new URL(options.sourceUrl);
  if (!smoke && !["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("--source-url musi używać HTTP lub HTTPS.");
  }

  const destination = path.resolve(projectRoot, options.destination);
  if (!smoke) {
    const htmlRoot = path.resolve(projectRoot, "HTML");
    if (path.dirname(destination) !== htmlRoot || path.basename(destination) !== volume) {
      throw new Error(`--destination musi wskazywać dokładnie HTML/${volume}.`);
    }
    if (Number.parseInt(String(options.volume), 10) <= 16) {
      throw new Error("Tych danych nie wolno zapisywać do istniejących HTML/VOLUME01–VOLUME16.");
    }
  }

  return { ...options, volume, sourceUrl: parsedUrl.href, destination };
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function canonicalYaleSectionUrl(candidateUrl) {
  const outer = new URL(candidateUrl);
  const encodedPath = outer.searchParams.get("path");
  if (!encodedPath) return null;
  let inner;
  try {
    inner = Buffer.from(encodedPath, "base64").toString("utf8");
  } catch {
    return null;
  }
  const objectMatch = inner.match(/(getobject\.pl\?c\.\d+:\d+)(?::\d+)*(\.wjeo)$/);
  if (!objectMatch) return null;
  const canonicalInner = `${inner.slice(0, objectMatch.index)}${objectMatch[1]}${objectMatch[2]}`;
  outer.searchParams.set("path", Buffer.from(canonicalInner, "utf8").toString("base64"));
  return outer.href;
}

export function discoverTopLevelSections(html, baseUrl) {
  const results = [];
  const seen = new Set();
  const spanPattern = /<span\b[^>]*class=["'][^"']*\bnavlevel([123])\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  let spanMatch;
  while ((spanMatch = spanPattern.exec(html)) !== null) {
    const level = Number.parseInt(spanMatch[1], 10);
    const anchor = spanMatch[2].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const linkedUrl = new URL(decodeEntities(anchor[1]), baseUrl).href;
    const canonicalUrl = canonicalYaleSectionUrl(linkedUrl);
    if (!canonicalUrl && level !== 1) continue;
    const url = canonicalUrl ?? linkedUrl;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: decodeEntities(anchor[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
    });
  }
  return results.map((section, offset) => ({
    ...section,
    index: offset + 1,
    localFile: `${localStem(offset + 1)}.html`,
  }));
}

export function discoverDescendantSections(html, baseUrl, { fromTitle, startIndex = 1 } = {}) {
  const requestedPrefix = String(fromTitle ?? "").trim();
  if (!requestedPrefix) {
    throw new Error("Odzyskiwanie podsekcji wymaga niepustego prefiksu tytułu.");
  }
  const items = [];
  const spanPattern = /<span\b[^>]*class=["'][^"']*\bnavlevel([123])\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  let spanMatch;
  while ((spanMatch = spanPattern.exec(html)) !== null) {
    const anchor = spanMatch[2].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    items.push({
      level: Number.parseInt(spanMatch[1], 10),
      url: new URL(decodeEntities(anchor[1]), baseUrl).href,
      title: decodeEntities(anchor[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
    });
  }

  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.title.startsWith(requestedPrefix));
  if (matches.length !== 1) {
    throw new Error(
      `Prefiks podsekcji "${requestedPrefix}" powinien wskazywać dokładnie jedną pozycję; znaleziono ${matches.length}.`,
    );
  }
  const { item: first, index: firstIndex } = matches[0];
  if (first.level === 1) {
    throw new Error("Odzyskiwanie podsekcji musi zaczynać się od navlevel2 albo navlevel3.");
  }

  const results = [];
  const seen = new Set();
  for (let index = firstIndex; index < items.length; index += 1) {
    const item = items[index];
    if (index > firstIndex && item.level < first.level) break;
    if (item.level !== first.level || seen.has(item.url)) continue;
    seen.add(item.url);
    results.push(item);
  }
  return results.map((section, offset) => ({
    url: section.url,
    title: section.title,
    index: startIndex + offset,
    localFile: `${localStem(startIndex + offset)}.html`,
  }));
}

export async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryMetrics(directory) {
  if (!(await pathExists(directory))) return { bytes: 0, count: 0 };
  let bytes = 0;
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryMetrics(entryPath);
      bytes += nested.bytes;
      count += nested.count;
    } else if (entry.isFile()) {
      bytes += (await stat(entryPath)).size;
      count += 1;
    }
  }
  return { bytes, count };
}

export async function captureMetrics(destination, stem) {
  const htmlPath = path.join(destination, `${stem}.html`);
  const assetsPath = path.join(destination, `${stem}_files`);
  const htmlExists = await pathExists(htmlPath);
  const assetsDirectoryExists = await pathExists(assetsPath);
  const assets = await directoryMetrics(assetsPath);
  return {
    htmlExists,
    assetsDirectoryExists,
    htmlBytes: htmlExists ? (await stat(htmlPath)).size : 0,
    assetsBytes: assets.bytes,
    assetCount: assets.count,
  };
}

export function metricsAreComplete(metrics) {
  return metrics.htmlExists && metrics.htmlBytes > 0 && metrics.assetsDirectoryExists && metrics.assetCount > 0;
}

export async function loadManifest(destination, volume, sourceUrl) {
  const manifestPath = path.join(destination, MANIFEST_NAME);
  if (!(await pathExists(manifestPath))) {
    return { schemaVersion: 1, volume, sourceUrl, createdAt: new Date().toISOString(), updatedAt: null, entries: [] };
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.volume !== volume) {
    throw new Error(`Manifest należy do tomu ${manifest.volume}, a nie ${volume}.`);
  }
  if (manifest.sourceUrl !== sourceUrl) {
    throw new Error("Manifest ma inny sourceUrl; odmowa połączenia dwóch zrzutów w jednym katalogu.");
  }
  return manifest;
}

export async function saveManifest(destination, manifest) {
  manifest.updatedAt = new Date().toISOString();
  const target = path.join(destination, MANIFEST_NAME);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function replaceManifestEntry(manifest, entry) {
  const existingIndex = manifest.entries.findIndex((candidate) => candidate.localFile === entry.localFile);
  if (existingIndex === -1) manifest.entries.push(entry);
  else manifest.entries[existingIndex] = entry;
  manifest.entries.sort((left, right) => left.localFile.localeCompare(right.localFile));
}

export async function resumeDecision(destination, entry) {
  if (
    !entry ||
    entry.status !== "complete" ||
    !entry.finalUrl ||
    entry.scroll?.stabilized !== true
  ) {
    return { skip: false, reason: "manifest-incomplete" };
  }
  const stem = path.basename(entry.localFile, ".html");
  const metrics = await captureMetrics(destination, stem);
  return metricsAreComplete(metrics)
    ? { skip: true, reason: "complete", metrics }
    : { skip: false, reason: "artifacts-incomplete", metrics };
}

export async function assertArchiveDestinationSafe(destination, { resume = false } = {}) {
  if (!(await pathExists(destination))) return;
  const entries = await readdir(destination);
  if (entries.length > 0 && !resume) {
    throw new Error(
      `Katalog ${destination} nie jest pusty. Odmowa naruszenia istniejących danych; ` +
      "użyj --resume tylko dla zrzutu utworzonego przez ten archiwizator.",
    );
  }
  if (entries.length > 0 && resume && !entries.includes(MANIFEST_NAME)) {
    throw new Error(
      `Katalog ${destination} nie ma ${MANIFEST_NAME}. ` +
      "Odmowa wznowienia zrzutu, którego nie utworzył ten archiwizator.",
    );
  }
}

export async function assertRawTargetAbsent(destination, stem) {
  const metrics = await captureMetrics(destination, stem);
  if (metrics.htmlExists || metrics.assetsDirectoryExists) {
    throw new Error(
      `Odmowa nadpisania surowego zrzutu ${stem}.html/${stem}_files. ` +
      "Przenieś ręcznie niekompletne artefakty i ponów z --resume.",
    );
  }
}
