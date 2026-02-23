
# This is an example Ruby client for emitting events from a trigger.dev task. It provides a simple API for sending heartbeats, logs, metadata updates, and wait instructions to the Node.js host process via stdout. It also includes a helper method for triggering other tasks via the trigger.dev API.
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
require "httparty"


module TriggerDev
  # Custom error class for trigger.dev-specific errors
  class Error < StandardError; end

  class ConfigurationError < Error; end
  class APIError < Error; end

  # Must match TRIGGER_EVENT_PREFIX in src/index.ts
  EVENT_PREFIX = "__TRIGGER_EVENT__:"

  # Configuration for API access
  @api_key = nil
  @api_url = "https://api.trigger.dev"

  class << self
    attr_accessor :api_key, :api_url
  end

  # Configure the trigger.dev client
  # @param api_key [String] Your trigger.dev API key (or set TRIGGER_API_KEY env var)
  # @param api_url [String] The trigger.dev API URL (defaults to https://api.trigger.dev)
  def self.configure(api_key: nil, api_url: nil)
    @api_key = api_key || ENV["TRIGGER_API_KEY"]
    @api_url = api_url || ENV["TRIGGER_API_URL"] || "https://api.trigger.dev"
  end

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
  def self.trigger(task_id, payload = {}, **options)
    unless defined?(HTTParty)
      raise Error, "HTTParty gem is required to trigger tasks. Install it with: gem install httparty"
    end

    api_key = @api_key || ENV["TRIGGER_API_KEY"]
    raise ConfigurationError, "API key not configured. Set TRIGGER_API_KEY env var or call TriggerDev.configure" unless api_key

    api_url = @api_url || ENV["TRIGGER_API_URL"] || "https://api.trigger.dev"
    endpoint = "#{api_url}/api/v1/tasks/#{task_id}/trigger"

    headers = {
      "Content-Type" => "application/json",
      "Authorization" => "Bearer #{api_key}"
    }

    body = { payload: payload }
    body[:idempotencyKey] = options[:idempotency_key] if options[:idempotency_key]
    body[:options] = {}
    body[:options][:delay] = { seconds: options[:delay_in_seconds] } if options[:delay_in_seconds]
    body[:options][:delay] = { until: options[:delay_until].iso8601 } if options[:delay_until]
    body[:options][:ttl] = options[:ttl] if options[:ttl]
    body[:options][:tags] = options[:tags] if options[:tags]
    body[:options][:concurrencyKey] = options[:concurrency_key] if options[:concurrency_key]
    body[:options][:batchId] = options[:batch_id] if options[:batch_id]
    body.delete(:options) if body[:options].empty?

    response = HTTParty.post(
      endpoint,
      headers: headers,
      body: JSON.generate(body),
      timeout: 30
    )

    unless response.success?
      error_message = begin
        parsed = JSON.parse(response.body)
        parsed["error"] || parsed["message"] || response.message
      rescue JSON::ParserError
        response.message
      end
      raise APIError, "Failed to trigger task '#{task_id}': #{response.code} - #{error_message}"
    end

    JSON.parse(response.body)
  rescue HTTParty::Error => e
    raise APIError, "HTTP error while triggering task '#{task_id}': #{e.message}"
  end
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
