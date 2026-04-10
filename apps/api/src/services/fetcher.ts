import { normalizeSourceConfig, type ActivityItem, type DatasetWarning, type FetchRequest } from "@weekly/shared";
import { randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../db";
import { fetchDiscourseForumActivity } from "./discourse";
import { fetchGitHubRepoActivity, parseGitHubTarget, resolveGitHubTargets, type GitHubAdapterResult } from "./github";
import { createEmptyDatasetRecord, finalizeItem, getDatasetByCacheKey, replaceDataset } from "./store";

const GITHUB_FETCH_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function createWarning(sourceKey: string, message: string): DatasetWarning {
  return {
    id: randomUUID(),
    sourceKey,
    severity: "warning",
    message,
  };
}

function toRawItem(item: ActivityItem): Omit<ActivityItem, "score" | "summary" | "alreadyShared" | "reactivated" | "activityWindow"> {
  const { score: _score, summary: _summary, alreadyShared: _alreadyShared, reactivated: _reactivated, activityWindow: _activityWindow, ...rawItem } = item;
  return rawItem;
}

function isRicherForumItem(previousItem: ActivityItem, currentItem: Omit<ActivityItem, "score" | "summary" | "alreadyShared" | "reactivated" | "activityWindow">): boolean {
  const previousSignal = previousItem.body.trim().length + previousItem.discussionTimeline.length * 100 + previousItem.excerpts.length * 10;
  const currentSignal = currentItem.body.trim().length + currentItem.discussionTimeline.length * 100 + currentItem.excerpts.length * 10;
  return previousSignal > currentSignal;
}

async function fetchGitHubActivity(request: FetchRequest): Promise<GitHubAdapterResult> {
  const warnings: DatasetWarning[] = [];
  const items: GitHubAdapterResult["items"] = [];
  const parsedTargets = request.sourceConfig.githubTargets.flatMap((target) => {
    const parsedTarget = parseGitHubTarget(target);
    if (!parsedTarget) {
      warnings.push(createWarning(target, `Invalid GitHub target "${target}". Use owner/repo, owner, or org:owner.`));
      return [];
    }
    return [parsedTarget];
  });

  if (parsedTargets.length === 0) {
    return { items, warnings };
  }

  if (!request.githubToken) {
    warnings.push(createWarning("github", "GitHub targets require a GitHub token. GitHub activity was skipped."));
    return { items, warnings };
  }

  const resolvedTargets = await resolveGitHubTargets(parsedTargets, request.githubToken);
  warnings.push(...resolvedTargets.warnings);

  const repoResults = await mapWithConcurrency(resolvedTargets.repos, GITHUB_FETCH_CONCURRENCY, async (repo) => {
    try {
      return await fetchGitHubRepoActivity(repo, request.fetchWindow, request.githubToken);
    } catch (error) {
      return {
        items: [],
        warnings: [createWarning(repo, `GitHub fetch failed for ${repo}: ${(error as Error).message}`)],
      } satisfies GitHubAdapterResult;
    }
  });

  for (const result of repoResults) {
    warnings.push(...result.warnings);
    items.push(...result.items);
  }

  return { items, warnings };
}

export async function fetchDataset(db: SqliteDatabase, request: FetchRequest) {
  const normalizedRequest: FetchRequest = {
    ...request,
    sourceConfig: normalizeSourceConfig(request.sourceConfig),
  };
  const dataset = createEmptyDatasetRecord(
    normalizedRequest.fetchWindow,
    normalizedRequest.sourceConfig,
    normalizedRequest.scoringWeights,
  );
  const previousDataset = getDatasetByCacheKey(db, dataset.cacheKey);
  const previousForumItems = new Map(
    (previousDataset?.items ?? [])
      .filter((item) => item.source === "discourse")
      .map((item) => [item.itemKey, item]),
  );
  const previousForumItemsByForum = new Map<string, ActivityItem[]>();
  for (const item of previousForumItems.values()) {
    if (item.sourceMeta.source !== "discourse") {
      continue;
    }
    const group = previousForumItemsByForum.get(item.sourceMeta.forumUrl) ?? [];
    group.push(item);
    previousForumItemsByForum.set(item.sourceMeta.forumUrl, group);
  }

  const [githubResult, forumResults] = await Promise.all([
    fetchGitHubActivity(normalizedRequest),
    Promise.allSettled(
      normalizedRequest.sourceConfig.forums.map((forum) =>
        fetchDiscourseForumActivity(forum, normalizedRequest.fetchWindow),
      ),
    ),
  ]);

  dataset.warnings.push(...githubResult.warnings);
  dataset.items.push(...githubResult.items.map((item) => finalizeItem(db, item, normalizedRequest.scoringWeights)));

  for (const [index, result] of forumResults.entries()) {
    const forumUrl = normalizedRequest.sourceConfig.forums[index]?.replace(/\/+$/, "");
    if (!forumUrl) {
      continue;
    }

    if (result.status === "fulfilled") {
      dataset.warnings.push(...result.value.warnings);
      for (const item of result.value.items) {
        const previousItem = previousForumItems.get(item.itemKey);
        const currentWarnings = new Set(item.warnings);
        const partiallyParsed = currentWarnings.has("Topic metadata degraded; body and replies were unavailable.");

        if (partiallyParsed && previousItem && isRicherForumItem(previousItem, item)) {
          const reusedItem = toRawItem(previousItem);
          reusedItem.warnings = Array.from(new Set([
            ...reusedItem.warnings,
            ...item.warnings,
            "Showing previously cached forum content because the latest topic refresh was degraded.",
          ]));
          dataset.items.push(finalizeItem(db, reusedItem, normalizedRequest.scoringWeights));
          dataset.warnings.push(createWarning(forumUrl, `Reused cached content for topic ${previousItem.sourceMeta.source === "discourse" ? previousItem.sourceMeta.topicId : "unknown"} after a degraded forum response.`));
          continue;
        }

        dataset.items.push(finalizeItem(db, item, normalizedRequest.scoringWeights));
      }
    } else {
      const previousItemsForForum = previousForumItemsByForum.get(forumUrl) ?? [];
      if (previousItemsForForum.length) {
        dataset.items.push(
          ...previousItemsForForum.map((item) => {
            const reusedItem = toRawItem(item);
            reusedItem.warnings = Array.from(new Set([
              ...reusedItem.warnings,
              "Showing previously cached forum content because the latest forum refresh failed.",
            ]));
            return finalizeItem(db, reusedItem, normalizedRequest.scoringWeights);
          }),
        );
      }
      dataset.warnings.push(createWarning(forumUrl, `Forum fetch failed for ${forumUrl}; reused cached forum data when available. ${(result.reason as Error)?.message ?? "Unknown fetch error"}`));
    }
  }

  dataset.items.sort((left, right) => right.score.total - left.score.total || right.latestActivityAt.localeCompare(left.latestActivityAt));
  try {
    return replaceDataset(db, dataset);
  } catch (error) {
    throw new Error(`Dataset persistence failed: ${(error as Error).message}`);
  }
}
