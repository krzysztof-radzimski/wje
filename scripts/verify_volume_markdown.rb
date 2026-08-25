#!/usr/bin/env ruby
# frozen_string_literal: true

# Checks that a Markdown volume preserves locally saved WJE source content.
# It makes no network requests and is deliberately tolerant of incomplete
# captures: page and navigation gaps are reported, not reconstructed.

require "nokogiri"
require "pathname"
require_relative "lib/image_selections"

CONTENT_START = "<!-- START OF CONTENT AREA -->"
CONTENT_END = "<!-- END OF CONTEXT AREA, WE HOPE-->"

def source_fragment(path)
  html = File.read(path, encoding: "UTF-8")
  start = html.index(CONTENT_START)
  finish = html.index(CONTENT_END, start || 0)
  finish ||= html.index('<div id="footer">', start || 0)
  finish ||= html.index("</body>", start || 0)
  abort "Brak obszaru treści: #{path}" unless start && finish

  html[(start + CONTENT_START.length)...finish]
end

def valid_local_image?(node, source_page)
  source = node["src"].to_s
  return false if source.empty? || source.match?(%r{\Ahttps?://}i)

  path = File.expand_path(source, File.dirname(source_page))
  return false unless File.file?(path)

  signature = File.binread(path, 512)
  signature.start_with?("\xFF\xD8\xFF".b, "\x89PNG\r\n\x1A\n".b, "GIF87a", "GIF89a") ||
    (signature.start_with?("RIFF") && signature[8, 4] == "WEBP") ||
    (signature.lstrip.start_with?("<svg", "<?xml") && signature.match?(/<svg\b/i))
end

def heading_key(text)
  text.gsub(/\[\^[^\]]+\]/, "").unicode_normalize(:nfkd)
      .gsub(/[^[:alnum:]]+/, " ").strip.downcase
end

def navigation_text(text)
  value = text.gsub(/\s+/, " ").strip
  return "CONTENTS" if value.match?(/\ACONTENTS Editorial Committee [ivxlcdm]+\z/i)

  value
end

def unescaped_pipe_positions(line)
  positions = []
  backslashes = 0
  line.each_char.with_index do |character, index|
    if character == "\\"
      backslashes += 1
      next
    end

    positions << index if character == "|" && backslashes.even?
    backslashes = 0
  end
  positions
end

def gfm_separator_row?(line)
  positions = unescaped_pipe_positions(line)
  return false unless positions.length >= 2 && line[0...positions.first].strip.empty? && line[(positions.last + 1)..].to_s.strip.empty?

  positions.each_cons(2).all? do |left, right|
    line[(left + 1)...right].match?(/\A\s*:?-{3,}:?\s*\z/)
  end
end

def validate_gfm_tables!(markdown)
  lines = markdown.lines
  index = 0
  while index < lines.length
    unless lines[index].start_with?("|")
      index += 1
      next
    end

    first_line = index + 1
    rows = []
    while index < lines.length && lines[index].start_with?("|")
      rows << lines[index]
      index += 1
    end
    abort "Tabela Markdown od wiersza #{first_line} nie ma separatora GFM w drugim wierszu." unless rows.length >= 2 && gfm_separator_row?(rows[1])

    pipe_counts = rows.map { |row| unescaped_pipe_positions(row).length }
    next if pipe_counts.uniq.length == 1

    abort "Tabela Markdown od wiersza #{first_line} ma niespójną liczbę kolumn: #{pipe_counts.join(', ')}."
  end
end

include_images = ARGV.delete("--include-images")
image_selections_argument = ARGV.find { |argument| argument.start_with?("--image-selections=") }
ARGV.delete(image_selections_argument) if image_selections_argument
image_selections_path = image_selections_argument&.delete_prefix("--image-selections=")
abort "Nie łącz --include-images z --image-selections." if include_images && image_selections_path
input_directory = ARGV[0] || "HTML/VOLUME01"
markdown_file = ARGV[1] || "MD/VOLUME01.md"
pages = Dir.glob(File.join(input_directory, "*.html")).sort.reject { |path| File.basename(path) == "000.html" }
abort "Nie znaleziono plików źródłowych w #{input_directory}" if pages.empty?
abort "Nie znaleziono #{markdown_file}" unless File.file?(markdown_file)

documents = pages.map { |path| Nokogiri::HTML::DocumentFragment.parse(source_fragment(path)) }
source_refs = documents.sum { |document| document.css('a.fnote[title="view footnote"]').length }
source_notes = documents.sum do |document|
  document.css("div.fnote").count { |note| note.at_css('a[name^="note"]') }
end
source_pages = documents.flat_map do |document|
  document.css("center").map { |node| node.text[/--\s*(.*?)\s*--/, 1] }.compact
end
source_images = pages.zip(documents).flat_map do |path, document|
  document.css("img").select { |node| valid_local_image?(node, path) }
end

markdown = File.read(markdown_file, encoding: "UTF-8")
# Definicja przypisu zaczyna się od identyfikatora na początku wiersza. Nie
# odrzucaj zwykłego odwołania tylko dlatego, że po nim występuje dwukropek
# (np. `[^004-note88]: 'Tis ...` w tekście źródłowym).
markdown_refs = markdown.each_line.flat_map do |line|
  line.sub(/\A\[\^[^\]]+\]:/, "").scan(/(?<!\\)\[\^([^\]]+)\]/)
