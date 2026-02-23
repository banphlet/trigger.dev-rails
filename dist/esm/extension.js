import { addAdditionalFilesToBuild } from "@trigger.dev/build/internal";
export function rubyExtension(options = {}) {
    return new RubyExtension(options);
}
class RubyExtension {
    options;
    name = "RubyExtension";
    constructor(options = {}) {
        this.options = options;
    }
    async onBuildComplete(context, manifest) {
        await addAdditionalFilesToBuild("rubyExtension", {
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
        const rubyPackage = `ruby${rubyVersion}`;
        context.addLayer({
            id: "ruby-installation",
            image: {
                instructions: [
                    `RUN apt-get update && apt-get install -y \
            curl \
            gnupg2 \
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
            && rm -rf /var/lib/apt/lists/*
          `,
                    `RUN curl -sSL https://rvm.io/mpapis.asc | gpg2 --import - && \
            curl -sSL https://rvm.io/pkuczynski.asc | gpg2 --import - && \
            curl -sSL https://get.rvm.io | bash -s stable
          `,
                    `RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && \
          rvm install ${rubyVersion} && \
          rvm use ${rubyVersion} --default && \
          gem install bundler"
    `,
                    "RUN gem install pg",
                    "RUN gem install rake",
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