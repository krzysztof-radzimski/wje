# Markdown Volumes

This directory contains searchable Markdown editions of *The Works of
Jonathan Edwards*, created solely from the unmodified local HTML sources in
[`../HTML/`](../HTML/). For volumes 17–73 those sources may be captured only by
the controlled macOS importer documented in `../AGENTS.md`: it drives a visible
Microsoft Edge window and invokes the browser's native complete-page save.
Direct downloads, APIs, DOM serialization, and source-HTML edits are forbidden.

Each file is named `VOLUMENN.md`; volumes 1–9 use a leading zero (for example,
`VOLUME01.md`). The files preserve the source text, document hierarchy, and
footnotes. Printed page numbers are stored as searchable HTML comments, for
example `<!-- p. 123 -->`, so they do not interrupt the heading structure.

The Markdown files normally omit images, WJE Online navigation, and page
footers. The new-volume workflow writes a complete image-selection manifest;
only `include` entries are copied to `assets/VOLUMENN/`, full-page manuscript
scans receive `omit-scan`, and `uncertain` entries are recorded without being
copied or blocking conversion. The converter itself reads local files only and
does not reconstruct content absent from the local HTML capture.

To generate and verify a volume from the repository root:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN MD/VOLUMENN.md
```

To preserve content images for an explicitly designated volume:

```bash
ruby scripts/html_volume_to_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
ruby scripts/verify_volume_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMENN.md
```

To preserve only one local content image, identify it by source page and saved
filename. The optional final name controls the filename in the asset directory:

```bash
ruby scripts/html_volume_to_markdown.rb '--include-image=003:getimage(7).php=illustration.jpg' HTML/VOLUMENN MD/VOLUMENN.md
```
