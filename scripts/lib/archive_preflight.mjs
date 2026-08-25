import { access } from "node:fs/promises";
import { constants } from "node:fs";

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
  const edgePath = options.edgePath ?? EDGE_EXECUTABLE_PATH;
  const errors = [];

  if (platform !== "darwin") errors.push("Narzędzie wymaga macOS.");
  if (!(await canExecute(edgePath))) {
    errors.push(
      `Nie znaleziono wykonywalnego Microsoft Edge pod ${edgePath}. ` +
      "Zainstaluj Microsoft Edge w /Applications i uruchom go co najmniej raz.",
    );
  }

  if (errors.length) throw new Error(`Preflight nieudany:\n- ${errors.join("\n- ")}`);
  return { edgePath, browserAutomation: true };
}
