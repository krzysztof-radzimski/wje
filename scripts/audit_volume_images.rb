#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "optparse"
require_relative "lib/image_selections"

options = {}
parser = OptionParser.new do |cli|
  cli.banner = "Użycie: ruby scripts/audit_volume_images.rb [--manifest=PATH] HTML/VOLUMENN"
  cli.on("--manifest=PATH", "Jawna ścieżka manifestu decyzji") { |value| options[:manifest] = value }
end
parser.parse!
input_directory = ARGV.shift
abort parser.to_s unless input_directory && ARGV.empty?

volume = File.basename(File.expand_path(input_directory))
manifest_path = options[:manifest] || File.join("metadata", "image-selections", "#{volume}.json")
manifest = ImageSelections.write_manifest(input_directory, manifest_path)
counts = manifest["entries"].group_by { |entry| entry["decision"] }.transform_values(&:length)
puts "Zapisano #{manifest_path}: #{manifest['entries'].length} kandydatów (#{ImageSelections::DECISIONS.map { |decision| "#{decision}=#{counts.fetch(decision, 0)}" }.join(', ')})."
manifest["entries"].select { |entry| entry["decision"] == "uncertain" }.each do |entry|
  puts "UNCERTAIN #{entry['id']}: #{entry['reason']}"
end
