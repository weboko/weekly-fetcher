import { type FetchRequest } from "@weekly/shared";
import { randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../db";
import { fetchDiscourseForumActivity } from "./discourse";
import { fetchGitHubRepoActivity } from "./github";
import { createEmptyDatasetRecord, finalizeItem, replaceDataset } from "./store";

export async function fetchDataset(db: SqliteDatabase, request: FetchRequest) {
  const dataset = createEmptyDatasetRecord(request.fetchWindow, request.sourceConfig, request.scoringWeights);

  const results = await Promise.allSettled([
    ...request.sourceConfig.githubRepos.map((repo) => fetchGitHubRepoActivity(repo, request.fetchWindow, request.githubToken)),
    ...request.sourceConfig.forums.map((forum) => fetchDiscourseForumActivity(forum, request.fetchWindow)),
  ]);

  for (const result of results) {
    if (result.status === "fulfilled") {
      dataset.warnings.push(...result.value.warnings);
      dataset.items.push(...result.value.items.map((item) => finalizeItem(db, item, request.scoringWeights)));
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
  return replaceDataset(db, dataset);
}
