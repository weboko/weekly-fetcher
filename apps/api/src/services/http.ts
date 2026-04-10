export interface FetchJsonOptions {
  headers?: Record<string, string>;
  retries?: number;
}

class HttpError extends Error {
  transient: boolean;

  constructor(message: string, transient = false) {
    super(message);
    this.transient = transient;
  }
}

function formatErrorBody(text: string): string | null {
  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as { message?: string; errors?: unknown };
    const errors = Array.isArray(payload.errors)
      ? payload.errors.filter((value): value is string => typeof value === "string")
      : [];
    if (errors.length > 0) {
      return errors.join("; ");
    }
    return payload.message ?? text;
  } catch {
    return text;
  }
}

function isTransientDiscourseRateLimit(status: number, body: string | null): boolean {
  if (status !== 422 || !body) {
    return false;
  }
  const normalized = body.toLowerCase();
  return normalized.includes("too many times") || normalized.includes("try again later");
}

async function buildHttpError(response: Response, url: string): Promise<HttpError> {
  const body = formatErrorBody(await response.text().catch(() => ""));
  const retryAfter = response.headers.get("retry-after");
  const transient = response.status === 429 || response.status >= 500 || isTransientDiscourseRateLimit(response.status, body);
  const suffix = [body, retryAfter ? `retry after ${retryAfter}s` : null].filter(Boolean).join("; ");
  const prefix = transient ? "Transient response" : "HTTP";
  return new HttpError(`${prefix} ${response.status} for ${url}${suffix ? `: ${suffix}` : ""}`, transient);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(url: string, options: FetchJsonOptions = {}): Promise<string> {
  const retries = options.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: options.headers });
      if (!response.ok) {
        throw await buildHttpError(response, url);
      }
      return await response.text();
    } catch (error) {
      lastError = error as Error;
      const transient = error instanceof HttpError ? error.transient : true;
      if (attempt === retries || !transient) {
        break;
      }
      await sleep(350 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`Unable to fetch ${url}`);
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json, application/json",
      "User-Agent": "weekly-fetcher-api",
      ...(options.headers ?? {}),
    },
  });
  return JSON.parse(text) as T;
}
