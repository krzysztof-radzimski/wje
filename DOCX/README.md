# WJE DOCX profiles

Both deliverables are generated from one semantic model parsed from
`MD/VOLUMENN.md`:

- `KINDLE/VOLUMENN.docx` is a reflowable Kindle manuscript with a static,
  clickable table of contents, true Word footnotes, and no running headers,
  footers, or document page numbers;
- `PRINT-6X9/VOLUMENN.docx` is a no-bleed 6×9-inch print interior source with
  mirrored margins, separate front/body sections, running heads, and body page
  numbering.

Install the locked npm dependencies, generate, and validate a volume with:

```bash
npm ci
npm run kdp:smoke
npm run kdp:docx -- --profile kindle MD/VOLUME01.md
npm run kdp:validate -- --profile kindle \
  MD/VOLUME01.md DOCX/KINDLE/VOLUME01.docx

npm run kdp:docx -- --profile print-6x9 MD/VOLUME01.md
npm run kdp:validate -- --profile print-6x9 \
  MD/VOLUME01.md DOCX/PRINT-6X9/VOLUME01.docx
```

Use `--force` only for deliberate regeneration of the exact output. Never edit
a generated DOCX by hand; fix the shared parser, builder, validator, or profile
configuration and regenerate it. Before publication, inspect Kindle output in
Kindle Previewer and export the print profile to PDF for page-by-page review in
KDP Print Previewer.

The smoke suite generates both profiles from a controlled fixture and rejects
OOXML that Word would need to repair, including invalid OPC part names and
relationship targets, duplicate paragraph styles and bookmark IDs, disabled
table-header markers, schema-sensitive settings order, invalid embedded-font
keys, automatic field updates that trigger Word's security prompt, unpaired
bookmark ranges, broken relationships, and lost heading footnotes.
