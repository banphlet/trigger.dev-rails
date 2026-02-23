# @trigger.dev/ruby

Ruby runtime and build extension for [Trigger.dev](https://trigger.dev).

## Overview

This package provides a `rubyExtension` build extension and a `ruby.runScript` helper function that enable running Ruby scripts from within Trigger.dev tasks.

- **Install Ruby:** Automatically installs Ruby in the container during the build process.
- **Script execution:** Runs `.rb` script files with proper OpenTelemetry propagation.
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

## API

### `ruby.runScript(scriptPath, scriptArgs?, options?)`

Executes a Ruby script file.

| Parameter    | Type                 | Description                                        |
|--------------|----------------------|----------------------------------------------------|
| `scriptPath` | `string`             | Path to the `.rb` file to execute. Must exist.     |
| `scriptArgs` | `string[]`           | Optional arguments passed to the script.           |
| `options`    | `RubyExecOptions`    | Optional execution options (env vars, etc.).       |

Returns a `Promise<Result>` where `Result` has `stdout`, `stderr`, and `exitCode`.

Throws an error if the script exits with a non-zero exit code.

### `rubyExtension(options?)`

Build extension that installs Ruby in the container.

| Option              | Type       | Description                                                    |
|---------------------|------------|----------------------------------------------------------------|
| `devRubyBinaryPath` | `string`   | Path to the Ruby binary used in development.                   |
| `scripts`           | `string[]` | Glob patterns for Ruby scripts to copy into the container.     |

## Environment Variables

| Variable        | Description                                         | Default  |
|-----------------|-----------------------------------------------------|----------|
| `RUBY_BIN_PATH` | Path to the Ruby binary used at runtime.            | `"ruby"` |

## Limitations

- Only `runScript` is supported. Inline script execution and lower-level command running are not provided.
- This is a partial implementation and does not provide full Ruby support as an execution runtime for tasks.
