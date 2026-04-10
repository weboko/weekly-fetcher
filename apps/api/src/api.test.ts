import { DEFAULT_SCORING_WEIGHTS, createDefaultFetchWindow } from "@weekly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "./db";
import { fetchDiscourseForumActivity } from "./services/discourse";
import { extractTextualLinks, fetchGitHubRepoActivity, parseGitHubTarget, resolveGitHubTargets } from "./services/github";
import { isReactivated } from "./services/reactivation";
import { getSettings, replaceDataset } from "./services/store";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("github link extraction", () => {
  it("captures repo-local and cross-repo references", () => {
    const links = extractTextualLinks(
      "Fixes #10 and closes openai/codex#11 while leaving refs alone",
      "logos",
      "weekly-fetcher",
    );

    expect(links).toContain("logos/weekly-fetcher#10");
    expect(links).toContain("openai/codex#11");
  });
});

describe("reactivation rules", () => {
  it("requires meaningful activity after posting", () => {
    expect(
      isReactivated(
        [
          { id: "1", type: "created", createdAt: "2026-04-01T10:00:00.000Z" },
          { id: "2", type: "commented", createdAt: "2026-04-09T10:00:00.000Z" },
        ],
        { postedAt: "2026-04-05T00:00:00.000Z" },
      ),
    ).toBe(true);
  });
});

describe("github target parsing", () => {
  it("accepts repo and org targets", () => {
    expect(parseGitHubTarget("logos/weekly-fetcher")).toMatchObject({
      kind: "repo",
      repoFullName: "logos/weekly-fetcher",
    });
    expect(parseGitHubTarget("logos-co/logos-scaffold")).toMatchObject({
      kind: "repo",
      repoFullName: "logos-co/logos-scaffold",
    });
    expect(parseGitHubTarget("org:logos")).toEqual({
      kind: "org",
      raw: "org:logos",
      org: "logos",
    });
    expect(parseGitHubTarget("logos")).toEqual({
      kind: "org",
      raw: "logos",
      org: "logos",
    });
    expect(parseGitHubTarget("logos-co/")).toEqual({
      kind: "org",
      raw: "logos-co",
      org: "logos-co",
    });
  });

  it("rejects malformed targets", () => {
    expect(parseGitHubTarget("org:logos/repo")).toBeNull();
    expect(parseGitHubTarget("logos/repo/extra")).toBeNull();
    expect(parseGitHubTarget("https://github.com/logos")).toBeNull();
  });
});

