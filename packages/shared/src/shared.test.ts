import { describe, expect, it } from "vitest";

import { buildSummary, computeScores, DEFAULT_SCORING_WEIGHTS, fillPromptTemplate, normalizeAppSettings, normalizeSourceConfig } from "./index";
import type { ActivityItem, FetchWindow } from "./types";

const fetchWindow: FetchWindow = {
  startDate: "2026-04-01",
  endDate: "2026-04-08",
  timeZone: "Europe/Prague",
};

const baseItem: ActivityItem = {
  id: "1",
  itemKey: "github:openai/codex:pull_request:1",
  source: "github",
  type: "pull_request",
  sourceMeta: {
    source: "github",
    organization: "openai",
    repository: "codex",
    number: 1,
    labels: [],
    stateReason: null,
  },
  title: "Improve ranking",
  body: "Adds ranking and chart generation.",
  summary: "placeholder",
  url: "https://example.com",
  status: "merged",
  createdAt: "2026-04-01T10:00:00.000Z",
  completedAt: "2026-04-02T10:00:00.000Z",
  latestActivityAt: "2026-04-02T10:00:00.000Z",
  linkedItems: [{ kind: "textual", target: "openai/codex#4" }],
  discussionTimeline: [],
  excerpts: [],
  metrics: {
    commentsCount: 3,
    reactionsCount: 2,
    diffSize: 240,
    additions: 120,
    deletions: 120,
    changedFiles: 4,
  },
  events: [
    { id: "created", type: "created", createdAt: "2026-04-01T10:00:00.000Z" },
    { id: "merged", type: "merged", createdAt: "2026-04-02T10:00:00.000Z" },
  ],
  score: { delivery: 0, engagement: 0, aiRelevance: null, total: 0 },
  activityWindow: {
    sincePostedAt: null,
    activeStart: "2026-04-01T10:00:00.000Z",
    activeEnd: "2026-04-02T10:00:00.000Z",
  },
  alreadyShared: false,
  reactivated: false,
  warnings: [],
  state: {
    reviewed: false,
    selected: true,
    includedInGeneratedPrompt: false,
    posted: false,
    selectionOrder: 1,
  },
};

