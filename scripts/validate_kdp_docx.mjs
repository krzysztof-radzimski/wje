#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { isOutlineTable, splitTableRows } from "./lib/kdp-docx/builder.mjs";
import { navigationHeadings, parseWjeMarkdown, plainText } from "./lib/kdp-docx/markdown.mjs";
import { loadProfile } from "./create_kdp_docx.mjs";

export async function validateKdpDocx({ input, docx, profileId }) {
  if (!input || !docx || !profileId) throw new Error("--profile, Markdown input, and DOCX output are required");
  const profile = await loadProfile(profileId);
  const model = await parseWjeMarkdown(path.resolve(input));
  const data = await fs.readFile(path.resolve(docx));
  const errors = [];
  const warnings = [];
  let zip;
  try {
    zip = await JSZip.loadAsync(data, { checkCRC32: true });
  } catch (error) {
    return { valid: false, errors: [`Corrupt DOCX ZIP: ${error.message}`], warnings, inventory: null };
  }

  const required = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/settings.xml", "word/_rels/document.xml.rels"];
  for (const part of required) if (!zip.file(part)) errors.push(`Missing required OOXML part: ${part}`);
  if (errors.length) return { valid: false, errors, warnings, inventory: null };

  const xmlParts = {};
  for (const part of Object.keys(zip.files).filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))) {
    try {
      xmlParts[part] = parseXml(await zip.file(part).async("string"), part);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) return { valid: false, errors, warnings, inventory: null };

  await validateRelationships(zip, xmlParts, errors);
  const document = xmlParts["word/document.xml"];
  const styles = xmlParts["word/styles.xml"];
  const settings = xmlParts["word/settings.xml"];
  const text = elements(document, "w:t").map((node) => node.textContent).join("");
  const paragraphs = elements(document, "w:p");
  const paragraphStyles = paragraphs.map((paragraph) => first(paragraph, "w:pStyle")?.getAttribute("w:val") ?? "");
  const styleCount = (style) => paragraphStyles.filter((value) => value === style).length;
  const headings = {
    1: styleCount("Heading1"),
    2: styleCount("Heading2"),
    3: styleCount("Heading3")
  };

  const expectedHeadings = {
    1: model.inventory.headings[2] + model.inventory.headings[1] - 1,
    2: model.inventory.headings[3],
    3: model.inventory.headings[4] + model.inventory.headings[5] + model.inventory.headings[6]
  };
  for (const level of [1, 2, 3]) {
    if (headings[level] !== expectedHeadings[level]) errors.push(`Heading ${level} count differs: DOCX=${headings[level]}, Markdown=${expectedHeadings[level]}`);
  }
  if (!text.includes(model.title)) errors.push("Markdown title is missing from DOCX text");

  const bookmarks = elements(document, "w:bookmarkStart").map((node) => node.getAttribute("w:name")).filter(Boolean);
  const duplicateBookmarks = bookmarks.filter((name, index) => bookmarks.indexOf(name) !== index);
  if (duplicateBookmarks.length) errors.push(`Duplicate bookmarks: ${[...new Set(duplicateBookmarks)].join(", ")}`);
  for (const requiredBookmark of ["top", "toc", ...model.headings.filter((heading) => !heading.data?.isTitle).map((heading) => heading.data.bookmark)]) {
    if (!bookmarks.includes(requiredBookmark)) errors.push(`Missing bookmark: ${requiredBookmark}`);
  }
  const anchors = elements(document, "w:hyperlink").map((node) => node.getAttribute("w:anchor")).filter(Boolean);
  for (const anchor of anchors) if (!bookmarks.includes(anchor)) errors.push(`Internal hyperlink points to missing bookmark: ${anchor}`);
  const expectedNavigation = navigationHeadings(model).length;
  if (anchors.length < expectedNavigation) errors.push(`Too few internal TOC links: DOCX=${anchors.length}, expected at least ${expectedNavigation}`);

  const footnoteReferences = elements(document, "w:footnoteReference").length;
  const footnotesPart = xmlParts["word/footnotes.xml"];
  const footnoteDefinitions = footnotesPart
    ? elements(footnotesPart, "w:footnote").filter((node) => Number(node.getAttribute("w:id")) > 0).length
    : 0;
  if (footnoteReferences !== model.inventory.footnoteReferences) errors.push(`Footnote reference count differs: DOCX=${footnoteReferences}, Markdown=${model.inventory.footnoteReferences}`);
  if (footnoteDefinitions !== model.inventory.footnoteReferences) errors.push(`Generated footnote definition count differs: DOCX=${footnoteDefinitions}, expected=${model.inventory.footnoteReferences}`);
  const referencedIdentifiers = new Set();
  for (const node of model.body) collectFootnoteIdentifiers(node, referencedIdentifiers);
  const expectedUnreferenced = [...model.footnotes.keys()].filter((identifier) => !referencedIdentifiers.has(identifier)).length;
  if (styleCount("UnreferencedNote") !== expectedUnreferenced) errors.push(`Unreferenced source-note count differs: DOCX=${styleCount("UnreferencedNote")}, Markdown=${expectedUnreferenced}`);

  const expectedTables = expectedTableParts(model);
  const docxTables = elements(document, "w:tbl").length;
  if (docxTables !== expectedTables.parts) errors.push(`Native table part count differs: DOCX=${docxTables}, expected=${expectedTables.parts}`);
  if (styleCount("OutlineRow") !== expectedTables.outlineRows) errors.push(`Outline row count differs: DOCX=${styleCount("OutlineRow")}, expected=${expectedTables.outlineRows}`);

  const sourcePages = (text.match(/\[p\.\s*[^\]]+\]/g) ?? []).length;
  if (sourcePages !== model.inventory.sourcePages) errors.push(`Source page marker count differs: DOCX=${sourcePages}, Markdown=${model.inventory.sourcePages}`);
  const drawings = elements(document, "a:blip");
  if (drawings.length !== model.inventory.images) errors.push(`Embedded image count differs: DOCX=${drawings.length}, Markdown=${model.inventory.images}`);
  for (const drawing of elements(document, "wp:docPr")) {
    if (!drawing.getAttribute("descr")) errors.push("An embedded image has no alternative description");
  }
  if (model.inventory.mermaidBlocks && styleCount("MermaidCode") < model.inventory.mermaidBlocks) errors.push("A Mermaid block was lost instead of being retained as named preformatted text");

  validateStyles(styles, profile, errors);
  validateFontEmbedding(zip, xmlParts, profile, errors);
  validateProfile(document, settings, xmlParts, profile, errors);
  validateMediaRelationships(zip, xmlParts, errors);

  const inventory = {
    profile: profile.id,
    headings,
    footnoteReferences,
    footnoteDefinitions,
    tables: docxTables,
    outlineRows: styleCount("OutlineRow"),
    images: drawings.length,
    sourcePages,
    bookmarks: bookmarks.length,
    internalLinks: anchors.length,
    sections: elements(document, "w:sectPr").length
  };
  return { valid: errors.length === 0, errors, warnings, inventory };
}

