import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

const root = pino({
  level,
  base: { service: process.env.SERVICE_NAME ?? "contritas-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,service",
          },
        },
      }),
});

export type Logger = pino.Logger;

export function createLogger(module: string, bindings: Record<string, unknown> = {}): Logger {
  return root.child({ module, ...bindings });
}

export const logger = root;
