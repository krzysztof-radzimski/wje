#!/usr/bin/env ruby
# frozen_string_literal: true

# Converts locally saved WJE Online pages into one Markdown document.  The
# archive pages are malformed HTML, so this intentionally works from the
# explicit source-content comments rather than from the surrounding layout.

require "cgi"
require "fileutils"
require "nokogiri"
require "pathname"

CONTENT_START = "<!-- START OF CONTENT AREA -->"
CONTENT_END = "<!-- END OF CONTEXT AREA, WE HOPE-->"
SKIPPED_TAGS = %w[script style img input form].freeze

def image_extension(path)
  signature = File.binread(path, 512)
  return "jpg" if signature.start_with?("\xFF\xD8\xFF".b)
  return "png" if signature.start_with?("\x89PNG\r\n\x1A\n".b)
  return "gif" if signature.start_with?("GIF87a", "GIF89a")
  return "webp" if signature.start_with?("RIFF") && signature[8, 4] == "WEBP"
  return "svg" if signature.lstrip.start_with?("<svg", "<?xml") && signature.match?(/<svg\b/i)

  fallback = File.extname(path).delete_prefix(".").downcase
  %w[jpg jpeg png gif webp svg].include?(fallback) ? fallback : nil
end

def image_markdown(node)
  source = node["src"].to_s
  return "" if source.empty? || source.match?(%r{\Ahttps?://}i)

  source_path = File.expand_path(source, File.dirname(@source_path))
  return "" unless File.file?(source_path)

  selector = image_selector(source_path)
  selected_asset = @included_images[selector]
  return "" unless @include_images || @included_images.key?(selector)

  extension = image_extension(source_path)
  return "" if extension.nil?

  stem = File.basename(source_path, File.extname(source_path)).gsub(/[^A-Za-z0-9._-]+/, "-")
  filename = if selected_asset.nil? || selected_asset.empty?
               "#{@source_page}-#{stem}.#{extension}"
             else
               File.basename(selected_asset)
             end
  filename = "#{filename}.#{extension}" if File.extname(filename).empty?
  destination = File.join(@asset_directory, filename)
  FileUtils.mkdir_p(File.dirname(destination))
  FileUtils.cp(source_path, destination)

  relative_path = Pathname.new(destination).relative_path_from(Pathname.new(File.dirname(@output_file))).to_s
  alt = node["alt"].to_s.strip
  alt = "Illustration from source page #{@source_page}" if alt.empty?
  "![#{alt.gsub("]", "\\\\]")}](#{relative_path})"
end

def image_selector(source_path)
  "#{@source_page}:#{File.basename(source_path)}"
end

