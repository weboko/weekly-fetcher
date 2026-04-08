export interface FetchJsonOptions {
  headers?: Record<string, string>;
  retries?: number;
}

function formatErrorBody(text: string): string | null {
  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as { message?: string };
    return payload.message ?? text;
  } catch {
    return text;
  }
}

async function buildHttpError(response: Response, url: string, prefix = "HTTP"): Promise<Error> {
  const body = formatErrorBody(await response.text().catch(() => ""));
  const retryAfter = response.headers.get("retry-after");
  const suffix = [body, retryAfter ? `retry after ${retryAfter}s` : null].filter(Boolean).join("; ");
  return new Error(`${prefix} ${response.status} for ${url}${suffix ? `: ${suffix}` : ""}`);
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
      if (response.status === 429 || response.status >= 500) {
        throw await buildHttpError(response, url, "Transient response");
      }
      if (!response.ok) {
        throw await buildHttpError(response, url);
      }
      return await response.text();
    } catch (error) {
      lastError = error as Error;
      if (attempt === retries) {
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
      ...(options.headers ?? {}),
    },
  });
  return JSON.parse(text) as T;
}
