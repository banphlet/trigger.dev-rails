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
     * The version of Ruby to install in the container (e.g. `"3.2"`, `"3.1.4"`).
     *
     * @remarks
     * When specified, the exact package `ruby<version>` is installed via apt-get.
     * If omitted, the default `ruby` package provided by the base image is used.
     *
     * Example: `"3.2"` installs the `ruby3.2` apt package.
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
