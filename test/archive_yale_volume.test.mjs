import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArguments, stabilizeDocument } from "../scripts/archive_yale_volume.mjs";
import { EDGE_EXECUTABLE_PATH, runPreflight } from "../scripts/lib/archive_preflight.mjs";
import {
  assertArchiveDestinationSafe,
  assertRawTargetAbsent,
  discoverDescendantSections,
  discoverTopLevelSections,
  localStem,
  resumeDecision,
  validateArchiveOptions,
  volumeName,
} from "../scripts/lib/yale_archive_core.mjs";

test("odkrywa sekcje w kolejności spisu, numeruje je i usuwa duplikaty URL", () => {
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

test("grupuje potomne odnośniki Yale bez sortowania po numerach URL", () => {
  const encoded = (object) => Buffer
    .from(`http://edwards.yale.edu/cgi-bin/newphilo/getobject.pl?${object}`, "utf8")
    .toString("base64");
  const html = `
    <span class="navlevel2"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:7:0.wjeo")}">Part III</a></span>
    <span class="navlevel3"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:7:0:1.wjeo")}">Child</a></span>
    <span class="navlevel1"><a href="https://edwards.yale.edu/archive?path=${encoded("c.0:3.wjeo")}">Earlier URL number, later section</a></span>
  `;
  const sections = discoverTopLevelSections(html, "https://edwards.yale.edu/archive");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, "Part III");
  assert.equal(sections[1].title, "Earlier URL number, later section");
  assert.equal(
    Buffer.from(new URL(sections[0].url).searchParams.get("path"), "base64").toString("utf8"),
    "http://edwards.yale.edu/cgi-bin/newphilo/getobject.pl?c.0:7.wjeo",
  );
});

test("dołącza brakujące równorzędne podsekcje od jednoznacznego tytułu", () => {
  const encoded = (object) => Buffer
    .from(`http://edwards.yale.edu/cgi-bin/newphilo/getobject.pl?${object}`, "utf8")
    .toString("base64");
  const html = `
    <span class="navlevel1"><a href="?path=${encoded("c.17:4.wjeo")}">Main</a></span>
    <span class="navlevel2"><a href="?path=${encoded("c.17:4:247.wjeo")}">748. Earlier</a></span>
    <span class="navlevel2"><a href="?path=${encoded("c.17:4:248.wjeo")}">749. Start</a></span>
    <span class="navlevel3"><a href="?path=${encoded("c.17:4:248:0.wjeo")}">Nested child</a></span>
    <span class="navlevel2"><a href="?path=${encoded("c.17:4:249.wjeo")}">750. Next</a></span>
    <span class="navlevel1"><a href="?path=${encoded("c.17:5.wjeo")}">Appendix</a></span>
    <span class="navlevel2"><a href="?path=${encoded("c.17:5:0.wjeo")}">Later child</a></span>
  `;

  const sections = discoverDescendantSections(html, "http://edwards.yale.edu/archive", {
    fromTitle: "749.",
    startIndex: 5,
  });

  assert.deepEqual(sections.map(({ title, index, localFile }) => ({ title, index, localFile })), [
    { title: "749. Start", index: 5, localFile: "005.html" },
    { title: "750. Next", index: 6, localFile: "006.html" },
  ]);
  assert.match(
    Buffer.from(new URL(sections[0].url).searchParams.get("path"), "base64").toString("utf8"),
    /c\.17:4:248\.wjeo$/,
  );
});

test("odczytuje jawny prefiks odzyskiwania podsekcji z CLI", () => {
  const options = parseArguments(["--append-descendants-from", "749. BEING OF GOD"]);
  assert.equal(options.appendDescendantsFrom, "749. BEING OF GOD");
});

test("stabilizuje bardzo długą, rosnącą stronę w limicie 500 próbek", async () => {
  const viewportHeight = 720;
  let height = 84_000;
  let scrollY = 0;
  let grew = false;
  let maxJump = 0;
  const page = {
    async evaluate(_callback, scrollFraction) {
      if (scrollY >= 40_000) {
        height = 168_180;
        grew = true;
      }
      const bottom = Math.ceil(scrollY + viewportHeight) >= height;
      if (!bottom) {
        const step = Math.max(180, Math.floor(viewportHeight * scrollFraction));
        const nextScrollY = Math.min(scrollY + step, height - viewportHeight);
        maxJump = Math.max(maxJump, nextScrollY - scrollY);
        scrollY = nextScrollY;
      }
      return {
        height,
        scrollY,
        viewportHeight,
        bottom,
      };
    },
  };

  const result = await stabilizeDocument(page, { sampleDelayMs: 0 });

  assert.equal(grew, true);
  assert.equal(result.reachedBottom, true);
  assert.equal(result.stabilized, true);
  assert.equal(result.stabilizedHeight, 168_180);
  assert.equal(result.stableSamples, 4);
  assert.ok(result.measurementCount < 400);
  assert.ok(maxJump < viewportHeight);
});

test("stabilizuje stronę wymagającą ponad 500 bezpiecznych kroków", async () => {
  const viewportHeight = 720;
  const height = 311_331;
  let scrollY = 0;
  const page = {
    async evaluate(_callback, scrollFraction) {
      const bottom = Math.ceil(scrollY + viewportHeight) >= height;
      if (!bottom) {
        const step = Math.max(180, Math.floor(viewportHeight * scrollFraction));
        scrollY = Math.min(scrollY + step, height - viewportHeight);
      }
      return {
        height,
        scrollY,
        viewportHeight,
        bottom,
      };
    },
  };

  const result = await stabilizeDocument(page, { sampleDelayMs: 0 });

  assert.equal(result.reachedBottom, true);
  assert.equal(result.stabilized, true);
  assert.equal(result.stabilizedHeight, height);
  assert.ok(result.measurementCount > 500);
  assert.ok(result.measurementCount < 700);
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
  assert.throws(() => volumeName("17abc"), /1 do 99/);
  assert.throws(() => localStem(1000), /000–999/);
});

test("preflight przechodzi dla macOS i dostępnego Microsoft Edge bez Accessibility", async () => {
  const result = await runPreflight({
    platform: "darwin",
    edgePath: EDGE_EXECUTABLE_PATH,
    canExecute: async () => true,
  });
  assert.equal(result.browserAutomation, true);
  assert.equal(result.edgePath, EDGE_EXECUTABLE_PATH);
});

test("preflight zgłasza brak Microsoft Edge i niewłaściwy system bez obejścia", async () => {
  await assert.rejects(
    runPreflight({
      platform: "linux",
      edgePath: "/missing/Microsoft Edge",
      canExecute: async () => false,
    }),
    (error) => error.message.includes("wymaga macOS") && error.message.includes("Microsoft Edge"),
  );
});

test("chroni tomy 01–16 i odrzuca zapis do niewłaściwego katalogu", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "wje-options-test-"));
  const base = {
    sourceUrl: "https://edwards.yale.edu/archive/volume",
    resume: false,
    delayMs: 100,
    retries: 2,
    headless: true,
  };
  assert.throws(
    () => validateArchiveOptions({ ...base, volume: "16", destination: "HTML/VOLUME16" }, { projectRoot }),
    /VOLUME01–VOLUME16/,
  );
  assert.throws(
    () => validateArchiveOptions({ ...base, volume: "17", destination: "tmp/VOLUME17" }, { projectRoot }),
    /HTML\/VOLUME17/,
  );
  const valid = validateArchiveOptions(
    { ...base, volume: "17", destination: "HTML/VOLUME17" },
    { projectRoot },
  );
  assert.equal(valid.destination, path.join(projectRoot, "HTML", "VOLUME17"));
});

