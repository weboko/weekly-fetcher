import { clampText, isWithinWindow, type ActivityEvent, type ActivityExcerpt, type ActivityItem, type DatasetWarning, type FetchWindow } from "@weekly/shared";
import { randomUUID } from "node:crypto";

import { fetchJson } from "./http";

interface GitHubIssueListEntry {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

interface GitHubPullListEntry {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  draft: boolean;
}

interface GitHubIssueDetail {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  state: string;
  state_reason: string | null;
  comments: number;
  reactions: {
    total_count: number;
  };
  labels: Array<{ name: string }>;
}

interface GitHubPullDetail extends GitHubIssueDetail {
  merged_at: string | null;
  draft: boolean;
  review_comments: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

interface GitHubComment {
  id: number;
  body: string | null;
  created_at: string;
  html_url: string;
  reactions: {
    total_count: number;
  };
  user: {
    login: string;
  };
}

interface GitHubTimelineEvent {
  id?: number;
  event?: string;
  created_at?: string;
  source?: {
    issue?: {
      number?: number;
      repository_url?: string;
      html_url?: string;
      title?: string;
    };
  };
}

export interface GitHubAdapterResult {
  items: Array<Omit<ActivityItem, "score" | "summary" | "alreadyShared" | "reactivated" | "activityWindow">>;
  warnings: DatasetWarning[];
}

function githubHeaders(token?: string): Record<string, string> {
  return token
    ? {
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      }
    : {
        "X-GitHub-Api-Version": "2022-11-28",
      };
}

function shouldStopPaging(updatedAt: string, window: FetchWindow): boolean {
  return new Date(updatedAt).getTime() < new Date(`${window.startDate}T00:00:00Z`).getTime();
}

export function extractTextualLinks(text: string, owner: string, repo: string): string[] {
  const matches = new Set<string>();
  const regex = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

  for (const match of text.matchAll(regex)) {
    const rawTarget = match[1];
    if (rawTarget.includes("/")) {
      matches.add(rawTarget);
    } else {
      matches.add(`${owner}/${repo}${rawTarget}`);
    }
  }

  return Array.from(matches);
}

function pickStatus(detail: GitHubIssueDetail, isPullRequest: boolean): string {
  if (isPullRequest) {
    const pull = detail as GitHubPullDetail;
    if (pull.merged_at) {
      return "merged";
    }
    return detail.state === "open" ? "open" : "closed";
  }

  if (detail.state === "open") {
    return "open";
  }
  if (detail.state_reason === "completed") {
    return "completed";
  }
  if (detail.state_reason === "not_planned") {
    return "not_planned";
  }
  return "closed";
}

function normalizeComment(comment: GitHubComment, kind: ActivityExcerpt["kind"]): ActivityExcerpt {
  return {
    id: String(comment.id),
    kind,
    author: comment.user.login,
    body: clampText(comment.body ?? "", 500),
    createdAt: comment.created_at,
    reactionCount: comment.reactions.total_count,
    url: comment.html_url,
  };
}

function normalizeTimelineEvents(
  timeline: GitHubTimelineEvent[],
  detail: GitHubIssueDetail,
  isPullRequest: boolean,
): ActivityEvent[] {
  const events: ActivityEvent[] = [{ id: `${detail.number}-created`, type: "created", createdAt: detail.created_at }];

  for (const event of timeline) {
    if (!event.event || !event.created_at) {
      continue;
    }

    if (event.event === "reopened") {
      events.push({ id: `${event.id ?? randomUUID()}-reopened`, type: "reopened", createdAt: event.created_at });
    }
    if (event.event === "closed") {
      events.push({
        id: `${event.id ?? randomUUID()}-closed`,
        type: isPullRequest ? "closed" : detail.state_reason === "completed" ? "completed" : "closed",
        createdAt: event.created_at,
      });
    }
    if (event.event === "merged") {
      events.push({ id: `${event.id ?? randomUUID()}-merged`, type: "merged", createdAt: event.created_at });
    }
  }

  return events;
}

function fromRepoUrl(repoUrl: string | undefined): string | null {
  if (!repoUrl) {
    return null;
  }
  const match = repoUrl.match(/repos\/([^/]+\/[^/]+)$/);
  return match?.[1] ?? null;
}

async function paginateList<T extends { updated_at: string }>(
  urlFactory: (page: number) => string,
  window: FetchWindow,
  token?: string,
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageResults = await fetchJson<T[]>(urlFactory(page), { headers: githubHeaders(token) });
    results.push(...pageResults);
    if (pageResults.length === 0 || shouldStopPaging(pageResults[pageResults.length - 1].updated_at, window)) {
      break;
    }
  }
  return results;
}

export async function fetchGitHubRepoActivity(
  repoFullName: string,
  window: FetchWindow,
  token?: string,
): Promise<GitHubAdapterResult> {
  const warnings: DatasetWarning[] = [];
  const items: GitHubAdapterResult["items"] = [];
  const [owner, repo] = repoFullName.split("/");

  const pulls = await paginateList<GitHubPullListEntry>(
    (page) => `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=25&page=${page}`,
    window,
    token,
  );
  const issues = await paginateList<GitHubIssueListEntry>(
    (page) => `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=25&page=${page}`,
    window,
    token,
  );

  const pullCandidates = pulls.filter((pull) => !pull.draft && (isWithinWindow(pull.updated_at, window) || isWithinWindow(pull.created_at, window) || isWithinWindow(pull.merged_at, window) || isWithinWindow(pull.closed_at, window)));
  const issueCandidates = issues.filter((issue) => !issue.pull_request && (isWithinWindow(issue.updated_at, window) || isWithinWindow(issue.created_at, window) || isWithinWindow(issue.closed_at, window)));

  for (const pull of pullCandidates) {
    try {
      const [pullDetail, issueDetail, issueComments, reviewComments, timeline] = await Promise.all([
        fetchJson<GitHubPullDetail>(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull.number}`, { headers: githubHeaders(token) }),
        fetchJson<GitHubIssueDetail>(`https://api.github.com/repos/${owner}/${repo}/issues/${pull.number}`, { headers: githubHeaders(token) }),
        fetchJson<GitHubComment[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${pull.number}/comments?per_page=20`, { headers: githubHeaders(token) }),
        fetchJson<GitHubComment[]>(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull.number}/comments?per_page=20`, { headers: githubHeaders(token) }),
        fetchJson<GitHubTimelineEvent[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${pull.number}/timeline?per_page=100`, { headers: githubHeaders(token) }),
      ]);

      const linkedItems = new Set<string>(extractTextualLinks(`${pullDetail.body ?? ""}\n${issueComments.map((comment) => comment.body ?? "").join("\n")}`, owner, repo));
      for (const event of timeline) {
        const repoRef = fromRepoUrl(event.source?.issue?.repository_url);
        const issueNumber = event.source?.issue?.number;
        if (repoRef && issueNumber && event.event === "cross-referenced") {
          linkedItems.add(`${repoRef}#${issueNumber}`);
        }
      }

      const comments = [...issueComments.map((comment) => normalizeComment(comment, "comment")), ...reviewComments.map((comment) => normalizeComment(comment, "comment"))];
      const events = [
        ...normalizeTimelineEvents(timeline, pullDetail, true),
        ...comments.map((comment) => ({
          id: `${comment.id}-commented`,
          type: "commented" as const,
          createdAt: comment.createdAt,
        })),
      ];

      items.push({
        id: randomUUID(),
        itemKey: `github:${owner}/${repo}:pull_request:${pull.number}`,
        source: "github",
        type: "pull_request",
        sourceMeta: {
          source: "github",
          organization: owner,
          repository: repo,
          number: pull.number,
          labels: issueDetail.labels.map((label) => label.name),
          stateReason: issueDetail.state_reason,
        },
        title: pullDetail.title,
        body: pullDetail.body ?? "",
        url: pullDetail.html_url,
        status: pickStatus(pullDetail, true),
        createdAt: pullDetail.created_at,
        completedAt: pullDetail.merged_at ?? pullDetail.closed_at,
        latestActivityAt: comments[0]?.createdAt ?? pullDetail.updated_at,
        linkedItems: Array.from(linkedItems).map((target) => ({ kind: "textual" as const, target })),
        excerpts: comments.sort((left, right) => right.reactionCount - left.reactionCount || right.createdAt.localeCompare(left.createdAt)).slice(0, 3),
        metrics: {
          commentsCount: issueDetail.comments + pullDetail.review_comments,
          reactionsCount: issueDetail.reactions.total_count + comments.reduce((sum, comment) => sum + comment.reactionCount, 0),
          diffSize: pullDetail.additions + pullDetail.deletions,
          additions: pullDetail.additions,
          deletions: pullDetail.deletions,
          changedFiles: pullDetail.changed_files,
        },
        events,
        warnings: [],
        state: {
          reviewed: false,
          selected: false,
          includedInGeneratedPrompt: false,
          posted: false,
          selectionOrder: null,
        },
      });
    } catch (error) {
      warnings.push({
        id: randomUUID(),
        sourceKey: repoFullName,
        severity: "warning",
        message: `PR fetch degraded for ${repoFullName}#${pull.number}: ${(error as Error).message}`,
      });
    }
  }

  for (const issue of issueCandidates) {
    try {
      const [detail, comments, timeline] = await Promise.all([
        fetchJson<GitHubIssueDetail>(`https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}`, { headers: githubHeaders(token) }),
        fetchJson<GitHubComment[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/comments?per_page=20`, { headers: githubHeaders(token) }),
        fetchJson<GitHubTimelineEvent[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/timeline?per_page=100`, { headers: githubHeaders(token) }),
      ]);

      const linkedItems = new Set<string>(extractTextualLinks(`${detail.body ?? ""}\n${comments.map((comment) => comment.body ?? "").join("\n")}`, owner, repo));
      for (const event of timeline) {
        const repoRef = fromRepoUrl(event.source?.issue?.repository_url);
        const issueNumber = event.source?.issue?.number;
        if (repoRef && issueNumber && event.event === "cross-referenced") {
          linkedItems.add(`${repoRef}#${issueNumber}`);
        }
      }

      const normalizedComments = comments.map((comment) => normalizeComment(comment, "comment"));
      const events = [
        ...normalizeTimelineEvents(timeline, detail, false),
        ...normalizedComments.map((comment) => ({
          id: `${comment.id}-commented`,
          type: "commented" as const,
          createdAt: comment.createdAt,
        })),
      ];

      items.push({
        id: randomUUID(),
        itemKey: `github:${owner}/${repo}:issue:${issue.number}`,
        source: "github",
        type: "issue",
        sourceMeta: {
          source: "github",
          organization: owner,
          repository: repo,
          number: issue.number,
          labels: detail.labels.map((label) => label.name),
          stateReason: detail.state_reason,
        },
        title: detail.title,
        body: detail.body ?? "",
        url: detail.html_url,
        status: pickStatus(detail, false),
        createdAt: detail.created_at,
        completedAt: detail.closed_at,
        latestActivityAt: normalizedComments[0]?.createdAt ?? detail.updated_at,
        linkedItems: Array.from(linkedItems).map((target) => ({ kind: "textual" as const, target })),
        excerpts: normalizedComments.sort((left, right) => right.reactionCount - left.reactionCount || right.createdAt.localeCompare(left.createdAt)).slice(0, 3),
        metrics: {
          commentsCount: detail.comments,
          reactionsCount: detail.reactions.total_count + normalizedComments.reduce((sum, comment) => sum + comment.reactionCount, 0),
          diffSize: null,
          additions: null,
          deletions: null,
          changedFiles: null,
        },
        events,
        warnings: [],
        state: {
          reviewed: false,
          selected: false,
          includedInGeneratedPrompt: false,
          posted: false,
          selectionOrder: null,
        },
      });
    } catch (error) {
      warnings.push({
        id: randomUUID(),
        sourceKey: repoFullName,
        severity: "warning",
        message: `Issue fetch degraded for ${repoFullName}#${issue.number}: ${(error as Error).message}`,
      });
    }
  }

  return { items, warnings };
}
