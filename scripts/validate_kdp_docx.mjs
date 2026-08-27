#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { isOutlineTable, splitTableRows } from "./lib/kdp-docx/builder.mjs";
import { navigationHeadings, parseWjeMarkdown, plainText, sourcePageLabel } from "./lib/kdp-docx/markdown.mjs";
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

  const required = ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml", "word/settings.xml", "word/_rels/document.xml.rels"];
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

  validateOpcUris(zip, xmlParts, errors);
  await validateRelationships(zip, xmlParts, errors);
  validateWordCompatibility(xmlParts, errors);
  const document = xmlParts["word/document.xml"];
  const styles = xmlParts["word/styles.xml"];
  const settings = xmlParts["word/settings.xml"];
  validateMetadata(xmlParts["docProps/core.xml"], model, profile, errors);
  const text = elements(document, "w:t").map((node) => node.textContent).join("");
  const paragraphs = elements(document, "w:p");
  const paragraphStyles = paragraphs.map((paragraph) => first(paragraph, "w:pStyle")?.getAttribute("w:val") ?? "");
  const styleCount = (style) => paragraphStyles.filter((value) => value === style).length;
  const headings = {
    1: styleCount("Heading1"),
    2: styleCount("Heading2"),
    3: styleCount("Heading3")
  };

  const expectedHeadings = { 1: 0, 2: 0, 3: 0 };
  for (const heading of model.headings) {
    if (heading.data?.isTitle) continue;
    const level = Math.min(Math.max(heading.depth - 1, 1), 3);
    expectedHeadings[level] += 1;
  }
  for (const level of [1, 2, 3]) {
    if (headings[level] !== expectedHeadings[level]) errors.push(`Heading ${level} count differs: DOCX=${headings[level]}, Markdown=${expectedHeadings[level]}`);
  }
  if (!text.includes(model.title)) errors.push("Markdown title is missing from DOCX text");
  validateHeadingOrder(document, model, errors);

  const bookmarks = elements(document, "w:bookmarkStart").map((node) => node.getAttribute("w:name")).filter(Boolean);
  const duplicateBookmarks = bookmarks.filter((name, index) => bookmarks.indexOf(name) !== index);
  if (duplicateBookmarks.length) errors.push(`Duplicate bookmarks: ${[...new Set(duplicateBookmarks)].join(", ")}`);
  validateBookmarkIds(document, errors);
  for (const requiredBookmark of ["top", "toc", ...model.headings.filter((heading) => !heading.data?.isTitle).map((heading) => heading.data.bookmark)]) {
    if (!bookmarks.includes(requiredBookmark)) errors.push(`Missing bookmark: ${requiredBookmark}`);
  }
  const anchors = elements(document, "w:hyperlink").map((node) => node.getAttribute("w:anchor")).filter(Boolean);
  for (const anchor of anchors) if (!bookmarks.includes(anchor)) errors.push(`Internal hyperlink points to missing bookmark: ${anchor}`);
  const expectedNavigation = navigationHeadings(model).length;
  if (anchors.length < expectedNavigation) errors.push(`Too few internal TOC links: DOCX=${anchors.length}, expected at least ${expectedNavigation}`);
  validateToc(document, model, errors);

  const footnoteReferences = elements(document, "w:footnoteReference").length;
  const footnotesPart = xmlParts["word/footnotes.xml"];
  const footnoteDefinitions = footnotesPart
    ? elements(footnotesPart, "w:footnote").filter((node) => Number(node.getAttribute("w:id")) > 0).length
    : 0;
  if (footnoteReferences !== model.inventory.footnoteReferences) errors.push(`Footnote reference count differs: DOCX=${footnoteReferences}, Markdown=${model.inventory.footnoteReferences}`);
  if (footnoteDefinitions !== model.inventory.footnoteReferences) errors.push(`Generated footnote definition count differs: DOCX=${footnoteDefinitions}, expected=${model.inventory.footnoteReferences}`);
  validateFootnoteContents(document, footnotesPart, model, errors);
  const referencedIdentifiers = new Set();
  for (const node of model.body) collectFootnoteIdentifiers(node, referencedIdentifiers);
  const expectedUnreferenced = [...model.footnotes.keys()].filter((identifier) => !referencedIdentifiers.has(identifier)).length;
  if (styleCount("UnreferencedNote") !== expectedUnreferenced) errors.push(`Unreferenced source-note count differs: DOCX=${styleCount("UnreferencedNote")}, Markdown=${expectedUnreferenced}`);

  const expectedTables = expectedTableParts(model);
  const docxTables = elements(document, "w:tbl").length;
  if (docxTables !== expectedTables.parts) errors.push(`Native table part count differs: DOCX=${docxTables}, expected=${expectedTables.parts}`);
  if (styleCount("OutlineRow") !== expectedTables.outlineRows) errors.push(`Outline row count differs: DOCX=${styleCount("OutlineRow")}, expected=${expectedTables.outlineRows}`);
  validateTableContents(document, model, errors);

  const sourcePages = styleCount("SourcePage") + elements(document, "w:rStyle").filter((node) => node.getAttribute("w:val") === "SourcePageInline").length;
  if (sourcePages !== model.inventory.sourcePages) errors.push(`Source page marker count differs: DOCX=${sourcePages}, Markdown=${model.inventory.sourcePages}`);
  const drawings = elements(document, "a:blip");
  if (drawings.length !== model.inventory.images) errors.push(`Embedded image count differs: DOCX=${drawings.length}, Markdown=${model.inventory.images}`);
  const drawingProperties = elements(document, "wp:docPr");
  const drawingIds = drawingProperties.map((drawing) => drawing.getAttribute("id") ?? "");
  if (drawingIds.some((id) => !/^\d+$/.test(id) || Number(id) < 1)) errors.push("An embedded image has an invalid drawing id");
  const duplicateDrawingIds = drawingIds.filter((id, index) => id && drawingIds.indexOf(id) !== index);
  if (duplicateDrawingIds.length) errors.push(`Duplicate drawing ids: ${[...new Set(duplicateDrawingIds)].join(", ")}`);
  for (const drawing of drawingProperties) {
    if (!drawing.getAttribute("descr")) errors.push("An embedded image has no alternative description");
  }
  validateImagesAndCaptions(document, model, errors);
  validateMermaid(document, model, errors);
  validateInlineFormatting(document, footnotesPart, model, errors);

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

