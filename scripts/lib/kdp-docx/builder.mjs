import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  ImageRun,
  InternalHyperlink,
  LeaderType,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageReference,
  Paragraph,
  SectionType,
  ShadingType,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  VerticalAlignTable,
  TextRun,
  WidthType
} from "docx";
import JSZip from "jszip";
import { navigationHeadings, plainText, sourcePageLabel } from "./markdown.mjs";

const FONT_NAME = "Libre Baskerville";
const FONT_FILE = path.resolve("node_modules/@expo-google-fonts/libre-baskerville/400Regular/LibreBaskerville_400Regular.ttf");
const FONT_KEY = "00112233-4455-6677-8899-AABBCCDDEEFF";
const FONT_PART = "word/fonts/LibreBaskerville-Regular.odttf";
const FONT_RELATIONSHIP_TARGET = "fonts/LibreBaskerville-Regular.odttf";
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 10;
const MAX_TABLE_CELLS = 1800;
const MAX_TABLE_CHARACTERS = 20_000;

export async function buildKdpDocx(model, profile, options = {}) {
  const state = {
    model,
    profile,
    options: { author: "Jonathan Edwards", language: "en-US", ...options },
    footnotes: {},
    usedFootnoteIdentifiers: new Set(),
    footnoteId: 1,
    warnings: [...model.warnings],
    embeddedImages: 0,
    outputTableParts: 0,
    outlineRows: 0
  };

  const front = frontMatter(state);
  const body = await bodyMatter(state);
  const sectionBase = sectionProperties(profile);
  const sections = profile.id === "print-6x9"
    ? [
        { properties: { ...sectionBase, type: SectionType.NEXT_PAGE, titlePage: true }, children: front },
        printBodySection(state, sectionBase, body)
      ]
    : [{ properties: sectionBase, children: [...front, ...body] }];

  const fonts = profile.layout.embedFonts ? [{ name: FONT_NAME, data: await fs.readFile(FONT_FILE) }] : undefined;
  const doc = new Document({
    title: model.title,
    subject: profile.description,
    creator: state.options.author,
    description: `WJE Markdown to KDP DOCX (${profile.id})`,
    lastModifiedBy: "wje-local-tools",
    compatabilityModeVersion: 15,
    evenAndOddHeaderAndFooters: profile.layout.runningHeaders,
    features: { updateFields: true, trackRevisions: false },
    fonts,
    styles: styleSheet(profile, state.options.language),
    numbering: numberingConfig(profile),
    footnotes: state.footnotes,
    sections
  });

  let buffer = await Packer.toBuffer(doc);
  buffer = await patchGeneratedDocx(buffer, profile);
  return { buffer, warnings: state.warnings, statistics: buildStatistics(state) };
}

function frontMatter(state) {
  const { model, options, profile } = state;
  const subtitle = model.volume
    ? `The Works of Jonathan Edwards · Volume ${model.volume}`
    : "The Works of Jonathan Edwards";
  const children = [
    new Paragraph({ style: "BookTitle", children: [new Bookmark({ id: "top", children: [new TextRun(model.title)] })] }),
    new Paragraph({ style: "BookSubtitle", text: subtitle }),
    new Paragraph({ style: "BookAuthor", text: options.author }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ style: "TocTitle", children: [new Bookmark({ id: "toc", children: [new TextRun("Contents")] })] })
  ];

  const chapters = navigationHeadings(model);
  for (const heading of chapters) {
    const entry = [
      new InternalHyperlink({
        anchor: heading.data.bookmark,
        children: [new TextRun({ text: plainText(heading), style: "Hyperlink" })]
      })
    ];
    if (profile.navigation.tocPageNumbers) {
      entry.push(new TextRun("\t"), new PageReference(heading.data.bookmark, { hyperlink: true }));
    }
    children.push(new Paragraph({
      style: "TocEntry",
      tabStops: profile.navigation.tocPageNumbers
        ? [{ type: TabStopType.RIGHT, position: profileContentWidth(profile), leader: LeaderType.DOT }]
        : undefined,
      children: entry
    }));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));
  return children;
}

