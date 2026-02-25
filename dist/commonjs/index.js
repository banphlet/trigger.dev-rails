"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruby = exports.TRIGGER_EVENT_PREFIX = void 0;
const v3_1 = require("@trigger.dev/core/v3");
const v3_2 = require("@trigger.dev/sdk/v3");
const otel_1 = require("@trigger.dev/core/v3/otel");
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const node_readline_1 = require("node:readline");
/**
 * Prefix used by trigger_dev.rb to write structured events to stdout.
 * Lines with this prefix are intercepted by runScript and never appear in result.stdout.
 */
exports.TRIGGER_EVENT_PREFIX = "__TRIGGER_EVENT__:";
async function handleTriggerEvent(event) {
    switch (event.type) {
        case "heartbeat":
            await v3_2.heartbeats.yield();
            return false;
        case "wait.for": {
            const { type, ...waitOpts } = event;
            await v3_2.wait.for(waitOpts);
            return true;
        }
        case "wait.until":
            await v3_2.wait.until({ date: new Date(event.date) });
            return true;
        case "log": {
            const { type, message, ...attrs } = event;
            v3_2.logger.log(message, Object.keys(attrs).length ? attrs : undefined);
            return false;
        }
        case "log.error": {
            const { type, message, ...attrs } = event;
            v3_2.logger.error(message, Object.keys(attrs).length ? attrs : undefined);
            return false;
        }
        case "metadata.set":
            v3_2.metadata.set(event.key, event.value);
            return false;
        case "metadata.append":
            v3_2.metadata.append(event.key, event.value);
            return false;
        default:
            return false;
    }
}
exports.ruby = {
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
     * @param params.options.payload - Optional JSON payload passed as TRIGGER_PAYLOAD env var
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
     *   options: {
     *     cwd: process.cwd(),
     *     payload: { userId: 123, action: "process" }
     *   }
     * });
     * console.log(result.stdout);
     * ```
     *
     * @example Ruby script accessing payload:
     * ```ruby
     * require 'json'
     * payload = JSON.parse(ENV['TRIGGER_PAYLOAD'] || '{}')
     * user_id = payload['userId']
     * action = payload['action']
     * ```
     */
    async runRailsScript({ scriptArgs = [], scriptPath, options, }) {
        (0, node_assert_1.default)(scriptPath, "Script path is required");
        const commandArgs = ["exec", "rails", "runner", scriptPath, ...scriptArgs];
        const binPath = "bundle";
        return await v3_2.logger.trace("ruby.runRailsScript()", async (span) => {
            span.setAttribute("scriptPath", scriptPath);
            const carrier = (0, otel_1.carrierFromContext)();
            const envVars = buildEnvironmentVariables(options, carrier);
            const exportStatements = buildExportStatements(envVars);
            const escapedArgs = escapeShellArguments(commandArgs);
            const shellCommand = buildShellCommand(binPath, escapedArgs, exportStatements, options.cwd);
            return new Promise((resolve, reject) => {
                // Use bash/sh for better compatibility across systems
                const shellPath = process.env.SHELL?.includes("bash")
                    ? process.env.SHELL
                    : "/bin/bash";
                const proc = (0, node_child_process_1.spawn)(shellCommand, {
                    stdio: ["pipe", "pipe", "pipe"],
                    shell: shellPath,
                });
                const stdoutLines = [];
                const stderrChunks = [];
                let eventChain = Promise.resolve();
                const rl = (0, node_readline_1.createInterface)({
                    input: proc.stdout,
                    crlfDelay: Infinity,
                });
                rl.on("line", (line) => {
                    eventChain = processEventLine(line, stdoutLines, eventChain, proc).then((chain) => chain);
                });
                proc.stderr.on("data", (chunk) => {
                    const content = chunk.toString();
                    // Always write to terminal stderr for real-time visibility
                    process.stderr.write(content);
                    stderrChunks.push(content);
                });
                proc.on("error", reject);
                proc.on("close", async (code) => {
                    try {
                        const result = await handleProcessClose(code, eventChain, stdoutLines, stderrChunks, scriptPath);
                        span.setAttribute("exitCode", result.exitCode);
                        resolve(result);
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            });
        }, {
            attributes: {
                binPath,
                scriptPath,
                args: commandArgs.join(" "),
                [v3_1.SemanticInternalAttributes.STYLE_ICON]: "ruby",
            },
        });
    },
};
/**
 * Build environment variables for the Ruby process, including OpenTelemetry context.
 */
function buildEnvironmentVariables(options, carrier) {
    const otelResourceAttributes = `${v3_1.SemanticInternalAttributes.EXECUTION_ENVIRONMENT}=trigger,${Object.entries(v3_1.taskContext.attributes)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")}`;
    const envVars = {
        ...options.env,
        TRACEPARENT: carrier["traceparent"],
        OTEL_RESOURCE_ATTRIBUTES: otelResourceAttributes,
        OTEL_LOG_LEVEL: "DEBUG",
    };
    // Add payload as JSON string if provided
    if (options.payload) {
        envVars.TRIGGER_PAYLOAD = JSON.stringify(options.payload);
    }
    return envVars;
}
/**
 * Convert environment variables into shell export statements.
 */
