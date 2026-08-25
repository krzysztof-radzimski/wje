import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const adapterPath = fileURLToPath(new URL("./mac_chrome_save_page.applescript", import.meta.url));

export async function saveCompletePageWithChrome(destination, stem, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const processName = options.processName ?? "Google Chrome";
  const result = await execFile(
    "/usr/bin/osascript",
    [adapterPath, path.resolve(destination), `${stem}.html`, processName],
    { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
  );
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
