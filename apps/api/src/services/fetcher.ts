import { normalizeSourceConfig, type ActivityItem, type DatasetWarning, type FetchRequest } from "@weekly/shared";
import { randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../db";
import { fetchDiscourseForumActivity } from "./discourse";
import { fetchGitHubRepoActivity, parseGitHubTarget, resolveGitHubTargets, type GitHubAdapterResult } from "./github";
import { createEmptyDatasetRecord, finalizeItem, getDatasetByCacheKey, replaceDataset } from "./store";

const GITHUB_FETCH_CONCURRENCY = 2;

interface FetcherLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error?(payload: Record<string, unknown>, message: string): void;
}

interface FetchDatasetOptions {
  logger?: FetcherLogger;
}

interface GitHubRepoFetchResult {
  repo: string;
  status: "success" | "failure";
  items: GitHubAdapterResult["items"];
  warnings: DatasetWarning[];
  errorMessage?: string;
}

interface GitHubFetchResult {
  warnings: DatasetWarning[];
  repoResults: GitHubRepoFetchResult[];
}

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

function buildGitHubRepoKey(item: ActivityItem): string | null {
  if (item.source !== "github" || item.sourceMeta.source !== "github") {
    return null;
  }

  return `${item.sourceMeta.organization}/${item.sourceMeta.repository}`;
}

async function fetchGitHubActivity(request: FetchRequest, logger?: FetcherLogger): Promise<GitHubFetchResult> {
  const warnings: DatasetWarning[] = [];
  const invalidTargets: string[] = [];
  const parsedTargets = request.sourceConfig.githubTargets.flatMap((target) => {
    const parsedTarget = parseGitHubTarget(target);
    if (!parsedTarget) {
      invalidTargets.push(target);
      warnings.push(createWarning(target, `Invalid GitHub target "${target}". Use owner/repo, owner, or org:owner.`));
      return [];
    }
    return [parsedTarget];
  });

  logger?.info(
    {
      targetCount: request.sourceConfig.githubTargets.length,
      parsedTargetCount: parsedTargets.length,
      invalidTargetCount: invalidTargets.length,
    },
    "Processed GitHub targets",
  );

  if (invalidTargets.length > 0) {
    logger?.warn({ invalidTargets }, "Ignored invalid GitHub targets");
  }

  if (parsedTargets.length === 0) {
    return { warnings, repoResults: [] };
  }

  if (!request.githubToken) {
    warnings.push(createWarning("github", "GitHub targets require a GitHub token. GitHub activity was skipped."));
    logger?.warn({ parsedTargetCount: parsedTargets.length }, "Skipped GitHub fetch because no token was provided");
    return { warnings, repoResults: [] };
  }

  const resolvedTargets = await resolveGitHubTargets(parsedTargets, request.githubToken);
  warnings.push(...resolvedTargets.warnings);
  logger?.info(
    {
      parsedTargetCount: parsedTargets.length,
      resolvedRepoCount: resolvedTargets.repos.length,
      warningCount: resolvedTargets.warnings.length,
    },
    "Resolved GitHub targets",
  );

  const repoResults = await mapWithConcurrency(resolvedTargets.repos, GITHUB_FETCH_CONCURRENCY, async (repo) => {
    try {
      const result = await fetchGitHubRepoActivity(repo, request.fetchWindow, request.githubToken);
      logger?.info(
        {
          repo,
          status: "success",
          itemCount: result.items.length,
          warningCount: result.warnings.length,
        },
        "Fetched GitHub repo activity",
      );
      return {
        repo,
        status: "success",
        items: result.items,
        warnings: result.warnings,
      } satisfies GitHubRepoFetchResult;
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger?.warn(
        {
          repo,
          status: "failure",
          errorMessage,
        },
        "GitHub repo fetch failed",
      );
      return {
        repo,
        status: "failure",
        items: [],
        warnings: [createWarning(repo, `GitHub fetch failed for ${repo}: ${errorMessage}`)],
        errorMessage,
      } satisfies GitHubRepoFetchResult;
    }
  });

  return { warnings, repoResults };
}

export async function fetchDataset(db: SqliteDatabase, request: FetchRequest, options: FetchDatasetOptions = {}) {
  const logger = options.logger;
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
  const previousGitHubItemsByRepo = new Map<string, ActivityItem[]>();
  for (const item of previousDataset?.items ?? []) {
    const repoKey = buildGitHubRepoKey(item);
    if (!repoKey) {
      continue;
    }

    const group = previousGitHubItemsByRepo.get(repoKey) ?? [];
    group.push(item);
    previousGitHubItemsByRepo.set(repoKey, group);
  }
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
    fetchGitHubActivity(normalizedRequest, logger),
    Promise.allSettled(
      normalizedRequest.sourceConfig.forums.map((forum) =>
        fetchDiscourseForumActivity(forum, normalizedRequest.fetchWindow),
      ),
    ),
  ]);

  dataset.warnings.push(...githubResult.warnings);
  for (const repoResult of githubResult.repoResults) {
    dataset.warnings.push(...repoResult.warnings);

    if (repoResult.status === "success") {
      dataset.items.push(...repoResult.items.map((item) => finalizeItem(db, item, normalizedRequest.scoringWeights)));
      continue;
    }

    const previousItemsForRepo = previousGitHubItemsByRepo.get(repoResult.repo) ?? [];
    if (previousItemsForRepo.length > 0) {
      dataset.items.push(
        ...previousItemsForRepo.map((item) => {
          const reusedItem = toRawItem(item);
          reusedItem.warnings = Array.from(new Set([
            ...reusedItem.warnings,
            "Showing previously cached GitHub content because latest refresh failed.",
          ]));
          return finalizeItem(db, reusedItem, normalizedRequest.scoringWeights);
        }),
      );
    }

    logger?.warn(
      {
        repo: repoResult.repo,
        reusedItemCount: previousItemsForRepo.length,
        warningCount: repoResult.warnings.length,
      },
      "Reused cached GitHub repo content after fetch failure",
    );
    dataset.warnings.push(
      createWarning(
        repoResult.repo,
        `GitHub fetch failed for ${repoResult.repo}; reused cached GitHub data when available.${repoResult.errorMessage ? ` ${repoResult.errorMessage}` : ""}`,
      ),
    );
  }

  for (const [index, result] of forumResults.entries()) {
    const forumUrl = normalizedRequest.sourceConfig.forums[index]?.replace(/\/+$/, "");
    if (!forumUrl) {
      continue;
    }

    if (result.status === "fulfilled") {
      logger?.info(
        {
          forumUrl,
          itemCount: result.value.items.length,
          warningCount: result.value.warnings.length,
        },
        "Fetched forum activity",
      );
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
          logger?.warn(
            {
              forumUrl,
              itemKey: previousItem.itemKey,
            },
            "Reused cached forum topic after degraded response",
          );
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
      logger?.warn(
        {
          forumUrl,
          reusedItemCount: previousItemsForForum.length,
          errorMessage: (result.reason as Error)?.message ?? "Unknown fetch error",
        },
        "Forum fetch failed; reused cached content when available",
      );
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
