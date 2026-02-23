import { addAdditionalFilesToBuild } from "@trigger.dev/build/internal";
import { BuildManifest } from "@trigger.dev/core/v3";
import { BuildContext, BuildExtension } from "@trigger.dev/core/v3/build";

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

export function rubyExtension(options: RubyOptions = {}): BuildExtension {
  return new RubyExtension(options);
}

class RubyExtension implements BuildExtension {
  public readonly name = "RubyExtension";

  constructor(private options: RubyOptions = {}) {}

  async onBuildComplete(context: BuildContext, manifest: BuildManifest) {
    await addAdditionalFilesToBuild(
      "rubyExtension",
      {
        files: this.options.files ?? [],
      },
      context,
      manifest,
    );

    if (context.target === "dev") {
      if (this.options.devRubyBinaryPath) {
        process.env.RUBY_BIN_PATH = this.options.devRubyBinaryPath;
      } else {
        process.env.RUBY_BIN_PATH = "/usr/bin/ruby";
      }

      return;
    }

    context.logger.debug(`Adding ${this.name} to the build`);
    const rubyVersion = this.options.rubyVersion ?? "3.2.8";

    context.addLayer({
      id: "ruby-installation",
      image: {
        instructions: [
          `RUN apt-get update && apt-get install -y \
        procps \
        libpq-dev\
        git\
        curl \
        build-essential \
        libssl-dev \
        libreadline-dev \
        zlib1g-dev \
        autoconf \
        bison \
        libyaml-dev \
        libsqlite3-dev \
        sqlite3 \
        libxml2-dev \
        libxslt1-dev \
        libcurl4-openssl-dev \
        libffi-dev \
        wget \
        && rm -rf /var/lib/apt/lists/*
    `,
          `RUN wget https://cache.ruby-lang.org/pub/ruby/3.2/ruby-${rubyVersion}.tar.gz && \
          tar -xzf ruby-${rubyVersion}.tar.gz && \
          cd ruby-${rubyVersion} && \
          ./configure --disable-install-doc && \
          make -j$(nproc) && \
          make install && \
          cd .. && \
          rm -rf ruby-${rubyVersion} ruby-${rubyVersion}.tar.gz`,
          `RUN gem install bundler`,
          `RUN ruby --version && bundle --version`,
          ...(this.options.scripts?.map((script) => `RUN ${script}`) ?? []),
        ],
      },
      deploy: {
        env: {
          RUBY_BIN_PATH: "/usr/bin/ruby",
        },
        override: true,
      },
    });

    if (this.options.gemFile) {
      context.addLayer({
        id: "ruby-gem-installation",
        image: {
          instructions: [
            `COPY ${this.options.gemFile} ${this.options.gemFile}.lock .`,
            "RUN bundle check || bundle install || bundle update",
          ],
        },
        deploy: {
          override: true,
        },
      });
    }
  }
}
