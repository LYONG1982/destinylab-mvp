import { logServerError as writeErrorLog } from "../../scripts/lib/error-log.mjs";

export type ServerErrorContext = {
  route?: string;
  method?: string;
  stage?: string;
  activity?: string;
  audience?: string;
  role?: string;
};

export function logServerError(
  event: string,
  error: unknown,
  context: ServerErrorContext = {},
  options: { throttleMs?: number } = {},
) {
  writeErrorLog(event, error, context, options);
}
