// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartCard } from "./components/ChartCard";
import { DetailPanel } from "./components/DetailPanel";

const item = {
  id: "1",
  itemKey: "github:logos/repo:pull_request:1",
  source: "github" as const,
  type: "pull_request" as const,
  sourceMeta: {
    source: "github" as const,
    organization: "logos",
    repository: "repo",
    number: 1,
    labels: [],
    stateReason: null,
  },
  title: "Merged feature",
  body: "Body",
  summary: "Summary",
  url: "https://github.com/logos/repo/pull/1",
  status: "merged",
  createdAt: "2026-04-01T00:00:00.000Z",
  completedAt: "2026-04-02T00:00:00.000Z",
  latestActivityAt: "2026-04-02T00:00:00.000Z",
  linkedItems: [],
  excerpts: [],
  metrics: {
    commentsCount: 0,
    reactionsCount: 0,
    diffSize: 10,
    additions: 5,
    deletions: 5,
    changedFiles: 1,
  },
  events: [{ id: "1", type: "created" as const, createdAt: "2026-04-01T00:00:00.000Z" }],
  score: {
    delivery: 80,
    engagement: 10,
    aiRelevance: null,
    total: 48,
  },
  activityWindow: {
    sincePostedAt: null,
    activeStart: "2026-04-01T00:00:00.000Z",
    activeEnd: "2026-04-02T00:00:00.000Z",
  },
  alreadyShared: false,
  reactivated: false,
  warnings: [],
  state: {
    reviewed: false,
    selected: false,
    includedInGeneratedPrompt: false,
    posted: false,
    selectionOrder: null,
  },
};

describe("ui components", () => {
  it("renders detail links", () => {
    render(<DetailPanel item={item} onToggleSelected={() => undefined} onMarkPosted={() => undefined} />);
    expect(screen.getByText("Open original source")).toBeInTheDocument();
    expect(screen.getByText("Merged feature")).toBeInTheDocument();
  });

  it("renders the chart title", () => {
    render(<ChartCard items={[item]} />);
    expect(screen.getByLabelText("Weekly activity chart")).toBeInTheDocument();
  });
});