function validateStyles(styles, profile, errors) {
  const styleMap = new Map(elements(styles, "w:style").map((style) => [style.getAttribute("w:styleId"), style]));
  const required = ["Normal", "BodyText", "BookTitle", "BookSubtitle", "BookAuthor", "Heading1", "Heading2", "Heading3", "TocTitle", "TocEntry", "BlockQuote", "SourcePage", "TableText", "Caption", "FootnoteText", "UnreferencedNotesTitle", "UnreferencedNote"];
  for (const id of required) if (!styleMap.has(id)) errors.push(`Missing named style: ${id}`);
  for (const id of ["Normal", "BodyText"]) {
    const style = styleMap.get(id);
    const fonts = style ? first(style, "w:rFonts") : null;
    const font = fonts?.getAttribute("w:ascii") ?? fonts?.getAttribute("w:hAnsi");
    if (font !== profile.typography.bodyFont) errors.push(`${id} uses ${font || "an inherited default"} instead of ${profile.typography.bodyFont}`);
    const size = first(style, "w:sz")?.getAttribute("w:val");
    if (size !== String(profile.typography.bodySizeHalfPoints)) errors.push(`${id} font size differs: ${size}`);
  }
  const defaults = first(styles, "w:docDefaults");
  const defaultFont = first(defaults, "w:rFonts")?.getAttribute("w:ascii");
  if (defaultFont !== profile.typography.bodyFont) errors.push(`Document default font is ${defaultFont || "implicit"}, expected ${profile.typography.bodyFont}`);
  const forbidden = new Set(["Aptos", "Calibri", "Times New Roman"]);
  for (const id of ["Normal", "BodyText"]) {
    const font = first(styleMap.get(id), "w:rFonts")?.getAttribute("w:ascii");
    if (forbidden.has(font)) errors.push(`Accidental Word default font in ${id}: ${font}`);
  }
}