describe("shared helpers", () => {
  it("computes weighted scores", () => {
    const { score: _score, summary: _summary, ...scorableItem } = baseItem;
    const score = computeScores(scorableItem, DEFAULT_SCORING_WEIGHTS);
    expect(score.delivery).toBeGreaterThan(score.engagement);
    expect(score.total).toBeGreaterThan(50);
  });

  it("builds deterministic summary", () => {
    const summary = buildSummary(baseItem);
    expect(summary).toContain("Merged work");
    expect(summary).toContain("linked reference");
  });

  it("fills the prompt template", () => {
    const prompt = fillPromptTemplate("Weekly digest\n\n{{update_list}}", [
      { ...baseItem, summary: buildSummary(baseItem) },
    ], fetchWindow);
    expect(prompt).toContain("## github / pull_request");
    expect(prompt).toContain("Improve ranking");
    expect(prompt).toContain("- Link: https://example.com");
  });

  it("renders recent forum topics with the body and latest three replies", () => {
    const prompt = fillPromptTemplate("Weekly digest\n\n{{update_list}}", [
      {
        ...baseItem,
        id: "forum-1",
        itemKey: "discourse:https://forum.logos.co:topic:1",
        source: "discourse",
        type: "forum_topic",
        sourceMeta: {
          source: "discourse",
          forumUrl: "https://forum.logos.co",
          forumName: "forum.logos.co",
          topicId: 1,
          slug: "forum-topic",
        },
        title: "Forum topic",
        status: "active",
        body: "Original post",
        url: "https://forum.logos.co/t/forum-topic/1",
        createdAt: "2026-04-02T10:00:00.000Z",
        completedAt: null,
        latestActivityAt: "2026-04-06T10:00:00.000Z",
        linkedItems: [],
        discussionTimeline: [
          { id: "body", kind: "body", author: "alice", body: "Original post", createdAt: "2026-04-02T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-1", kind: "reply", author: "bob", body: "Reply 1", createdAt: "2026-04-03T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-2", kind: "reply", author: "carol", body: "Reply 2", createdAt: "2026-04-04T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-3", kind: "reply", author: "dave", body: "Reply 3", createdAt: "2026-04-05T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-4", kind: "reply", author: "erin", body: "Reply 4", createdAt: "2026-04-06T10:00:00.000Z", reactionCount: 0 },
        ],
        excerpts: [
          { id: "reply-1", kind: "reply", author: "bob", body: "Reply 1", createdAt: "2026-04-03T10:00:00.000Z", reactionCount: 10 },
        ],
        metrics: { ...baseItem.metrics, commentsCount: 4 },
        events: [
          { id: "created", type: "created", createdAt: "2026-04-02T10:00:00.000Z" },
          { id: "reply-4-event", type: "forum_activity", createdAt: "2026-04-06T10:00:00.000Z" },
        ],
        summary: "Forum summary",
      },
    ], fetchWindow);

    expect(prompt).toContain("Original post");
    expect(prompt).not.toContain("Reply 1");
    expect(prompt).toContain("Reply 2");
    expect(prompt).toContain("Reply 3");
    expect(prompt).toContain("Reply 4");
    expect(prompt).not.toContain("Top discussion excerpts");
  });

  it("renders older forum topics with the full discussion timeline", () => {
    const prompt = fillPromptTemplate("Weekly digest\n\n{{update_list}}", [
      {
        ...baseItem,
        id: "forum-2",
        itemKey: "discourse:https://forum.logos.co:topic:2",
        source: "discourse",
        type: "forum_topic",
        sourceMeta: {
          source: "discourse",
          forumUrl: "https://forum.logos.co",
          forumName: "forum.logos.co",
          topicId: 2,
          slug: "older-topic",
        },
        title: "Older topic",
        status: "active",
        body: "Older original post",
        url: "https://forum.logos.co/t/older-topic/2",
        createdAt: "2026-03-20T10:00:00.000Z",
        completedAt: null,
        latestActivityAt: "2026-04-03T10:00:00.000Z",
        linkedItems: [],
        discussionTimeline: [
          { id: "body", kind: "body", author: "alice", body: "Older original post", createdAt: "2026-03-20T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-1", kind: "reply", author: "bob", body: "Older reply 1", createdAt: "2026-04-01T10:00:00.000Z", reactionCount: 0 },
          { id: "reply-2", kind: "reply", author: "carol", body: "Older reply 2", createdAt: "2026-04-03T10:00:00.000Z", reactionCount: 0 },
        ],
        excerpts: [],
        metrics: { ...baseItem.metrics, commentsCount: 2 },
        events: [
          { id: "created", type: "created", createdAt: "2026-03-20T10:00:00.000Z" },
          { id: "reply-2-event", type: "forum_activity", createdAt: "2026-04-03T10:00:00.000Z" },
        ],
        summary: "Forum summary",
      },
    ], fetchWindow);

    expect(prompt).toContain("Older original post");
    expect(prompt).toContain("Older reply 1");
    expect(prompt).toContain("Older reply 2");
  });

  it("normalizes legacy GitHub repo settings", () => {
    expect(normalizeSourceConfig({
      githubRepos: [" logos/repo ", ""],
      forums: ["https://forum.logos.co/"],
    })).toEqual({
      githubTargets: ["logos/repo"],
      forums: ["https://forum.logos.co/"],
    });

    expect(normalizeAppSettings({
      sourceConfig: {
        githubRepos: ["openai/codex"],
      },
    }).sourceConfig.githubTargets).toEqual(["openai/codex"]);
  });
});
