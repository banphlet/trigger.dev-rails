import { SemanticInternalAttributes, taskContext } from "@trigger.dev/core/v3";
import { logger, heartbeats, wait, metadata } from "@trigger.dev/sdk/v3";
import { carrierFromContext } from "@trigger.dev/core/v3/otel";
import assert from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export type RubyExecOptions = {
  env?: { [key: string]: string | undefined };
  cwd: string;
};

export type RubyScriptResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Prefix used by trigger_dev.rb to write structured events to stdout.
 * Lines with this prefix are intercepted by runScript and never appear in result.stdout.
 */
export const TRIGGER_EVENT_PREFIX = "__TRIGGER_EVENT__:";

type TriggerEvent =
  | { type: "heartbeat" }
  | {
      type: "wait.for";
      seconds?: number;
      minutes?: number;
      hours?: number;
      days?: number;
      weeks?: number;
      months?: number;
      years?: number;
    }
  | { type: "wait.until"; date: string }
  | { type: "log"; message: string; [key: string]: unknown }
  | { type: "metadata.set"; key: string; value: unknown }
  | { type: "metadata.append"; key: string; value: unknown };

async function handleTriggerEvent(event: TriggerEvent): Promise<boolean> {
  switch (event.type) {
    case "heartbeat":
      await heartbeats.yield();
      return false;
    case "wait.for": {
      const { type, ...waitOpts } = event;
      await wait.for(waitOpts as Parameters<typeof wait.for>[0]);
      return true;
    }
    case "wait.until":
      await wait.until({ date: new Date(event.date) });
      return true;
    case "log": {
      const { type, message, ...attrs } = event;
      logger.log(message, Object.keys(attrs).length ? attrs : undefined);
      return false;
    }
    case "metadata.set":
      metadata.set(event.key, event.value as never);
      return false;
    case "metadata.append":
      metadata.append(event.key, event.value as never);
      return false;
    default:
      return false;
  }
}