function validateMetadata(core, model, profile, errors) {
  const values = {
    title: first(core, "dc:title")?.textContent ?? "",
    creator: first(core, "dc:creator")?.textContent ?? "",
    subject: first(core, "dc:subject")?.textContent ?? "",
    description: first(core, "dc:description")?.textContent ?? ""
  };
  if (values.title !== model.title) errors.push(`Core title differs from Markdown: ${JSON.stringify(values.title)}`);
  if (!values.creator.trim()) errors.push("Core creator metadata is empty");
  if (values.subject !== profile.description) errors.push(`Core subject differs from profile description: ${JSON.stringify(values.subject)}`);
  if (!values.description.includes(profile.id)) errors.push("Core description does not identify the selected profile");
}

function validateHeadingOrder(document, model, errors) {
  const actual = elements(document, "w:p")
    .filter((paragraph) => /^Heading[123]$/.test(first(paragraph, "w:pStyle")?.getAttribute("w:val") ?? ""))
    .map(paragraphText);
  const expected = model.headings.filter((heading) => !heading.data?.isTitle).map((heading) => plainText(heading));
  compareSequence("Heading text/order", actual, expected, errors);
}

function validateToc(document, model, errors) {
  const actual = elements(document, "w:p")
    .filter((paragraph) => first(paragraph, "w:pStyle")?.getAttribute("w:val") === "TocEntry")
    .map((paragraph) => {
      const hyperlink = first(paragraph, "w:hyperlink");
      return { anchor: hyperlink?.getAttribute("w:anchor") ?? "", text: hyperlink ? textContent(hyperlink) : "" };
    });
  const expected = navigationHeadings(model).map((heading) => ({ anchor: heading.data.bookmark, text: plainText(heading) }));
  compareSequence("TOC entry", actual.map(JSON.stringify), expected.map(JSON.stringify), errors);
}

