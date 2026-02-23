# trigger-dev-rails

Rails runtime and build extension for [Trigger.dev](https://trigger.dev).

## Overview

This package provides a `rubyExtension` build extension and a `ruby.runRailsScript()` helper function that enable running Ruby scripts from within Trigger.dev tasks.

- **Install Ruby:** Automatically installs Ruby in the container during the build process via source compilation.
- **Rails integration:** Runs Ruby scripts with full Rails environment context using `rails runner`.
- **OpenTelemetry tracing:** Full tracing and context propagation for observability.
- **Event streaming:** Ruby scripts can send structured events back to the task — heartbeats, waits, logs, and metadata updates.
- **Task triggering:** Trigger Trigger.dev tasks from Ruby using HTTParty integration.
- **Gem support:** Include and install gems via Gemfile during the build process.
- **Version manager support:** Automatic RVM/rbenv detection and setup for development environments.
- **Custom Ruby path:** In development, configure `devRubyBinaryPath` to point to a specific Ruby installation.

## Installation

```bash
npm install trigger-dev-rails
# or
pnpm add trigger-dev-rails
```

## Setup

Add the extension to your `trigger.config.ts` file:

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";
import { rubyExtension } from "trigger-dev-rails/extension";

export default defineConfig({
  project: "<project ref>",
  build: {
    extensions: [
      rubyExtension({
        rubyVersion: "3.2.8",                // Optional: specific Ruby version to install (default: 3.2.8)
        devRubyBinaryPath: "/usr/bin/ruby", // Optional: custom Ruby binary path for dev
        files: ["src/ruby/**/*.rb"],         // Optional: glob patterns for Ruby scripts to include
        gemFile: "Gemfile",                  // Optional: path to Gemfile for gem dependencies
        scripts: ["bundle install"],         // Optional: custom build scripts to run
      }),
    ],
  },
});
```

## Usage

### Running a Rails Runner Script

For Rails applications, use `runRailsScript` to execute scripts with `rails runner`:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { ruby } from "trigger-dev-rails";

export const myRailsTask = task({
  id: "my-rails-task",
  run: async () => {
    // Runs: bundle exec rails runner src/ruby/rails_script.rb arg1 arg2
    const result = await ruby.runRailsScript({
      scriptPath: "src/ruby/rails_script.rb",
      scriptArgs: ["arg1", "arg2"],
      options: { cwd: process.cwd() },
    });
    return result.stdout;
  },
});
```

The method automatically detects `bin/rails` (preferred) or falls back to `rails` command. You can override this with the `RAILS_BIN_PATH` environment variable.

### Streaming Events from Ruby (heartbeats, waits, logs, metadata)

Ruby scripts can communicate back to the Trigger.dev task by requiring the bundled `trigger_dev.rb` helper. Copy it into your project next to your scripts (it is also published at `src/ruby/trigger_dev.rb` inside this package).

```ruby
# my_script.rb
require_relative "trigger_dev"

10_000.times do |i|
  TriggerDev.heartbeat             # keep the task alive during heavy loops
  TriggerDev.log("processing row", index: i)
  do_heavy_work(i)
end

TriggerDev.set_metadata("progress", 1.0)
TriggerDev.wait_for(seconds: 30)  # pause the task for 30 s, then continue
TriggerDev.append_metadata("log", "done")

puts "finished"
```

#### Example Available helper methods

| Ruby method                                              | Trigger.dev SDK equivalent    |
|----------------------------------------------------------|-------------------------------|
| `TriggerDev.heartbeat`                                   | `heartbeats.yield()`          |
| `TriggerDev.log(message, **attrs)`                       | `logger.log()`                |
| `TriggerDev.wait_for(seconds:, minutes:, hours:, days:, weeks:, months:, years:)` | `wait.for()`                  |
| `TriggerDev.wait_until(time_object)`                     | `wait.until()`                |
| `TriggerDev.set_metadata(key, value)`                    | `metadata.set()`              |
| `TriggerDev.append_metadata(key, value)`                 | `metadata.append()`           |
| `TriggerDev.trigger(task_id, payload, **options)`        | `tasks.trigger()`             |

> **Note on `wait_for` / `wait_until`:** For durations longer than 5 seconds, Trigger.dev checkpoints the task (suspends and restores it later). The Ruby process is suspended during that window and resumes automatically when the task is restored.

### Triggering Tasks from Ruby

The `trigger_dev.rb` helper also provides a `trigger` method to trigger other Trigger.dev tasks from your Ruby scripts. This requires the `httparty` gem.

#### Installation

```bash
gem install httparty
```

#### Configuration

Set your Trigger.dev API key via environment variable or programmatically:

```ruby
# Option 1: Environment variable
# export TRIGGER_API_KEY="tr_dev_xxxxx"

# Option 2: Configure programmatically
TriggerDev.configure(
  api_key: "tr_dev_xxxxx",
  api_url: "https://api.trigger.dev"  # Optional, defaults to https://api.trigger.dev
)
```

#### Basic Usage

```ruby
require_relative "trigger_dev"

# Configure API credentials
TriggerDev.configure(api_key: ENV["TRIGGER_API_KEY"])

# Trigger a task
result = TriggerDev.trigger(
  "my-task-id",
  { user_id: 123, action: "process" }
)

puts "Run ID: #{result['id']}"
```

#### Advanced Options

```ruby
result = TriggerDev.trigger(
  "email-task",
  { to: "user@example.com", subject: "Hello" },
  idempotency_key: "email-#{user_id}-#{Time.now.to_i}",
  delay_in_seconds: 60,                    # Delay execution by 60 seconds
  ttl: 3600,                               # Time-to-live: 1 hour
  tags: { environment: "production" },
  concurrency_key: "user-#{user_id}",
  batch_id: "batch-2024-01"
)
```

Available options:

- `idempotency_key`: Unique key to prevent duplicate runs
- `delay_in_seconds`: Delay before executing (in seconds)
- `delay_until`: Delay until a specific time (Ruby Time object)
- `ttl`: Time-to-live in seconds
- `tags`: Hash of key-value tags for organization
- `concurrency_key`: Key for controlling concurrent execution
- `batch_id`: Identifier for batch grouping

## API

### `ruby.runRailsScript({ scriptPath, scriptArgs?, options })`

Executes a Ruby script using `rails runner`, providing full Rails environment context.

This method runs the specified Ruby script via `bundle exec rails runner`, providing access to the complete Rails application environment. It handles:
- **OpenTelemetry tracing** - Full tracing and context propagation for observability
- **Streaming event processing** - Processes heartbeats, waits, logs, and metadata updates from Ruby
- **Error handling** - Proper exit code validation and error reporting
- **Version manager support** - RVM/rbenv detection and setup for development environments

**Parameters:**

| Parameter    | Type                 | Description                                        |
|--------------|----------------------|----------------------------------------------------|
| `scriptPath` | `string`             | Path to the `.rb` file to execute. Must exist.     |
| `scriptArgs` | `string[]`           | Optional arguments passed to the script.           |
| `options`    | `RubyExecOptions`    | Execution options with `env` and `cwd` properties. |

**RubyExecOptions:**
- `env`: Record<string, string | undefined> - Environment variables
- `cwd`: string - Working directory for script execution

**Returns:** `Promise<RubyScriptResult>` with `{ stdout, stderr, exitCode }`.

**Throws:**
- Error if the script path is not provided
- Error if the script exits with a non-zero exit code

Executes via `bundle exec rails runner`. Automatically detects `bin/rails` or falls back to `rails` command. Override with `RAILS_BIN_PATH` environment variable.

### `rubyExtension(options?)`

Build extension that installs Ruby in the container by compiling from source.

| Option              | Type       | Description                                                                              |
|---------------------|------------|------------------------------------------------------                                     |
| `devRubyBinaryPath` | `string`   | Path to the Ruby binary used in development. Defaults to `/usr/bin/ruby`.                |
| `rubyVersion`       | `string`   | Ruby version to install (e.g. `"3.2.8"`, `"3.1.4"`). Compiled from source. Defaults to `"3.2.8"`. |
| `files`             | `string[]` | Glob patterns for Ruby files to copy into the container during build.                     |
| `gemFile`           | `string`   | Path to a Gemfile to include in the build. Runs `bundle install` if provided.           |
| `scripts`           | `string[]` | Custom shell commands to run during the build process.                                   |

## Environment Variables

| Variable            | Description                                           | Default                   |
|---------------------|-------------------------------------------------------|---------------------------|
| `RUBY_BIN_PATH`     | Path to the Ruby binary used at runtime.              | `/usr/bin/ruby`           |
| `RAILS_BIN_PATH`    | Path to the Rails binary for `runRailsScript`.        | `bin/rails` or `rails`    |
| `TRIGGER_API_KEY`   | Your Trigger.dev API key for triggering tasks.        | (none)                    |
| `TRIGGER_API_URL`   | Trigger.dev API URL.                                  | `https://api.trigger.dev` |

## Limitations

- Only `runRailsScript` is currently supported. Direct Ruby script execution without Rails is not yet implemented.
- This is a partial implementation and does not provide full Ruby support as an execution runtime for tasks.
- Task triggering from Ruby requires the `httparty` gem to be installed separately.
- Ruby is compiled from source during the build, which may increase build times.

## Architecture

The extension is built with a modular architecture for maintainability and testability:

- **Environment setup** - Constructs OpenTelemetry context and environment variables
- **Shell command building** - Safely escapes arguments and builds shell commands
- **Version manager detection** - Automatically detects and configures RVM/rbenv
- **Event processing** - Streams and processes trigger events from Ruby scripts
- **Error handling** - Validates exit codes and provides detailed error messages

All helper functions are well-documented and can be easily extended for future enhancements.

## Author

Created by [banphlet](https://github.com/banphlet)

## License

MIT

