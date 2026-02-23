import { SemanticInternalAttributes, taskContext } from "@trigger.dev/core/v3";
import { logger } from "@trigger.dev/sdk/v3";
import { carrierFromContext } from "@trigger.dev/core/v3/otel";
import assert from "node:assert";
import fs from "node:fs";
import { Result, x, Options as XOptions } from "tinyexec";

export type RubyExecOptions = Partial<XOptions> & {
  env?: { [key: string]: string | undefined };
};

export const ruby = {
  async runScript(
    scriptPath: string,
    scriptArgs: string[] = [],
    options: RubyExecOptions = {}
  ): Promise<Result> {
    assert(scriptPath, "Script path is required");
    assert(fs.existsSync(scriptPath), `Script does not exist: ${scriptPath}`);

    const rubyBin = process.env.RUBY_BIN_PATH || "ruby";

    return await logger.trace(
      "ruby.runScript()",
      async (span) => {
        span.setAttribute("scriptPath", scriptPath);

        const carrier = carrierFromContext();

        const result = await x(rubyBin, [scriptPath, ...scriptArgs], {
          ...options,
          nodeOptions: {
            ...(options.nodeOptions || {}),
            env: {
              ...process.env,
              ...options.env,
              TRACEPARENT: carrier["traceparent"],
              OTEL_RESOURCE_ATTRIBUTES: `${
                SemanticInternalAttributes.EXECUTION_ENVIRONMENT
              }=trigger,${Object.entries(taskContext.attributes)
                .map(([key, value]) => `${key}=${value}`)
                .join(",")}`,
              OTEL_LOG_LEVEL: "DEBUG",
            },
          },
          throwOnError: false,
        });

        if (result.exitCode) {
          span.setAttribute("exitCode", result.exitCode);
        }

        if (result.exitCode !== 0) {
          throw new Error(
            `${scriptPath} ${scriptArgs.join(" ")} exited with a non-zero code ${
              result.exitCode
            }:\n${result.stdout}\n${result.stderr}`
          );
        }

        return result;
      },
      {
        attributes: {
          rubyBin,
          scriptPath,
          args: scriptArgs.join(" "),
          [SemanticInternalAttributes.STYLE_ICON]: "ruby",
        },
      }
    );
  },
};