def selected_image?(node)
  source = node["src"].to_s
  return false if source.empty? || source.match?(%r{\Ahttps?://}i)

  source_path = File.expand_path(source, File.dirname(@source_path))
  File.file?(source_path) && (@include_images || @included_images.key?(image_selector(source_path)))
end

# A few front-matter pages place an illustration before an embedded Contents
# subsection. The Contents text is replaced with the navigation-derived
# outline, but selected illustrations and printed page markers that precede it
# are still source content and must retain their original order.
def render_intro_prefix(node, output, heading_count)
  return heading_count if node.text?

  if node.name == "center"
    marker = page_marker(inline(node).strip)
    output << "\n\n#{marker}\n\n" if marker
    return heading_count
  end
  if node.name == "figure"
    return heading_count unless node.css("img").any? { |image| selected_image?(image) }

    return render(node, output, heading_count)
  end
  if node.name == "img"
    return selected_image?(node) ? render(node, output, heading_count) : heading_count
  end

  node.children.each { |child| heading_count = render_intro_prefix(child, output, heading_count) }
  heading_count
end

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
  return image_markdown(node) if node.name == "img"
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

  # Editorial notes can be nested inside malformed heading spans. They belong
  # to the text after the heading, not to the heading label itself.
  return "" if node["class"].to_s.split.include?("fnote")

  return inline(node) if node.name == "a" && node["class"].to_s.split.include?("fnote")

  node.children.map { |child| heading_text(child) }.join
end

# Some saved archive pages have an unclosed heading span.  Its block-level
# descendants are still source text and must be rendered after the heading.
def render_heading_descendants(node, output, heading_count)
  return heading_count if node.text?

  if node.name == "span" && node["class"].to_s.split.include?("fnote")
    return render(node, output, heading_count)
  end

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

  # A manuscript can use a vertical stroke as prose or a deletion mark. If a
  # paragraph consists only of that stroke, leaving it as a literal leading
  # pipe makes Markdown parsers (and the volume validator) treat it as a
  # malformed GFM table row. Tables are rendered separately below, so escape
  # prose pipes here while retaining their visible source character.
  text = text.gsub(/(?<!\\)\|/, "\\\\|")
  # Manuscript dividers can consist of seven or more equals signs. A literal
  # line beginning that way is visually valid Markdown but Git interprets it
  # as a leftover merge-conflict marker. Escape the first sign so the rendered
  # text stays faithful and checkpoint validation remains meaningful.
  text = "\\#{text}" if text.match?(/\A={7}/)
  output << text << "\n\n"
end

# WJE Online sometimes records a manuscript transcription one physical line at
# a time, with every line wrapped in its own <p>.  Rendering those elements as
# separate Markdown paragraphs makes the text look like unprocessed OCR.
# Reflow only a strong lineation signature (many very short direct paragraphs)
# so ordinary prose pages retain their authored paragraph structure.
def lineated_manuscript_container?(node)
  return false unless node.name == "div"

  paragraphs = node.element_children.select { |child| child.name == "p" }
  return false if paragraphs.length < 20

  lines = paragraphs.map { |paragraph| inline(paragraph).gsub(/[\t\r\n ]+/, " ").strip }
                    .reject(&:empty?)
  return false if lines.length < 16

  average_length = lines.sum(&:length).fdiv(lines.length)
  short_lines = lines.count { |line| line.length <= 80 }
  average_length <= 65 && short_lines.fdiv(lines.length) >= 0.9
end

def manuscript_divider?(text)
  visible = text.gsub(/\[\^[^\]]+\]/, "").strip
  visible.match?(/\A(?:[_-]{3,}[[:space:]]*)+\z/)
end

def join_lineated_lines(previous, line)
  return line if previous.empty?

  previous = previous.rstrip
  line = line.strip
  return previous if line.empty?

  # A terminal hyphen in a physical manuscript line normally marks a word
  # split by the original line boundary.  Footnote references may occur
  # between the two parts; put them after the rejoined word rather than in its
  # middle (for example, "Enlarg-[^n]" + "ing" -> "Enlarging[^n]").
  footnotes = previous[/((?:\[\^[^\]]+\])*)\z/, 1].to_s
  stem = footnotes.empty? ? previous : previous[0...-footnotes.length]
  continuation = line.match(/\A([[:alpha:]]+)(.*)\z/)
  if stem.match?(/(?<!-)-\z/) && continuation
    return "#{stem[0...-1]}#{continuation[1]}#{footnotes}#{continuation[2]}"
  end

  separator = line.match?(/\A[,:;.!?%\)\]\}]/) || previous.end_with?("(", "[", "{", "/") ? "" : " "
  "#{previous}#{separator}#{line}"
end

def paragraph_contains_heading?(node)
  node.element_children.any? do |child|
    child.name == "span" && child["class"].to_s.split.include?("head")
  end
end

def render_lineated_paragraphs(paragraphs, output, heading_count)
  paragraph = +""
  flush = lambda do
    append_paragraph(output, paragraph)
    paragraph = +""
  end

  paragraphs.each do |node|
    if paragraph_contains_heading?(node)
      flush.call
      heading_count = render(node, output, heading_count)
      next
    end

    line = inline(node).gsub(/[\t\r\n ]+/, " ").strip
    if line.empty?
      flush.call
    elsif line.match?(/\A--\s*(?:[ivxlcdm]+|\d+)\s*--\z/i) && (marker = page_marker(line))
      flush.call
      output << "\n\n#{marker}\n\n"
    elsif manuscript_divider?(line)
      flush.call
      append_paragraph(output, line)
    else
      paragraph = join_lineated_lines(paragraph, line)
    end
  end

  flush.call
  heading_count
end

