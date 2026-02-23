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
          // Install dependencies for RVM and Ruby
          "RUN apt-get update && apt-get install -y --no-install-recommends gnupg2 curl ca-certificates software-properties-common && apt-get clean && rm -rf /var/lib/apt/lists/*",
          // Add RVM GPG keys
          "RUN gpg2 --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB || true",
          // Install RVM
          "RUN curl -sSL https://get.rvm.io | bash -s stable",
          // Source RVM and install Ruby
          `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && rvm install ${rubyVersion} && rvm use ${rubyVersion} --default"`,
          // Install common gems
          `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && rvm use ${rubyVersion} && gem install nokogiri --platform=ruby --no-document -- --use-system-libraries"`,
          `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && rvm use ${rubyVersion} && gem install pg"`,
          `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && rvm use ${rubyVersion} && gem install rake"`,
          ...(this.options.scripts?.map((script) => `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && rvm use ${rubyVersion} && ${script}"`) ?? []),
        ],
      },
      deploy: {
        env: {
          RUBY_BIN_PATH: `/usr/local/rvm/rubies/ruby-${rubyVersion}/bin/ruby`,
          PATH: `/usr/local/rvm/rubies/ruby-${rubyVersion}/bin:$PATH`,
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
            'RUN bundle check || bundle install || bundle update'
          ],
        },
        deploy: {
          override: true,
        },
      });
    }
  }
}
