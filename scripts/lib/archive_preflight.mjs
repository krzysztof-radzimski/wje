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
      // The native save adapter runs under osascript, so verify the TCC trust
      // of that exact process. "UI elements enabled" is a deprecated global
      // switch and can report false even for a trusted client.
      const result = await run("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()',
      ]);
      if (result.stdout.trim() !== "true") {
        errors.push(
          "macOS nie przyznał Dostępności procesowi /usr/bin/osascript, który obsługuje okno „Zapisz jako”. " +
          "W Ustawienia systemowe → Prywatność i ochrona → Dostępność dodaj i włącz /usr/bin/osascript.",
        );
      }
    } catch (error) {
      errors.push(
        "Nie udało się sprawdzić Dostępności procesu /usr/bin/osascript. W Ustawienia systemowe → " +
        "Prywatność i ochrona → Dostępność dodaj i włącz /usr/bin/osascript. " +
        `Szczegóły: ${error.message}`,
      );
    }
  }

  if (errors.length) throw new Error(`Preflight nieudany:\n- ${errors.join("\n- ")}`);
  return { edgePath, accessibility: true, visibleWindow: true };
}
