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

const OUTLINE_TABLE_MARKDOWN = `# A Sparse Outline Table

## Inventory

| A | B | C | D | E | F | G | H | I | J |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  | *2.33v* |
|  |  |  |  |  |  |  |  |  | *2.45r* |
|  |  |  |  |  |  |  |  |  | *3.3v* |
|  |  |  |  |  |  |  |  |  | *3.21r* |
`;

const NESTED_LIST_MARKDOWN = `# Nested List Preservation

## Source note

48. 55. 56. 57. This source sentence contains **a bold title** and must not be omitted when the parser interprets the initial numbers as nested ordered lists.
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

function bookmarkIds(documentXml, kind) {
  const pattern = new RegExp(`<w:bookmark${kind}\\b[^>]*\\bw:id="(\\d+)"[^>]*/>`, "g");
  return [...documentXml.matchAll(pattern)].map((match) => match[1]);
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
    const zip = await JSZip.loadAsync(generated.buffer);
    const documentXml = await zip.file("word/document.xml").async("string");
    const settingsXml = await zip.file("word/settings.xml").async("string");
    const fontTableXml = await zip.file("word/fontTable.xml").async("string");
    const fontRelationships = await zip.file("word/_rels/fontTable.xml.rels").async("string");
    assert.ok(zip.file("word/fonts/LibreBaskerville-Regular.odttf"), "embedded font uses an OPC-safe part name");
    assert.equal(zip.file("word/fonts/Libre Baskerville.odttf"), null, "embedded font part name contains no raw space");
    assert.match(fontRelationships, /Target="fonts\/LibreBaskerville-Regular\.odttf"/);
    assert.doesNotMatch(documentXml, /<w:tblHeader\b[^>]*w:val="false"/);
    assert.doesNotMatch(settingsXml, /<w:defaultTabStop\b/);
    assert.doesNotMatch(settingsXml, /<w:updateFields\b/);
    if (profileId === "print-6x9") {
      assert.ok(settingsXml.indexOf("<w:mirrorMargins/>") < settingsXml.indexOf("<w:trackRevisions"), "mirror margins precede revision settings as required by OOXML schema order");
    } else {
      assert.doesNotMatch(settingsXml, /<w:mirrorMargins\b/);
    }
    assert.match(fontTableXml, /w:fontKey="\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}"/);
    for (const [, paragraphProperties] of documentXml.matchAll(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/g)) {
      const styleElements = paragraphProperties.match(/<w:pStyle\b/g) ?? [];
      assert.ok(styleElements.length <= 1, "paragraph properties contain at most one paragraph style");
      if (styleElements.length) assert.match(paragraphProperties, /^<w:pStyle\b/);
    }
    const bookmarkStarts = bookmarkIds(documentXml, "Start");
    const bookmarkEnds = bookmarkIds(documentXml, "End");
    assert.ok(bookmarkStarts.length > 1, "smoke fixture exercises multiple bookmarks");
    assert.equal(new Set(bookmarkStarts).size, bookmarkStarts.length, "bookmark numeric ids are unique");
    assert.deepEqual([...bookmarkEnds].sort((a, b) => Number(a) - Number(b)), [...bookmarkStarts].sort((a, b) => Number(a) - Number(b)));
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

test("validator rejects colliding numeric bookmark ids that Word repairs", async (t) => {
  const { directory, markdown } = await fixture(t);
  const original = path.join(directory, "original.docx");
  const broken = path.join(directory, "duplicate-bookmark-ids.docx");
  await createKdpDocx({ input: markdown, output: original, profileId: "kindle" });
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const documentXml = await zip.file("word/document.xml").async("string");
  const [firstId, secondId] = bookmarkIds(documentXml, "Start");
  assert.ok(firstId && secondId && firstId !== secondId);
  let replacements = 0;
  const brokenXml = documentXml.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, (tag) => {
    if (!tag.includes(`w:id="${secondId}"`)) return tag;
    replacements += 1;
    return tag.replace(`w:id="${secondId}"`, `w:id="${firstId}"`);
  });
  assert.equal(replacements, 2);
  zip.file("word/document.xml", brokenXml);
  await fs.writeFile(broken, await zip.generateAsync({ type: "nodebuffer" }));
  const validation = await validateKdpDocx({ input: markdown, docx: broken, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Duplicate bookmark numeric ids")));
});

test("validator rejects raw spaces in OPC font part URIs", async (t) => {
  const { directory, markdown } = await fixture(t);
  const original = path.join(directory, "original.docx");
  const broken = path.join(directory, "invalid-font-part-uri.docx");
  await createKdpDocx({ input: markdown, output: original, profileId: "kindle" });
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const safePart = "word/fonts/LibreBaskerville-Regular.odttf";
  const fontData = await zip.file(safePart).async("nodebuffer");
  zip.remove(safePart);
  zip.file("word/fonts/Libre Baskerville.odttf", fontData);
  const relationships = await zip.file("word/_rels/fontTable.xml.rels").async("string");
  zip.file("word/_rels/fontTable.xml.rels", relationships.replace("fonts/LibreBaskerville-Regular.odttf", "fonts/Libre Baskerville.odttf"));
  await fs.writeFile(broken, await zip.generateAsync({ type: "nodebuffer" }));
  const validation = await validateKdpDocx({ input: markdown, docx: broken, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Invalid OPC part URI")));
  assert.ok(validation.errors.some((error) => error.includes("Invalid internal relationship target")));
});

test("sparse outline tables preserve inline emphasis", async (t) => {
  const { markdown, directory } = await fixture(t);
  const output = path.join(directory, "outline-table.docx");
  await fs.writeFile(markdown, OUTLINE_TABLE_MARKDOWN);
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.inventory.outlineRows, 5);
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.match(documentXml, /<w:i\/><w:iCs\/><\/w:rPr><w:t[^>]*>2\.33v<\/w:t>/);
});

test("nested ordered lists preserve their first-child content and emphasis", async (t) => {
  const { markdown, directory } = await fixture(t);
  const output = path.join(directory, "nested-list.docx");
  await fs.writeFile(markdown, NESTED_LIST_MARKDOWN);
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.match(documentXml, /<w:b\/><w:bCs\/><\/w:rPr><w:t[^>]*>a bold title<\/w:t>/);
  assert.match(documentXml, /This source sentence contains/);
});

test("configured titles support manuscript Markdown without a level-one heading", async (t) => {
  const { directory } = await fixture(t);
  const markdown = path.join(directory, "VOLUME27.md");
  const output = path.join(directory, "configured-title.docx");
  await fs.writeFile(markdown, "## First manuscript section\n\nText retained below the configured book title.\n");
  const model = await parseWjeMarkdown(markdown);
  assert.equal(model.title, '"Controversies" Notebook');
  assert.equal(model.headings[0].data?.isTitle, undefined, "the first source heading remains content");
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validator accepts a preserved Unicode replacement marker from source OCR", async (t) => {
  const { directory } = await fixture(t);
  const markdown = path.join(directory, "VOLUME27.md");
  const output = path.join(directory, "replacement-marker.docx");
  await fs.writeFile(markdown, "## Transcription\n\nA source gap is preserved as � rather than silently invented.\n");
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("list-shaped footnotes retain inline formatting", async (t) => {
  const { directory } = await fixture(t);
  const markdown = path.join(directory, "VOLUME27.md");
  const output = path.join(directory, "list-shaped-footnote.docx");
  await fs.writeFile(markdown, "## Note\n\nA reference.[^note]\n\n[^note]: * An editorial note with *preserved italics*.\n");
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const footnotesXml = await zip.file("word/footnotes.xml").async("string");
  assert.match(footnotesXml, /<w:i\/><w:iCs\/><\/w:rPr><w:t[^>]*>preserved italics<\/w:t>/);
});

test("multiple embedded images receive unique Word drawing ids", async (t) => {
  const { markdown, directory } = await fixture(t);
  const output = path.join(directory, "multiple-images.docx");
  await fs.writeFile(markdown, MARKDOWN.replace("![A simple diagram](assets/diagram.png)", "![First illustration](assets/diagram.png)\n\n![Second illustration](assets/diagram.png)"));
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const documentXml = await zip.file("word/document.xml").async("string");
  const ids = [...documentXml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, ids.length);
});

test("validator rejects Word schema constructs that trigger document repair", async (t) => {
  const { directory, markdown } = await fixture(t);
  const original = path.join(directory, "original.docx");
  const broken = path.join(directory, "schema-repair.docx");
  await createKdpDocx({ input: markdown, output: original, profileId: "kindle" });
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const documentXml = await zip.file("word/document.xml").async("string");
  const settingsXml = await zip.file("word/settings.xml").async("string");
  const fontTableXml = await zip.file("word/fontTable.xml").async("string");
  zip.file("word/document.xml", documentXml
    .replace(/(<w:pStyle\b[^>]*\/>)/, "$1$1")
    .replace("<w:tblHeader/>", '<w:tblHeader w:val="false"/>'));
  zip.file("word/settings.xml", settingsXml.replace("</w:settings>", '<w:defaultTabStop w:val="720"/><w:updateFields/></w:settings>'));
  zip.file("word/fontTable.xml", fontTableXml.replace(/w:fontKey="\{([^}]*)\}"/, (_match, key) => `w:fontKey="{${key.toLowerCase()}}"`));
  await fs.writeFile(broken, await zip.generateAsync({ type: "nodebuffer" }));
  const validation = await validateKdpDocx({ input: markdown, docx: broken, profileId: "kindle" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Duplicate paragraph style")));
  assert.ok(validation.errors.some((error) => error.includes("Invalid disabled table-header marker")));
  assert.ok(validation.errors.some((error) => error.includes("defaultTabStop")));
  assert.ok(validation.errors.some((error) => error.includes("field updates on open")));
  assert.ok(validation.errors.some((error) => error.includes("font key is not an uppercase GUID")));
});

test("footnote references inside headings remain true Word footnotes", async (t) => {
  const { directory, markdown } = await fixture(t);
  const output = path.join(directory, "heading-footnote.docx");
  const source = MARKDOWN
    .replace("### Note to the Reader", "### Note to the Reader[^heading-note]")
    .replace("[^unused]:", "[^heading-note]: A heading footnote must not be dropped.\n\n[^unused]:");
  await fs.writeFile(markdown, source);
  await createKdpDocx({ input: markdown, output, profileId: "kindle" });
  const validation = await validateKdpDocx({ input: markdown, docx: output, profileId: "kindle" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.inventory.footnoteReferences, 2);
  assert.equal(validation.inventory.footnoteDefinitions, 2);
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