function validateBookmarkIds(document, errors) {
  const starts = elements(document, "w:bookmarkStart");
  const ends = elements(document, "w:bookmarkEnd");
  const startIds = starts.map((node) => node.getAttribute("w:id") ?? "");
  const endIds = ends.map((node) => node.getAttribute("w:id") ?? "");
  const invalid = [...startIds, ...endIds].filter((id) => !/^\d+$/.test(id));
  if (invalid.length) errors.push(`Bookmark ids must be non-negative integers; invalid=${[...new Set(invalid)].map(JSON.stringify).join(", ")}`);

  const duplicateIds = startIds.filter((id, index) => id && startIds.indexOf(id) !== index);
  if (duplicateIds.length) errors.push(`Duplicate bookmark numeric ids: ${[...new Set(duplicateIds)].join(", ")}`);

  const startCounts = countValues(startIds);
  const endCounts = countValues(endIds);
  for (const id of new Set([...startIds, ...endIds])) {
    if (!id) continue;
    const startCount = startCounts.get(id) ?? 0;
    const endCount = endCounts.get(id) ?? 0;
    if (startCount !== 1 || endCount !== 1) {
      errors.push(`Bookmark id ${id} must have exactly one start and one end; starts=${startCount}, ends=${endCount}`);
    }
  }
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function validateFootnoteContents(document, footnotesPart, model, errors) {
  if (!footnotesPart) return;
  const identifiers = [];
  for (const node of model.body) collectFootnoteIdentifierOrder(node, identifiers);
  const references = elements(document, "w:footnoteReference").map((node) => Number(node.getAttribute("w:id")));
  if (references.length !== identifiers.length) return;
  const definitions = new Map(elements(footnotesPart, "w:footnote")
    .filter((node) => Number(node.getAttribute("w:id")) > 0)
    .map((node) => [Number(node.getAttribute("w:id")), node]));
  const actual = references.map((id) => footnoteText(definitions.get(id)));
  const expected = identifiers.map((identifier) => expectedFootnoteText(model.footnotes.get(identifier)));
  compareSequence("Footnote content/order", actual, expected, errors);
  for (const [id, definition] of definitions) {
    if (!elements(definition, "w:footnoteRef").length) errors.push(`Footnote ${id} lacks its Word footnote marker/backlink semantics`);
  }
}

function validateTableContents(document, model, errors) {
  const expected = [];
  for (const node of model.body.filter((item) => item.type === "table")) {
    const rows = node.children.map((row) => row.children.map((cell) => cell.children));
    if (isOutlineTable(rows)) continue;
    for (const chunk of splitTableRows(rows)) {
      expected.push(chunk.map((row) => row.map((cell) => semanticText({ children: cell }))));
    }
  }
  const actual = elements(document, "w:tbl").map((table) => directChildren(table, "w:tr").map((row) =>
    directChildren(row, "w:tc").map((cell) => textContent(cell))));
  compareSequence("Table content/order", actual.map(JSON.stringify), expected.map(JSON.stringify), errors);
}

function validateImagesAndCaptions(document, model, errors) {
  const expected = [];
  collectNodes({ type: "root", children: model.body }, "image", (node) => expected.push(node.alt?.trim() || "Illustration"));
  const actualAlt = elements(document, "wp:docPr").map((node) => node.getAttribute("descr") ?? "");
  compareSequence("Image alt text/order", actualAlt, expected, errors);
  const captions = elements(document, "w:p")
    .filter((paragraph) => first(paragraph, "w:pStyle")?.getAttribute("w:val") === "Caption")
    .map(paragraphText);
  let from = 0;
  for (const caption of expected) {
    const index = captions.indexOf(caption, from);
    if (index < 0) errors.push(`Missing image caption: ${JSON.stringify(caption)}`);
    else from = index + 1;
  }
}

function validateMermaid(document, model, errors) {
  const expected = [];
  collectNodes({ type: "root", children: model.body }, "code", (node) => {
    if (node.lang?.toLowerCase() === "mermaid") expected.push(...String(node.value).split("\n").map((line) => line || " "));
  });
  const actual = elements(document, "w:p")
    .filter((paragraph) => first(paragraph, "w:pStyle")?.getAttribute("w:val") === "MermaidCode")
    .map(paragraphText);
  compareSequence("Mermaid source", actual, expected, errors);
}

function validateInlineFormatting(document, footnotesPart, model, errors) {
  const expected = { bold: [], italics: [], strike: [] };
  collectFormattedLeaves({ type: "root", children: model.body }, {}, expected);
  const identifiers = [];
  for (const node of model.body) collectFootnoteIdentifierOrder(node, identifiers);
  for (const identifier of identifiers) {
    for (const node of model.footnotes.get(identifier) ?? []) collectFormattedLeaves(node, {}, expected);
  }
  const roots = [document, footnotesPart].filter(Boolean);
  const actual = { bold: [], italics: [], strike: [] };
  for (const root of roots) {
    for (const run of elements(root, "w:r")) {
      const value = textContent(run);
      if (!value) continue;
      if (first(run, "w:b")) actual.bold.push(value);
      if (first(run, "w:i")) actual.italics.push(value);
      if (first(run, "w:strike")) actual.strike.push(value);
    }
  }
  for (const kind of Object.keys(expected)) validateMultisetSubset(`${kind} inline formatting`, actual[kind], expected[kind], errors);
}

function collectFormattedLeaves(node, inherited, output) {
  const flags = {
    bold: inherited.bold || node.type === "strong",
    italics: inherited.italics || node.type === "emphasis",
    strike: inherited.strike || node.type === "delete"
  };
  if (["text", "inlineCode", "html"].includes(node.type) && node.value) {
    for (const kind of Object.keys(output)) if (flags[kind]) output[kind].push(node.value);
  }
  for (const child of node.children ?? []) collectFormattedLeaves(child, flags, output);
}

function validateMultisetSubset(label, actual, expected, errors) {
  const remaining = new Map();
  for (const value of actual) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const value of expected) {
    const count = remaining.get(value) ?? 0;
    if (!count) errors.push(`${label} lost text: ${JSON.stringify(value)}`);
    else remaining.set(value, count - 1);
  }
}

