import { SemanticInternalAttributes, taskContext } from "@trigger.dev/core/v3";
import { logger, heartbeats, wait, metadata } from "@trigger.dev/sdk/v3";
import { carrierFromContext } from "@trigger.dev/core/v3/otel";
import assert from "node:assert";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type RubyExecOptions = {
  env?: { [key: string]: string | undefined };
  cwd?: string;
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
  async runScript(
    scriptPath: string,
    scriptArgs: string[] = [],
    options: RubyExecOptions = {}
  ): Promise<RubyScriptResult> {
    assert(scriptPath, "Script path is required");
    assert(fs.existsSync(scriptPath), `Script does not exist: ${scriptPath}`);

    const rubyBin = process.env.RUBY_BIN_PATH || "ruby";

    return await _executeRubyCommand(
      "ruby.runScript()",
      [scriptPath, ...scriptArgs],
      rubyBin,
      scriptPath,
      options
    );
  },

  async runRailsScript(
    scriptPath: string,
    scriptArgs: string[] = [],
    options: RubyExecOptions = {}
  ): Promise<RubyScriptResult> {
    assert(scriptPath, "Script path is required");
    assert(fs.existsSync(scriptPath), `Script does not exist: ${scriptPath}`);

    // Try bin/rails first (common in Rails apps), then fall back to rails
    const railsBin = process.env.RAILS_BIN_PATH || 
      (fs.existsSync("bin/rails") ? "bin/rails" : "rails");

    return await _executeRubyCommand(
      "ruby.runRailsScript()",
      ["runner", scriptPath, ...scriptArgs],
      railsBin,
      scriptPath,
      options
    );
  },
};

async function _executeRubyCommand(
  traceName: string,
  commandArgs: string[],
  binPath: string,
  scriptPath: string,
  options: RubyExecOptions = {}
): Promise<RubyScriptResult> {
  return await logger.trace(
    traceName,
    async (span) => {
      span.setAttribute("scriptPath", scriptPath);

        const carrier = carrierFromContext();

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          ...options.env,
          TRACEPARENT: carrier["traceparent"],
          OTEL_RESOURCE_ATTRIBUTES: `${
            SemanticInternalAttributes.EXECUTION_ENVIRONMENT
          }=trigger,${Object.entries(taskContext.attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join(",")}`,
          OTEL_LOG_LEVEL: "DEBUG",
        };

        return new Promise<RubyScriptResult>((resolve, reject) => {
          const proc = spawn(binPath, commandArgs, {
            env,
            cwd: options.cwd,
            stdio: ["pipe", "pipe", "pipe"],
          });

          const stdoutLines: string[] = [];
          const stderrChunks: string[] = [];

          const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

          // Process events serially to preserve ordering and allow blocking waits
          let eventChain: Promise<void> = Promise.resolve();

          rl.on("line", (line) => {
            if (line.startsWith(TRIGGER_EVENT_PREFIX)) {
              try {
                const event: TriggerEvent = JSON.parse(
                  line.slice(TRIGGER_EVENT_PREFIX.length)
                );
                eventChain = eventChain.then(async () => {
                  try {
                    const needsAck = await handleTriggerEvent(event);
                    if (needsAck && proc.stdin && !proc.stdin.destroyed) {
                      proc.stdin.write("__ACK__\n");
                    }
                  } catch (err) {
                    logger.error("Error handling Ruby trigger event", {
                      error: String(err),
                    });
                    // Always send ACK to unblock the Ruby process
                    if (proc.stdin && !proc.stdin.destroyed) {
                      proc.stdin.write("__ACK__\n");
                    }
                  }
                });
              } catch {
                // Malformed event line – treat as plain output
                stdoutLines.push(line);
              }
            } else {
              stdoutLines.push(line);
            }
          });

          proc.stderr!.on("data", (chunk: Buffer) => {
            stderrChunks.push(chunk.toString());
          });

          proc.on("error", reject);

          proc.on("close", async (code) => {
            try {
              // Wait for all in-flight events to finish before resolving
              await eventChain;

              const exitCode = code ?? -1;
              const stdout = stdoutLines.join("\n");
              const stderr = stderrChunks.join("");

              span.setAttribute("exitCode", exitCode);

              if (exitCode !== 0) {
                const reason =
                  exitCode === -1
                    ? `${scriptPath} was terminated by a signal`
                    : `${scriptPath} exited with a non-zero code ${exitCode}`;
                reject(new Error(`${reason}:\n${stdout}\n${stderr}`));
                return;
              }

              resolve({ stdout, stderr, exitCode });
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
      }
    );
}
