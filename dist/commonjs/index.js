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
const node_fs_1 = __importDefault(require("node:fs"));
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
    async runScript(scriptPath, scriptArgs = [], options = {}) {
        (0, node_assert_1.default)(scriptPath, "Script path is required");
        (0, node_assert_1.default)(node_fs_1.default.existsSync(scriptPath), `Script does not exist: ${scriptPath}`);
        const rubyBin = process.env.RUBY_BIN_PATH || "ruby";
        return await _executeRubyCommand("ruby.runScript()", [scriptPath, ...scriptArgs], rubyBin, scriptPath, options);
    },
    async runRailsScript(scriptPath, scriptArgs = [], options = {}) {
        (0, node_assert_1.default)(scriptPath, "Script path is required");
        (0, node_assert_1.default)(node_fs_1.default.existsSync(scriptPath), `Script does not exist: ${scriptPath}`);
        // Try bin/rails first (common in Rails apps), then fall back to rails
        const railsBin = process.env.RAILS_BIN_PATH ||
            (node_fs_1.default.existsSync("bin/rails") ? "bin/rails" : "rails");
        return await _executeRubyCommand("ruby.runRailsScript()", ["rails", "runner", scriptPath, ...scriptArgs], railsBin, scriptPath, options);
    },
};
async function _executeRubyCommand(traceName, commandArgs, binPath, scriptPath, options = {}) {
    return await v3_2.logger.trace(traceName, async (span) => {
        span.setAttribute("scriptPath", scriptPath);
        const carrier = (0, otel_1.carrierFromContext)();
        const env = {
            ...process.env,
            ...options.env,
            TRACEPARENT: carrier["traceparent"],
            OTEL_RESOURCE_ATTRIBUTES: `${v3_1.SemanticInternalAttributes.EXECUTION_ENVIRONMENT}=trigger,${Object.entries(v3_1.taskContext.attributes)
                .map(([key, value]) => `${key}=${value}`)
                .join(",")}`,
            OTEL_LOG_LEVEL: "DEBUG",
        };
        return new Promise((resolve, reject) => {
            const proc = (0, node_child_process_1.spawn)(binPath, commandArgs, {
                env,
                cwd: options.cwd,
                stdio: ["pipe", "pipe", "pipe"],
            });
            const stdoutLines = [];
            const stderrChunks = [];
            const rl = (0, node_readline_1.createInterface)({ input: proc.stdout, crlfDelay: Infinity });
            // Process events serially to preserve ordering and allow blocking waits
            let eventChain = Promise.resolve();
            rl.on("line", (line) => {
                if (line.startsWith(exports.TRIGGER_EVENT_PREFIX)) {
                    try {
                        const event = JSON.parse(line.slice(exports.TRIGGER_EVENT_PREFIX.length));
                        eventChain = eventChain.then(async () => {
                            try {
                                const needsAck = await handleTriggerEvent(event);
                                if (needsAck && proc.stdin && !proc.stdin.destroyed) {
                                    proc.stdin.write("__ACK__\n");
                                }
                            }
                            catch (err) {
                                v3_2.logger.error("Error handling Ruby trigger event", {
                                    error: String(err),
                                });
                                // Always send ACK to unblock the Ruby process
                                if (proc.stdin && !proc.stdin.destroyed) {
                                    proc.stdin.write("__ACK__\n");
                                }
                            }
                        });
                    }
                    catch {
                        // Malformed event line – treat as plain output
                        stdoutLines.push(line);
                    }
                }
                else {
                    stdoutLines.push(line);
                }
            });
            proc.stderr.on("data", (chunk) => {
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
                        const reason = exitCode === -1
                            ? `${scriptPath} was terminated by a signal`
                            : `${scriptPath} exited with a non-zero code ${exitCode}`;
                        reject(new Error(`${reason}:\n${stdout}\n${stderr}`));
                        return;
                    }
                    resolve({ stdout, stderr, exitCode });
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
}
//# sourceMappingURL=index.js.map