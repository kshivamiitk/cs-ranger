type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, service: string, msg: string, meta: object = {}) {
  const entry = { ts: new Date().toISOString(), level, service, msg, ...meta };
  const stream = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  stream(JSON.stringify(entry));
}

export function makeLogger(service: string) {
  return {
    debug: (msg: string, meta?: object) => emit("debug", service, msg, meta),
    info: (msg: string, meta?: object) => emit("info", service, msg, meta),
    warn: (msg: string, meta?: object) => emit("warn", service, msg, meta),
    error: (msg: string, meta?: object) => emit("error", service, msg, meta),
  };
}
