import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const EDGE_EXECUTABLE_PATH = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

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
  const edgePath = options.edgePath ?? EDGE_EXECUTABLE_PATH;
  const visibleWindow = options.visibleWindow ?? true;
  const errors = [];

  if (platform !== "darwin") errors.push("Narzędzie wymaga macOS.");
  if (!visibleWindow) {
    errors.push("Archiwizowanie wymaga widocznego okna Microsoft Edge; usuń --no-visible-window.");
  }
  if (!(await canExecute(edgePath))) {
    errors.push(
      `Nie znaleziono wykonywalnego Microsoft Edge pod ${edgePath}. ` +
      "Zainstaluj Microsoft Edge w /Applications i uruchom go co najmniej raz.",
    );
  }

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
  return { edgePath, accessibility: true, visibleWindow: true };
}