describe("github target resolution", () => {
  it("expands orgs, excludes inactive repo kinds, and de-duplicates overlaps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const parsedUrl = new URL(url);
        const page = parsedUrl.searchParams.get("page");

        if (parsedUrl.pathname === "/orgs/logos/repos" && page === "1") {
          return new Response(
            JSON.stringify([
              { full_name: "logos/weekly-fetcher", private: false, fork: false, archived: false },
              { full_name: "logos/forked", private: false, fork: true, archived: false },
              { full_name: "logos/archived", private: false, fork: false, archived: true },
              { full_name: "logos/private", private: true, fork: false, archived: false },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (parsedUrl.pathname === "/orgs/logos/repos" && page === "2") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const targets = [
      parseGitHubTarget("logos/weekly-fetcher"),
      parseGitHubTarget("org:logos"),
    ].filter((target): target is NonNullable<typeof target> => target !== null);

    const result = await resolveGitHubTargets(targets, "token");

    expect(result.warnings).toEqual([]);
    expect(result.repos).toEqual(["logos/weekly-fetcher"]);
  });

  it("uses GITHUB_API_BASE_URL when expanding org targets", async () => {
    const customBase = "https://github-proxy.example.test/api/v3";
    vi.stubEnv("GITHUB_API_BASE_URL", customBase);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const parsedUrl = new URL(url);
        const page = parsedUrl.searchParams.get("page");

        if (url.startsWith(customBase) && parsedUrl.pathname === "/api/v3/orgs/logos-co/repos" && page === "1") {
          return new Response(
            JSON.stringify([{ full_name: "logos-co/logos-scaffold", private: false, fork: false, archived: false }]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.startsWith(customBase) && parsedUrl.pathname === "/api/v3/orgs/logos-co/repos" && page === "2") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const targets = [parseGitHubTarget("org:logos-co")].filter((target): target is NonNullable<typeof target> => target !== null);
    const result = await resolveGitHubTargets(targets, "token");

    expect(result.warnings).toEqual([]);
    expect(result.repos).toEqual(["logos-co/logos-scaffold"]);
  });
});

describe("settings normalization", () => {
  it("converts legacy githubRepos to githubTargets when loading settings", () => {
    const db = createDatabase(":memory:");
    db.prepare("INSERT INTO settings (id, json) VALUES (1, ?)").run(
      JSON.stringify({
        sourceConfig: {
          githubRepos: ["logos/weekly-fetcher"],
          forums: ["https://forum.logos.co/"],
        },
        promptTemplate: "Prompt",
        scoringWeights: DEFAULT_SCORING_WEIGHTS,
        tokenLimit: 1000,
        fetchWindow: createDefaultFetchWindow(new Date("2026-04-08T00:00:00.000Z")),
      }),
    );

    const settings = getSettings(db);

    expect(settings.sourceConfig.githubTargets).toEqual(["logos/weekly-fetcher"]);
    expect(settings.sourceConfig.forums).toEqual(["https://forum.logos.co/"]);
  });
});

describe("excerpt ids", () => {
  it("stores duplicate logical excerpt ids under item-scoped row ids", () => {
    const db = createDatabase(":memory:");

    expect(() =>
      replaceDataset(db, {
        id: "dataset-1",
        cacheKey: "cache-1",
        createdAt: "2026-04-08T00:00:00.000Z",
        fetchWindow: {
          startDate: "2026-04-01",
          endDate: "2026-04-08",
          timeZone: "Europe/Prague",
        },
        sourceConfig: {
          githubTargets: ["logos/repo"],
          forums: [],
        },
        scoringWeights: DEFAULT_SCORING_WEIGHTS,
        warnings: [],
        items: [
          {
            id: "item-1",
            itemKey: "github:logos/repo:issue:1",
            source: "github",
            type: "issue",
            sourceMeta: {
              source: "github",
              organization: "logos",
              repository: "repo",
              number: 1,
              labels: [],
              stateReason: null,
            },
            title: "First item",
            body: "",
            summary: "",
            url: "https://github.com/logos/repo/issues/1",
            status: "open",
            createdAt: "2026-04-01T00:00:00.000Z",
            completedAt: null,
            latestActivityAt: "2026-04-01T00:00:00.000Z",
            linkedItems: [],
            discussionTimeline: [],
            excerpts: [
              {
                id: "duplicate",
                kind: "comment",
                author: "alice",
                body: "x",
                createdAt: "2026-04-01T00:00:00.000Z",
                reactionCount: 0,
              },
            ],
            metrics: {
              commentsCount: 1,
              reactionsCount: 0,
              diffSize: null,
              additions: null,
              deletions: null,
              changedFiles: null,
            },
            events: [{ id: "event-1", type: "created", createdAt: "2026-04-01T00:00:00.000Z" }],
            score: { delivery: 0, engagement: 0, aiRelevance: null, total: 0 },
            activityWindow: {
              sincePostedAt: null,
              activeStart: "2026-04-01T00:00:00.000Z",
              activeEnd: "2026-04-01T00:00:00.000Z",
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
          },
          {
            id: "item-2",
            itemKey: "github:logos/repo:issue:2",
            source: "github",
            type: "issue",
            sourceMeta: {
              source: "github",
              organization: "logos",
              repository: "repo",
              number: 2,
              labels: [],
              stateReason: null,
            },
            title: "Second item",
            body: "",
            summary: "",
            url: "https://github.com/logos/repo/issues/2",
            status: "open",
            createdAt: "2026-04-01T00:00:00.000Z",
            completedAt: null,
            latestActivityAt: "2026-04-01T00:00:00.000Z",
            linkedItems: [],
            discussionTimeline: [],
            excerpts: [
              {
                id: "duplicate",
                kind: "comment",
                author: "bob",
                body: "y",
                createdAt: "2026-04-01T00:00:00.000Z",
                reactionCount: 0,
              },
            ],
            metrics: {
              commentsCount: 1,
              reactionsCount: 0,
              diffSize: null,
              additions: null,
              deletions: null,
              changedFiles: null,
            },
            events: [{ id: "event-2", type: "created", createdAt: "2026-04-01T00:00:00.000Z" }],
            score: { delivery: 0, engagement: 0, aiRelevance: null, total: 0 },
            activityWindow: {
              sincePostedAt: null,
              activeStart: "2026-04-01T00:00:00.000Z",
              activeEnd: "2026-04-01T00:00:00.000Z",
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
          },
        ],
      }),
    ).not.toThrow();
  });

  it("namespaces GitHub issue and review comment excerpt ids", async () => {
    const fetchWindow = {
      startDate: "2026-04-01",
      endDate: "2026-04-08",
      timeZone: "Europe/Prague",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (url.pathname === "/repos/logos/repo/pulls" && url.searchParams.get("page") === "1") {
          return new Response(
            JSON.stringify([
              {
                number: 7,
                title: "Add feature",
                body: "Body",
                created_at: "2026-04-02T10:00:00.000Z",
                updated_at: "2026-04-03T10:00:00.000Z",
                closed_at: null,
                merged_at: null,
                draft: false,
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/repos/logos/repo/pulls" && url.searchParams.get("page") === "2") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (url.pathname === "/repos/logos/repo/issues" && (url.searchParams.get("page") === "1" || url.searchParams.get("page") === "2")) {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (url.pathname === "/repos/logos/repo/pulls/7") {
          return new Response(
            JSON.stringify({
              number: 7,
              title: "Add feature",
              body: "Body",
              html_url: "https://github.com/logos/repo/pull/7",
              created_at: "2026-04-02T10:00:00.000Z",
              updated_at: "2026-04-03T10:00:00.000Z",
              closed_at: null,
              state: "open",
              state_reason: null,
              comments: 1,
              reactions: { total_count: 0 },
              labels: [],
              merged_at: null,
              draft: false,
              review_comments: 1,
              additions: 5,
              deletions: 2,
              changed_files: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/repos/logos/repo/issues/7") {
          return new Response(
            JSON.stringify({
              number: 7,
              title: "Add feature",
              body: "Body",
              html_url: "https://github.com/logos/repo/pull/7",
              created_at: "2026-04-02T10:00:00.000Z",
              updated_at: "2026-04-03T10:00:00.000Z",
              closed_at: null,
              state: "open",
              state_reason: null,
              comments: 1,
              reactions: { total_count: 0 },
              labels: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/repos/logos/repo/issues/7/comments") {
          return new Response(
            JSON.stringify([
              {
                id: 123,
                body: "Issue comment",
                created_at: "2026-04-03T11:00:00.000Z",
                html_url: "https://github.com/logos/repo/issues/7#issuecomment-123",
                reactions: { total_count: 1 },
                user: { login: "alice" },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/repos/logos/repo/pulls/7/comments") {
          return new Response(
            JSON.stringify([
              {
                id: 123,
                body: "Review comment",
                created_at: "2026-04-03T12:00:00.000Z",
                html_url: "https://github.com/logos/repo/pull/7#discussion_r123",
                reactions: { total_count: 2 },
                user: { login: "bob" },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/repos/logos/repo/issues/7/timeline") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const result = await fetchGitHubRepoActivity("logos/repo", fetchWindow, "token");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].excerpts.map((excerpt) => excerpt.id)).toEqual([
      "github:logos/repo:review_comment:123",
      "github:logos/repo:issue_comment:123",
    ]);
    expect(new Set(result.items[0].events.map((event) => event.id)).size).toBe(result.items[0].events.length);
  });

  it("namespaces Discourse reply ids by forum", async () => {
    const forumUrl = "https://forum.logos.co";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url === `${forumUrl}/latest.json`) {
          return new Response(
            JSON.stringify({
              topic_list: {
                topics: [
                  {
                    id: 1,
                    title: "Forum topic",
                    slug: "forum-topic",
                    created_at: "2026-04-02T10:00:00.000Z",
                    last_posted_at: "2026-04-03T10:00:00.000Z",
                    reply_count: 1,
                    like_count: 0,
                    posts_count: 2,
                    visible: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200, headers: { "Content-Type": "application/xml" } });
        }

        if (url === `${forumUrl}/t/1.json?print=true`) {
          return new Response(
            JSON.stringify({
              title: "Forum topic",
              slug: "forum-topic",
              id: 1,
              created_at: "2026-04-02T10:00:00.000Z",
              last_posted_at: "2026-04-03T10:00:00.000Z",
              reply_count: 1,
              like_count: 0,
              posts_count: 2,
              post_stream: {
                stream: [10, 11],
                posts: [
                  {
                    id: 10,
                    username: "alice",
                    created_at: "2026-04-02T10:00:00.000Z",
                    cooked: "<p>Topic body</p>",
                  },
                  {
                    id: 11,
                    username: "bob",
                    created_at: "2026-04-03T10:00:00.000Z",
                    cooked: "<p>Reply body</p>",
                    actions_summary: [{ id: 1, count: 2 }],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const result = await fetchDiscourseForumActivity(forumUrl, {
      startDate: "2026-04-01",
      endDate: "2026-04-08",
      timeZone: "Europe/Prague",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].excerpts[0].id).toBe("discourse:https://forum.logos.co:post:11");
    expect(result.items[0].discussionTimeline.map((entry) => entry.id)).toEqual([
      "discourse:https://forum.logos.co:post:10",
      "discourse:https://forum.logos.co:post:11",
    ]);
  });

  it("fetches missing Discourse posts when the print view is incomplete", async () => {
    const forumUrl = "https://forum.logos.co";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (String(url) === `${forumUrl}/latest.json`) {
          return new Response(
            JSON.stringify({
              topic_list: {
                topics: [
                  {
                    id: 7,
                    title: "Long topic",
                    slug: "long-topic",
                    created_at: "2026-04-02T10:00:00.000Z",
                    last_posted_at: "2026-04-04T10:00:00.000Z",
                    reply_count: 2,
                    like_count: 0,
                    posts_count: 3,
                    visible: true,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (String(url) === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200, headers: { "Content-Type": "application/xml" } });
        }

        if (String(url) === `${forumUrl}/t/7.json?print=true`) {
          return new Response(
            JSON.stringify({
              title: "Long topic",
              slug: "long-topic",
              id: 7,
              created_at: "2026-04-02T10:00:00.000Z",
              last_posted_at: "2026-04-04T10:00:00.000Z",
              reply_count: 2,
              like_count: 0,
              posts_count: 3,
              post_stream: {
                stream: [70, 71, 72],
                posts: [
                  {
                    id: 70,
                    username: "alice",
                    created_at: "2026-04-02T10:00:00.000Z",
                    cooked: "<p>Topic body</p>",
                  },
                  {
                    id: 71,
                    username: "bob",
                    created_at: "2026-04-03T10:00:00.000Z",
                    cooked: "<p>Reply one</p>",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname === "/t/7/posts.json") {
          expect(url.searchParams.getAll("post_ids[]")).toEqual(["72"]);
          return new Response(
            JSON.stringify({
              post_stream: {
                posts: [
                  {
                    id: 72,
                    username: "carol",
                    created_at: "2026-04-04T10:00:00.000Z",
                    cooked: "<p>Reply two</p>",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const result = await fetchDiscourseForumActivity(forumUrl, {
      startDate: "2026-04-01",
      endDate: "2026-04-08",
      timeZone: "Europe/Prague",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].discussionTimeline.map((entry) => entry.body)).toEqual([
      "Topic body",
      "Reply one",
      "Reply two",
    ]);
  });
});
