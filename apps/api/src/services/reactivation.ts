import type { ActivityEvent, ActivityWindowSummary } from "@weekly/shared";

export interface PostedMarker {
  postedAt: string;
}

export function computeActivityWindow(events: ActivityEvent[], postedMarker: PostedMarker | null): ActivityWindowSummary {
  const sorted = [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const activeEvents = postedMarker
    ? sorted.filter((event) => event.createdAt > postedMarker.postedAt)
    : sorted;

  const start = activeEvents[0]?.createdAt ?? sorted[0]?.createdAt ?? new Date().toISOString();
  const end = activeEvents[activeEvents.length - 1]?.createdAt ?? sorted[sorted.length - 1]?.createdAt ?? start;

  return {
    sincePostedAt: postedMarker?.postedAt ?? null,
    activeStart: start,
    activeEnd: end,
  };
}

export function isReactivated(events: ActivityEvent[], postedMarker: PostedMarker | null): boolean {
  if (!postedMarker) {
    return false;
  }

  return events.some((event) => {
    if (event.createdAt <= postedMarker.postedAt) {
      return false;
    }

    return event.type === "merged" || event.type === "completed" || event.type === "reopened" || event.type === "commented" || event.type === "replied" || event.type === "forum_activity";
  });
}