def render_lineated_container(node, output, heading_count)
  children = node.children
  index = 0
  while index < children.length
    child = children[index]
    unless child.element? && child.name == "p"
      heading_count = render(child, output, heading_count)
      index += 1
      next
    end

    paragraphs = []
    while index < children.length
      candidate = children[index]
      if candidate.element? && candidate.name == "p"
        paragraphs << candidate
        index += 1
      elsif candidate.text? && candidate.text.strip.empty?
        index += 1
      else
        break
      end
    end
    heading_count = render_lineated_paragraphs(paragraphs, output, heading_count)
  end
  heading_count
end

def page_marker(text)
  match = text.strip.match(/\A--\s*(.+?)\s*--\z/)
  match && "<!-- p. #{match[1]} -->"
end

def table_cell_text(cell)
  # A printed page marker can occur inside a table cell. Keep it in the cell
  # as an HTML comment: converting it later as a standalone marker would split
  # the GFM row and invalidate the entire table.
  inline(cell)
    .gsub(/--\s*([ivxlcdm]+|\d+)\s*--/i) { "<!-- p. #{$1} -->" }
    .gsub("|", "\\\\|")
    .gsub(/[\t\r\n]+/, " ")
    .strip
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
  if node.name == "img"
    image = image_markdown(node)
    output << "\n\n#{image}\n\n" unless image.empty?
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
  if node.name == "span" && classes.include?("fnote")
    append_paragraph(output, inline(node))
    return heading_count
  end
  if node.name == "span" && classes.include?("docauthor")
    # Author labels are block metadata in the source.  Without an explicit
    # paragraph boundary they can become glued to the first reflowed line of
    # a manuscript transcription.
    append_paragraph(output, inline(node))
    return heading_count
  end
  if node.name == "div" && node["type"] == "intro"
    subsections = node.css('div[type="subsection"]')
    contents_section = subsections.first
    contents_heading = contents_section&.at_css("span.head")&.then { |heading| heading_text(heading).strip }
    body_section = subsections[1]
    if contents_heading&.casecmp?("CONTENTS") && body_section
      serialized = node.to_html
      start = serialized.index(body_section.to_html)
      prefix = Nokogiri::HTML::DocumentFragment.parse(serialized[0...start])
      heading_count = render_intro_prefix(prefix, output, heading_count)
      output << "\n\n### CONTENTS\n\n"
      fragment = Nokogiri::HTML::DocumentFragment.parse(serialized[start..])
      fragment.children.each { |child| heading_count = render(child, output, heading_count) }
      return heading_count
    end
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
    serialized = node.to_html
    arabic_start = body_center && serialized.index(body_center.to_html)
    # A few contents pages contain real Roman-numeral front matter (for
    # example, a list of illustrations and a foreword) under malformed,
    # unclosed contents markup. Start at its first subsection heading before
    # the first Arabic marker; otherwise retain the existing fallback.
    front_matter_heading = if arabic_start
                             node.css("span.head").find do |heading|
                               position = serialized.index(heading.to_html)
                               subsection_depth = heading.ancestors.count do |ancestor|
                                 ancestor.name == "div" && ancestor["type"] == "subsection"
                               end
                               section_depth = heading.ancestors.count do |ancestor|
                                 ancestor.name == "div" && ancestor["type"] == "section"
                               end
                               position && position < arabic_start && (subsection_depth > 1 || section_depth > 1)
                             end
                           else
                             # Some Roman-numeral front-matter pages leave the
                             # entire text after the navigation inside an
                             # unclosed contents div. Begin at the first real
                             # nested section after Contents, rather than
                             # retaining only the printed page markers.
                             node.css('div[type="section"]').lazy.map do |section|
                               heading = section.element_children.find do |child|
                                 child.name == "span" && child["class"].to_s.split.include?("head")
                               end
                               heading unless heading.nil? || heading_text(heading).strip.casecmp?("CONTENTS")
                             end.find(&:itself)
                           end
    body_start = front_matter_heading || body_center
    start = body_start && serialized.index(body_start.to_html)
    prefix = start ? Nokogiri::HTML::DocumentFragment.parse(serialized[0...start]) : nil
    (prefix ? prefix.css("center") : (body_center ? centers.take_while { |center| center != body_center } : centers)).each do |center|
      marker = page_marker(inline(center).strip)
      output << "\n\n#{marker}\n\n" if marker
    end
    if start
      # The malformed source nests the actual text in the contents div. Render
      # the fragment from the first content subsection (or Arabic page) onward,
      # preserving all text and footnotes while omitting the duplicated table
      # of contents.
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
    if id
      # Footnote containers can follow an unclosed inline element. Ensure the
      # definition starts on its own line so it remains a Markdown definition
      # rather than becoming an additional reference in the preceding text.
      output << "\n" unless output.empty? || output.end_with?("\n\n")
      append_paragraph(output, "[^#{id}]: #{footnote_text(node)}")
    end
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
      row.element_children.select { |cell| %w[th td].include?(cell.name) }.map do |cell|
        table_cell_text(cell)
      end
    end.reject(&:empty?)
    unless rows.empty?
      column_count = rows.map(&:length).max
      # HTML tables in the archive often contain only data cells and, in a few
      # rows, omit trailing empty cells. A blank synthetic header supplies the
      # delimiter required by GFM while padding preserves the visual grid.
      output << "| #{Array.new(column_count, "").join(" | ")} |\n"
      output << "| #{Array.new(column_count, "---").join(" | ")} |\n"
      rows.each do |row|
        output << "| #{row.fill("", row.length...column_count).join(" | ")} |\n"
      end
      output << "\n"
    end
    return heading_count
  end
  if node.name == "span" && classes.include?("item")
    # Appendix lists sometimes wrap a real heading and all following entries
    # in one `span.item`. Flattening the wrapper would join the heading with
    # its annotation and make the entire appendix look like one paragraph.
    direct_heading = node.element_children.any? do |child|
      child.name == "span" && child["class"].to_s.split.include?("head")
    end
    if direct_heading
      node.children.each { |child| heading_count = render(child, output, heading_count) }
      return heading_count
    end
  end
  if node.name == "span" && classes.any? { |klass| %w[item navhead navlevel1 navlevel2 navlevel3].include?(klass) }
    text = inline(node).strip
    append_paragraph(output, text) unless text.empty?
    return heading_count
  end

  if lineated_manuscript_container?(node)
    return render_lineated_container(node, output, heading_count)
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

  text = document.at_css("div#text")
  return document unless text
  return text if text.at_css("div#footnotes")

  footnotes = document.at_css("div#footnotes")
  return text unless footnotes

  # In some saved pages the footnotes are a sibling of #text. Preserve both
  # regions without rendering the surrounding navigation and footer markup.
  content = Nokogiri::HTML::DocumentFragment.parse("")
  content.add_child(text.dup)
  content.add_child(footnotes.dup)
  content