end.flatten
markdown_notes = markdown.scan(/^\[\^([^\]]+)\]:/).flatten
missing_notes = markdown_refs.uniq - markdown_notes.uniq
duplicate_notes = markdown_notes.group_by(&:itself).select { |_id, values| values.length > 1 }

abort "Niezgodna liczba odwołań przypisów: HTML=#{source_refs}, Markdown=#{markdown_refs.length}" unless source_refs == markdown_refs.length
abort "Niezgodna liczba definicji przypisów: HTML=#{source_notes}, Markdown=#{markdown_notes.length}" unless source_notes == markdown_notes.length
abort "Odwołania bez definicji: #{missing_notes.join(', ')}" unless missing_notes.empty?
abort "Zduplikowane definicje: #{duplicate_notes.keys.join(', ')}" unless duplicate_notes.empty?
abort "Niezgodna liczba znaczników stron: HTML=#{source_pages.length}, Markdown=#{markdown.scan(/<!-- p\. /).length}" unless source_pages.length == markdown.scan(/<!-- p\. /).length
abort "Pozostały znaczniki <sup>" if markdown.include?("<sup>")
validate_gfm_tables!(markdown)
if image_selections_path
  abort "Nie znaleziono manifestu selekcji #{image_selections_path}" unless File.file?(image_selections_path)

  manifest = ImageSelections.load_manifest(image_selections_path)
  entries = ImageSelections.validate_manifest!(manifest, input_directory)
  included_entries = entries.select { |entry| entry["decision"] == "include" }
  markdown_images = markdown.scan(/!\[(?:\\.|[^\]])*\]\(([^)]+)\)/).flatten
  abort "Niezgodna liczba obrazów: manifest include=#{included_entries.length}, Markdown=#{markdown_images.length}" unless included_entries.length == markdown_images.length

  asset_directory = File.join(File.dirname(markdown_file), "assets", File.basename(input_directory))
  expected_paths = included_entries.map do |entry|
    Pathname.new(File.join(asset_directory, entry["assetName"]))
            .relative_path_from(Pathname.new(File.dirname(markdown_file))).to_s
  end
  unexpected = markdown_images - expected_paths
  missing_references = expected_paths - markdown_images
  abort "Markdown zawiera obrazy spoza include: #{unexpected.join(', ')}" unless unexpected.empty?
  abort "Markdown nie zawiera obrazów include: #{missing_references.join(', ')}" unless missing_references.empty?

  invalid_images = included_entries.map do |entry|
    target = File.join(asset_directory, entry["assetName"])
    info = ImageSelections.image_info(target)
    entry["assetName"] unless File.file?(target) && info["mimeType"]
  end.compact
  abort "Brakujące lub nierozpoznawalne pliki obrazów: #{invalid_images.join(', ')}" unless invalid_images.empty?
