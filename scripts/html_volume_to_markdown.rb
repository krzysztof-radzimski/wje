#!/usr/bin/env ruby
# frozen_string_literal: true

# Converts locally saved WJE Online pages into one Markdown document.  The
# archive pages are malformed HTML, so this intentionally works from the
# explicit source-content comments rather than from the surrounding layout.

require "cgi"
require "nokogiri"

CONTENT_START = "<!-- START OF CONTENT AREA -->"
CONTENT_END = "<!-- END OF CONTEXT AREA, WE HOPE-->"
SKIPPED_TAGS = %w[script style img input form].freeze

def inline(node)
  return "" if node.text? && node.text.empty?
  return node.text.gsub(/[\t\r\n ]+/, " ") if node.text?
  return "" if SKIPPED_TAGS.include?(node.name)

  classes = node["class"].to_s.split
  return "" if node.name == "a" && node["title"] == "return to text"
  if node.name == "a" && classes.include?("fnote")
    number = node.text.strip
    return number.empty? ? "" : "<sup>#{number}</sup>"
  end

  text = node.children.map { |child| inline(child) }.join
  case node.name
  when "i", "em"
    "*#{text.strip}*"
  when "b", "strong"
    "**#{text.strip}**"
  else
    style = node["style"].to_s.downcase
    return "*#{text.strip}*" if style.include?("font-style:italic") || style.include?("font-style: italic")
    return "**#{text.strip}**" if %w[emph hi hibold].any? { |klass| classes.include?(klass) }

    text
  end
end

def heading_text(node)
  return node.text.gsub(/[\t\r\n ]+/, " ") if node.text?
  return "" if %w[div p center table quote].include?(node.name)

  node.children.map { |child| heading_text(child) }.join
end

# Some saved archive pages have an unclosed heading span.  Its block-level
# descendants are still source text and must be rendered after the heading.
def render_heading_descendants(node, output, heading_count)
  return heading_count if node.text?

  if %w[div p center table quote ul ol].include?(node.name)
    return render(node, output, heading_count)
  end

  node.children.each do |child|
    heading_count = render_heading_descendants(child, output, heading_count)
  end
  heading_count
end

def append_paragraph(output, text)
  text = text.gsub(/[\t\r\n ]+/, " ").strip
  return if text.empty?

  output << text << "\n\n"
end

def page_marker(text)
  match = text.strip.match(/\A--\s*(.+?)\s*--\z/)
  match && "<!-- p. #{match[1]} -->"
end

