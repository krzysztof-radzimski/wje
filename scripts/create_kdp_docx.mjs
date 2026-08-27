#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildKdpDocx } from "./lib/kdp-docx/builder.mjs";
import { parseWjeMarkdown } from "./lib/kdp-docx/markdown.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadProfile(profileId) {
  if (!new Set(["kindle", "print-6x9"]).has(profileId)) {
    throw new Error(`Unknown profile "${profileId}"; choose kindle or print-6x9`);
  }
  const file = path.join(repositoryRoot, "config", "kdp-docx", `${profileId}.json`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function defaultOutputFor(input, profile) {
  return path.join(repositoryRoot, profile.outputDirectory, path.basename(input, path.extname(input)) + ".docx");
}

export async function createKdpDocx({ input, output, profileId, force = false, author = "Jonathan Edwards", language = "en-US" }) {
  if (!input) throw new Error("A Markdown input path is required");
  if (!profileId) throw new Error("--profile is required (kindle or print-6x9)");
  const inputPath = path.resolve(input);
  if (path.extname(inputPath).toLowerCase() !== ".md") throw new Error("Input must be a .md file");
  await fs.access(inputPath);
  const profile = await loadProfile(profileId);
  const outputPath = path.resolve(output ?? defaultOutputFor(inputPath, profile));
  if (path.extname(outputPath).toLowerCase() !== ".docx") throw new Error("Output must be a .docx file");
  if (!force) {
    await fs.access(outputPath).then(() => { throw new Error(`Output already exists; use --force: ${outputPath}`); }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  const model = await parseWjeMarkdown(inputPath);
  const result = await buildKdpDocx(model, profile, { author, language });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.buffer);
  return { ...result, inputPath, outputPath, profile };
}

function usage() {
  return `Usage: node scripts/create_kdp_docx.mjs --profile kindle|print-6x9 [options] MD/VOLUMENN.md

Options:
  --output FILE      Override the canonical profile output path
  --author NAME      Author metadata and print running header
  --language TAG     BCP 47 document language (default: en-US)
  --force            Replace the exact output file if it exists
  --help             Show this help`;
}

function parseArguments(argv) {
  const options = { force: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--profile", "--output", "--author", "--language"].includes(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${argument}`);
      options[{ "--profile": "profileId", "--output": "output", "--author": "author", "--language": "language" }[argument]] = value;
    } else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 1) throw new Error("Exactly one Markdown input is allowed");
  options.input = positional[0];
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await createKdpDocx(options);
  console.log(`Created ${result.outputPath}`);
  console.log(`Profile ${result.profile.id}; headings ${Object.values(result.statistics.headings).reduce((a, b) => a + b, 0)}, footnotes ${result.statistics.generatedFootnotes}, tables ${result.statistics.outputTableParts}, images ${result.statistics.embeddedImages}`);
  for (const warning of [...new Set(result.warnings)]) console.warn(`WARNING: ${warning}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
