import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const adapterPath = fileURLToPath(new URL("./mac_edge_save_page.applescript", import.meta.url));

export async function saveCompletePageWithEdge(destination, stem, options = {}) {
  if (!/^\d{3}$/.test(stem)) throw new Error(`Nieprawidłowa nazwa pliku archiwum: ${stem}.`);
  const timeoutMs = options.timeoutMs ?? 90_000;
  try {
    const result = await execFile(
      "/usr/bin/osascript",
      [adapterPath, path.resolve(destination), `${stem}.html`],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
    );
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Natywny zapis Microsoft Edge nie powiódł się: ${detail}`, { cause: error });
  }
}
