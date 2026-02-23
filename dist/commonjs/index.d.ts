export type RubyExecOptions = {
    env?: {
        [key: string]: string | undefined;
    };
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
export declare const TRIGGER_EVENT_PREFIX = "__TRIGGER_EVENT__:";
export declare const ruby: {
    runScript(scriptPath: string, scriptArgs?: string[], options?: RubyExecOptions): Promise<RubyScriptResult>;
};
