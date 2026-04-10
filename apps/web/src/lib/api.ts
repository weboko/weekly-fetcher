import type {
  AppSettings,
  DatasetRecord,
  FetchRequest,
  FetchResponse,
  PostItemRequest,
  UpdateItemStateRequest,
} from "@weekly/shared";

async function requestJson<T>(input: RequestInfo, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getSettings() {
  return requestJson<AppSettings>("/api/settings");
}

export function saveSettings(settings: AppSettings) {
  return requestJson<AppSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function fetchDataset(payload: FetchRequest, signal?: AbortSignal) {
  return requestJson<FetchResponse>("/api/fetch", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function getDataset(datasetId: string) {
  return requestJson<{ dataset: DatasetRecord }>(`/api/datasets/${datasetId}`);
}

export function patchItemState(datasetId: string, itemId: string, patch: UpdateItemStateRequest) {
  return requestJson<{ dataset: DatasetRecord }>(`/api/datasets/${datasetId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function postItem(itemKey: string, payload: PostItemRequest) {
  return requestJson<{ dataset: DatasetRecord }>(`/api/items/${encodeURIComponent(itemKey)}/posted`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