function buildExportStatements(envVars) {
    return Object.entries(envVars)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => `export ${key}="${value?.replace(/"/g, '\\"')}"`)
        .join("; ");
}
/**
 * Escape shell arguments for safe command execution.
 */
function escapeShellArguments(args) {
    return args
        .map((arg) => {
        const needsEscaping = arg.includes(" ") ||
            arg.includes("&") ||
            arg.includes(";") ||
            arg.includes("$");
        return needsEscaping ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
    })
        .join(" ");
}
/**
 * Build Ruby version manager setup command (RVM or rbenv).
 * Also ensures common Ruby/gem bin paths are in PATH for container environments.
 */
function buildRubySetupCommand() {
    const homeDir = process.env.HOME || "~";
    const rvmScript = `${homeDir}/.rvm/scripts/rvm`;
    const rbenvInit = `${homeDir}/.rbenv/bin/rbenv`;
    // Ensure common gem/ruby bin paths are in PATH for containers and system installs
    // /usr/local/bundle/bin - Common in Ruby Docker images
    // /usr/local/bin - Standard system-wide bin
    // /usr/bin - System binaries
    // $GEM_HOME/bin - User gem binaries
    const ensurePath = `export PATH="/usr/local/bundle/bin:/usr/local/bin:/usr/bin:$GEM_HOME/bin:$PATH"`;
    return `${ensurePath}; if [ -f "${rvmScript}" ]; then source "${rvmScript}" 2>/dev/null; elif [ -f "${rbenvInit}" ]; then export PATH="${homeDir}/.rbenv/bin:$PATH"; eval "$(rbenv init - 2>/dev/null)"; fi`;
}
/**
 * Build the complete shell command to execute.
 */
function buildShellCommand(binPath, escapedArgs, exportStatements, cwd) {
    const rubySetup = buildRubySetupCommand();
    return `${rubySetup}; cd "${cwd}"; ${exportStatements}; ${binPath} ${escapedArgs}`;
}
/**
 * Send acknowledgment to the Ruby process via stdin.
 */
function sendAcknowledgment(proc) {
    if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write("__ACK__\n");
    }
}
/**
 * Process a line from stdout, handling trigger events or regular output.
 */
async function processEventLine(line, stdoutLines, eventChain, proc) {
    if (!line.startsWith(exports.TRIGGER_EVENT_PREFIX)) {
        // Always write to terminal stdout for real-time visibility
        process.stdout.write(line + "\n");
        stdoutLines.push(line);
        return eventChain;
    }
    try {
        const eventJson = line.slice(exports.TRIGGER_EVENT_PREFIX.length);
        const event = JSON.parse(eventJson);
        return eventChain.then(async () => {
            try {
                const needsAck = await handleTriggerEvent(event);
                if (needsAck) {
                    sendAcknowledgment(proc);
                }
            }
            catch (err) {
                v3_2.logger.error("Error handling Ruby trigger event", {
                    error: String(err),
                });
                // Always send ACK to unblock the Ruby process
                sendAcknowledgment(proc);
            }
        });
    }
    catch {
        // Malformed event line – treat as plain output
        stdoutLines.push(line);
        return eventChain;
    }
}
/**
 * Handle process close event and return the result.
 */
async function handleProcessClose(code, eventChain, stdoutLines, stderrChunks, scriptPath) {
    // Wait for all in-flight events to finish
    await eventChain;
    const exitCode = code ?? -1;
    const stdout = stdoutLines.join("\n");
    const stderr = stderrChunks.join("");
    if (exitCode !== 0) {
        const reason = exitCode === -1
            ? `${scriptPath} was terminated by a signal`
            : `${scriptPath} exited with a non-zero code ${exitCode}`;
        throw new Error(`${reason}:\n${stdout}\n${stderr}`);
    }
    return { stdout, stderr, exitCode };
}
//# sourceMappingURL=index.js.map