function collectFootnoteIdentifierOrder(node, result) {
  if (node.type === "footnoteReference") result.push(node.identifier);
  for (const child of node.children ?? []) collectFootnoteIdentifierOrder(child, result);
}

function expectedFootnoteText(nodes) {
  if (!nodes?.length) return "[Footnote text is absent from the saved source.]";
  return nodes.map(semanticText).join(" ");
}

function footnoteText(node) {
  if (!node) return "";
  return directChildren(node, "w:p").map(paragraphText).join(" ");
}

function semanticText(node) {
  const page = sourcePageLabel(node);
  if (page !== null) return `[p. ${page}]`;
  if (["text", "inlineCode", "code", "html"].includes(node?.type)) return node.value ?? "";
  if (node?.type === "image") return node.alt ?? "";
  if (node?.type === "footnoteReference") return "";
  return (node?.children ?? []).map(semanticText).join("");
}

function collectNodes(node, type, callback) {
  if (node.type === type) callback(node);
  for (const child of node.children ?? []) collectNodes(child, type, callback);
}

function compareSequence(label, actual, expected, errors) {
  if (actual.length !== expected.length) {
    errors.push(`${label} count differs: DOCX=${actual.length}, Markdown=${expected.length}`);
    return;
  }
  const index = actual.findIndex((value, itemIndex) => value !== expected[itemIndex]);
  if (index >= 0) errors.push(`${label} differs at item ${index + 1}: DOCX=${JSON.stringify(actual[index])}, Markdown=${JSON.stringify(expected[index])}`);
}

function paragraphText(paragraph) {
  return textContent(paragraph);
}

function textContent(node) {
  return elements(node, "w:t").map((item) => item.textContent).join("");
}

function directChildren(node, name) {
  return Array.from(node?.childNodes ?? []).filter((child) => child.nodeType === 1 && (child.nodeName === name || child.localName === name.split(":").at(-1)));
}