function validateFontEmbedding(zip, xmlParts, profile, errors) {
  if (!profile.layout.embedFonts) return;
  const fontTable = xmlParts["word/fontTable.xml"];
  const fontRels = xmlParts["word/_rels/fontTable.xml.rels"];
  if (!fontTable || !fontRels) {
    errors.push("Profile requires an embedded font, but font-table parts are missing");
    return;
  }
  const font = elements(fontTable, "w:font").find((node) => node.getAttribute("w:name") === profile.typography.bodyFont);
  if (!font) errors.push(`Font table does not declare ${profile.typography.bodyFont}`);
  if (first(font, "w:altName")?.getAttribute("w:val") !== profile.typography.fallbackFonts[0]) {
    errors.push(`Font table lacks the configured ${profile.typography.fallbackFonts[0]} fallback`);
  }
  const embedded = elements(fontRels, "Relationship").filter((node) => /\/font$/.test(node.getAttribute("Type")));
  if (!embedded.length) errors.push("No embedded font relationship is present");
  for (const relation of embedded) {
    const target = path.posix.normalize(path.posix.join("word", relation.getAttribute("Target")));
    if (!zip.file(target)) errors.push(`Missing embedded font part: ${target}`);
  }
}

function validateProfile(document, settings, xmlParts, profile, errors) {
  const sections = elements(document, "w:sectPr");
  if (!sections.length) errors.push("DOCX has no section properties");
  for (const [index, section] of sections.entries()) {
    const size = first(section, "w:pgSz");
    if (size?.getAttribute("w:w") !== String(profile.page.widthDxa) || size?.getAttribute("w:h") !== String(profile.page.heightDxa)) {
      errors.push(`Section ${index + 1} has incorrect page size`);
    }
    const margin = first(section, "w:pgMar");
    for (const key of ["top", "right", "bottom", "left", "header", "footer", "gutter"]) {
      const expected = profile.page[`margin${key[0].toUpperCase()}${key.slice(1)}Dxa`] ?? profile.page[`${key}Dxa`];
      if (margin?.getAttribute(`w:${key}`) !== String(expected)) errors.push(`Section ${index + 1} has incorrect ${key} margin`);
    }
  }
  const headerRefs = elements(document, "w:headerReference").length;
  const footerRefs = elements(document, "w:footerReference").length;
  const fieldText = Object.entries(xmlParts).filter(([name]) => /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name))
    .flatMap(([, xml]) => elements(xml, "w:instrText").map((node) => node.textContent)).join(" ");
  const mirrored = elements(settings, "w:mirrorMargins").length > 0;
  if (profile.id === "kindle") {
    if (headerRefs || footerRefs) errors.push("Kindle profile contains running header/footer references");
    if (/\b(?:PAGE|NUMPAGES)\b/i.test(fieldText)) errors.push("Kindle profile contains document page-number fields");
    if (mirrored) errors.push("Kindle profile must not use mirrored margins");
  } else {
    if (sections.length !== 2) errors.push(`Print profile must have exactly two sections; found ${sections.length}`);
    if (!headerRefs || !footerRefs) errors.push("Print profile lacks running headers or page-number footers in the body section");
    if (!/\bPAGE\b/i.test(fieldText)) errors.push("Print profile lacks a PAGE field");
    if (!mirrored) errors.push("Print profile lacks mirrored margins");
    if (profile.page.marginLeftDxa < 1260 || profile.page.marginRightDxa < 360) errors.push("Print margins do not meet the selected no-bleed 6×9 safety profile");
  }
}

