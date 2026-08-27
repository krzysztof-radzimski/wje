import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createKdpDocx, defaultOutputFor, loadProfile } from "../scripts/create_kdp_docx.mjs";
import { parseWjeMarkdown } from "../scripts/lib/kdp-docx/markdown.mjs";
import { validateKdpDocx } from "../scripts/validate_kdp_docx.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAC0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg0QAAABuB9eAAAAAElFTkSuQmCC", "base64");

const MARKDOWN = `# A Representative WJE Volume

## Front Matter

<!-- p. vii -->

This paragraph contains *emphasis*, **strong emphasis**, ~~deletion~~, \`code\`, [a link](https://example.com), Unicode — Ω, and a note.[^001-note1]

### Note to the Reader

> A short quotation preserves its semantic role.

- A bullet item
  - A nested bullet

1. A numbered item
2. Another numbered item

## First Discourse

<!-- p. 1 -->

| Term | Meaning |
| --- | --- |
| Grace <!-- p. 1a --> | A concise value |
| Faith | Another value |

![A simple diagram](assets/diagram.png)

#### A deeper heading

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

* * *

Literal manuscript insertion <being retained> remains text.

[^001-note1]: This is a true **Word footnote** generated from Markdown.

[^unused]: This unreferenced definition is inventoried but not invented into body text.
`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wje-kdp-docx-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const assets = path.join(directory, "assets");
  await fs.mkdir(assets);
  await fs.writeFile(path.join(assets, "diagram.png"), PNG);
  const markdown = path.join(directory, "VOLUME99.md");
  await fs.writeFile(markdown, MARKDOWN);
  return { directory, markdown };
}

test("shared Markdown parser covers WJE semantic constructs", async (t) => {
  const { markdown } = await fixture(t);
  const model = await parseWjeMarkdown(markdown);
  assert.equal(model.title, "A Representative WJE Volume");
  assert.equal(model.volume, 99);
  assert.deepEqual(model.inventory.headings, { 1: 1, 2: 2, 3: 1, 4: 1, 5: 0, 6: 0 });
  assert.equal(model.inventory.footnoteReferences, 1);
  assert.equal(model.inventory.footnoteDefinitions, 2);
  assert.equal(model.inventory.tables, 1);
  assert.equal(model.inventory.images, 1);
  assert.equal(model.inventory.sourcePages, 3);
  assert.equal(model.inventory.mermaidBlocks, 1);
  assert.equal(model.inventory.blockquotes, 1);
  assert.equal(model.inventory.lists, 3);
});

for (const profileId of ["kindle", "print-6x9"]) {
  test(`${profileId} profile generates and validates deterministic OOXML`, async (t) => {
    const { directory, markdown } = await fixture(t);
    const output = path.join(directory, `${profileId}.docx`);
    const generated = await createKdpDocx({ input: markdown, output, profileId });
    assert.equal(generated.outputPath, output);
    assert.ok(generated.buffer.length > 10_000);
    assert.ok(generated.warnings.some((warning) => warning.includes("Mermaid")));
    const validation = await validateKdpDocx({ input: markdown, docx: output, profileId });
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
    assert.equal(validation.inventory.images, 1);
    assert.equal(validation.inventory.footnoteReferences, 1);
    assert.equal(validation.inventory.sourcePages, 3);
    assert.equal(validation.inventory.sections, profileId === "kindle" ? 1 : 2);
  });
}

test("validator rejects a broken ZIP", async (t) => {
  const { directory, markdown } = await fixture(t);
  const output = path.join(directory, "broken.docx");
  await fs.writeFile(output, "not a ZIP");
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /Corrupt DOCX ZIP/);
});

test("validator rejects a dangling bookmark and missing media", async (t) => {
  const { directory, markdown } = await fixture(t);
  const original = path.join(directory, "original.docx");
  const broken = path.join(directory, "broken-parts.docx");
  await createKdpDocx({ input: markdown, output: original, profileId: "kindle" });
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const documentXml = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", documentXml.replace(/<w:bookmarkStart[^>]+w:name="heading_first_discourse"[^>]*\/>/, ""));
  const media = Object.keys(zip.files).find((name) => name.startsWith("word/media/") && !name.endsWith("/"));
  assert.ok(media, "fixture DOCX contains embedded media");
  zip.remove(media);
  await fs.writeFile(broken, await zip.generateAsync({ type: "nodebuffer" }));
  const validation = await validateKdpDocx({ input: markdown, docx: broken, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Missing bookmark")));
  assert.ok(validation.errors.some((error) => error.includes("Broken relationship") || error.includes("Missing related media")));
});

test("validator rejects changed TOC and footnote content", async (t) => {
  const { directory, markdown } = await fixture(t);
  const original = path.join(directory, "original.docx");
  const broken = path.join(directory, "broken-semantics.docx");
  await createKdpDocx({ input: markdown, output: original, profileId: "kindle" });
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const documentXml = await zip.file("word/document.xml").async("string");
  const footnotesXml = await zip.file("word/footnotes.xml").async("string");
  zip.file("word/document.xml", documentXml.replace(">First Discourse<", ">Changed Discourse<"));
  zip.file("word/footnotes.xml", footnotesXml.replace("This is a true ", "This content was changed "));
  await fs.writeFile(broken, await zip.generateAsync({ type: "nodebuffer" }));
  const validation = await validateKdpDocx({ input: markdown, docx: broken, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("TOC entry")));
  assert.ok(validation.errors.some((error) => error.includes("Footnote content/order")));
});

test("generator refuses to overwrite without --force", async (t) => {
  const { directory, markdown } = await fixture(t);
  const output = path.join(directory, "kindle.docx");
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  await assert.rejects(() => createKdpDocx({ input: markdown, output, profileId: "kindle" }), /already exists/);
  await createKdpDocx({ input: markdown, output, profileId: "kindle", force: true });
});

test("canonical output directories are profile-specific", async () => {
  const kindle = await loadProfile("kindle");
  const print = await loadProfile("print-6x9");
  assert.match(defaultOutputFor("MD/VOLUME01.md", kindle), /DOCX\/KINDLE\/VOLUME01\.docx$/);
  assert.match(defaultOutputFor("MD/VOLUME01.md", print), /DOCX\/PRINT-6X9\/VOLUME01\.docx$/);
});
