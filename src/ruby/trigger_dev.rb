# frozen_string_literal: true
# trigger_dev.rb – Ruby helper for streaming events back to a Trigger.dev task.
#
# Drop this file next to your Ruby script (or in a shared lib directory) and
# require it at the top of every script you run with `ruby.runScript`.
#
# Usage:
#
#   require_relative "trigger_dev"
#
#   1000.times do |i|
#     TriggerDev.heartbeat           # keep the task alive
#     TriggerDev.log("processing", index: i)
#     heavy_work(i)
#   end
#
#   TriggerDev.set_metadata("progress", 1.0)
#   TriggerDev.wait_for(seconds: 30)   # pause the task for 30 s, then continue
#
# Event types and their Node.js SDK equivalents:
#
#   heartbeat               -> heartbeats.yield()
#   log                     -> logger.log()
#   wait_for                -> wait.for()
#   wait_until              -> wait.until()
#   set_metadata            -> metadata.set()
#   append_metadata         -> metadata.append()

require "json"
require "time"

module TriggerDev
  # Must match TRIGGER_EVENT_PREFIX in src/index.ts
  EVENT_PREFIX = "__TRIGGER_EVENT__:"

  # Emit a structured event to stdout.
  # @param event [Hash] the event payload (must include a :type key)
  # @param wait_for_ack [Boolean] when true, block until the Node.js host
  #   sends "__ACK__\n" on stdin. Use this for blocking operations like waits.
  def self.emit_event(event, wait_for_ack: false)
    $stdout.puts("#{EVENT_PREFIX}#{JSON.generate(event)}")
    $stdout.flush
    $stdin.gets if wait_for_ack
  end
  private_class_method :emit_event

  # Send a heartbeat to keep the task alive.
  # Call this regularly inside CPU-heavy loops to prevent the run from being
  # marked as stalled by the Trigger.dev runtime.
  def self.heartbeat
    emit_event({ type: "heartbeat" })
  end

  # Pause the task for a given duration, then resume execution.
  # Supports the same time units as Trigger.dev's wait.for().
  #
  # @param seconds  [Integer, nil]
  # @param minutes  [Integer, nil]
  # @param hours    [Integer, nil]
  # @param days     [Integer, nil]
  # @param weeks    [Integer, nil]
  # @param months   [Integer, nil]
  # @param years    [Integer, nil]
  #
  # Note: durations longer than 5 seconds cause Trigger.dev to checkpoint
  # the task. The Ruby process will be suspended during that time and will
  # resume automatically once the checkpoint is restored.
  def self.wait_for(seconds: nil, minutes: nil, hours: nil, days: nil, weeks: nil, months: nil, years: nil)
    opts = { type: "wait.for" }
    opts[:seconds] = seconds if seconds
    opts[:minutes] = minutes if minutes
    opts[:hours]   = hours   if hours
    opts[:days]    = days    if days
    opts[:weeks]   = weeks   if weeks
    opts[:months]  = months  if months
    opts[:years]   = years   if years
    emit_event(opts, wait_for_ack: true)
  end

  # Pause the task until a specific point in time, then resume execution.
  # @param time [Time] the point in time to wait until
  def self.wait_until(time)
    emit_event({ type: "wait.until", date: time.iso8601 }, wait_for_ack: true)
  end

  # Emit a structured log message visible in the Trigger.dev dashboard.
  # @param message [String] the log message
  # @param attrs   [Hash]   optional key/value attributes attached to the log entry
  def self.log(message, **attrs)
    emit_event({ type: "log", message: message }.merge(attrs))
  end

  # Set a key in the run's metadata.
  # @param key   [String] metadata key
  # @param value metadata value (must be JSON-serialisable)
  def self.set_metadata(key, value)
    emit_event({ type: "metadata.set", key: key, value: value })
  end

  # Append a value to an array stored under a metadata key.
  # @param key   [String] metadata key
  # @param value the value to append (must be JSON-serialisable)
  def self.append_metadata(key, value)
    emit_event({ type: "metadata.append", key: key, value: value })
  end
end
