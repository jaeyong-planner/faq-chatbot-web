/**
 * 중앙 집중식 로거 유틸리티
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isProduction = import.meta.env?.PROD ?? false;
const MIN_LOG_LEVEL: LogLevel = isProduction ? "warn" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) {
        console.log(`${formatTimestamp()} ${prefix}`, ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) {
        console.log(`${formatTimestamp()} ${prefix}`, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) {
        console.warn(`${formatTimestamp()} ${prefix}`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog("error")) {
        console.error(`${formatTimestamp()} ${prefix}`, ...args);
      }
    },
  };
}
