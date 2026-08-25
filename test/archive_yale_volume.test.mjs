import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runPreflight } from "../scripts/lib/archive_preflight.mjs";
import {
  discoverTopLevelSections,
  localStem,
  resumeDecision,
  volumeName,
} from "../scripts/lib/yale_archive_core.mjs";

test("odkrywa tylko navlevel1, zachowuje kolejność i usuwa duplikaty URL", () => {
  const html = `
    <span class="navlevel1"><a href="/archive?path=second">Druga w URL, pierwsza w tomie</a></span>
    <span class="navlevel2"><a href="/archive?path=child">Podsekcja</a></span>
    <span class="extra navlevel1 active"><a href="third">Trzecia &amp; ostatnia</a></span>
    <span class="navlevel1"><a href="/archive?path=second">Duplikat</a></span>
  `;
  assert.deepEqual(discoverTopLevelSections(html, "https://edwards.yale.edu/root/index"), [
    {
      url: "https://edwards.yale.edu/archive?path=second",
      title: "Druga w URL, pierwsza w tomie",
      index: 1,
      localFile: "001.html",
    },
    {
      url: "https://edwards.yale.edu/root/third",
      title: "Trzecia & ostatnia",
      index: 2,
      localFile: "002.html",
    },
  ]);
});

test("grupuje potomne odnośniki Yale do nadrzędnych sekcji bez sortowania numerów", () => {
  const encoded = (object) => Buffer.from(`http://edwards.yale.edu/cgi-bin/newphilo/getobject.pl?${object}`, "utf8").toString("base64");
  const html = `
    <span class="navlevel2"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:7:0.wjeo")}">Part III</a></span>
    <span class="navlevel3"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:7:0:1.wjeo")}">Child</a></span>
    <span class="navlevel1"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:3.wjeo")}">Earlier URL number, later section</a></span>
  `;
  const sections = discoverTopLevelSections(html, "https://edwards.yale.edu/archive");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, "Part III");
  assert.equal(sections[1].title, "Earlier URL number, later section");
  assert.equal(Buffer.from(new URL(sections[0].url).searchParams.get("path"), "base64").toString("utf8"),
    "http://edwards.yale.edu/cgi-bin/newphilo/getobject.pl?c.0:7.wjeo");
});

test("odkryta liczba sekcji odpowiada ręcznym zrzutom tomów 01–16", async () => {
  for (let number = 1; number <= 16; number += 1) {
    const directory = `HTML/VOLUME${String(number).padStart(2, "0")}`;
    const html = await readFile(path.join(directory, "000.html"), "utf8");
    const expected = (await readdir(directory)).filter((entry) => /^\d{3}\.html$/.test(entry)).length - 1;
    assert.equal(discoverTopLevelSections(html, "http://edwards.yale.edu/").length, expected, directory);
  }
});

test("numeruje tomy i pliki z zerami wiodącymi", () => {
  assert.equal(volumeName("7"), "VOLUME07");
  assert.equal(volumeName("17"), "VOLUME17");
  assert.equal(localStem(0), "000");
  assert.equal(localStem(42), "042");
  assert.throws(() => localStem(1000), /000–999/);
});

test("preflight przechodzi dla macOS, Chrome i Accessibility", async () => {
  const result = await runPreflight({
    platform: "darwin",
    chromeCandidates: ["/Applications/Google Chrome.app/test"],
    canExecute: async () => true,
    run: async () => ({ stdout: "true\n", stderr: "" }),
  });
  assert.equal(result.accessibility, true);
  assert.match(result.chromePath, /Google Chrome/);
});

test("preflight zgłasza wszystkie wymagania bez cichego obejścia", async () => {
  await assert.rejects(
    runPreflight({
      platform: "linux",
      chromeCandidates: ["/missing/chrome"],
      canExecute: async () => false,
      run: async () => ({ stdout: "false\n", stderr: "" }),
    }),
    (error) => error.message.includes("wymaga macOS") && error.message.includes("Nie znaleziono Google Chrome"),
  );
  await assert.rejects(
    runPreflight({
      platform: "darwin",
      chromeCandidates: ["/Applications/Google Chrome.app/test"],
      canExecute: async () => true,
      run: async () => ({ stdout: "false\n", stderr: "" }),
    }),
    /Dostępność|Accessibility/,
  );
});

test("resume pomija tylko kompletny wpis z istniejącymi artefaktami", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "wje-resume-test-"));
  await writeFile(path.join(destination, "001.html"), "<html>saved</html>", "utf8");
  await mkdir(path.join(destination, "001_files"));
  await writeFile(path.join(destination, "001_files", "asset.css"), "body{}", "utf8");
  const complete = await resumeDecision(destination, { localFile: "001.html", status: "complete" });
  assert.equal(complete.skip, true);
  const incomplete = await resumeDecision(destination, { localFile: "001.html", status: "error" });
  assert.equal(incomplete.skip, false);
  assert.equal(await readFile(path.join(destination, "001.html"), "utf8"), "<html>saved</html>");
});

test("kod archiwizatora nie zawiera zakazanych mechanizmów zastępczych", async () => {
  const files = [
    "scripts/archive_yale_volume.mjs",
    "scripts/lib/archive_preflight.mjs",
    "scripts/lib/mac_chrome_save_page.mjs",
    "scripts/lib/mac_chrome_save_page.applescript",
    "scripts/lib/yale_archive_core.mjs",
  ];
  const forbidden = ["cu" + "rl", "wg" + "et", "fe" + "tch", "page." + "content(", "MH" + "TML"];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const phrase of forbidden) assert.equal(source.includes(phrase), false, `${file} zawiera ${phrase}`);
  }
});