async function validateRelationships(zip, xmlParts, errors) {
  for (const [name, xml] of Object.entries(xmlParts).filter(([part]) => part.endsWith(".rels"))) {
    const sourceDirectory = name === "_rels/.rels" ? "" : path.posix.dirname(path.posix.dirname(name));
    for (const relation of elements(xml, "Relationship")) {
      if (relation.getAttribute("TargetMode") === "External") continue;
      const target = path.posix.normalize(path.posix.join(sourceDirectory, relation.getAttribute("Target")));
      if (!zip.file(target)) errors.push(`Broken relationship ${name} -> ${target}`);
    }
  }
}

function validateMediaRelationships(zip, xmlParts, errors) {
  const relationships = xmlParts["word/_rels/document.xml.rels"];
  for (const relation of elements(relationships, "Relationship").filter((node) => /\/image$/.test(node.getAttribute("Type")))) {
    const target = path.posix.normalize(path.posix.join("word", relation.getAttribute("Target")));
    if (!zip.file(target)) errors.push(`Missing related media part: ${target}`);
  }
}

function expectedTableParts(model) {
  let parts = 0;
  let outlineRows = 0;
  for (const node of model.body.filter((item) => item.type === "table")) {
    const rows = node.children.map((row) => row.children.map((cell) => cell.children));
    if (isOutlineTable(rows)) outlineRows += rows.filter((row) => row.some((cell) => plainText({ children: cell }).trim())).length;
    else parts += splitTableRows(rows).length;
  }
  return { parts, outlineRows };
}

function collectFootnoteIdentifiers(node, result) {
  if (node.type === "footnoteReference") result.add(node.identifier);
  for (const child of node.children ?? []) collectFootnoteIdentifiers(child, result);
}

function parseXml(source, part) {
  const messages = [];
  const document = new DOMParser({ onError: (level, message) => messages.push(`${level}: ${message}`) }).parseFromString(source, "application/xml");
  if (messages.length || elements(document, "parsererror").length) throw new Error(`Malformed XML part ${part}: ${messages.join("; ") || "parser error"}`);
  return document;
}

function elements(root, name) {
  if (!root) return [];
  const direct = Array.from(root.getElementsByTagName(name));
  if (direct.length || !name.includes(":")) return direct;
  return Array.from(root.getElementsByTagNameNS("*", name.split(":")[1]));
}

function first(root, name) {
  return elements(root, name)[0] ?? null;
}

function usage() {
  return "Usage: node scripts/validate_kdp_docx.mjs --profile kindle|print-6x9 MD/VOLUMENN.md DOCX_FILE.docx";
}

function parseArguments(argv) {
  const positional = [];
  let profileId;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--profile") profileId = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") return { help: true };
    else if (argv[index].startsWith("--")) throw new Error(`Unknown option: ${argv[index]}`);
    else positional.push(argv[index]);
  }
  return { profileId, input: positional[0], docx: positional[1], extra: positional.slice(2) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (options.extra?.length) throw new Error("Too many positional arguments");
  const result = await validateKdpDocx(options);
  console.log(`Validation ${result.valid ? "OK" : "FAILED"}: ${options.docx}`);
  if (result.inventory) console.log(JSON.stringify(result.inventory));
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
