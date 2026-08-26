#!/usr/bin/env ruby
# frozen_string_literal: true

require "cgi"
require "fileutils"
require "json"
require "nokogiri"
require "pathname"
require "time"

module ImageSelections
  CONTENT_START = "<!-- START OF CONTENT AREA -->"
  CONTENT_END = "<!-- END OF CONTEXT AREA, WE HOPE-->"
  SCHEMA_VERSION = 1
  LEGACY_RULES_VERSION = "wje-image-selection-v1"
  RULES_VERSION = "wje-image-selection-v2"
  DECISIONS = %w[include omit-scan omit-noncontent uncertain].freeze

  INTERFACE_MARKERS = [
    "addthis", "button", "creative commons", "footer", "header", "icon",
    "jonathan edwards center", "logo", "navigation", "new search",
    "next section", "previous section", "share this page", "site-title",
    "yale university"
  ].freeze
  SCAN_MARKERS = [
    "facsimile", "folio", "full page", "handwritten", "handwriting",
    "manuscript", "recto", "scan", "scanned", "verso"
  ].freeze
  INCLUDE_MARKERS = [
    "chart", "diagram", "fig.", "figure", "graph", "illustration", "map",
    "plan", "plate", "schematic"
  ].freeze
  SCAN_THRESHOLDS = {
    "minimumFileBytes" => 4096,
    "minimumShortSide" => 600,
    "minimumLongSide" => 800,
    "minimumPixels" => 800_000,
    "minimumPageAspectRatio" => 1.15,
    "maximumPageAspectRatio" => 1.80
  }.freeze
  LEGACY_SCAN_THRESHOLDS = {
    "minimumFileBytes" => 4096,
    "minimumWidth" => 600,
    "minimumHeight" => 800,
    "minimumPixels" => 800_000,
    "minimumHeightToWidthRatio" => 1.15,
    "maximumHeightToWidthRatio" => 1.80
  }.freeze

  module_function

  def rule_definition(version = RULES_VERSION)
    precedence, thresholds = case version
                             when RULES_VERSION
                               [["omit-scan", "omit-noncontent", "include", "uncertain"], SCAN_THRESHOLDS]
                             when LEGACY_RULES_VERSION
                               [["omit-noncontent", "omit-scan", "include", "uncertain"], LEGACY_SCAN_THRESHOLDS]
                             else
                               return nil
                             end
    {
      "version" => version,
      "precedence" => precedence,
      "interfaceMarkers" => INTERFACE_MARKERS,
      "scanMarkers" => SCAN_MARKERS,
      "includeMarkers" => INCLUDE_MARKERS,
      "scanThresholds" => thresholds
    }
  end

  def normalized_text(value)
    value.to_s.gsub(/\s+/, " ").strip
  end

  def marker_matches(text, markers)
    haystack = normalized_text(text).downcase
    markers.select do |marker|
      haystack.match?(/(?<![[:alnum:]])#{Regexp.escape(marker)}(?![[:alnum:]])/i)
    end
  end

  def source_regions(html)
    start = html.index(CONTENT_START)
    finish = html.index(CONTENT_END, start || 0)
    boundary_length = CONTENT_END.length
    unless finish
      finish = html.index('<div id="footer">', start || 0)
      boundary_length = 0
    end
    unless finish
      finish = html.index("</body>", start || 0)
      boundary_length = 0
    end
    return [["outside-before-content", html]] unless start && finish

    [
      ["outside-before-content", html[0...start]],
      ["content", html[(start + CONTENT_START.length)...finish]],
      ["outside-after-content", html[(finish + boundary_length)..-1].to_s]
    ]
  end

  def local_source_path(source, html_path, volume_directory)
    return [nil, "remote-or-inline"] if source.empty? || source.match?(%r{\A(?:https?:)?//|\Adata:}i)

    relative = CGI.unescapeHTML(source).sub(/[?#].*\z/, "")
    absolute = File.expand_path(relative, File.dirname(html_path))
    root = File.expand_path(volume_directory)
    return [nil, "outside-volume"] unless absolute == root || absolute.start_with?("#{root}#{File::SEPARATOR}")

    [absolute, nil]
  end

  def image_info(path)
    return { "mimeType" => nil, "extension" => nil, "width" => nil, "height" => nil, "fileBytes" => nil } unless path && File.file?(path)

    bytes = File.binread(path)
    mime = nil
    extension = nil
    width = nil
    height = nil
    if bytes.start_with?("\xFF\xD8\xFF".b)
      mime = "image/jpeg"
      extension = "jpg"
      width, height = jpeg_dimensions(bytes)
    elsif bytes.start_with?("\x89PNG\r\n\x1A\n".b)
      mime = "image/png"
      extension = "png"
      width, height = bytes[16, 8].unpack("NN") if bytes.bytesize >= 24
    elsif bytes.start_with?("GIF87a", "GIF89a")
      mime = "image/gif"
      extension = "gif"
      width, height = bytes[6, 4].unpack("vv") if bytes.bytesize >= 10
    elsif bytes.start_with?("RIFF") && bytes[8, 4] == "WEBP"
      mime = "image/webp"
      extension = "webp"
      width, height = webp_dimensions(bytes)
    elsif bytes.lstrip.start_with?("<svg", "<?xml") && bytes.match?(/<svg\b/i)
      mime = "image/svg+xml"
      extension = "svg"
      width, height = svg_dimensions(bytes)
    end
    {
      "mimeType" => mime,
      "extension" => extension,
      "width" => width,
      "height" => height,
      "fileBytes" => bytes.bytesize
    }
  end

  def jpeg_dimensions(bytes)
    index = 2
    while index + 9 < bytes.bytesize
      index += 1 while index < bytes.bytesize && bytes.getbyte(index) != 0xFF
      index += 1 while index < bytes.bytesize && bytes.getbyte(index) == 0xFF
      break if index >= bytes.bytesize

      marker = bytes.getbyte(index)
      index += 1
      next if marker == 0x01 || (0xD0..0xD9).cover?(marker)
      break if index + 1 >= bytes.bytesize

      length = bytes[index, 2].unpack1("n")
      return [bytes[index + 5, 2].unpack1("n"), bytes[index + 3, 2].unpack1("n")] if
        [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].include?(marker) && length >= 7

      break if length < 2

      index += length
    end
    [nil, nil]
  end

  def webp_dimensions(bytes)
    chunk = bytes[12, 4]
    case chunk
    when "VP8X"
      return [nil, nil] if bytes.bytesize < 30

      width = 1 + bytes[24, 3].bytes.each_with_index.sum { |value, index| value << (8 * index) }
      height = 1 + bytes[27, 3].bytes.each_with_index.sum { |value, index| value << (8 * index) }
      [width, height]
    when "VP8L"
      return [nil, nil] if bytes.bytesize < 25 || bytes.getbyte(20) != 0x2F

      bits = bytes[21, 4].unpack1("V")
      [1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)]
    when "VP8 "
      marker = bytes.index("\x9D\x01\x2A".b, 20)
      return [nil, nil] unless marker && marker + 7 <= bytes.bytesize

      [bytes[marker + 3, 2].unpack1("v") & 0x3FFF, bytes[marker + 5, 2].unpack1("v") & 0x3FFF]
    else
      [nil, nil]
    end
  end

  def svg_dimensions(bytes)
    document = Nokogiri::XML(bytes) { |config| config.nonet.recover }
    svg = document.at_xpath("/*[local-name()='svg']")
    return [nil, nil] unless svg

    width = numeric_svg_dimension(svg["width"])
    height = numeric_svg_dimension(svg["height"])
    view_box = svg["viewBox"].to_s.split(/[\s,]+/).map { |value| Float(value) rescue nil }
    if (width.nil? || height.nil?) && view_box.length == 4 && view_box.all?
      width ||= view_box[2]
      height ||= view_box[3]
    end
    [integer_dimension(width), integer_dimension(height)]
  rescue Nokogiri::XML::SyntaxError
    [nil, nil]
  end

  def numeric_svg_dimension(value)
    match = value.to_s.strip.match(/\A([0-9]+(?:\.[0-9]+)?)(?:px)?\z/i)
    match && Float(match[1])
  end

  def integer_dimension(value)
    value && value.positive? ? value.round : nil
  end

  def node_text_without_images(node)
    copy = node.dup
    copy.css("img").remove
    normalized_text(copy.text)
  end

  def occurrence_for(node, position)
    caption_node = node.at_xpath("ancestor::figure[1]/*[self::figcaption or contains(concat(' ', normalize-space(@class), ' '), ' caption ')][1]")
    caption_node ||= node.xpath("following-sibling::*[1]").find do |sibling|
      sibling.name == "figcaption" || sibling["class"].to_s.split.include?("caption")
    end
    adjacent = [node.previous_element, node.next_element].compact.map { |sibling| node_text_without_images(sibling) }
    figure = node.at_xpath("ancestor::figure[1]")
    {
      "position" => position,
      "alt" => normalized_text(node["alt"]),
      "title" => normalized_text(node["title"]),
      "caption" => caption_node ? node_text_without_images(caption_node)[0, 500] : "",
      "context" => normalized_text((adjacent + [figure ? node_text_without_images(figure) : ""]).join(" "))[0, 500]
    }
  end

  def discover(volume_directory)
    candidates = {}
    pages = Dir.glob(File.join(volume_directory, "[0-9][0-9][0-9].html")).sort
    raise "Nie znaleziono stron HTML w #{volume_directory}" if pages.empty?

    pages.each do |html_path|
      page = File.basename(html_path, ".html")
      html = File.binread(html_path).force_encoding("UTF-8").scrub
      source_regions(html).each do |position, fragment|
        Nokogiri::HTML::DocumentFragment.parse(fragment).css("img").each do |node|
          source = node["src"].to_s
          next if source.empty? || source.match?(%r{\A(?:https?:)?//|\Adata:}i)

          path, path_problem = local_source_path(source, html_path, volume_directory)
          saved_file = File.basename(CGI.unescapeHTML(source).sub(/[?#].*\z/, ""))
          next if saved_file.empty?

          id = "#{page}:#{saved_file}"
          candidate = candidates[id] ||= {
            "id" => id,
            "sourcePage" => page,
            "savedFile" => saved_file,
            "sourcePath" => path ? Pathname.new(path).relative_path_from(Pathname.new(File.expand_path(volume_directory))).to_s : source,
            "pathProblem" => path_problem,
            "occurrences" => []
          }
          candidate["occurrences"] << occurrence_for(node, position)
          candidate["localPath"] ||= path
        end
      end
    end
    candidates.values.sort_by { |candidate| candidate["id"] }
  end

  def scan_shape?(info)
    width = info["width"]
    height = info["height"]
    bytes = info["fileBytes"]
    return false unless width && height && bytes && width.positive? && height.positive?

    short_side, long_side = [width, height].minmax
    page_aspect_ratio = long_side.to_f / short_side
    bytes >= SCAN_THRESHOLDS["minimumFileBytes"] &&
      short_side >= SCAN_THRESHOLDS["minimumShortSide"] &&
      long_side >= SCAN_THRESHOLDS["minimumLongSide"] &&
      width * height >= SCAN_THRESHOLDS["minimumPixels"] &&
      page_aspect_ratio >= SCAN_THRESHOLDS["minimumPageAspectRatio"] &&
      page_aspect_ratio <= SCAN_THRESHOLDS["maximumPageAspectRatio"]
  end

  def stable_asset_name(candidate, extension)
    stem = File.basename(candidate["savedFile"], File.extname(candidate["savedFile"]))
               .gsub(/[^A-Za-z0-9._-]+/, "-")
    "#{candidate['sourcePage']}-#{stem}.#{extension}"
  end

  def classify(candidate)
    occurrences = candidate["occurrences"]
    content_occurrence = occurrences.find { |occurrence| occurrence["position"] == "content" }
    primary = content_occurrence || occurrences.first
    positions = occurrences.map { |occurrence| occurrence["position"] }.uniq
    marker_text = [candidate["savedFile"], primary["alt"], primary["title"], primary["caption"], primary["context"]].join(" ")
    info = image_info(candidate.delete("localPath"))
    interface = marker_matches(marker_text, INTERFACE_MARKERS)
    scan = marker_matches(marker_text, SCAN_MARKERS)
    include_markers = marker_matches(marker_text, INCLUDE_MARKERS)
    ratio = info["width"] && info["height"] && info["width"].positive? ? (info["height"].to_f / info["width"]).round(4) : nil

    decision, reason = if info["mimeType"].nil?
                         ["omit-noncontent", "Typ MIME nie jest rozpoznawalnym obrazem odczytanym z zawartości pliku."]
                       elsif content_occurrence.nil?
                         ["omit-noncontent", "Obraz występuje wyłącznie poza obszarem treści."]
                       elsif scan.any? && scan_shape?(info)
                         ["omit-scan", "Marker skanu (#{scan.join(', ')}) oraz wszystkie progi rozmiaru, wymiarów i proporcji strony w orientacji pionowej lub poziomej są spełnione."]
                       elsif interface.any?
                         ["omit-noncontent", "Marker interfejsu: #{interface.join(', ')}."]
                       elsif scan.any?
                         ["uncertain", "Marker skanu (#{scan.join(', ')}) występuje, lecz nie są spełnione wszystkie progi skanu strony."]
                       elsif include_markers.any?
                         ["include", "Marker obrazu treści: #{include_markers.join(', ')}; brak cech skanu strony i interfejsu."]
                       else
                         ["uncertain", "Rozpoznawalny obraz treści nie spełnia literalnych reguł include, omit-scan ani omit-noncontent."]
                       end

    entry = candidate.merge(
      "positions" => positions,
      "position" => content_occurrence ? "content" : positions.first,
      "mimeType" => info["mimeType"],
      "width" => info["width"],
      "height" => info["height"],
      "heightToWidthRatio" => ratio,
      "fileBytes" => info["fileBytes"],
      "alt" => primary["alt"],
      "title" => primary["title"],
      "caption" => primary["caption"],
      "context" => primary["context"],
      "matchedMarkers" => { "interface" => interface, "scan" => scan, "include" => include_markers },
      "decision" => decision,
      "reason" => reason
    )
    entry["assetName"] = stable_asset_name(candidate, info["extension"]) if decision == "include"
    entry.delete("pathProblem") if entry["pathProblem"].nil?
    entry
  end

  def build_manifest(volume_directory)
    volume = File.basename(File.expand_path(volume_directory))
    {
      "schemaVersion" => SCHEMA_VERSION,
      "rulesVersion" => RULES_VERSION,
      "volume" => volume,
      "generatedAt" => Time.now.utc.iso8601,
      "rules" => rule_definition,
      "entries" => discover(volume_directory).map { |candidate| classify(candidate) }
    }
  end

  def write_manifest(volume_directory, manifest_path)
    manifest = build_manifest(volume_directory)
    directory = File.dirname(File.expand_path(manifest_path))
    FileUtils.mkdir_p(directory)
    temporary = "#{File.expand_path(manifest_path)}.tmp"
    File.write(temporary, "#{JSON.pretty_generate(manifest)}\n", encoding: "UTF-8")
    File.rename(temporary, manifest_path)
    manifest
  end

  def load_manifest(path)
    JSON.parse(File.read(path, encoding: "UTF-8"))
  rescue JSON::ParserError => error
    raise "Niepoprawny JSON manifestu #{path}: #{error.message}"
  end

  def validate_manifest!(manifest, volume_directory, discovered = nil)
    volume = File.basename(File.expand_path(volume_directory))
    raise "Manifest należy do #{manifest['volume']}, a nie #{volume}." unless manifest["volume"] == volume
    raise "Nieobsługiwana wersja schematu manifestu: #{manifest['schemaVersion'].inspect}." unless manifest["schemaVersion"] == SCHEMA_VERSION
    expected_rules = rule_definition(manifest["rulesVersion"])
    raise "Nieobsługiwana wersja reguł manifestu: #{manifest['rulesVersion'].inspect}." unless expected_rules
    raise "Manifest ma niespójną definicję reguł #{manifest['rulesVersion']}." unless manifest["rules"] == expected_rules

    entries = manifest["entries"]
    raise "Manifest nie zawiera tablicy entries." unless entries.is_a?(Array)
    invalid = entries.reject { |entry| DECISIONS.include?(entry["decision"]) }
    raise "Manifest zawiera nieprawidłowe decyzje: #{invalid.map { |entry| entry['id'] }.join(', ')}" unless invalid.empty?
    duplicate_ids = entries.group_by { |entry| entry["id"] }.select { |_id, group| group.length > 1 }.keys
    raise "Manifest zawiera zduplikowane identyfikatory: #{duplicate_ids.join(', ')}" unless duplicate_ids.empty?
    bad_includes = entries.select do |entry|
      entry["decision"] == "include" && (entry["assetName"].to_s.empty? || File.basename(entry["assetName"]) != entry["assetName"])
    end
    raise "Pozycje include bez bezpiecznej nazwy assetu: #{bad_includes.map { |entry| entry['id'] }.join(', ')}" unless bad_includes.empty?

    discovered ||= discover(volume_directory)
    known = entries.map { |entry| entry["id"] }
    missing = discovered.map { |candidate| candidate["id"] } - known
    raise "Wykryte kandydaty nieobecne w manifeście: #{missing.join(', ')}" unless missing.empty?

    entries
  end
end