async function bodyMatter(state) {
  const output = [];
  for (const node of state.model.body) {
    if (node.type === "heading" && node.data?.isTitle) continue;
    const page = sourcePageLabel(node);
    if (page !== null) {
      output.push(new Paragraph({ style: "SourcePage", text: `[p. ${page}]` }));
      continue;
    }
    output.push(...await renderBlock(node, state));
  }
  const unused = [...state.model.footnotes.entries()].filter(([identifier]) => !state.usedFootnoteIdentifiers.has(identifier));
  if (unused.length) {
    output.push(new Paragraph({ style: "UnreferencedNotesTitle", text: "Unreferenced Source Notes" }));
    for (const [identifier, nodes] of unused) {
      output.push(new Paragraph({
        style: "UnreferencedNote",
        children: [new TextRun({ text: `[${identifier}] `, bold: true }), ...footnoteDefinitionRuns(nodes)]
      }));
    }
    state.warnings.push(`Preserved ${unused.length} unreferenced Markdown footnote definition(s) in a named source-notes section`);
  }
  return output;
}

async function renderBlock(node, state) {
  switch (node.type) {
    case "heading": return [headingParagraph(node, state)];
    case "paragraph": return renderParagraph(node, state);
    case "blockquote": return renderBlockquote(node, state);
    case "list": return renderList(node, state);
    case "table": return renderTable(node, state);
    case "image": return renderImage(node, state);
    case "code": return renderCode(node, state);
    case "thematicBreak": return [new Paragraph({ style: "SceneBreak", text: "* * *" })];
    case "html": return node.value.trim() ? [new Paragraph({ style: "BodyText", text: node.value })] : [];
    default:
      if (node.children) return (await Promise.all(node.children.map((child) => renderBlock(child, state)))).flat();
      state.warnings.push(`Unsupported Markdown block retained as text: ${node.type}`);
      return [new Paragraph({ style: "BodyText", text: plainText(node) })];
  }
}

function headingParagraph(node, state) {
  const depth = Math.min(Math.max(node.depth - 1, 1), 3);
  const style = `Heading${depth}`;
  return new Paragraph({
    style,
    pageBreakBefore: depth === 1 && state.profile.layout.chapterPageBreaks,
    children: [new Bookmark({ id: node.data.bookmark, children: inlineRuns(node.children, state) })]
  });
}

function renderParagraph(node, state, style = "BodyText") {
  const image = node.children?.length === 1 && node.children[0].type === "image" ? node.children[0] : null;
  if (image) return renderImage(image, state);
  return [new Paragraph({ style, children: inlineRuns(node.children, state) })];
}

async function renderBlockquote(node, state) {
  const paragraphs = [];
  for (const child of node.children ?? []) {
    if (child.type === "paragraph") paragraphs.push(...renderParagraph(child, state, "BlockQuote"));
    else paragraphs.push(...await renderBlock(child, state));
  }
  return paragraphs;
}

async function renderList(node, state, level = 0) {
  const result = [];
  let itemIndex = node.start ?? 1;
  for (const item of node.children ?? []) {
    const first = item.children?.[0];
    if (first?.type === "paragraph") {
      result.push(new Paragraph({
        style: "ListText",
        numbering: { reference: node.ordered ? "wje-numbered" : "wje-bullets", level: Math.min(level, 2), instance: node.ordered ? itemIndex : undefined },
        children: inlineRuns(first.children, state)
      }));
    }
    for (const child of item.children?.slice(1) ?? []) {
      if (child.type === "list") result.push(...await renderList(child, state, level + 1));
      else result.push(...await renderBlock(child, state));
    }
    itemIndex += 1;
  }
  return result;
}

async function renderTable(node, state) {
  const rows = node.children.map((row) => row.children.map((cell) => cell.children));
  if (isOutlineTable(rows)) {
    const out = [];
    for (const row of rows) {
      const populated = row.map((cell, index) => ({ cell, index, text: plainText({ children: cell }) })).filter((entry) => entry.text.trim());
      if (!populated.length) continue;
      const text = populated.map((entry) => entry.text).join(" — ");
      out.push(new Paragraph({ style: "OutlineRow", indent: { left: Math.min(populated[0].index, 5) * 288 }, text }));
      state.outlineRows += 1;
    }
    state.warnings.push(`Converted sparse ${rows.length}×${rows[0]?.length ?? 0} table to reflowable outline`);
    return out;
  }
  const chunks = splitTableRows(rows);
  state.outputTableParts += chunks.length;
  const out = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0) out.push(new Paragraph({ style: "Caption", text: "Table (continued)" }));
    out.push(createTable(chunks[index], state));
  }
  return out;
}

