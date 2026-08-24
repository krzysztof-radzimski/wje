**EN** | [PL](README.pl.md)

# The Works of Jonathan Edwards — Markdown Archive

![Portrait of Jonathan Edwards](jonathan-edwards.svg)

This project creates searchable Markdown files from manually saved
[WJE Online](http://edwards.yale.edu/research/browse) pages for the 73 volumes
of *The Works of Jonathan Edwards*. Content is saved manually and converted
locally; the project does not automate downloading from the Yale website.

Polish version: [README.pl.md](README.pl.md).

## Contents

- `HTML/VOLUMENN/` — unmodified, locally saved source pages. `000.html`
  contains the volume navigation and heading hierarchy.
- `VOLUMEN.md` — the resulting Markdown text for a volume.
- `scripts/html_volume_to_markdown.rb` — a converter that tolerates the
  archive's malformed HTML.
- `AGENTS.md` — the working procedure for subsequent volumes.

The output preserves source content, heading structure, footnotes, and page
numbers. Page numbers are intentionally stored as unobtrusive comments, for
example `<!-- p. 123 -->`, so that they remain searchable without disrupting
the document hierarchy. Images, site navigation, and footers are omitted.

## Creating a volume

After placing manually saved files in `HTML/VOLUMENN/`, run:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUMENN VOLUMEN.md
```

For example, for the second volume:

```bash
ruby scripts/html_volume_to_markdown.rb HTML/VOLUME02 VOLUME2.md
```

The converter reads local HTML only, identifies main content from the archive's
comments, derives heading levels from `000.html`, and creates unique Markdown
footnotes. Uniqueness matters because printed footnote numbering may restart in
different source fragments.

## Verification

After generating a volume, run at least:

```bash
ruby -c scripts/html_volume_to_markdown.rb
ruby scripts/verify_volume_markdown.rb HTML/VOLUMENN VOLUMEN.md
git diff --check
```

The validator compares page markers, footnote references, and footnote
definitions with the local HTML, and reports headings from `000.html` that are
absent from the result. A gap in page numbering means the missing fragment
should be saved manually; it must not be reconstructed from memory or another
edition.

## Capture status

| Volume | Markdown file | Source status |
| --- | --- | --- |
| 1 — *Freedom of the Will* | `VOLUME1.md` | The saved content includes the complete hierarchy from `000.html`. Page markers 31, 136, and 149 are absent from the source; the document does not add them artificially. |
| 2 — *Religious Affections* | `VOLUME2.md` | The saved content includes the complete hierarchy from `000.html`. Page markers 46, 76–77, 84, 125, and 440 are absent from the source; the document does not add them artificially. `007.html` lacks the archive's usual closing comment, so the converter uses a safe fallback end. |
| 3 — *Original Sin* | `VOLUME3.md` | The saved content includes the complete hierarchy from `000.html`. Page markers 105–106, 220–222, 350–352, and 372–374 are absent from the source; the document does not add them artificially. `007.html` lacks the archive's usual closing comment, so the converter uses a safe fallback end. |

Markdown documents contain only content present in the local capture.
