import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARCHIVABLE_RESOURCE_TYPES = new Set([
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
  "other",
]);

function normalizedUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function safeBaseName(resourceUrl) {
  let candidate;
  try {
    candidate = path.posix.basename(decodeURIComponent(new URL(resourceUrl).pathname));
  } catch {
    candidate = "resource";
  }
  candidate = candidate
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "resource")
    .slice(0, 180);
  return candidate || "resource";
}

function uniqueName(candidate, usedNames) {
  const extension = path.extname(candidate);
  const base = extension ? candidate.slice(0, -extension.length) : candidate;
  let name = candidate;
  let suffix = 1;
  while (usedNames.has(name.toLowerCase())) {
    name = `${base}(${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

function rewriteCss(buffer, resourceUrl, urlToName) {
  const css = buffer.toString("utf8");
  return Buffer.from(css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    if (/^(?:data:|blob:|#)/i.test(value)) return match;
    try {
      const resolved = normalizedUrl(new URL(value, resourceUrl).href);
      const localName = urlToName.get(resolved);
      return localName ? `url(${quote}${localName}${quote})` : match;
    } catch {
      return match;
    }
  }), "utf8");
}

export function beginBrowserPageCapture(page, { log = async () => {} } = {}) {
  const resources = new Map();
  const pending = new Set();
  let accepting = true;

  const onResponse = (response) => {
    if (!accepting) return;
    const request = response.request();
    if (!ARCHIVABLE_RESOURCE_TYPES.has(request.resourceType())) return;
    if (response.status() < 200 || response.status() >= 400) return;
    if (!/^(?:https?|file):/i.test(response.url())) return;

    const operation = (async () => {
      try {
        const body = await response.body();
        if (body.length === 0) return;
        const headers = await response.allHeaders();
        resources.set(normalizedUrl(response.url()), {
          body,
          contentType: headers["content-type"] ?? "application/octet-stream",
          resourceUrl: response.url(),
          resourceType: request.resourceType(),
        });
      } catch (error) {
        await log(`resource:omit ${response.url()} reason=${error.message}`);
      }
    })();
    pending.add(operation);
    operation.finally(() => pending.delete(operation));
  };

  page.on("response", onResponse);

  async function stopCollecting() {
    if (!accepting) return;
    accepting = false;
    page.off("response", onResponse);
    await Promise.allSettled([...pending]);
  }

  return {
    async save(destination, stem) {
      await stopCollecting();
      const assetsDirectoryName = `${stem}_files`;
      const assetsDirectory = path.join(destination, assetsDirectoryName);
      const usedNames = new Set();
      const urlToName = new Map();

      for (const resourceUrl of resources.keys()) {
        urlToName.set(resourceUrl, uniqueName(safeBaseName(resourceUrl), usedNames));
      }

      const replacements = Object.fromEntries(urlToName);
      await page.evaluate(({ directoryName, replacementsByUrl }) => {
        const replacementsMap = new Map(Object.entries(replacementsByUrl));
        const normalize = (rawValue) => {
          try {
            const resolved = new URL(rawValue, document.baseURI);
            resolved.hash = "";
            return resolved.href;
          } catch {
            return null;
          }
        };
        const localValue = (rawValue) => {
          const resolved = normalize(rawValue);
          const fileName = resolved ? replacementsMap.get(resolved) : null;
          return fileName ? `./${directoryName}/${fileName}` : null;
        };

        for (const element of document.querySelectorAll("[src], [href], [poster], [data-src]")) {
          for (const attribute of ["src", "href", "poster", "data-src"]) {
            if (!element.hasAttribute(attribute)) continue;
            const replacement = localValue(element.getAttribute(attribute));
            if (replacement) element.setAttribute(attribute, replacement);
          }
        }
        for (const element of document.querySelectorAll("[srcset]")) {
          const rewritten = element.getAttribute("srcset").split(",").map((candidate) => {
            const parts = candidate.trim().split(/\s+/);
            const replacement = localValue(parts[0]);
            if (replacement) parts[0] = replacement;
            return parts.join(" ");
          }).join(", ");
          element.setAttribute("srcset", rewritten);
        }
      }, { directoryName: assetsDirectoryName, replacementsByUrl: replacements });

      const html = await page.content();
      await mkdir(assetsDirectory, { recursive: false });
      for (const [resourceUrl, resource] of resources) {
        const name = urlToName.get(resourceUrl);
        const body = /^text\/css\b/i.test(resource.contentType)
          ? rewriteCss(resource.body, resource.resourceUrl, urlToName)
          : resource.body;
        await writeFile(path.join(assetsDirectory, name), body);
      }
      await writeFile(path.join(destination, `${stem}.html`), html, "utf8");
      return { htmlBytes: Buffer.byteLength(html), assetCount: resources.size };
    },

    async dispose() {
      await stopCollecting();
    },
  };
}