function createTable(rows, state) {
  const columns = Math.max(...rows.map((row) => row.length));
  const width = profileContentWidth(state.profile);
  const columnWidths = tableWidths(rows, columns, width);
  const borders = { style: BorderStyle.SINGLE, size: 3, color: "B8B8B8" };
  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    indent: { size: 0, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: { top: borders, bottom: borders, left: borders, right: borders, insideHorizontal: borders, insideVertical: borders },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0 ? true : undefined,
      cantSplit: true,
      children: Array.from({ length: columns }, (_, columnIndex) => new TableCell({
        width: { size: columnWidths[columnIndex], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: "ECE9E2", color: "auto" } : undefined,
        children: [new Paragraph({
          style: "TableText",
          children: inlineRuns(row[columnIndex] ?? [], state, { bold: rowIndex === 0 })
        })]
      }))
    }))
  });
}

async function renderImage(node, state) {
  const source = path.resolve(path.dirname(state.model.inputPath), decodeURIComponent(node.url));
  const data = await fs.readFile(source).catch(() => null);
  if (!data) throw new Error(`Missing Markdown image: ${source}`);
  const info = imageInfo(data, source);
  const maxWidth = state.profile.id === "print-6x9" ? 416 : 576;
  const maxHeight = state.profile.id === "print-6x9" ? 576 : 720;
  const scale = Math.min(1, maxWidth / info.width, maxHeight / info.height);
  const alt = node.alt?.trim() || "Illustration";
  state.embeddedImages += 1;
  return [
    new Paragraph({ style: "Image", children: [new ImageRun({
      type: info.type,
      data,
      transformation: { width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)) },
      altText: { title: alt, description: alt, name: path.basename(source) }
    })] }),
    new Paragraph({ style: "Caption", text: alt })
  ];
}

function renderCode(node, state) {
  if (node.lang?.toLowerCase() === "mermaid") {
    state.warnings.push("Mermaid block retained as named preformatted text; replace with an accessible figure before publication if essential");
  }
  const style = node.lang?.toLowerCase() === "mermaid" ? "MermaidCode" : "CodeBlock";
  return String(node.value).split("\n").map((line) => new Paragraph({ style, text: line || " " }));
}

function inlineRuns(nodes, state, inherited = {}) {
  const result = [];
  for (const node of nodes ?? []) {
    const props = { ...inherited };
    switch (node.type) {
      case "text": result.push(new TextRun({ text: node.value, ...props })); break;
      case "emphasis": result.push(...inlineRuns(node.children, state, { ...props, italics: true })); break;
      case "strong": result.push(...inlineRuns(node.children, state, { ...props, bold: true })); break;
      case "delete": result.push(...inlineRuns(node.children, state, { ...props, strike: true })); break;
      case "inlineCode": result.push(new TextRun({ text: node.value, style: "InlineCode", ...props })); break;
      case "break": result.push(new TextRun({ break: 1, ...props })); break;
      case "link": result.push(new ExternalHyperlink({ link: node.url, children: inlineRuns(node.children, state, props) })); break;
      case "footnoteReference": {
        if (!state) break;
        state.usedFootnoteIdentifiers.add(node.identifier);
        const id = state.footnoteId++;
        state.footnotes[id] = { children: footnoteParagraphs(node.identifier, state) };
        result.push(new FootnoteReferenceRun(id));
        break;
      }
      case "image": result.push(new TextRun({ text: node.alt ? `[Illustration: ${node.alt}]` : "[Illustration]", ...props })); break;
      case "html": {
        const page = sourcePageLabel(node);
        result.push(new TextRun(page === null
          ? { text: node.value, ...props }
          : { text: `[p. ${page}]`, style: "SourcePageInline", ...props }));
        break;
      }
      default:
        if (node.children) result.push(...inlineRuns(node.children, state, props));
        else if (node.value) result.push(new TextRun({ text: node.value, ...props }));
    }
  }
  return result;
}

