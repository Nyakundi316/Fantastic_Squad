// Small fetch wrapper for client components. Errors carry the API's code and field messages.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; details?: { fields?: Record<string, string[]> } };
  };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error?.code ?? "unknown",
      json.error?.message ?? "Something went wrong. Please try again.",
      json.error?.details?.fields ?? {},
    );
  }
  return json;
}
