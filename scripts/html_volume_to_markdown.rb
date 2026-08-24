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

def footnote_id(node)
  target = node["href"].to_s[/#(note[^&#]+)/, 1] || node["name"].to_s[/\A(note.+)\z/, 1]
  return nil if target.nil? || target.empty? || @source_page.nil?

  "#{@source_page}-#{target}"
end

def footnote_text(node)
  text = inline(node).sub(/(?:Previous section|Next section|Jonathan Edwards \[).*/m, "").strip
  text.sub!(/\A\*\*(?:\d+|\.)\.?\*\*\s*/, "")
  embedded = node.css("span.fnote[id]").map { |span| span["id"].strip }
                 .reject { |value| value.empty? || value.match?(/\A\d+\z/) }
  text = ([text] + embedded).reject(&:empty?).join(" ")
  text.empty? ? "*[Footnote text is absent from the saved HTML.]*" : text
end

def inline(node)
  return "" if node.text? && node.text.empty?
  return node.text.gsub(/[\t\r\n ]+/, " ") if node.text?
  return "" if SKIPPED_TAGS.include?(node.name)

  classes = node["class"].to_s.split
  return "" if node.name == "a" && node["title"] == "return to text"
  if node.name == "a" && classes.include?("fnote")
    id = footnote_id(node)
    return id ? "[^#{id}]" : ""
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
  return inline(node) if node.name == "a" && node["class"].to_s.split.include?("fnote")

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
    visible_text = text.gsub(/\[\^[^\]]+\]/, "").strip
    unless visible_text.empty?
      output << "\n\n#{'#' * heading_level(text, heading_count)} #{text}\n\n"
      heading_count += 1
    else
      append_paragraph(output, text)
    end
    node.children.each do |child|
      heading_count = render_heading_descendants(child, output, heading_count)
    end
    return heading_count
  end
  if node.name == "div" && node["type"] == "contents"
    # The contents table is replaced with the navigation-derived Markdown
    # outline, but its printed page markers still belong to the source text.
    # Some archive pages leave this div unclosed and place the actual text
    # after the first Arabic page marker inside it.
    centers = node.css("center")
    body_center = centers.find do |center|
      page_marker(inline(center).strip).to_s.match?(/\A<!-- p\. \d+ -->\z/)
    end
    (body_center ? centers.take_while { |center| center != body_center } : centers).each do |center|
      marker = page_marker(inline(center).strip)
      output << "\n\n#{marker}\n\n" if marker
    end
    if body_center
      # The malformed source nests the actual text in the contents div. Render
      # the serialized fragment from the first Arabic page onward, preserving
      # all text and footnotes while omitting the duplicated table of contents.
      serialized = node.to_html
      start = serialized.index(body_center.to_html)
      fragment = Nokogiri::HTML::DocumentFragment.parse(serialized[start..])
      fragment.children.each { |child| heading_count = render(child, output, heading_count) }
    end
    return heading_count
  end
  if node.name == "div" && node["id"] == "footnotes"
    notes = node.element_children.select { |child| child.name == "div" && child["class"].to_s.split.include?("fnote") }
    return heading_count if notes.empty?

    node.children.each { |child| heading_count = render(child, output, heading_count) }
    return heading_count
  end
  if node.name == "div" && classes.include?("fnote")
    id = node.at_css('a[name^="note"]')&.then { |anchor| footnote_id(anchor) }
    append_paragraph(output, "[^#{id}]: #{footnote_text(node)}") if id
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
    headings = node.element_children.select do |child|
      child.name == "span" && child["class"].to_s.split.include?("head")
    end
    unless headings.empty?
      buffer = +""
      node.children.each do |child|
        if headings.include?(child)
          append_paragraph(output, buffer)
          buffer = +""
          heading_count = render(child, output, heading_count)
        else
          buffer << inline(child)
        end
      end
      append_paragraph(output, buffer)
      return heading_count
    end

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
  text.gsub(/\[\^[^\]]+\]/, "")
      .unicode_normalize(:nfkd)
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
  markdown = markdown.lstrip
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

  lines = markdown.lines
  merged = []
  index = 0
  while index < lines.length
    first = lines[index].match(/\A#+\s+(.+?)\s*\n?\z/)
    next_index = index + 1
    next_index += 1 while next_index < lines.length && lines[next_index].strip.empty?
    second = next_index < lines.length && lines[next_index].match(/\A#+\s+(.+?)\s*\n?\z/)
    if first && second
      combined = "#{first[1]} #{second[1]}"
      level = expected_heading_level(combined, navigation)
      if level
        merged << "#{'#' * level} #{combined}\n"
        index = next_index + 1
        next
      end
    end

    merged << lines[index]
    index += 1
  end
  markdown = merged.join

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
  markdown.gsub!(
    "## PART THREE\n\n## Part Three\n\n### Showing What Are Distinguishing Signs of Truly Gracious and Holy affections\n",
    "## PART THREE\n\n### Showing What Are Distinguishing Signs of Truly Gracious and Holy affections\n"
  )

  title = markdown[/\A#\s+(.+)\n/, 1]
  hidden_depth = nil
  contents_entries = entries.each_with_object([]) do |(depth, text), result|
    key = heading_key(text)
    if key == "front matter"
      hidden_depth = depth
      next
    end
    hidden_depth = nil if hidden_depth && depth <= hidden_depth
    next if key == "contents" || (!title.nil? && key == heading_key(title))

    result << [hidden_depth ? depth - 1 : depth, text]
  end
  contents = contents_entries.map { |depth, text| "#{'  ' * (depth - 1)}- #{text}" }.join("\n")
  unless contents.empty?
    if markdown.match?(/^### CONTENTS$/)
      markdown.sub!(/^### CONTENTS\n\n/, "### CONTENTS\n\n#{contents}\n\n")
    else
      first_section = entries.find do |depth, text|
        key = heading_key(text)
        depth == 1 && key != "front matter" && key != "contents" && (!title.nil? && key != heading_key(title))
      end&.last
      markdown.sub!(/^## #{Regexp.escape(first_section)}\n/, "### CONTENTS\n\n#{contents}\n\n\\0") if first_section
    end
  end

  # `Front Matter` is a navigation heading, omitted by the source pages.
  # Preserve it when the archive's navigation records it for the volume.
  if entries.any? { |_depth, text| heading_key(text) == "front matter" }
    markdown.sub!(/\A# [^\n]+\n/, "\\0\n## Front Matter\n")
  end
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
  @source_page = File.basename(path, ".html")
  node = content_node(source_fragment(path), index)
  heading_count = render(node, output, heading_count)
end

# Remove navigation residues and normalise the deliberately generous paragraph
# spacing emitted while traversing malformed source HTML.
# Remove only standalone navigation residues.  Some malformed captures join a
# navigation label to the first text paragraph; matching it mid-line would
# discard legitimate text and its footnotes.
output.gsub!(/^(?:Previous section|Next section|New Search)\s*$/i, "")
# The archive metadata can share a physical line with the first paragraph in
# malformed captures. Match the complete metadata token (with or without
# Markdown bold generated from the source) instead of dropping the line.
output.gsub!(/(?:^|\n)Jonathan Edwards \[(?:\*\*)?\d{4}(?:\*\*)?\], .*?\[word count\] \[(?:\*\*)?jec-wjeo\d+(?:\*\*)?\]\.[ \t]*/, "\n")
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
