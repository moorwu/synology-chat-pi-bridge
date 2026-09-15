/**
 * Structured logger for the bridge — thin wrapper around Pino.
 *
 * Configurable via env:
 *   LOG_LEVEL  — trace|debug|info|warn|error|silent (default: info)
 *   LOG_FORMAT — pretty (dev, colored) | json (production/Docker, default: pretty)
 *
 * In Docker, LOG_FORMAT=json is set by default via Dockerfile.
 */

import pino, { type Logger as PinoLogger } from "pino";

export type { Logger } from "pino";

let rootLogger: PinoLogger | undefined;

function buildRootLogger(): PinoLogger {
  const level = process.env.LOG_LEVEL ?? "info";
  const format = process.env.LOG_FORMAT ?? "pretty";

  const transport =
    format === "json"
      ? undefined // raw JSON to stdout
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        };

  return pino({
    level,
    ...(transport ? { transport } : {}),
  });
}

function getRootLogger(): PinoLogger {
  if (!rootLogger) {
    rootLogger = buildRootLogger();
  }
  return rootLogger;
}

/**
 * Create a logger tagged with a component name.
 *
 *   const log = createLogger("synology:bot");
 *   log.info("starting");          // [synology:bot] starting
 *   const child = log.child({ threadId: "abc" });
 *   child.info("message");         // [synology:bot] message  threadId=abc
 */
export function createLogger(component: string): PinoLogger {
  return getRootLogger().child({ component });
}

/**
 * Re-read LOG_LEVEL / LOG_FORMAT from env (e.g. after config load).
 */
export function refreshLogConfig(): void {
  rootLogger = buildRootLogger();
}
