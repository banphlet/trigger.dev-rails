# This is an example Rails client for emitting events from a trigger.dev task. It provides a simple API for sending heartbeats, logs, metadata updates, and wait instructions to the Node.js host process via stdout. It also includes a helper method for triggering other tasks via the trigger.dev API.

# frozen_string_literal: true
# trigger_dev.rb – Ruby helper for streaming events back to a Trigger.dev task.
#
# Drop this file next to your Ruby script (or in a shared lib directory) and
# require it at the top of every script you run with `ruby.runScript`.
#
# Usage:
#
# In Rails, configure once in an initializer:
#   TriggerDev.configure(api_key: ENV['TRIGGER_API_KEY'])
#
# Then use anywhere in your app:
#   TriggerDev.log("processing order", order_id: 123)
#   TriggerDev.heartbeat
#   TriggerDev.set_metadata("progress", 1.0)
#
# Or create a standalone instance:
#   trigger_dev = TriggerDev.new
#   trigger_dev.log("processing", index: i)
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
require "httparty"
require_relative "api_errors"

class TriggerDev
  # Must match TRIGGER_EVENT_PREFIX in @trigger.dev/ruby/src/index.ts
  EVENT_PREFIX = "__TRIGGER_EVENT__:"

  attr_reader :api_key, :api_url

  # Class-level instance for singleton pattern
  @instance = nil

  class << self
    # Configure and set the shared instance
    # @param api_key [String] Your trigger.dev API key
    # @param api_url [String] The trigger.dev API URL
    def configure(api_key: nil, api_url: nil)
      @instance = new(api_key: api_key, api_url: api_url, skip_validation: true)
    end

    # Get the shared instance
    def instance
      @instance ||= new(skip_validation: true)
    end

    # Delegate class methods to the shared instance
    def log(message, **attrs)
      instance.log(message, **attrs)
    end

    def heartbeat
      instance.heartbeat
    end

    def wait_for(**options)
      instance.wait_for(**options)
    end

    def wait_until(time)
      instance.wait_until(time)
    end

    def set_metadata(key, value)
      instance.set_metadata(key, value)
    end

    def append_metadata(key, value)
      instance.append_metadata(key, value)
    end

    def trigger(task_id, payload = {}, **options)
      instance.trigger(task_id, payload, **options)
    end
  end

  # Configure the trigger.dev client
  # @param api_key [String] Your trigger.dev API key (or set TRIGGER_API_KEY env var)
  # @param api_url [String] The trigger.dev API URL (defaults to https://api.trigger.dev)
  # @param skip_validation [Boolean] Skip API key validation (for lazy initialization)
  def initialize(api_key: nil, api_url: nil, skip_validation: false)
    @api_key = api_key || ENV["TRIGGER_API_KEY"]
    @api_url = api_url || ENV["TRIGGER_API_URL"] || "https://api.trigger.dev"

    unless skip_validation || @api_key
      raise ApiErrors::ValidationInvalid.new "API key is required. Set TRIGGER_API_KEY env var or pass api_key to initialize."
    end
  end

  # Emit a structured log message visible in the Trigger.dev dashboard.
  # @param message [String] the log message
  # @param attrs   [Hash]   optional key/value attributes attached to the log entry
  def log(message, **attrs)
    emit_event({ type: "log", message: message }.merge(attrs))
  end

  # Trigger a task asynchronously via the trigger.dev API.
  # Requires HTTParty gem to be installed and API credentials configured.
  #
  # @param task_id [String] the task identifier (e.g., "my-task")
  # @param payload [Hash] the payload to send to the task (must be JSON-serialisable)
  # @param options [Hash] optional parameters
  # @option options [String] :idempotency_key optional idempotency key to prevent duplicate runs
  # @option options [Integer] :delay_in_seconds delay before executing the task
  # @option options [Time] :delay_until delay execution until this time
  # @option options [Integer] :ttl time-to-live in seconds for the task
  # @option options [Hash] :tags key-value tags for the task run
  # @option options [Integer] :concurrency_key concurrency key to limit parallel runs
  # @option options [String] :batch_id batch identifier for grouping runs
  #
  # @return [Hash] the API response containing run details
  # @raise [ConfigurationError] if API key is not configured
  # @raise [APIError] if the API request fails
  def trigger(task_id, payload = {}, **options)
    unless @api_key
      raise ApiErrors::TriggerDevConfigurationError,
            "API key not configured. Set TRIGGER_API_KEY env var or pass to initialize"
    end

    endpoint = "#{@api_url}/api/v1/tasks/#{task_id}/trigger"

    headers = {
      "Content-Type" => "application/json",
      "Authorization" => "Bearer #{@api_key}"
    }

    body = { payload: payload }
    body[:idempotencyKey] = options[:idempotency_key] if options[
      :idempotency_key
    ]
    body[:options] = {}
    body[:options][:delay] = { seconds: options[:delay_in_seconds] } if options[
      :delay_in_seconds
    ]
    body[:options][:delay] = {
      until: options[:delay_until].iso8601
    } if options[:delay_until]
    body[:options][:ttl] = options[:ttl] if options[:ttl]
    body[:options][:tags] = options[:tags] if options[:tags]
    body[:options][:concurrencyKey] = options[:concurrency_key] if options[
      :concurrency_key
    ]
    body[:options][:batchId] = options[:batch_id] if options[:batch_id]
    body.delete(:options) if body[:options].empty?

    response =
      HTTParty.post(
        endpoint,
        headers: headers,
        body: JSON.generate(body),
        timeout: 30
      )

    unless response.success?
      error_message =
        begin
          parsed = JSON.parse(response.body)
          parsed["error"] || parsed["message"] || response.message
        rescue JSON::ParserError
          response.message
        end
      raise ApiErrors::ValidationInvalid,
            "Failed to trigger task '#{task_id}': #{response.code} - #{error_message}"
    end

    JSON.parse(response.body)
  rescue HTTParty::Error => e
    raise ApiErrors::ValidationInvalid,
          "HTTP error while triggering task '#{task_id}': #{e.message}"
  end

  # Emit a structured event to stdout.
  # @param event [Hash] the event payload (must include a :type key)
  # @param wait_for_ack [Boolean] when true, block until the Node.js host
  #   sends "__ACK__\n" on stdin. Use this for blocking operations like waits.
  def emit_event(event, wait_for_ack: false)
    $stdout.puts("#{EVENT_PREFIX}#{JSON.generate(event)}")
    $stdout.flush
    $stdin.gets if wait_for_ack
  end

  # Send a heartbeat to keep the task alive.
  # Call this regularly inside CPU-heavy loops to prevent the run from being
  # marked as stalled by the Trigger.dev runtime.
  def heartbeat
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
  def wait_for(
    seconds: nil,
    minutes: nil,
    hours: nil,
    days: nil,
    weeks: nil,
    months: nil,
    years: nil
  )
    opts = { type: "wait.for" }
    opts[:seconds] = seconds if seconds
    opts[:minutes] = minutes if minutes
    opts[:hours] = hours if hours
    opts[:days] = days if days
    opts[:weeks] = weeks if weeks
    opts[:months] = months if months
    opts[:years] = years if years
    emit_event(opts, wait_for_ack: true)
  end

  # Pause the task until a specific point in time, then resume execution.
  # @param time [Time] the point in time to wait until
  def wait_until(time)
    emit_event({ type: "wait.until", date: time.iso8601 }, wait_for_ack: true)
  end

  # Set a key in the run's metadata.
  # @param key   [String] metadata key
  # @param value metadata value (must be JSON-serialisable)
  def set_metadata(key, value)
    emit_event({ type: "metadata.set", key: key, value: value })
  end

  # Append a value to an array stored under a metadata key.
  # @param key   [String] metadata key
  # @param value the value to append (must be JSON-serialisable)
  def append_metadata(key, value)
    emit_event({ type: "metadata.append", key: key, value: value })
  end
end
