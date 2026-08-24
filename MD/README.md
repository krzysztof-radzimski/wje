# Markdown Volumes

This directory contains searchable Markdown editions of *The Works of
Jonathan Edwards*, created solely from the manually saved HTML sources in
[`../HTML/`](../HTML/).

Each file is named `VOLUMEN.md`, where `N` is the volume number without a
leading zero. The files preserve the source text, document hierarchy, and
footnotes. Printed page numbers are stored as searchable HTML comments, for
example `<!-- p. 123 -->`, so they do not interrupt the heading structure.

The Markdown files normally omit images, WJE Online navigation, and page
footers. For volumes whose illustrations are essential, `--include-images`
copies the locally saved content images to `assets/VOLUMENN/` and preserves
them as relative Markdown image links. The conversion never downloads images.
It does not reconstruct content that is absent from the local HTML capture.

To generate and verify a volume from the repository root:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN MD/VOLUMEN.md
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN MD/VOLUMEN.md
```

To preserve content images for an explicitly designated volume:

```bash
ruby scripts/html_volume_to_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMEN.md
ruby scripts/verify_volume_markdown.rb --include-images HTML/VOLUMENN MD/VOLUMEN.md
```
