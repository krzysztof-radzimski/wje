#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"
require_relative "../scripts/lib/image_selections"

class ImageSelectionsTest < Minitest::Test
  PROJECT_ROOT = File.expand_path("..", __dir__)
  FIXTURE_ROOT = File.join(__dir__, "fixtures", "image_selections", "VOLUME99")

  def setup
    @temporary_root = Dir.mktmpdir("wje-image-selections-")
    @volume_directory = File.join(@temporary_root, "HTML", "VOLUME99")
    FileUtils.mkdir_p(File.dirname(@volume_directory))
    FileUtils.cp_r(FIXTURE_ROOT, @volume_directory)
    write_fixture_images
  end

  def teardown
    FileUtils.remove_entry(@temporary_root) if @temporary_root && File.exist?(@temporary_root)
  end

  def test_audit_classifies_every_candidate_from_literal_inputs
    manifest_path = File.join(@temporary_root, "metadata", "image-selections", "VOLUME99.json")
    stdout, stderr, status = ruby_command(
      "scripts/audit_volume_images.rb",
      "--manifest=#{manifest_path}",
      @volume_directory
    )
    assert status.success?, "audit failed:\n#{stdout}\n#{stderr}"
    assert_includes stdout, "6 kandydatów"
    assert_includes stdout, "uncertain=1"
    manifest = JSON.parse(File.read(manifest_path, encoding: "UTF-8"))
    entries = manifest.fetch("entries").to_h { |entry| [entry.fetch("id"), entry] }

    assert_equal ImageSelections::RULES_VERSION, manifest["rulesVersion"]
    assert_equal ImageSelections.rule_definition, manifest["rules"]
    assert_equal 6, entries.length
    assert_entry entries, "001:diagram.svg", "include", "content", "image/svg+xml"
    assert_equal "001-diagram.svg", entries.fetch("001:diagram.svg").fetch("assetName")
    assert_entry entries, "001:manuscript-scan.svg", "omit-scan", "content", "image/svg+xml"
    assert_operator entries.fetch("001:manuscript-scan.svg").fetch("fileBytes"), :>=,
                    ImageSelections::SCAN_THRESHOLDS.fetch("minimumFileBytes")
    assert_entry entries, "001:manuscript-spread.svg", "omit-scan", "content", "image/svg+xml"
    assert_entry entries, "001:broken-image.jpg", "omit-noncontent", "content", nil
    assert_entry entries, "001:outside-logo.svg", "omit-noncontent", "outside-before-content", "image/svg+xml"
    assert_entry entries, "001:neutral.svg", "uncertain", "content", "image/svg+xml"
  end

  def test_fallback_content_boundary_keeps_footer_images_in_the_audit
    html = <<~HTML
      <html><body>
      #{ImageSelections::CONTENT_START}
      <p>Content</p>
      <div id="footer"><img src="001_files/footer.svg" alt="Footer logo"></div>
      </body></html>
    HTML
    regions = ImageSelections.source_regions(html).to_h

    assert_includes regions.fetch("content"), "<p>Content</p>"
    assert_includes regions.fetch("outside-after-content"), "footer.svg"
  end

  def test_validator_accepts_traceable_previous_rules_version
    manifest = ImageSelections.build_manifest(@volume_directory)
    [ImageSelections::LEGACY_RULES_VERSION, ImageSelections::PREVIOUS_RULES_VERSION].each do |version|
      manifest["rulesVersion"] = version
      manifest["rules"] = ImageSelections.rule_definition(version)

      assert_equal manifest.fetch("entries"), ImageSelections.validate_manifest!(manifest, @volume_directory)
    end
  end

  def test_explicit_first_page_scan_can_be_near_square
    path = File.join(@volume_directory, "001_files", "near-square-scan.svg")
    File.write(path, svg(914, 958, "First page", padding: "x" * 5000), encoding: "UTF-8")
    candidate = {
      "id" => "001:near-square-scan.svg",
      "sourcePage" => "001",
      "savedFile" => "near-square-scan.svg",
      "sourcePath" => "001_files/near-square-scan.svg",
      "localPath" => path,
      "occurrences" => [{
        "position" => "content",
        "alt" => "",
        "title" => "",
        "caption" => "",
        "context" => "The first page of Edwards' Farewell Sermon. Courtesy Beinecke Manuscript Library, Yale University."
      }]
    }

    entry = ImageSelections.classify(candidate)

    assert_equal "omit-scan", entry.fetch("decision")
    assert_includes entry.dig("matchedMarkers", "explicitPageScan"), "first page"
    assert_includes entry.dig("matchedMarkers", "interface"), "yale university"
  end

  def test_near_square_yale_credit_without_first_page_remains_noncontent
    path = File.join(@volume_directory, "001_files", "near-square-credit.svg")
    File.write(path, svg(914, 958, "Credit", padding: "x" * 5000), encoding: "UTF-8")
    candidate = {
      "id" => "001:near-square-credit.svg",
      "sourcePage" => "001",
      "savedFile" => "near-square-credit.svg",
      "sourcePath" => "001_files/near-square-credit.svg",
      "localPath" => path,
      "occurrences" => [{
        "position" => "content",
        "alt" => "",
        "title" => "",
        "caption" => "",
        "context" => "Courtesy Beinecke Manuscript Library, Yale University."
      }]
    }

    entry = ImageSelections.classify(candidate)

    assert_equal "omit-noncontent", entry.fetch("decision")
    assert_empty entry.dig("matchedMarkers", "explicitPageScan")
    assert_includes entry.dig("matchedMarkers", "interface"), "yale university"
  end

  def test_orchestrator_copies_only_include_and_selective_verifier_passes
    markdown_file = File.join(@temporary_root, "MD", "VOLUME99.md")
    manifest_path = File.join(@temporary_root, "metadata", "image-selections", "VOLUME99.json")
    FileUtils.mkdir_p(File.dirname(markdown_file))

    stdout, stderr, status = ruby_command(
      "scripts/archive_and_convert_volume.rb",
      "--manifest=#{manifest_path}",
      @volume_directory,
      markdown_file
    )
    assert status.success?, "orchestrator failed:\n#{stdout}\n#{stderr}"
    assert_includes stdout, "include=1, uncertain=1"
    assert_includes stdout, "UNCERTAIN 001:neutral.svg"

    manifest = JSON.parse(File.read(manifest_path, encoding: "UTF-8"))
    assert_equal 6, manifest.fetch("entries").length
    markdown = File.read(markdown_file, encoding: "UTF-8")
    assert_equal ["assets/VOLUME99/001-diagram.svg"], markdown.scan(/!\[[^\]]*\]\(([^)]+)\)/).flatten
    assert_equal ["001-diagram.svg"], Dir.children(File.join(@temporary_root, "MD", "assets", "VOLUME99")).sort
    assert_includes markdown, "52. \\|"
    assert_includes markdown, "\n\\|\n"
    assert_includes markdown, "Particularly. --1--"
    assert_equal 1, markdown.scan(/<!-- p\. /).length
    assert_gfm_tables(markdown)

    verify_stdout, verify_stderr, verify_status = ruby_command(
      "scripts/verify_volume_markdown.rb",
      "--image-selections=#{manifest_path}",
      @volume_directory,
      markdown_file
    )
    assert verify_status.success?, "verifier failed:\n#{verify_stdout}\n#{verify_stderr}"
    assert_includes verify_stdout, "1 obrazów include z manifestu"
  end

  def test_orchestrator_preserves_selected_image_before_intro_contents
    File.write(
      File.join(@volume_directory, "001.html"),
      <<~HTML,
        <!doctype html>
        <html><body>
        <!-- START OF CONTENT AREA -->
        <div type="intro">
          <center>-- ii --</center>
          <figure>
            <img src="001_files/diagram.svg" alt="Figure 1 diagram">
            <figcaption>Figure 1. Diagram before the contents.</figcaption>
          </figure>
          <center>-- iii --</center>
          <div type="subsection"><span class="head">CONTENTS</span><span class="item">Fixture Volume 1</span></div>
          <div type="subsection"><span class="head">Fixture Volume</span><p>Body text.</p></div>
        </div>
        <!-- END OF CONTEXT AREA, WE HOPE-->
        </body></html>
      HTML
      encoding: "UTF-8"
    )
    markdown_file = File.join(@temporary_root, "MD", "VOLUME99.md")
    manifest_path = File.join(@temporary_root, "metadata", "image-selections", "VOLUME99.json")
    FileUtils.mkdir_p(File.dirname(markdown_file))

    stdout, stderr, status = ruby_command(
      "scripts/archive_and_convert_volume.rb",
      "--manifest=#{manifest_path}",
      @volume_directory,
      markdown_file
    )
    assert status.success?, "orchestrator failed:\n#{stdout}\n#{stderr}"

    markdown = File.read(markdown_file, encoding: "UTF-8")
    image_position = markdown.index("![Figure 1 diagram](assets/VOLUME99/001-diagram.svg)")
    contents_position = markdown.index("### CONTENTS")
    refute_nil image_position
    refute_nil contents_position
    assert_operator image_position, :<, contents_position
    assert_includes markdown, "Figure 1. Diagram before the contents."
    assert_equal 2, markdown.scan(/<!-- p\. /).length
  end

  def test_selective_verifier_fails_when_detected_candidate_is_absent_from_manifest
    markdown_file = File.join(@temporary_root, "MD", "VOLUME99.md")
    manifest_path = File.join(@temporary_root, "metadata", "image-selections", "VOLUME99.json")
    FileUtils.mkdir_p(File.dirname(markdown_file))
    _stdout, stderr, status = ruby_command(
      "scripts/archive_and_convert_volume.rb",
      "--manifest=#{manifest_path}",
      @volume_directory,
      markdown_file
    )
    assert status.success?, stderr

    manifest = JSON.parse(File.read(manifest_path, encoding: "UTF-8"))
    manifest.fetch("entries").reject! { |entry| entry["id"] == "001:neutral.svg" }
    File.write(manifest_path, "#{JSON.pretty_generate(manifest)}\n", encoding: "UTF-8")

    stdout, verify_stderr, verify_status = ruby_command(
      "scripts/verify_volume_markdown.rb",
      "--image-selections=#{manifest_path}",
      @volume_directory,
      markdown_file
    )
    refute verify_status.success?
    assert_includes "#{stdout}\n#{verify_stderr}", "Wykryte kandydaty nieobecne w manifeście: 001:neutral.svg"
  end

  private

  def assert_entry(entries, id, decision, position, mime_type)
    entry = entries.fetch(id)
    assert_equal decision, entry.fetch("decision")
    assert_equal position, entry.fetch("position")
    mime_type.nil? ? assert_nil(entry["mimeType"]) : assert_equal(mime_type, entry["mimeType"])
    refute_empty entry.fetch("reason")
  end

  def write_fixture_images
    directory = File.join(@volume_directory, "001_files")
    File.write(File.join(directory, "diagram.svg"), svg(640, 360, "Diagram"), encoding: "UTF-8")
    File.write(
      File.join(directory, "manuscript-scan.svg"),
      svg(1000, 1400, "Manuscript scan", padding: "x" * 5000),
      encoding: "UTF-8"
    )
    File.write(
      File.join(directory, "manuscript-spread.svg"),
      svg(1400, 1000, "Manuscript scan", padding: "x" * 5000),
      encoding: "UTF-8"
    )
    File.write(File.join(directory, "neutral.svg"), svg(320, 240, "Object"), encoding: "UTF-8")
    File.write(File.join(directory, "outside-logo.svg"), svg(120, 40, "Logo"), encoding: "UTF-8")
    File.write(File.join(directory, "broken-image.jpg"), "<html><body>saved error response</body></html>\n", encoding: "UTF-8")
  end

  def svg(width, height, label, padding: "")
    <<~SVG
      <svg xmlns="http://www.w3.org/2000/svg" width="#{width}" height="#{height}" viewBox="0 0 #{width} #{height}">
        <title>#{label}</title>
        <desc>#{padding}</desc>
        <rect width="100%" height="100%" fill="white" stroke="black"/>
      </svg>
    SVG
  end

  def ruby_command(script, *arguments)
    Open3.capture3(RbConfig.ruby, File.join(PROJECT_ROOT, script), *arguments, chdir: PROJECT_ROOT)
  end

  def assert_gfm_tables(markdown)
    groups = markdown.lines.chunk_while { |left, right| left.start_with?("|") && right.start_with?("|") }
                     .select { |group| group.first&.start_with?("|") }
    refute_empty groups
    groups.each do |rows|
      assert_match(/\A\|(?:\s*---\s*\|)+\s*\z/, rows.fetch(1))
      separator_counts = rows.map { |row| row.scan(/(?<!\\)\|/).length }
      assert_equal [separator_counts.first], separator_counts.uniq
    end
  end
end
