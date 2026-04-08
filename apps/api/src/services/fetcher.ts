import { normalizeSourceConfig, type DatasetWarning, type FetchRequest } from "@weekly/shared";
import { randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../db";
import { fetchDiscourseForumActivity } from "./discourse";
import { fetchGitHubRepoActivity, parseGitHubTarget, resolveGitHubTargets, type GitHubAdapterResult } from "./github";
import { createEmptyDatasetRecord, finalizeItem, replaceDataset } from "./store";

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

async function fetchGitHubActivity(request: FetchRequest): Promise<GitHubAdapterResult> {
  const warnings: DatasetWarning[] = [];
  const items: GitHubAdapterResult["items"] = [];
  const parsedTargets = request.sourceConfig.githubTargets.flatMap((target) => {
    const parsedTarget = parseGitHubTarget(target);
    if (!parsedTarget) {
      warnings.push(createWarning(target, `Invalid GitHub target "${target}". Use owner/repo or org:owner.`));
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

  for (const result of forumResults) {
    if (result.status === "fulfilled") {
      dataset.warnings.push(...result.value.warnings);
      dataset.items.push(...result.value.items.map((item) => finalizeItem(db, item, normalizedRequest.scoringWeights)));
    } else {
      dataset.warnings.push({
        id: randomUUID(),
        sourceKey: "fetch",
        severity: "error",
        message: result.reason instanceof Error ? result.reason.message : "Unknown fetch error",
      });
    }
  }

  dataset.items.sort((left, right) => right.score.total - left.score.total || right.latestActivityAt.localeCompare(left.latestActivityAt));
  try {
    return replaceDataset(db, dataset);
  } catch (error) {
    throw new Error(`Dataset persistence failed: ${(error as Error).message}`);
  }
}
