"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rubyExtension = rubyExtension;
const internal_1 = require("@trigger.dev/build/internal");
function rubyExtension(options = {}) {
    return new RubyExtension(options);
}
class RubyExtension {
    options;
    name = "RubyExtension";
    constructor(options = {}) {
        this.options = options;
    }
    async onBuildComplete(context, manifest) {
        await (0, internal_1.addAdditionalFilesToBuild)("rubyExtension", {
            files: this.options.files ?? [],
        }, context, manifest);
        if (context.target === "dev") {
            if (this.options.devRubyBinaryPath) {
                process.env.RUBY_BIN_PATH = this.options.devRubyBinaryPath;
            }
            else {
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
//# sourceMappingURL=extension.js.map