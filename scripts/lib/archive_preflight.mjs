import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function executableExists(target) {
  try {
    await access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runPreflight(options = {}) {
  const platform = options.platform ?? process.platform;
  const canExecute = options.canExecute ?? executableExists;
  const run = options.run ?? execFile;
  const chromeCandidates = options.chromeCandidates ?? CHROME_CANDIDATES;
  const errors = [];

  if (platform !== "darwin") errors.push("Narzędzie wymaga macOS.");
  const chromePath = (await Promise.all(chromeCandidates.map(async (candidate) => [candidate, await canExecute(candidate)])))
    .find(([, available]) => available)?.[0];
  if (!chromePath) errors.push("Nie znaleziono Google Chrome w /Applications. Zainstaluj Chrome i uruchom go co najmniej raz.");

  if (platform === "darwin") {
    try {
      const result = await run("/usr/bin/osascript", ["-e", 'tell application "System Events" to get UI elements enabled']);
      if (result.stdout.trim() !== "true") {
        errors.push(
          "Automatyzacja interfejsu jest wyłączona. W Ustawienia systemowe → Prywatność i ochrona → Dostępność " +
          "zezwól aplikacji Terminal (lub procesowi uruchamiającemu Node) na sterowanie komputerem.",
        );
      }
    } catch (error) {
      errors.push(`Nie udało się sprawdzić macOS Accessibility: ${error.message}`);
    }
  }

  if (errors.length) throw new Error(`Preflight nieudany:\n- ${errors.join("\n- ")}`);
  return { chromePath, accessibility: true };
}
