const recentEvents = new Map();
const contextFields = ["route", "method", "stage", "activity", "audience", "role"];
const errorFields = [
  "code",
  "severity",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
  "syscall",
  "address",
  "port",
];

function redact(value) {
  return value
    .replace(
      /(postgres(?:ql)?:\/\/[^:/\s@]+:)[^@\s/]+@/gi,
      "$1[REDACTED]@",
    )
    .replace(
      /((?:password|passwd|pwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    );
}

function errorRecord(error) {
  const source = error && typeof error === "object" ? error : {};
  const fields = Object.fromEntries(
    errorFields
      .filter((key) => {
        const value = source[key];
        return typeof value === "string" || typeof value === "number";
      })
      .map((key) => [key, source[key]]),
  );
  const record = {
    name: error instanceof Error ? error.name : "Error",
    message: redact(error instanceof Error ? error.message : String(error)),
    ...fields,
  };
  if (error instanceof Error && error.stack)
    record.stack = redact(error.stack);
  return record;
}

export function logServerError(event, error, context = {}, options = {}) {
  const safeContext = Object.fromEntries(
    contextFields
      .filter((key) => {
        const value = context[key];
        return typeof value === "string" || typeof value === "number";
      })
      .map((key) => [key, context[key]]),
  );
  const throttleMs = Number(options.throttleMs || 0);
  if (throttleMs > 0) {
    const key = `${event}:${safeContext.route || ""}:${error?.code || error?.message || "unknown"}`;
    const now = Date.now();
    if (now - (recentEvents.get(key) || 0) < throttleMs) return;
    recentEvents.set(key, now);
    if (recentEvents.size > 500) {
      for (const [entry, timestamp] of recentEvents)
        if (now - timestamp > throttleMs * 2) recentEvents.delete(entry);
    }
  }
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      ...safeContext,
      error: errorRecord(error),
    }),
  );
}
