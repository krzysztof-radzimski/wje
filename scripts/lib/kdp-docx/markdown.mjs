import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const SOURCE_PAGE = /^<!--\s*p\.\s*([^>]+?)\s*-->$/i;
const VOLUME_TITLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config/kdp-docx/volume-titles.json");
let volumeTitlesPromise;

export async function parseWjeMarkdown(inputPath) {
  const source = (await fs.readFile(inputPath, "utf8")).replace(/\r\n?/g, "\n");
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  const footnotes = new Map();
  const warnings = [];

  for (const node of tree.children) {
    if (node.type === "footnoteDefinition") {
      if (footnotes.has(node.identifier)) {
        warnings.push(`Duplicate footnote definition [^${node.identifier}]`);
      }
      footnotes.set(node.identifier, node.children);
    }
  }

  const body = tree.children.filter((node) => node.type !== "footnoteDefinition");
  const volumeMatch = path.basename(inputPath).match(/^VOLUME(\d+)\.md$/i);
  const volume = volumeMatch ? Number(volumeMatch[1]) : null;
  const sourceTitleNode = body.find((node) => node.type === "heading" && node.depth === 1);
  const configuredTitle = await titleForVolume(volume);
  const titleNode = configuredTitle ? virtualTitleNode(configuredTitle) : sourceTitleNode;
  if (!titleNode) throw new Error("The Markdown source must contain a level-one title or configured volume title");

  const title = plainText(titleNode);
  titleNode.data ??= {};
  titleNode.data.isTitle = true;
  const headings = body.filter((node) => node.type === "heading");
  const usedBookmarks = new Set(["toc", "top"]);
  for (const node of headings) {
    node.data ??= {};
    node.data.bookmark = uniqueBookmark(node.depth === 1 ? "book_title" : `heading_${slug(plainText(node))}`, usedBookmarks);
  }

  const inventory = inventoryFromTree(body, footnotes);
  return { inputPath, source, tree, body, footnotes, title, titleNode, headings, volume, warnings, inventory };
}

async function titleForVolume(volume) {
  if (!volume) return null;
  volumeTitlesPromise ??= fs.readFile(VOLUME_TITLES, "utf8").then(JSON.parse);
  const titles = await volumeTitlesPromise;
  return titles[String(volume)] ?? null;
}

function virtualTitleNode(value) {
  return {
    type: "heading",
    depth: 1,
    children: [{ type: "text", value }],
    data: { virtual: true }
  };
}

export function navigationHeadings(model) {
  const contentHeadings = model.headings.filter((heading) => !heading.data?.isTitle);
  const primary = contentHeadings.filter((heading) => heading.depth <= 2);
  if (primary.length) return primary;
  const shallowest = Math.min(...contentHeadings.map((heading) => heading.depth));
  return contentHeadings.filter((heading) => heading.depth === shallowest);
}

export function inventoryFromTree(body, footnotes) {
  const inventory = {
    title: 0,
    headings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    footnoteReferences: 0,
    footnoteDefinitions: footnotes.size,
    tables: 0,
    tableRows: 0,
    images: 0,
    sourcePages: 0,
    mermaidBlocks: 0,
    blockquotes: 0,
    thematicBreaks: 0,
    lists: 0
  };
  walk({ type: "root", children: body }, (node) => {
    if (node.type === "heading") inventory.headings[node.depth] += 1;
    if (node.type === "footnoteReference") inventory.footnoteReferences += 1;
    if (node.type === "table") {
      inventory.tables += 1;
      inventory.tableRows += node.children.length;
    }
    if (node.type === "image") inventory.images += 1;
    if (node.type === "html" && SOURCE_PAGE.test(node.value.trim())) inventory.sourcePages += 1;
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") inventory.mermaidBlocks += 1;
    if (node.type === "blockquote") inventory.blockquotes += 1;
    if (node.type === "thematicBreak") inventory.thematicBreaks += 1;
    if (node.type === "list") inventory.lists += 1;
  });
  inventory.title = inventory.headings[1];
  return inventory;
}

export function sourcePageLabel(node) {
  if (node?.type !== "html") return null;
  return node.value.trim().match(SOURCE_PAGE)?.[1]?.trim() ?? null;
}

export function plainText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (["text", "inlineCode", "code", "html"].includes(node.type)) return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "footnoteReference") return "";
  return (node.children ?? []).map(plainText).join("");
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function slug(value) {
  const cleaned = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28).toLowerCase();
  return cleaned || "section";
}

function uniqueBookmark(base, used) {
  let candidate = base.slice(0, 36);
  let index = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 31)}_${index++}`;
  used.add(candidate);
  return candidate;
}
