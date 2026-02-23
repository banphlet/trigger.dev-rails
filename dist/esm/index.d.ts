export type RubyExecOptions = {
    env?: {
        [key: string]: string | undefined;
    };
    cwd: string;
    /**
     * Optional JSON payload to pass to the Ruby script.
     * This will be available as an environment variable TRIGGER_PAYLOAD.
     * In Ruby, access it with: JSON.parse(ENV['TRIGGER_PAYLOAD'] || '{}')
     */
    payload?: Record<string, unknown>;
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
export declare const TRIGGER_EVENT_PREFIX = "__TRIGGER_EVENT__:";
export declare const ruby: {
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
    runRailsScript({ scriptArgs, scriptPath, options, }: {
        scriptPath: string;
        scriptArgs?: string[];
        options: RubyExecOptions;
    }): Promise<RubyScriptResult>;
};
