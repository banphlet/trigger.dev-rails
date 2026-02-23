import { BuildExtension } from "@trigger.dev/core/v3/build";
export type RubyOptions = {
    /**
     * [Dev-only] The path to the ruby binary.
     *
     * @remarks
     * This option is typically used during local development or in specific testing environments
     * where a particular Ruby installation needs to be targeted. It should point to the full path
     * of the ruby executable.
     *
     * Example: `/usr/bin/ruby` or `/usr/local/bin/ruby`
     */
    devRubyBinaryPath?: string;
    /**
     * The version of Ruby to install in the container (e.g. `"3.2.8"`, `"3.1.4"`, `"3.3.0"`).
     *
     * @remarks
     * When specified, RVM (Ruby Version Manager) is used to install the exact Ruby version.
     * If omitted, defaults to `"3.2.8"`.
     *
     * Example: `"3.2.8"` installs Ruby 3.2.8 via RVM.
     */
    rubyVersion?: string;
    /**
     * An array of glob patterns that specify which Ruby files are allowed to be executed.
     *
     * @remarks
     * These files will be copied to the container during the build process.
     */
    files?: string[];
    /**
     * Array of custom scripts to run during the build process. Each script should be a valid shell command.
     */
    scripts?: string[];
    /**
     * [Optional] The path to a Gemfile that should be included in the build. If provided, the Gemfile will be copied to the container and `bundle install` will be run during the build process.
     */
    gemFile?: string;
};
export declare function rubyExtension(options?: RubyOptions): BuildExtension;