function footnoteParagraphs(identifier, state) {
  const nodes = state.model.footnotes.get(identifier);
  if (!nodes?.length) {
    state.warnings.push(`Missing or empty footnote definition [^${identifier}]`);
    return [new Paragraph({ style: "FootnoteText", text: "[Footnote text is absent from the saved source.]" })];
  }
  const paragraphs = [];
  for (const node of nodes) {
    if (node.type === "paragraph") paragraphs.push(new Paragraph({ style: "FootnoteText", children: inlineRuns(node.children, null) }));
    else paragraphs.push(new Paragraph({ style: "FootnoteText", text: plainText(node) }));
  }
  return paragraphs;
}

function footnoteDefinitionRuns(nodes) {
  const runs = [];
  for (const [index, node] of nodes.entries()) {
    if (index > 0) runs.push(new TextRun({ break: 1 }));
    if (node.type === "paragraph") runs.push(...inlineRuns(node.children, null));
    else runs.push(new TextRun(plainText(node)));
  }
  return runs.length ? runs : [new TextRun("[Footnote text is absent from the saved source.]")];
}

function printBodySection(state, base, body) {
  const quietHeader = () => new Header({ children: [new Paragraph({ style: "RunningHeader", text: "" })] });
  const pageFooter = new Footer({ children: [new Paragraph({ style: "PageNumber", children: [new TextRun({ children: [PageNumber.CURRENT] })] })] });
  return {
    properties: { ...base, type: state.profile.layout.bodyStartsOnOddPage ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE, titlePage: true, page: { ...base.page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
    headers: {
      first: quietHeader(),
      default: new Header({ children: [new Paragraph({ style: "RunningHeader", text: state.model.title })] }),
      even: new Header({ children: [new Paragraph({ style: "RunningHeader", text: state.options.author })] })
    },
    footers: { first: pageFooter, default: pageFooter, even: pageFooter },
    children: body
  };
}

function sectionProperties(profile) {
  return {
    page: {
      size: { width: profile.page.widthDxa, height: profile.page.heightDxa },
      margin: {
        top: profile.page.marginTopDxa,
        right: profile.page.marginRightDxa,
        bottom: profile.page.marginBottomDxa,
        left: profile.page.marginLeftDxa,
        header: profile.page.headerDxa,
        footer: profile.page.footerDxa,
        gutter: profile.page.gutterDxa
      }
    }
  };
}

function styleSheet(profile, language) {
  const t = profile.typography;
  const bodyRun = { font: FONT_NAME, size: t.bodySizeHalfPoints, language: { value: language } };
  const bodyParagraph = { spacing: { before: 0, after: 0, line: t.bodyLineTwips, lineRule: "auto" }, indent: { firstLine: t.firstLineDxa }, alignment: AlignmentType.JUSTIFIED, widowControl: true };
  const heading = (id, name, size, before, after, outlineLevel, alignment = AlignmentType.LEFT) => ({
    id, name, basedOn: "BodyText", next: "BodyText", quickFormat: true,
    paragraph: { keepNext: true, keepLines: true, pageBreakBefore: id === "Heading1", spacing: { before, after }, indent: { firstLine: 0 }, alignment, outlineLevel },
    run: { font: FONT_NAME, size, bold: true, color: "1F2933" }
  });
  return {
    default: {
      document: { paragraph: bodyParagraph, run: bodyRun },
      heading1: heading("Heading1", "Heading 1", profile.id === "print-6x9" ? 30 : 34, 480, 220, 0, AlignmentType.CENTER),
      heading2: heading("Heading2", "Heading 2", profile.id === "print-6x9" ? 25 : 28, 320, 140, 1),
      heading3: heading("Heading3", "Heading 3", profile.id === "print-6x9" ? 22 : 24, 240, 100, 2),
      hyperlink: { name: "Hyperlink", run: { color: "40566B", underline: { type: "single" } } },
      footnoteReference: { name: "Footnote Reference", run: { superScript: true } },
      footnoteText: { name: "Footnote Text", paragraph: { spacing: { before: 0, after: 40, line: 220, lineRule: "auto" }, indent: { firstLine: 0 }, alignment: AlignmentType.JUSTIFIED }, run: { font: FONT_NAME, size: 17 } }
    },
    paragraphStyles: [
      { id: "Normal", name: "Normal", quickFormat: true, paragraph: bodyParagraph, run: bodyRun },
      { id: "BodyText", name: "WJE Body Text", basedOn: "Normal", next: "BodyText", quickFormat: true, paragraph: bodyParagraph, run: bodyRun },
      { id: "BookTitle", name: "WJE Book Title", basedOn: "BodyText", paragraph: { keepNext: true, spacing: { before: profile.id === "print-6x9" ? 2200 : 1800, after: 260 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: profile.id === "print-6x9" ? 44 : 52, bold: true } },
      { id: "BookSubtitle", name: "WJE Book Subtitle", basedOn: "BodyText", paragraph: { keepNext: true, spacing: { before: 100, after: 120 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 24, italics: true } },
      { id: "BookAuthor", name: "WJE Book Author", basedOn: "BodyText", paragraph: { spacing: { before: 220, after: 0 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 21, smallCaps: true } },
      { id: "TocTitle", name: "WJE Contents Title", basedOn: "BodyText", paragraph: { keepNext: true, spacing: { before: 240, after: 300 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 34, bold: true } },
      { id: "TocEntry", name: "WJE Contents Entry", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 80, line: 240, lineRule: "auto" }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT }, run: { font: FONT_NAME, size: 19 } },
      { id: "SourcePage", name: "WJE Source Page", basedOn: "BodyText", paragraph: { spacing: { before: 50, after: 20 }, indent: { firstLine: 0 }, alignment: AlignmentType.RIGHT }, run: { font: "Arial", size: 15, color: "777777" } },
      { id: "BlockQuote", name: "WJE Block Quote", basedOn: "BodyText", paragraph: { spacing: { before: 100, after: 100, line: t.bodyLineTwips }, indent: { left: 432, right: 288, firstLine: 0 }, alignment: AlignmentType.LEFT }, run: { font: FONT_NAME, size: t.bodySizeHalfPoints - 1, italics: true, color: "303A43" } },
      { id: "ListText", name: "WJE List Text", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 30, line: t.bodyLineTwips }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT }, run: bodyRun },
      { id: "TableText", name: "WJE Table Text", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 0, line: 220, lineRule: "auto" }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT }, run: { font: FONT_NAME, size: profile.id === "print-6x9" ? 16 : 18 } },
      { id: "OutlineRow", name: "WJE Outline Row", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 30, line: t.bodyLineTwips }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT }, run: bodyRun },
      { id: "Image", name: "WJE Image", basedOn: "BodyText", paragraph: { spacing: { before: 140, after: 70 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: bodyRun },
      { id: "Caption", name: "WJE Caption", basedOn: "BodyText", paragraph: { keepNext: true, spacing: { before: 0, after: 160 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 17, italics: true, color: "666666" } },
      { id: "CodeBlock", name: "WJE Code Block", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 0, line: 220, lineRule: "auto" }, indent: { left: 240, right: 240, firstLine: 0 }, alignment: AlignmentType.LEFT, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" } }, run: { font: "Courier New", size: 17 } },
      { id: "MermaidCode", name: "WJE Mermaid Source", basedOn: "CodeBlock", paragraph: { spacing: { before: 0, after: 0, line: 220, lineRule: "auto" }, indent: { left: 240, right: 240, firstLine: 0 }, alignment: AlignmentType.LEFT, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" } }, run: { font: "Courier New", size: 17 } },
      { id: "SceneBreak", name: "WJE Scene Break", basedOn: "BodyText", paragraph: { spacing: { before: 160, after: 160 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 18 } },
      { id: "UnreferencedNotesTitle", name: "WJE Unreferenced Source Notes Title", basedOn: "BodyText", paragraph: { keepNext: true, pageBreakBefore: true, spacing: { before: 320, after: 180 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 24, bold: true } },
      { id: "UnreferencedNote", name: "WJE Unreferenced Source Note", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 60, line: 220, lineRule: "auto" }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT }, run: { font: FONT_NAME, size: 17 } },
      { id: "RunningHeader", name: "WJE Running Header", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 0 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 15, smallCaps: true, color: "555555" } },
      { id: "PageNumber", name: "WJE Page Number", basedOn: "BodyText", paragraph: { spacing: { before: 0, after: 0 }, indent: { firstLine: 0 }, alignment: AlignmentType.CENTER }, run: { font: FONT_NAME, size: 16, color: "555555" } }
    ],
    characterStyles: [
      { id: "InlineCode", name: "WJE Inline Code", basedOn: "DefaultParagraphFont", run: { font: "Courier New", size: t.bodySizeHalfPoints - 2 } },
      { id: "SourcePageInline", name: "WJE Source Page Inline", basedOn: "DefaultParagraphFont", run: { font: "Arial", size: 15, color: "777777" } }
    ]
  };
}

function numberingConfig(profile) {
  const line = profile.typography.bodyLineTwips;
  return {
    config: [
      { reference: "wje-bullets", levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.BULLET, text: ["•", "◦", "▪"][level], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + level * 360, hanging: 270 }, spacing: { after: 30, line, lineRule: "auto" } }, run: { font: FONT_NAME } } })) },
      { reference: "wje-numbered", levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 576 + level * 360, hanging: 288 }, spacing: { after: 30, line, lineRule: "auto" } }, run: { font: FONT_NAME } } })) }
    ]
  };
}