test("nie rozpoczyna nowego przebiegu w niepustym katalogu i nie nadpisuje HTML", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "wje-protection-test-"));
  const original = "<html>existing raw capture</html>";
  await writeFile(path.join(destination, "000.html"), original, "utf8");
  await assert.rejects(assertArchiveDestinationSafe(destination), /nie jest pusty/);
  await assert.rejects(assertArchiveDestinationSafe(destination, { resume: true }), /nie ma \.archive-manifest/);
  await writeFile(
    path.join(destination, ".archive-manifest.json"),
    '{"schemaVersion":1,"volume":"VOLUME17","sourceUrl":"https://example.test/","entries":[]}\n',
    "utf8",
  );
  await assert.doesNotReject(assertArchiveDestinationSafe(destination, { resume: true }));
  await assert.rejects(assertRawTargetAbsent(destination, "000"), /Odmowa nadpisania/);
  assert.equal(await readFile(path.join(destination, "000.html"), "utf8"), original);
});

test("resume pomija wyłącznie kompletny wpis z kompletnymi artefaktami", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "wje-resume-test-"));
  await writeFile(path.join(destination, "001.html"), "<html>saved</html>", "utf8");
  await mkdir(path.join(destination, "001_files"));
  await writeFile(path.join(destination, "001_files", "asset.css"), "body{}", "utf8");
  const completeEntry = {
    localFile: "001.html",
    status: "complete",
    finalUrl: "https://edwards.yale.edu/final",
    scroll: { stabilized: true, stabilizedHeight: 1200 },
  };
  assert.equal((await resumeDecision(destination, completeEntry)).skip, true);
  assert.equal((await resumeDecision(destination, { ...completeEntry, status: "error" })).skip, false);
  assert.equal((await resumeDecision(destination, { ...completeEntry, scroll: null })).skip, false);
  assert.equal(await readFile(path.join(destination, "001.html"), "utf8"), "<html>saved</html>");
});

test("kod archiwizatora używa sesji przeglądarkowej bez AppleScriptu i bez HTTP fallbacku", async () => {
  const files = [
    "scripts/archive_yale_volume.mjs",
    "scripts/lib/archive_preflight.mjs",
    "scripts/lib/browser_page_archive.mjs",
    "scripts/lib/yale_archive_core.mjs",
  ];
  const forbidden = [
    "cu" + "rl",
    "wg" + "et",
    "fe" + "tch",
    "MH" + "TML",
    "Google" + " Chrome",
    "osas" + "cript",
  ];
  let combinedSource = "";
  for (const file of files) {
    const source = await readFile(file, "utf8");
    combinedSource += source;
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${file} zawiera zabroniony mechanizm lub markę`);
    }
  }
  assert.match(combinedSource, /Microsoft Edge/);
  const cli = await readFile("scripts/archive_yale_volume.mjs", "utf8");
  assert.match(cli, /executablePath: preflight\.edgePath/);
  assert.match(cli, /headless: options\.headless/);
  const archive = await readFile("scripts/lib/browser_page_archive.mjs", "utf8");
  assert.match(archive, /response\.body\(\)/);
  assert.match(archive, /page\.content\(\)/);
});