elsif include_images
  markdown_images = markdown.scan(/!\[[^\]]*\]\(([^)]+)\)/).flatten
  abort "Niezgodna liczba obrazów: HTML=#{source_images.length}, Markdown=#{markdown_images.length}" unless source_images.length == markdown_images.length

  missing_images = markdown_images.reject do |path|
    File.file?(File.expand_path(path, File.dirname(markdown_file)))
  end
  abort "Brakujące pliki obrazów: #{missing_images.join(', ')}" unless missing_images.empty?
end

navigation = Nokogiri::HTML::DocumentFragment.parse(source_fragment(File.join(input_directory, "000.html")))
                 .css("span.navlevel1, span.navlevel2, span.navlevel3")
                 .map do |node|
  [node["class"][/\d/].to_i, navigation_text(node.text)]
end
# `Contents` can have nested navigation entries that name printed sections
# rather than actual headings in the source text. They belong in the generated
# outline, but are not expected as duplicate body headings.
contents_depth = nil
expected = navigation.map do |depth, text|
  key = heading_key(text)
  if key == "contents"
    contents_depth = depth
    next
  end
  if contents_depth && depth > contents_depth
    next
  end

  contents_depth = nil
  next if key == "front matter" || text.match?(/\A\[\d+\]\z/) || key == heading_key(markdown[/\A#\s+(.+)\n/, 1].to_s)

  text
end.compact
actual = markdown.scan(/^#+\s+(.+)$/).flatten.map { |text| heading_key(text) }
missing_headings = expected.reject do |text|
  key = heading_key(text)
  actual.include?(key) ||
    # Navigation labels sometimes abbreviate or extend a source heading. Treat
    # a sufficiently specific shared prefix as the same heading.
    actual.any? do |actual_key|
      [key, actual_key].all? { |candidate| candidate.split.length >= 3 } &&
        (key.start_with?("#{actual_key} ") || actual_key.start_with?("#{key} "))
    end ||
    (key == heading_key("Part Three Showing What Are Distinguishing Signs of Truly Gracious and Holy affections") &&
      actual.include?(heading_key("PART THREE")) &&
      actual.include?(heading_key("Showing What Are Distinguishing Signs of Truly Gracious and Holy affections"))) ||
    # In volume 3 the navigation shortens this source heading to its final
    # biblical reference; the complete title is preserved in Markdown.
    (key == heading_key("Section 3. Observations on Romans 7") &&
      actual.include?(heading_key("Section 3. Observations on Romans 5:6–10, and Ephesians 2:3 with the context, and Romans 7"))) ||
    # Volume 5's navigation includes this descriptive label even though the
    # edition explicitly records that Edwards supplied no exposition.
    (key == heading_key("CHAPTER Revelation 3 in the exposition.") &&
      markdown.include?("JE did not comment on Revelation 3 in the exposition.")) ||
    (key.start_with?(heading_key("JE, Notes in MS copy of George Downame")) &&
      actual.any? { |actual_key| actual_key.start_with?(heading_key("JE, Notes in MS copy of George Downame")) })
end

summary = "OK: #{source_pages.length} znaczników stron, #{markdown_refs.length} odwołań i #{markdown_notes.length} definicji przypisów."
summary += " #{source_images.length} obrazów." if include_images
summary += " #{manifest['entries'].count { |entry| entry['decision'] == 'include' }} obrazów include z manifestu." if image_selections_path
puts summary
if missing_headings.empty?
  puts "Nagłówki z 000.html są obecne w Markdown."
else
  warn "Nagłówki z 000.html nieobecne w Markdown (sprawdź luki zrzutu): #{missing_headings.join(' | ')}"
end