export function splitTableRows(rows) {
  if (!rows.length) return [];
  const columns = Math.max(...rows.map((row) => row.length));
  if (columns > MAX_TABLE_COLUMNS) throw new Error(`Dense table has ${columns} columns; maximum is ${MAX_TABLE_COLUMNS}`);
  const header = rows[0];
  const chunks = [];
  let current = [header];
  let characters = rowCharacters(header);
  for (const row of rows.slice(1)) {
    const rowChars = rowCharacters(row);
    const exceeds = current.length >= MAX_TABLE_ROWS || (current.length + 1) * columns > MAX_TABLE_CELLS || characters + rowChars > MAX_TABLE_CHARACTERS;
    if (exceeds) {
      chunks.push(current);
      current = [header];
      characters = rowCharacters(header);
    }
    current.push(row);
    characters += rowChars;
  }
  chunks.push(current);
  return chunks;
}

export function isOutlineTable(rows) {
  if (!rows.length || Math.max(...rows.map((row) => row.length)) < MAX_TABLE_COLUMNS) return false;
  const cells = rows.flat();
  const blank = cells.filter((cell) => !plainText({ children: cell }).trim()).length / Math.max(cells.length, 1);
  const sparse = rows.filter((row) => row.filter((cell) => plainText({ children: cell }).trim()).length <= 3).length / rows.length;
  return blank >= 0.65 && sparse >= 0.75;
}

