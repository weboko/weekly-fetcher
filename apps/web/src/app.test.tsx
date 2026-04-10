// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createDefaultAppSettings } from "@weekly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartCard } from "./components/ChartCard";
import { DetailPanel } from "./components/DetailPanel";
import { SettingsForm } from "./components/SettingsForm";

afterEach(() => {
  cleanup();
});

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
  discussionTimeline: [],
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

  it("validates GitHub token presence for GitHub targets", () => {
    const onFetch = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsForm
        initialSettings={createDefaultAppSettings(new Date("2026-04-08T00:00:00.000Z"))}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onFetch={onFetch}
        isFetching={false}
      />,
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "logos/weekly-fetcher\nlogos-co\norg:logos" },
    });
    fireEvent.click(screen.getByText("Fetch weekly activity"));

    expect(screen.getByText("GitHub targets require a GitHub token for fetches.")).toBeInTheDocument();
    expect(screen.getByText("owner/repo", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("owner", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("org:owner", { selector: "code" })).toBeInTheDocument();
    expect(onFetch).not.toHaveBeenCalled();
  });

  it("splits pasted GitHub targets by comma and newline before fetch", async () => {
    const onFetch = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsForm
        initialSettings={createDefaultAppSettings(new Date("2026-04-08T00:00:00.000Z"))}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onFetch={onFetch}
        isFetching={false}
      />,
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "logos/weekly-fetcher, logos-co\norg:openai" },
    });
    fireEvent.change(screen.getByPlaceholderText("Required for GitHub fetches; used for the next fetch only"), {
      target: { value: "token" },
    });
    fireEvent.click(screen.getByText("Fetch weekly activity"));

    await vi.waitFor(() => {
      expect(onFetch).toHaveBeenCalledTimes(1);
    });
    expect(onFetch.mock.calls[0][0].sourceConfig.githubTargets).toEqual([
      "logos/weekly-fetcher",
      "logos-co",
      "org:openai",
    ]);
  });
});
