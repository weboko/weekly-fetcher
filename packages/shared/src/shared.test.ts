import { describe, expect, it } from "vitest";

import { buildSummary, computeScores, DEFAULT_SCORING_WEIGHTS, fillPromptTemplate } from "./index";
import type { ActivityItem } from "./types";

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
    ]);
    expect(prompt).toContain("## github / pull_request");
    expect(prompt).toContain("Improve ranking");
  });
});