function rowCharacters(row) {
  return row.reduce((sum, cell) => sum + plainText({ children: cell }).length, 0);
}

function tableWidths(rows, columns, totalWidth) {
  const longest = Array(columns).fill(0);
  for (const row of rows) row.forEach((cell, index) => { longest[index] = Math.max(longest[index], plainText({ children: cell }).length); });
  const weights = longest.map((length) => Math.min(5, Math.max(1.2, Math.sqrt(length + 4))));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((weight) => Math.round(totalWidth * weight / sum));
  widths[widths.length - 1] += totalWidth - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function profileContentWidth(profile) {
  return profile.page.widthDxa - profile.page.marginLeftDxa - profile.page.marginRightDxa;
}

function imageInfo(data, source) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 9 < data.length) {
      while (offset < data.length && data[offset] !== 0xff) offset += 1;
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9 || marker === undefined) break;
      const length = data.readUInt16BE(offset);
      if (sof.has(marker)) return { type: "jpg", height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
      offset += length;
    }
  }
  throw new Error(`Unsupported or corrupt image: ${source}; expected PNG or JPEG`);
}

async function patchGeneratedDocx(buffer, profile) {
  const zip = await JSZip.loadAsync(buffer);
  const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
  for (const file of Object.values(zip.files)) file.date = fixedTimestamp;
  const documentFile = zip.file("word/document.xml");
  if (documentFile) {
    const documentXml = await documentFile.async("string");
    zip.file("word/document.xml", normalizeBookmarkIds(documentXml), { date: fixedTimestamp });
  }
  const coreFile = zip.file("docProps/core.xml");
  if (coreFile) {
    const core = await coreFile.async("string");
    zip.file("docProps/core.xml", core.replace(/<dcterms:(created|modified)[^>]*>[^<]*<\/dcterms:\1>/g, (_match, name) => `<dcterms:${name} xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:${name}>`), { date: fixedTimestamp });
  }
  if (profile.layout.mirrorMargins) {
    const settings = await zip.file("word/settings.xml").async("string");
    const marker = "<w:displayBackgroundShape/>";
    if (!settings.includes(marker)) throw new Error("Generated settings lack the insertion point for mirror margins");
    zip.file("word/settings.xml", settings.replace(marker, `${marker}<w:mirrorMargins/>`), { date: fixedTimestamp });
  }
  const fontTableFile = zip.file("word/fontTable.xml");
  if (fontTableFile) {
    const fontTable = await fontTableFile.async("string");
    zip.file("word/fontTable.xml", fontTable
      .replace(/(<w:font w:name="Libre Baskerville"[^>]*>)/, "$1<w:altName w:val=\"Georgia\"/>")
      .replace(/w:fontKey="\{[^}]+\}"/, `w:fontKey="{${FONT_KEY}}"`), { date: fixedTimestamp });
  }
  if (profile.layout.embedFonts) {
    const generatedFontPart = "word/fonts/Libre Baskerville.odttf";
    if (!zip.file(generatedFontPart)) throw new Error(`Generated DOCX lacks embedded font part: ${generatedFontPart}`);
    zip.remove(generatedFontPart);
    zip.file(FONT_PART, obfuscateFont(await fs.readFile(FONT_FILE), FONT_KEY), { date: fixedTimestamp });

    const fontRelationshipsFile = zip.file("word/_rels/fontTable.xml.rels");
    if (!fontRelationshipsFile) throw new Error("Generated DOCX lacks fontTable relationships");
    const fontRelationships = await fontRelationshipsFile.async("string");
    const patchedRelationships = fontRelationships.replace(
      /Target="fonts\/Libre(?: |%20)Baskerville\.odttf"/g,
      `Target="${FONT_RELATIONSHIP_TARGET}"`
    );
    if (patchedRelationships === fontRelationships) throw new Error("Embedded font relationship target was not found for normalization");
    zip.file("word/_rels/fontTable.xml.rels", patchedRelationships, { date: fixedTimestamp });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

export function normalizeBookmarkIds(documentXml) {
  let nextId = 1;
  const open = [];
  const normalized = documentXml.replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, (tag, kind) => {
    let id;
    if (kind === "Start") {
      id = String(nextId++);
      open.push(id);
    } else {
      id = open.pop();
      if (id === undefined) throw new Error("Generated document.xml contains an unmatched bookmarkEnd");
    }
    if (!/\bw:id=(?:"[^"]*"|'[^']*')/.test(tag)) {
      throw new Error(`Generated ${kind === "Start" ? "bookmarkStart" : "bookmarkEnd"} has no w:id`);
    }
    return tag.replace(/\bw:id=(?:"[^"]*"|'[^']*')/, `w:id="${id}"`);
  });
  if (open.length) throw new Error(`Generated document.xml contains ${open.length} unmatched bookmarkStart element(s)`);
  return normalized;
}

function obfuscateFont(data, fontKey) {
  const key = Buffer.from(fontKey.replace(/-/g, ""), "hex").reverse();
  const result = Buffer.from(data);
  for (let index = 0; index < Math.min(32, result.length); index += 1) result[index] ^= key[index % key.length];
  return result;
}

function buildStatistics(state) {
  return {
    ...state.model.inventory,
    embeddedImages: state.embeddedImages,
    outputTableParts: state.outputTableParts,
    outlineRows: state.outlineRows,
    generatedFootnotes: state.footnoteId - 1
  };
}
