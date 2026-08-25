#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "optparse"
require "rbconfig"
require_relative "lib/image_selections"

options = {}
parser = OptionParser.new do |cli|
  cli.banner = "Użycie: ruby scripts/archive_and_convert_volume.rb [--manifest=PATH] HTML/VOLUMENN MD/VOLUMENN.md"
  cli.separator "Audytuje istniejące kompletne archiwum; nie uruchamia przeglądarki ani archiwizacji."
  cli.on("--manifest=PATH", "Jawna ścieżka manifestu decyzji") { |value| options[:manifest] = value }
end
parser.parse!
input_directory = ARGV.shift
output_file = ARGV.shift
abort parser.to_s unless input_directory && output_file && ARGV.empty?

def verify_complete_archive!(input_directory)
  archive_manifest_path = File.join(input_directory, ".archive-manifest.json")
  raise "Brak kompletnego archiwum: #{archive_manifest_path}." unless File.file?(archive_manifest_path)

  archive = JSON.parse(File.read(archive_manifest_path, encoding: "UTF-8"))
  volume = File.basename(File.expand_path(input_directory))
  raise "Manifest archiwum należy do #{archive['volume']}, a nie #{volume}." unless archive["volume"] == volume

  html_pages = Dir.glob(File.join(input_directory, "[0-9][0-9][0-9].html")).sort
  entries = archive["entries"].is_a?(Array) ? archive["entries"] : []
  known = entries.each_with_object({}) { |entry, result| result[entry["localFile"]] = entry }
  incomplete = html_pages.map { |path| File.basename(path) }.select do |page|
    entry = known[page]
    stem = File.basename(page, ".html")
    !entry || entry["status"] != "complete" || entry.dig("scroll", "stabilized") != true ||
      !File.file?(File.join(input_directory, page)) || !Dir.exist?(File.join(input_directory, "#{stem}_files"))
  end
  missing_html = known.keys.grep(/\A\d{3}\.html\z/).reject { |page| File.file?(File.join(input_directory, page)) }
  problems = incomplete + missing_html
  raise "Archiwum jest niekompletne: #{problems.uniq.sort.join(', ')}" unless problems.empty?
  raise "Archiwum nie zawiera 000.html ani stron treści." if html_pages.length < 2
end

def run_command!(*command)
  stdout, stderr, status = Open3.capture3(*command)
  $stdout.write(stdout)
  $stderr.write(stderr)
  raise "Polecenie zakończyło się kodem #{status.exitstatus}: #{command.join(' ')}" unless status.success?
end

begin
  verify_complete_archive!(input_directory)
  volume = File.basename(File.expand_path(input_directory))
  manifest_path = options[:manifest] || File.join("metadata", "image-selections", "#{volume}.json")
  ImageSelections.write_manifest(input_directory, manifest_path)
  manifest = ImageSelections.load_manifest(manifest_path)
  entries = ImageSelections.validate_manifest!(manifest, input_directory)
  includes = entries.select { |entry| entry["decision"] == "include" }
  uncertain = entries.select { |entry| entry["decision"] == "uncertain" }

  generator = File.expand_path("html_volume_to_markdown.rb", __dir__)
  generator_arguments = includes.map do |entry|
    "--include-image=#{entry['id']}=#{entry['assetName']}"
  end
  run_command!(RbConfig.ruby, generator, *generator_arguments, input_directory, output_file)

  verifier = File.expand_path("verify_volume_markdown.rb", __dir__)
  run_command!(RbConfig.ruby, verifier, "--image-selections=#{manifest_path}", input_directory, output_file)

  puts "Konwersja zakończona: include=#{includes.length}, uncertain=#{uncertain.length}."
  uncertain.each { |entry| puts "UNCERTAIN #{entry['id']}: #{entry['reason']}" }
rescue JSON::ParserError => error
  abort "BŁĄD: Niepoprawny manifest archiwum: #{error.message}"
rescue StandardError => error
  abort "BŁĄD: #{error.message}"
end