function validateStyles(styles, profile, errors) {
  const styleMap = new Map(elements(styles, "w:style").map((style) => [style.getAttribute("w:styleId"), style]));
  const required = ["Normal", "BodyText", "BookTitle", "BookSubtitle", "BookAuthor", "Heading1", "Heading2", "Heading3", "TocTitle", "TocEntry", "BlockQuote", "SourcePage", "SourcePageInline", "TableText", "Caption", "FootnoteText", "UnreferencedNotesTitle", "UnreferencedNote"];
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

function validateOpcUris(zip, xmlParts, errors) {
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (/[\\\s?#]/u.test(name) || /[^\x21-\x7E]/u.test(name) || /%(?![0-9A-Fa-f]{2})/.test(name)) {
      errors.push(`Invalid OPC part URI: ${name}`);
    }
  }
  for (const [name, xml] of Object.entries(xmlParts).filter(([part]) => part.endsWith(".rels"))) {
    for (const relation of elements(xml, "Relationship")) {
      if (relation.getAttribute("TargetMode") === "External") continue;
      const target = relation.getAttribute("Target") ?? "";
      if (!target || /[\\\s?#]/u.test(target) || /[^\x21-\x7E]/u.test(target) || /%(?![0-9A-Fa-f]{2})/.test(target)) {
        errors.push(`Invalid internal relationship target in ${name}: ${JSON.stringify(target)}`);
      }
    }
  }
}

function validateWordCompatibility(xmlParts, errors) {
  const wordprocessingParts = Object.entries(xmlParts).filter(([name]) =>
    /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(name)
  );
  for (const [name, xml] of wordprocessingParts) {
    for (const paragraphProperties of elements(xml, "w:pPr")) {
      const children = Array.from(paragraphProperties.childNodes ?? []).filter((child) => child.nodeType === 1);
      const paragraphStyles = children.filter((child) => child.nodeName === "w:pStyle" || child.localName === "pStyle");
      if (paragraphStyles.length > 1) errors.push(`Duplicate paragraph style elements in ${name}`);
      if (paragraphStyles.length === 1 && children[0] !== paragraphStyles[0]) {
        errors.push(`Paragraph style is not the first paragraph property in ${name}`);
      }
    }
    for (const tableHeader of elements(xml, "w:tblHeader")) {
      const value = tableHeader.getAttribute("w:val");
      if (value && !/^(?:1|true|on)$/i.test(value)) {
        errors.push(`Invalid disabled table-header marker in ${name}: ${JSON.stringify(value)}`);
      }
    }
  }

  const settings = xmlParts["word/settings.xml"];
  if (settings && elements(settings, "w:defaultTabStop").length) {
    errors.push("Generated settings contain a schema-sensitive defaultTabStop override");
  }
  for (const updateFields of elements(settings, "w:updateFields")) {
    const value = updateFields.getAttribute("w:val");
    if (!value || /^(?:1|true|on)$/i.test(value)) {
      errors.push("Document requests field updates on open and will trigger a Microsoft Word security prompt");
    }
  }
  if (settings) {
    const root = settings.documentElement;
    const settingNames = Array.from(root?.childNodes ?? [])
      .filter((child) => child.nodeType === 1)
      .map((child) => child.nodeName);
    const mirrorMargins = settingNames.indexOf("w:mirrorMargins");
    const trackRevisions = settingNames.indexOf("w:trackRevisions");
    if (mirrorMargins >= 0 && trackRevisions >= 0 && mirrorMargins > trackRevisions) {
      errors.push("mirrorMargins appears after trackRevisions in word/settings.xml");
    }
  }

  const fontTable = xmlParts["word/fontTable.xml"];
  for (const embeddedFont of ["w:embedRegular", "w:embedBold", "w:embedItalic", "w:embedBoldItalic"].flatMap((name) => elements(fontTable, name))) {
    const serializedValue = embeddedFont.getAttribute("w:fontKey");
    if (serializedValue && !/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/.test(serializedValue)) {
      errors.push(`Embedded font key is not an uppercase GUID: ${JSON.stringify(serializedValue)}`);
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
  const actionableMessages = messages.filter((message) => !/^warning: Unicode replacement character detected, source encoding issues\?$/i.test(message));
  if (actionableMessages.length || elements(document, "parsererror").length) {
    throw new Error(`Malformed XML part ${part}: ${actionableMessages.join("; ") || "parser error"}`);
  }
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
