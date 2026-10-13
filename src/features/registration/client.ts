import { clientId } from "@/lib/client-id";
export class RegistrationApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function registrationApi<T>(
  activity: string,
  path: string,
  input?: unknown,
  upload?: File,
  commandId?: string,
): Promise<T> {
  const response = await fetch(
    `/api/registration/${path}${path.includes("?") ? "&" : "?"}activity=${encodeURIComponent(activity)}`,
    {
      method: input !== undefined || upload ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers:
        input !== undefined || upload
          ? {
              "Content-Type": upload ? upload.type : "application/json",
              "Idempotency-Key": commandId || clientId(),
            }
          : undefined,
      body: upload || (input !== undefined ? JSON.stringify(input) : undefined),
    },
  );
  const data = await response
    .json()
    .catch(() => ({ error: "服务暂不可用，请稍后重试。" }));
  if (!response.ok)
    throw new RegistrationApiError(
      data.error || "操作失败，请稍后重试。",
      response.status,
    );
  return data;
}
