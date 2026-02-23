# @trigger.dev/ruby

Ruby runtime and build extension for [Trigger.dev](https://trigger.dev).

## Overview

This package provides a `rubyExtension` build extension and a `ruby.runScript` helper function that enable running Ruby scripts from within Trigger.dev tasks.

- **Install Ruby:** Automatically installs Ruby in the container during the build process.
- **Script execution:** Runs `.rb` script files with proper OpenTelemetry propagation.
- **Event streaming:** Ruby scripts can send structured events back to the task — heartbeats, waits, logs, and metadata updates.
- **Custom Ruby path:** In development, configure `devRubyBinaryPath` to point to a specific Ruby installation.

## Installation

```bash
npm install @trigger.dev/ruby
# or
pnpm add @trigger.dev/ruby
```

## Setup

Add the extension to your `trigger.config.ts` file:

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";
import { rubyExtension } from "@trigger.dev/ruby/extension";

export default defineConfig({
  project: "<project ref>",
  build: {
    extensions: [
      rubyExtension({
        rubyVersion: "3.2",                // Optional: specific Ruby version to install
        devRubyBinaryPath: "/usr/bin/ruby", // Optional: custom Ruby binary path for dev
        scripts: ["src/ruby/**/*.rb"],       // Optional: glob patterns for Ruby scripts to include
      }),
    ],
  },
});
```

## Usage

### Running a Ruby Script

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { ruby } from "@trigger.dev/ruby";

export const myRubyTask = task({
  id: "my-ruby-task",
  run: async () => {
    const result = await ruby.runScript("src/ruby/my_script.rb", ["arg1", "arg2"]);
    return result.stdout;
  },
});
```

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

#### Available helper methods

| Ruby method                                              | Trigger.dev SDK equivalent    |
|----------------------------------------------------------|-------------------------------|
| `TriggerDev.heartbeat`                                   | `heartbeats.yield()`          |
| `TriggerDev.log(message, **attrs)`                       | `logger.log()`                |
| `TriggerDev.wait_for(seconds:, minutes:, hours:, days:, weeks:, months:, years:)` | `wait.for()`                  |
| `TriggerDev.wait_until(time_object)`                     | `wait.until()`                |
| `TriggerDev.set_metadata(key, value)`                    | `metadata.set()`              |
| `TriggerDev.append_metadata(key, value)`                 | `metadata.append()`           |

> **Note on `wait_for` / `wait_until`:** For durations longer than 5 seconds, Trigger.dev checkpoints the task (suspends and restores it later). The Ruby process is suspended during that window and resumes automatically when the task is restored.

## API

### `ruby.runScript(scriptPath, scriptArgs?, options?)`

Executes a Ruby script file and processes any Trigger.dev events emitted by the script.

| Parameter    | Type                 | Description                                        |
|--------------|----------------------|----------------------------------------------------|
| `scriptPath` | `string`             | Path to the `.rb` file to execute. Must exist.     |
| `scriptArgs` | `string[]`           | Optional arguments passed to the script.           |
| `options`    | `RubyExecOptions`    | Optional execution options (`env`, `cwd`).         |

Returns a `Promise<RubyScriptResult>` with `{ stdout, stderr, exitCode }`.

Throws an error if the script exits with a non-zero exit code.

### `rubyExtension(options?)`

Build extension that installs Ruby in the container.

| Option              | Type       | Description                                                                              |
|---------------------|------------|------------------------------------------------------------------------------------------|
| `devRubyBinaryPath` | `string`   | Path to the Ruby binary used in development. Defaults to `/usr/bin/ruby`.                |
| `rubyVersion`       | `string`   | Ruby version to install (e.g. `"3.2"`). Installs the `ruby<version>` apt package.       |
| `scripts`           | `string[]` | Glob patterns for Ruby scripts to copy into the container.                               |

## Environment Variables

| Variable        | Description                                           | Default           |
|-----------------|-------------------------------------------------------|-------------------|
| `RUBY_BIN_PATH` | Path to the Ruby binary used at runtime.              | `/usr/bin/ruby`   |

## Limitations

- Only `runScript` is supported. Inline script execution and lower-level command running are not provided.
- This is a partial implementation and does not provide full Ruby support as an execution runtime for tasks.