def heading_level(text, count)
  return 1 if count.zero?
  return 2 if text.match?(/\A(?:PART|SECTION|CHAPTER|CONCLUSION|AUTHOR'S PREFACE|EDITOR'S INTRODUCTION|GENERAL EDITOR'S NOTE|RELATED CORRESPONDENCE|COPYRIGHT|CONTENTS)\b/i)

  3
end

def render(node, output, heading_count)
  return heading_count if node.text? && node.text.strip.empty?
  if node.text?
    output << node.text.gsub(/[\t\r\n ]+/, " ")
    return heading_count
  end
  return heading_count if SKIPPED_TAGS.include?(node.name)

  classes = node["class"].to_s.split
  if node.name == "pb"
    number = node["n"] || node["id"] || inline(node)
    output << "\n\n<!-- p. #{number} -->\n\n" unless number.to_s.strip.empty?
    return heading_count
  end
  if node.name == "span" && classes.include?("head")
    text = heading_text(node).gsub(/[\t\r\n ]+/, " ").strip
    unless text.empty?
      output << "\n\n#{'#' * heading_level(text, heading_count)} #{text}\n\n"
      heading_count += 1
    end
    node.children.each do |child|
      heading_count = render_heading_descendants(child, output, heading_count)
    end
    return heading_count
  end
  return heading_count if node.name == "div" && node["type"] == "contents"
  if node.name == "div" && node["id"] == "footnotes"
    notes = node.element_children.select { |child| child.name == "div" && child["class"].to_s.split.include?("fnote") }
    return heading_count if notes.empty?

    output << "\n\n### Notes\n\n"
    node.children.each { |child| heading_count = render(child, output, heading_count) }
    return heading_count
  end
  if node.name == "div" && classes.include?("fnote")
    text = inline(node).sub(/(?:Previous section|Next section|Jonathan Edwards \[).*/m, "").strip
    append_paragraph(output, "> #{text}") unless text.empty?
    return heading_count
  end
  if node.name == "center"
    text = inline(node).strip
    marker = page_marker(text)
    output << "\n\n#{marker || text}\n\n" unless text.empty?
    return heading_count
  end
  if node.name == "a" && classes.include?("fnote")
    number = inline(node)
    output << number unless number.empty?
    return heading_count
  end
  if node.name == "br"
    output << "  \n"
    return heading_count
  end
  if node.name == "p"
    append_paragraph(output, inline(node))
    return heading_count
  end
  if node.name == "quote"
    text = inline(node).strip
    unless text.empty?
      output << text.split(/\n+/).map { |line| "> #{line.strip}" }.join("\n") << "\n\n"
    end
    return heading_count
  end
  if %w[ul ol].include?(node.name)
    node.element_children.select { |child| child.name == "li" }.each_with_index do |item, index|
      prefix = node.name == "ol" ? "#{index + 1}." : "-"
      output << "#{prefix} #{inline(item).strip}\n"
    end
    output << "\n"
    return heading_count
  end
  if node.name == "table"
    return heading_count if inline(node).match?(/Previous section|Next section/)

    rows = node.css("tr").map do |row|
      row.element_children.select { |cell| %w[th td].include?(cell.name) }.map { |cell| inline(cell).strip }
    end.reject(&:empty?)
    rows.each { |row| output << "| #{row.join(' | ')} |\n" }
    output << "\n" unless rows.empty?
    return heading_count
  end
  if node.name == "span" && classes.any? { |klass| %w[item navhead navlevel1 navlevel2 navlevel3].include?(klass) }
    text = inline(node).strip
    append_paragraph(output, text) unless text.empty?
    return heading_count
  end

  node.children.each { |child| heading_count = render(child, output, heading_count) }
  heading_count
end

def source_fragment(path)
  html = File.read(path, encoding: "UTF-8")
  start = html.index(CONTENT_START)
  finish = html.index(CONTENT_END, start || 0)
  # Two saved pages were cut off by the browser before the archive's closing
  # marker.  Their layout still closes before the page footer/body.
  finish ||= html.index('<div id="footer">', start || 0)
  finish ||= html.index("</body>", start || 0)
  abort "Brak obszaru treści: #{path}" unless start && finish

  html[(start + CONTENT_START.length)...finish]
end

def content_node(fragment, index)
  document = Nokogiri::HTML::DocumentFragment.parse(fragment)
  return document if index.zero?

  document.at_css("div#text") || document
end

def heading_key(text)
  text.unicode_normalize(:nfkd)
      .gsub(/[^[:alnum:]]+/, " ")
      .strip
      .downcase
end

def navigation_entries(path)
  fragment = source_fragment(path)
  document = Nokogiri::HTML::DocumentFragment.parse(fragment)
  document.css("span.navlevel1, span.navlevel2, span.navlevel3").map do |node|
    [node["class"][/\d/].to_i, node.text.gsub(/\s+/, " ").strip]
  end
end

def expected_heading_level(text, navigation)
  key = heading_key(text)
  level = navigation[key]
  return level unless level.nil?

  # The source navigation has two inconsistent depths: Part III is shown as a
  # child of Part II, and Part IV's first section as a grandchild.  The text
  # itself makes their sibling relationships unambiguous.
  return 2 if key.match?(/\Apart (i|ii|iii|iv) /)
  return 3 if key.start_with?("section ")
  return 2 if %w[the conclusion related correspondence proposal for printing].include?(key)

  nil
end

def apply_heading_hierarchy(markdown, entries)
  navigation = entries.each_with_object({}) do |(depth, text), index|
    index[heading_key(text)] = depth + 1
  end

  # Correct the two malformed navigation levels noted above and retain the
  # natural document hierarchy for sections and subtopics.
  entries.each do |_depth, text|
    key = heading_key(text)
    navigation[key] = 2 if key.match?(/\Apart (i|ii|iii|iv) /)
    navigation[key] = 3 if key.start_with?("section ")
  end
  ["thomas chubb", "daniel whitby", "isaac watts"].each { |key| navigation[key] = 4 }
  navigation[heading_key("THE CONCLUSION")] = 2
  navigation[heading_key("RELATED CORRESPONDENCE")] = 2

  markdown = markdown.lines.map do |line|
    match = line.match(/\A#+\s+(.+?)\s*\n?\z/)
    if match
      next line if line.start_with?("# ")

      level = expected_heading_level(match[1], navigation)
      level ? "#{'#' * level} #{match[1]}\n" : line
    else
      text = line.strip
      level = expected_heading_level(text, navigation)
      level && !text.empty? ? "#{'#' * level} #{text}\n" : line
    end
  end.join

  markdown.gsub!(
    "## Part III.\n\n### Wherein Is Inquired, Whether Any Such Liberty of Will as Arminians Hold, Be Necessary to Moral Agency, Virtue and Vice, Praise, and Dispraise, Etc.\n",
    "## Part III. Wherein Is Inquired, Whether Any Such Liberty of Will as Arminians Hold, Be Necessary to Moral Agency, Virtue and Vice, Praise, and Dispraise, Etc.\n"
  )

  contents = entries.reject { |_depth, text| text == "Front Matter" || text == "Freedom of the Will" }
                    .map { |depth, text| "#{'  ' * (depth - 1)}- #{text}" }
                    .join("\n")
  markdown.sub!(
    "## EDITOR'S INTRODUCTION",
    "### CONTENTS\n\n#{contents}\n\n## EDITOR'S INTRODUCTION"
  )

  # `Front Matter` and `CONTENTS` are navigation headings.  The latter's
  # entries are preserved as a Markdown outline above.
  markdown.sub!("# Freedom of the Will\n", "# Freedom of the Will\n\n## Front Matter\n")
  markdown.sub!(/^### Proposal for Printing Freedom of the Will$/, "## Proposal for Printing")
  markdown
end

input_directory = ARGV[0] || "HTML/VOLUME01"
output_file = ARGV[1] || "VOLUME1.md"
pages = Dir.glob(File.join(input_directory, "*.html")).sort
# 000.html is the archive's generated navigation page.  The printed volume's
# own front matter (including its contents page) starts in 001.html.
pages.reject! { |path| File.basename(path) == "000.html" }
abort "Nie znaleziono stron HTML w #{input_directory}" if pages.empty?

output = +""
heading_count = 0
pages.each_with_index do |path, index|
  node = content_node(source_fragment(path), index)
  heading_count = render(node, output, heading_count)
end

# Remove navigation residues and normalise the deliberately generous paragraph
# spacing emitted while traversing malformed source HTML.
output.gsub!(/(?:^|\n)(?:Previous section|Next section|New Search)(?:\n|$)/, "\n")
output.gsub!(/^Jonathan Edwards .*?\[word count\].*?\n/, "")
output.gsub!(/^### Notes\n\n(?=(?:Jonathan Edwards|## ))/, "")
output.gsub!(/Previous section Next section Jonathan Edwards \[.*?\[word count\] \[\*\*jec-wjeo01\*\*\]\./, "")
# A few pages have unbalanced tags around their page-number elements.  Convert
# any remaining printed page markers after traversal, rather than losing them
# inside a paragraph or a heading.
output.gsub!(/(?<![<!])\s--\s*([ivxlcdm]+|\d+)\s*--(?=\s)/i) { "\n\n<!-- p. #{$1} -->\n\n" }
output.gsub!(/[ \t]+\n/, "\n")
output.gsub!(/\n{3,}/, "\n\n")
output = apply_heading_hierarchy(output, navigation_entries(File.join(input_directory, "000.html")))
output.strip!
File.write(output_file, "#{output}\n", encoding: "UTF-8")
