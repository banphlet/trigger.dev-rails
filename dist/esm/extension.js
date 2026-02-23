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
        const rubyVersion = this.options.rubyVersion ?? "3.2";
        const rubyPackage = `ruby${rubyVersion}`;
        context.addLayer({
            id: "ruby-installation",
            image: {
                instructions: [
                    `RUN apt-get update && apt-get install -y --no-install-recommends ${rubyPackage} && apt-get clean && rm -rf /var/lib/apt/lists/*`,
                    "RUN gem install nokogiri --platform=ruby --no-document -- --use-system-libraries",
                    "RUN gem install pg",
                    "RUN gem install rake",
                    ...this.options.scripts?.map(script => `RUN ${script}`) ?? []
                ],
            },
            deploy: {
                env: {
                    RUBY_BIN_PATH: "/usr/bin/ruby",
                },
                override: true,
            },
        });
    }
}
//# sourceMappingURL=extension.js.map