export const ruby = {
  /**
   * Execute a Ruby script using `rails runner` with full Rails environment context.
   *
   * This method runs the specified Ruby script via `bundle exec rails runner`,
   * providing access to the complete Rails application environment. It handles:
   * - OpenTelemetry tracing and context propagation
   * - Streaming event processing from Ruby (heartbeats, waits, logs, metadata)
   * - Proper error handling and exit code validation
   * - RVM/rbenv version manager support for development environments
   *
   * @param params - Configuration object for the Rails script execution
   * @param params.scriptPath - Path to the Ruby script file to execute (required)
   * @param params.scriptArgs - Optional array of command-line arguments to pass to the script
   * @param params.options - Execution options including environment variables and working directory
   * @param params.options.cwd - Working directory for script execution
   * @param params.options.env - Optional environment variables to pass to the script
   *
   * @returns Promise resolving to RubyScriptResult containing stdout, stderr, and exitCode
   *
   * @throws Error if the script path is not provided
   * @throws Error if the script exits with a non-zero exit code
   *
   * @example
   * ```typescript
   * const result = await ruby.runRailsScript({
   *   scriptPath: "src/ruby/process_users.rb",
   *   scriptArgs: ["--limit", "100"],
   *   options: { cwd: process.cwd() }
   * });
   * console.log(result.stdout);
   * ```
   */
  async runRailsScript({
    scriptArgs = [],
    scriptPath,
    options,
  }: {
    scriptPath: string;
    scriptArgs?: string[];
    options: RubyExecOptions;
  }): Promise<RubyScriptResult> {
    assert(scriptPath, "Script path is required");

    const commandArgs = ["exec", "rails", "runner", scriptPath, ...scriptArgs];
    const binPath = "bundle";

    return await logger.trace(
      "ruby.runRailsScript()",
      async (span) => {
        span.setAttribute("scriptPath", scriptPath);

        const carrier = carrierFromContext();
        const envVars = buildEnvironmentVariables(options, carrier);
        const exportStatements = buildExportStatements(envVars);
        const escapedArgs = escapeShellArguments(commandArgs);
        const shellCommand = buildShellCommand(
          binPath,
          escapedArgs,
          exportStatements,
          options.cwd,
        );

        return new Promise<RubyScriptResult>((resolve, reject) => {
          const shellPath = process.env.SHELL || "/bin/bash";
          const proc = spawn(shellCommand, {
            stdio: ["pipe", "pipe", "pipe"],
            shell: shellPath,
          });

          const stdoutLines: string[] = [];
          const stderrChunks: string[] = [];
          let eventChain: Promise<void> = Promise.resolve();

          const rl = createInterface({
            input: proc.stdout!,
            crlfDelay: Infinity,
          });

          rl.on("line", (line) => {
            eventChain = processEventLine(line, stdoutLines, eventChain, proc).then(
              (chain) => chain,
            );
          });

          proc.stderr!.on("data", (chunk: Buffer) => {
            stderrChunks.push(chunk.toString());
          });

          proc.on("error", reject);

          proc.on("close", async (code) => {
            try {
              const result = await handleProcessClose(
                code,
                eventChain,
                stdoutLines,
                stderrChunks,
                scriptPath,
              );
              span.setAttribute("exitCode", result.exitCode);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      },
      {
        attributes: {
          binPath,
          scriptPath,
          args: commandArgs.join(" "),
          [SemanticInternalAttributes.STYLE_ICON]: "ruby",
        },
      },
    );
  },
};

/**
 * Build environment variables for the Ruby process, including OpenTelemetry context.
 */
function buildEnvironmentVariables(
  options: RubyExecOptions,
  carrier: Record<string, string>,
): Record<string, string> {
  const otelResourceAttributes = `${
    SemanticInternalAttributes.EXECUTION_ENVIRONMENT
  }=trigger,${Object.entries(taskContext.attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join(",")}`;

  return {
    ...options.env,
    TRACEPARENT: carrier["traceparent"],
    OTEL_RESOURCE_ATTRIBUTES: otelResourceAttributes,
    OTEL_LOG_LEVEL: "DEBUG",
  };
}

/**
 * Convert environment variables into shell export statements.
 */
function buildExportStatements(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `export ${key}="${value?.replace(/"/g, '\\"')}"`)
    .join("; ");
}

/**
 * Escape shell arguments for safe command execution.
 */
function escapeShellArguments(args: string[]): string {
  return args
    .map((arg) => {
      const needsEscaping =
        arg.includes(" ") ||
        arg.includes("&") ||
        arg.includes(";") ||
        arg.includes("$");

      return needsEscaping ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
    })
    .join(" ");
}

/**
 * Build Ruby version manager setup command (RVM or rbenv).
 */
function buildRubySetupCommand(): string {
  const homeDir = process.env.HOME || "~";
  const rvmScript = `${homeDir}/.rvm/scripts/rvm`;
  const rbenvInit = `${homeDir}/.rbenv/bin/rbenv`;

  return `if [ -f "${rvmScript}" ]; then source "${rvmScript}" 2>/dev/null; elif [ -f "${rbenvInit}" ]; then export PATH="${homeDir}/.rbenv/bin:$PATH"; eval "$(rbenv init - 2>/dev/null)"; fi`;
}

/**
 * Build the complete shell command to execute.
 */
function buildShellCommand(
  binPath: string,
  escapedArgs: string,
  exportStatements: string,
  cwd: string,
): string {
  const rubySetup = buildRubySetupCommand();
  return `${rubySetup}; cd "${cwd}"; ${exportStatements}; ${binPath} ${escapedArgs}`;
}

/**
 * Send acknowledgment to the Ruby process via stdin.
 */
function sendAcknowledgment(proc: ChildProcess): void {
  if (proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.write("__ACK__\n");
  }
}

/**
 * Process a line from stdout, handling trigger events or regular output.
 */
async function processEventLine(
  line: string,
  stdoutLines: string[],
  eventChain: Promise<void>,
  proc: ChildProcess,
): Promise<Promise<void>> {
  if (!line.startsWith(TRIGGER_EVENT_PREFIX)) {
    stdoutLines.push(line);
    return eventChain;
  }

  try {
    const eventJson = line.slice(TRIGGER_EVENT_PREFIX.length);
    const event: TriggerEvent = JSON.parse(eventJson);

    return eventChain.then(async () => {
      try {
        const needsAck = await handleTriggerEvent(event);
        if (needsAck) {
          sendAcknowledgment(proc);
        }
      } catch (err) {
        logger.error("Error handling Ruby trigger event", {
          error: String(err),
        });
        // Always send ACK to unblock the Ruby process
        sendAcknowledgment(proc);
      }
    });
  } catch {
    // Malformed event line – treat as plain output
    stdoutLines.push(line);
    return eventChain;
  }
}

/**
 * Handle process close event and return the result.
 */
async function handleProcessClose(
  code: number | null,
  eventChain: Promise<void>,
  stdoutLines: string[],
  stderrChunks: string[],
  scriptPath: string,
): Promise<RubyScriptResult> {
  // Wait for all in-flight events to finish
  await eventChain;

  const exitCode = code ?? -1;
  const stdout = stdoutLines.join("\n");
  const stderr = stderrChunks.join("");

  if (exitCode !== 0) {
    const reason =
      exitCode === -1
        ? `${scriptPath} was terminated by a signal`
        : `${scriptPath} exited with a non-zero code ${exitCode}`;
    throw new Error(`${reason}:\n${stdout}\n${stderr}`);
  }

  return { stdout, stderr, exitCode };
}