end

def heading_key(text)
  text.gsub(/\[\^[^\]]+\]/, "")
      .unicode_normalize(:nfkd)
      .gsub(/[^[:alnum:]]+/, " ")
      .strip
      .downcase
end

def navigation_text(text)
  value = text.gsub(/\s+/, " ").strip
  return "CONTENTS" if value.match?(/\ACONTENTS Editorial Committee [ivxlcdm]+\z/i)

  value
end

def navigation_entries(path)
  fragment = source_fragment(path)
  document = Nokogiri::HTML::DocumentFragment.parse(fragment)
  document.css("span.navlevel1, span.navlevel2, span.navlevel3").map do |node|
    [node["class"][/\d/].to_i, navigation_text(node.text)]
  end
end

def expected_heading_level(text, navigation)
  key = heading_key(text)
  level = navigation[key]
  return level unless level.nil?

  # Volume 17's navigation shortens the appendix title by omitting the
  # explicit January–December 1733 range preserved in the printed heading.
  volume_17_appendix = heading_key(
    "Appendix: Dated Batches of Sermons, 1730–1732, and Dated Sermons, " \
    "Dating by Thomas A. Schafer"
  )
  volume_17_full_appendix = heading_key(
    "Appendix: Dated Batches of Sermons, 1730–1732, and Dated Sermons, " \
    "January–December 1733 Dating by Thomas A. Schafer"
  )
  return navigation[volume_17_appendix] if key == volume_17_full_appendix

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
  navigation_sequences = entries.each_with_object(Hash.new { |hash, key| hash[key] = [] }) do |(depth, text), index|
    index[heading_key(text)] << depth + 1
  end
  navigation = navigation_sequences.transform_values(&:last)

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
    # A part followed by a separately declared section is a genuine hierarchy,
    # not one heading split across two malformed source elements.
    separate_part_and_section = first && second &&
                                first[1].match?(/\Apart\b/i) && second[1].match?(/\Asection\b/i)
    if first && second && !separate_part_and_section
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

  # A title can legitimately occur at several navigation depths, for example
  # once as the sermon (H2) and again as its opening textual section (H3).
  # Use the ordered navigation levels only when all non-title occurrences are
  # present; otherwise retain the established last-level fallback for partial
  # or malformed captures.
  candidate_counts = Hash.new(0)
  markdown.each_line do |line|
    next if line.lstrip.start_with?("|")

    match = line.match(/\A#+\s+(.+?)\s*\n?\z/)
    next if match && line.start_with?("# ")

    text = match ? match[1] : line.strip
    next if text.empty? || text.match?(/\A\[\^[^\]]+\]:/)

    key = heading_key(text)
    candidate_counts[key] += 1 if navigation_sequences.key?(key)
  end
  sequenced_levels = navigation_sequences.each_with_object({}) do |(key, levels), selected|
    selected[key] = levels if levels.uniq.length > 1 && candidate_counts[key] == levels.length
  end
  sequence_positions = Hash.new(0)
  resolve_level = lambda do |text|
    key = heading_key(text)
    levels = sequenced_levels[key]
    if levels
      position = sequence_positions[key]
      sequence_positions[key] += 1
      levels[position]
    else
      expected_heading_level(text, navigation)
    end
  end

  markdown = markdown.lines.map do |line|
    next line if line.lstrip.start_with?("|")

    match = line.match(/\A#+\s+(.+?)\s*\n?\z/)
    if match
      next line if line.start_with?("# ")

      level = resolve_level.call(match[1])
      level ? "#{'#' * level} #{match[1]}\n" : line
    else
      text = line.strip
      next line if text.match?(/\A\[\^[^\]]+\]:/)

      level = resolve_level.call(text)
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
    elsif markdown.match?(/^### Contents$/)
      # The printed contents are already present. Do not prepend a second,
      # navigation-derived contents block when a newly corrected H2 makes the
      # first main section discoverable by the fallback below.
    elsif markdown.match?(/^## Front Matter$/)
      markdown.sub!(/^## Front Matter\n/, "## Front Matter\n\n### CONTENTS\n\n#{contents}\n\n")
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

include_images = ARGV.delete("--include-images")
included_image_arguments = ARGV.select { |argument| argument.start_with?("--include-image=") }
ARGV.reject! { |argument| argument.start_with?("--include-image=") }
input_directory = ARGV[0] || "HTML/VOLUME01"
output_file = ARGV[1] || "MD/VOLUME01.md"
@include_images = include_images
@included_images = included_image_arguments.each_with_object({}) do |argument, selected|
  selector, asset_name = argument.delete_prefix("--include-image=").split("=", 2)
  selected[selector] = asset_name
end
@output_file = File.expand_path(output_file)
@asset_directory = File.join(File.dirname(@output_file), "assets", File.basename(input_directory))
pages = Dir.glob(File.join(input_directory, "*.html")).sort
# 000.html is the archive's generated navigation page.  The printed volume's
# own front matter (including its contents page) starts in 001.html.
pages.reject! { |path| File.basename(path) == "000.html" }
abort "Nie znaleziono stron HTML w #{input_directory}" if pages.empty?

output = +""
heading_count = 0
pages.each_with_index do |path, index|
  @source_page = File.basename(path, ".html")
  @source_path = path
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
# Remaining printed markers use whitespace inside both pairs of dashes and
# occupy their own rendered line. Do not reinterpret compact deletions such
# as --<del>1</del>--, or manuscript numbering embedded in prose such as
# "15. -- 17 -- 22.", as pagination.
output.gsub!(/(?:\A|\n)[ \t]*--\s+([ivxlcdm]+|\d+)\s+--[ \t]*(?=\n|\z)/i) { "\n\n<!-- p. #{$1} -->\n\n" }
output.gsub!(/[ \t]+\n/, "\n")
output.gsub!(/\n{3,}/, "\n\n")
output = apply_heading_hierarchy(output, navigation_entries(File.join(input_directory, "000.html")))
output.strip!
File.write(output_file, "#{output}\n", encoding: "UTF-8")
