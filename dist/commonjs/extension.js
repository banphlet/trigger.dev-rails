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
        const rubyPackage = `ruby${rubyVersion}`;
        context.addLayer({
            id: "ruby-installation",
            image: {
                instructions: [
                    `RUN apt-get update && apt-get install -y \
        procps \
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