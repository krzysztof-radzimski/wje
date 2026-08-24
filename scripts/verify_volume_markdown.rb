#!/usr/bin/env ruby
# frozen_string_literal: true

# Checks that a Markdown volume preserves locally saved WJE source content.
# It makes no network requests and is deliberately tolerant of incomplete
# captures: page and navigation gaps are reported, not reconstructed.

require "nokogiri"

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

def heading_key(text)
  text.gsub(/\[\^[^\]]+\]/, "").unicode_normalize(:nfkd)
      .gsub(/[^[:alnum:]]+/, " ").strip.downcase
end

def navigation_text(text)
  value = text.gsub(/\s+/, " ").strip
  return "CONTENTS" if value.match?(/\ACONTENTS Editorial Committee [ivxlcdm]+\z/i)

  value
end

include_images = ARGV.delete("--include-images")
input_directory = ARGV[0] || "HTML/VOLUME01"
markdown_file = ARGV[1] || "MD/VOLUME1.md"
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
source_images = documents.flat_map { |document| document.css("img") }

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
if include_images
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
puts summary
if missing_headings.empty?
  puts "Nagłówki z 000.html są obecne w Markdown."
else
  warn "Nagłówki z 000.html nieobecne w Markdown (sprawdź luki zrzutu): #{missing_headings.join(' | ')}"
end
