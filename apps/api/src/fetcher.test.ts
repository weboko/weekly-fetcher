import { DEFAULT_SCORING_WEIGHTS, type FetchRequest } from "@weekly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "./db";
import { fetchDataset } from "./services/fetcher";
import { getDatasetByCacheKey } from "./services/store";

const fetchWindow = {
  startDate: "2026-04-01",
  endDate: "2026-04-08",
  timeZone: "Europe/Prague",
} satisfies FetchRequest["fetchWindow"];

function buildGitHubRepoFixture(repoFullName: string, issueNumber: number, title: string) {
  const [owner, repo] = repoFullName.split("/");
  const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;

  return {
    owner,
    repo,
    repoFullName,
    issueNumber,
    issueUrl,
    issueListEntry: {
      number: issueNumber,
      title,
      body: `${title} body`,
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-03T10:00:00.000Z",
      closed_at: null,
    },
    issueDetail: {
      number: issueNumber,
      title,
      body: `${title} body`,
      html_url: issueUrl,
      created_at: "2026-04-02T10:00:00.000Z",
      updated_at: "2026-04-03T10:00:00.000Z",
      closed_at: null,
      state: "open",
      state_reason: null,
      comments: 1,
      reactions: { total_count: 1 },
      labels: [],
    },
    issueComments: [
      {
        id: issueNumber * 100,
        body: `${title} comment`,
        created_at: "2026-04-03T11:00:00.000Z",
        html_url: `${issueUrl}#issuecomment-${issueNumber * 100}`,
        reactions: { total_count: 2 },
        user: { login: "alice" },
      },
    ],
  };
}

function stubGitHubRepoFetches(fixtures: Record<string, ReturnType<typeof buildGitHubRepoFixture>>, failingRepos: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/(pulls|issues)(?:\/(\d+)(?:\/(comments|timeline))?)?$/);
      if (!match) {
        throw new Error(`Unexpected URL ${url}`);
      }

      const repoFullName = `${match[1]}/${match[2]}`;
      const resource = match[3];
      const issueNumber = match[4] ? Number(match[4]) : null;
      const nestedResource = match[5] ?? null;
      const fixture = fixtures[repoFullName];

      if (!fixture) {
        throw new Error(`Unexpected repo ${repoFullName}`);
      }

      if (failingRepos.includes(repoFullName)) {
        throw new Error(`GitHub repo unavailable for ${repoFullName}`);
      }

      if (resource === "pulls" && issueNumber === null) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (resource === "issues" && issueNumber === null) {
        const page = url.searchParams.get("page");
        return new Response(JSON.stringify(page === "1" ? [fixture.issueListEntry] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (resource === "issues" && issueNumber === fixture.issueNumber && nestedResource === null) {
        return new Response(JSON.stringify(fixture.issueDetail), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (resource === "issues" && issueNumber === fixture.issueNumber && nestedResource === "comments") {
        return new Response(JSON.stringify(fixture.issueComments), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (resource === "issues" && issueNumber === fixture.issueNumber && nestedResource === "timeline") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchDataset", () => {
  it("skips GitHub without a token but still fetches forums", async () => {
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
                    like_count: 3,
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
              like_count: 3,
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
                    actions_summary: [{ id: 2, count: 1 }],
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

    const dataset = await fetchDataset(createDatabase(":memory:"), {
      sourceConfig: {
        githubTargets: ["logos/weekly-fetcher"],
        forums: [forumUrl],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    });

    expect(dataset.items).toHaveLength(1);
    expect(dataset.items[0].source).toBe("discourse");
    expect(dataset.items[0].discussionTimeline.map((entry) => entry.kind)).toEqual(["body", "reply"]);
    expect(dataset.warnings.some((warning) => warning.message.includes("GitHub targets require a GitHub token"))).toBe(true);
  });

  it("converts GitHub abuse responses into warnings instead of failing the dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            message: "You have triggered an abuse detection mechanism.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "retry-after": "1",
            },
          },
        )),
    );

    const dataset = await fetchDataset(createDatabase(":memory:"), {
      sourceConfig: {
        githubTargets: ["logos/weekly-fetcher"],
        forums: [],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
      githubToken: "token",
    });

    expect(dataset.items).toHaveLength(0);
    expect(dataset.warnings.some((warning) => warning.message.includes("GitHub fetch failed for logos/weekly-fetcher"))).toBe(true);
    expect(dataset.warnings.some((warning) => warning.message.includes("abuse detection mechanism"))).toBe(true);
  });

  it("reuses cached GitHub items when a later fetch fails for the same cache key", async () => {
    const db = createDatabase(":memory:");
    const request: FetchRequest = {
      sourceConfig: {
        githubTargets: ["logos/weekly-fetcher"],
        forums: [],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
      githubToken: "token",
    };

    stubGitHubRepoFetches({
      "logos/weekly-fetcher": buildGitHubRepoFixture("logos/weekly-fetcher", 7, "Initial GitHub issue"),
    });

    const firstDataset = await fetchDataset(db, request);
    expect(firstDataset.items).toHaveLength(1);
    expect(firstDataset.items[0].title).toBe("Initial GitHub issue");

    stubGitHubRepoFetches({
      "logos/weekly-fetcher": buildGitHubRepoFixture("logos/weekly-fetcher", 7, "Ignored replacement"),
    }, ["logos/weekly-fetcher"]);

    const secondDataset = await fetchDataset(db, request);

    expect(secondDataset.items).toHaveLength(1);
    expect(secondDataset.items[0].itemKey).toBe(firstDataset.items[0].itemKey);
    expect(secondDataset.items[0].title).toBe("Initial GitHub issue");
    expect(secondDataset.items[0].warnings).toContain("Showing previously cached GitHub content because latest refresh failed.");
    expect(secondDataset.warnings.some((warning) => warning.message.includes("GitHub fetch failed for logos/weekly-fetcher"))).toBe(true);
    expect(secondDataset.warnings.some((warning) => warning.message.includes("reused cached GitHub data"))).toBe(true);

    const persistedDataset = getDatasetByCacheKey(db, firstDataset.cacheKey);
    expect(persistedDataset?.items.map((item) => item.itemKey)).toEqual(secondDataset.items.map((item) => item.itemKey));
    expect(persistedDataset?.warnings.map((warning) => warning.message)).toEqual(secondDataset.warnings.map((warning) => warning.message));
  });

  it("reuses cached GitHub items only for repos whose refresh failed", async () => {
    const db = createDatabase(":memory:");
    const request: FetchRequest = {
      sourceConfig: {
        githubTargets: ["logos/repo-one", "logos/repo-two"],
        forums: [],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
      githubToken: "token",
    };

    stubGitHubRepoFetches({
      "logos/repo-one": buildGitHubRepoFixture("logos/repo-one", 11, "Repo one old"),
      "logos/repo-two": buildGitHubRepoFixture("logos/repo-two", 22, "Repo two old"),
    });

    const firstDataset = await fetchDataset(db, request);
    expect(firstDataset.items).toHaveLength(2);

    stubGitHubRepoFetches({
      "logos/repo-one": buildGitHubRepoFixture("logos/repo-one", 11, "Repo one new"),
      "logos/repo-two": buildGitHubRepoFixture("logos/repo-two", 22, "Repo two ignored"),
    }, ["logos/repo-two"]);

    const secondDataset = await fetchDataset(db, request);
    const repoOneItem = secondDataset.items.find((item) =>
      item.sourceMeta.source === "github"
      && item.sourceMeta.organization === "logos"
      && item.sourceMeta.repository === "repo-one");
    const repoTwoItem = secondDataset.items.find((item) =>
      item.sourceMeta.source === "github"
      && item.sourceMeta.organization === "logos"
      && item.sourceMeta.repository === "repo-two");

    expect(secondDataset.items).toHaveLength(2);
    expect(repoOneItem?.title).toBe("Repo one new");
    expect(repoOneItem?.warnings).not.toContain("Showing previously cached GitHub content because latest refresh failed.");
    expect(repoTwoItem?.title).toBe("Repo two old");
    expect(repoTwoItem?.warnings).toContain("Showing previously cached GitHub content because latest refresh failed.");
    expect(secondDataset.warnings.some((warning) => warning.message.includes("GitHub fetch failed for logos/repo-two"))).toBe(true);
    expect(secondDataset.warnings.some((warning) => warning.message.includes("reused cached GitHub data"))).toBe(true);
  });

  it("warns on malformed GitHub targets with the accepted formats", async () => {
    const dataset = await fetchDataset(createDatabase(":memory:"), {
      sourceConfig: {
        githubTargets: ["logos-co/logos-scaffold/issues"],
        forums: [],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    });

    expect(dataset.items).toHaveLength(0);
    expect(dataset.warnings).toHaveLength(1);
    expect(dataset.warnings[0].message).toBe(
      'Invalid GitHub target "logos-co/logos-scaffold/issues". Use owner/repo, owner, or org:owner.',
    );
  });

  it("persists items when fetched excerpts reuse the same raw upstream id across items", async () => {
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
                    title: "Topic one",
                    slug: "topic-one",
                    created_at: "2026-04-02T10:00:00.000Z",
                    last_posted_at: "2026-04-03T10:00:00.000Z",
                    reply_count: 1,
                    like_count: 1,
                    posts_count: 2,
                    visible: true,
                  },
                  {
                    id: 2,
                    title: "Topic two",
                    slug: "topic-two",
                    created_at: "2026-04-02T11:00:00.000Z",
                    last_posted_at: "2026-04-03T11:00:00.000Z",
                    reply_count: 1,
                    like_count: 1,
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
              title: "Topic one",
              slug: "topic-one",
              id: 1,
              created_at: "2026-04-02T10:00:00.000Z",
              last_posted_at: "2026-04-03T10:00:00.000Z",
              reply_count: 1,
              like_count: 1,
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
                    actions_summary: [{ id: 1, count: 1 }],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === `${forumUrl}/t/2.json?print=true`) {
          return new Response(
            JSON.stringify({
              title: "Topic two",
              slug: "topic-two",
              id: 2,
              created_at: "2026-04-02T11:00:00.000Z",
              last_posted_at: "2026-04-03T11:00:00.000Z",
              reply_count: 1,
              like_count: 1,
              posts_count: 2,
              post_stream: {
                stream: [20, 11],
                posts: [
                  {
                    id: 20,
                    username: "carol",
                    created_at: "2026-04-02T11:00:00.000Z",
                    cooked: "<p>Topic body</p>",
                  },
                  {
                    id: 11,
                    username: "dave",
                    created_at: "2026-04-03T11:00:00.000Z",
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

    const dataset = await fetchDataset(createDatabase(":memory:"), {
      sourceConfig: {
        githubTargets: [],
        forums: [forumUrl],
      },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    });

    expect(dataset.items).toHaveLength(2);
    expect(dataset.items.every((item) => item.excerpts.length === 1)).toBe(true);
  });

  it("reuses cached forum items when an entire forum fetch fails", async () => {
    const db = createDatabase(":memory:");
    const forumUrl = "https://forum.logos.co";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === `${forumUrl}/latest.json`) {
          return new Response(JSON.stringify({
            topic_list: {
              topics: [{
                id: 1,
                title: "Forum topic",
                slug: "forum-topic",
                created_at: "2026-04-02T10:00:00.000Z",
                last_posted_at: "2026-04-03T10:00:00.000Z",
                reply_count: 1,
                like_count: 3,
                posts_count: 2,
                visible: true,
              }],
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200 });
        }
        if (url === `${forumUrl}/t/1.json?print=true`) {
          return new Response(JSON.stringify({
            title: "Forum topic",
            slug: "forum-topic",
            id: 1,
            created_at: "2026-04-02T10:00:00.000Z",
            last_posted_at: "2026-04-03T10:00:00.000Z",
            reply_count: 1,
            like_count: 3,
            posts_count: 2,
            post_stream: {
              stream: [10, 11],
              posts: [
                { id: 10, username: "alice", created_at: "2026-04-02T10:00:00.000Z", cooked: "<p>Topic body</p>" },
                { id: 11, username: "bob", created_at: "2026-04-03T10:00:00.000Z", cooked: "<p>Reply body</p>" },
              ],
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const request: FetchRequest = {
      sourceConfig: { githubTargets: [], forums: [forumUrl] },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    };
    const firstDataset = await fetchDataset(db, request);
    expect(firstDataset.items).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === `${forumUrl}/latest.json`) {
          throw new Error("latest.json unavailable");
        }
        throw new Error(`Unexpected URL ${String(input)}`);
      }),
    );

    const secondDataset = await fetchDataset(db, request);
    expect(secondDataset.items).toHaveLength(1);
    expect(secondDataset.items[0].itemKey).toBe(firstDataset.items[0].itemKey);
    expect(secondDataset.warnings.some((warning) => warning.message.includes("reused cached forum data"))).toBe(true);
  });

  it("reuses cached richer forum topic content when topic detail fetch is degraded", async () => {
    const db = createDatabase(":memory:");
    const forumUrl = "https://forum.logos.co";
    const request: FetchRequest = {
      sourceConfig: { githubTargets: [], forums: [forumUrl] },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === `${forumUrl}/latest.json`) {
          return new Response(JSON.stringify({
            topic_list: {
              topics: [{
                id: 1, title: "Forum topic", slug: "forum-topic", created_at: "2026-04-02T10:00:00.000Z",
                last_posted_at: "2026-04-03T10:00:00.000Z", reply_count: 1, like_count: 3, posts_count: 2, visible: true,
              }],
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200 });
        }
        if (url === `${forumUrl}/t/1.json?print=true`) {
          return new Response(JSON.stringify({
            title: "Forum topic", slug: "forum-topic", id: 1, created_at: "2026-04-02T10:00:00.000Z", last_posted_at: "2026-04-03T10:00:00.000Z",
            reply_count: 1, like_count: 3, posts_count: 2, post_stream: { stream: [10, 11], posts: [
              { id: 10, username: "alice", created_at: "2026-04-02T10:00:00.000Z", cooked: "<p>Topic body</p>" },
              { id: 11, username: "bob", created_at: "2026-04-03T10:00:00.000Z", cooked: "<p>Reply body</p>" },
            ] },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    );
    const firstDataset = await fetchDataset(db, request);
    expect(firstDataset.items[0].discussionTimeline.length).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === `${forumUrl}/latest.json`) {
          return new Response(JSON.stringify({
            topic_list: {
              topics: [{
                id: 1, title: "Forum topic", slug: "forum-topic", created_at: "2026-04-02T10:00:00.000Z",
                last_posted_at: "2026-04-03T10:00:00.000Z", reply_count: 1, like_count: 3, posts_count: 2, visible: true,
              }],
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200 });
        }
        if (url === `${forumUrl}/t/1.json?print=true`) {
          return new Response(JSON.stringify({
            errors: ["You’ve performed this action too many times, please try again later."],
          }), { status: 422, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const secondDataset = await fetchDataset(db, request);
    expect(secondDataset.items[0].body).toBe("Topic body");
    expect(secondDataset.items[0].discussionTimeline.length).toBeGreaterThan(0);
    expect(secondDataset.items[0].warnings.some((warning) => warning.includes("previously cached forum content"))).toBe(true);
  });

  it("retries transient discourse 422 responses before succeeding", async () => {
    const forumUrl = "https://forum.logos.co";
    let topicAttempts = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === `${forumUrl}/latest.json`) {
          return new Response(JSON.stringify({
            topic_list: {
              topics: [{
                id: 1, title: "Forum topic", slug: "forum-topic", created_at: "2026-04-02T10:00:00.000Z",
                last_posted_at: "2026-04-03T10:00:00.000Z", reply_count: 1, like_count: 3, posts_count: 2, visible: true,
              }],
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `${forumUrl}/latest.rss`) {
          return new Response("<rss><channel /></rss>", { status: 200 });
        }
        if (url === `${forumUrl}/t/1.json?print=true`) {
          topicAttempts += 1;
          if (topicAttempts < 3) {
            return new Response(JSON.stringify({
              errors: ["You’ve performed this action too many times, please try again later."],
            }), { status: 422, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({
            title: "Forum topic", slug: "forum-topic", id: 1, created_at: "2026-04-02T10:00:00.000Z", last_posted_at: "2026-04-03T10:00:00.000Z",
            reply_count: 1, like_count: 3, posts_count: 2, post_stream: { stream: [10], posts: [
              { id: 10, username: "alice", created_at: "2026-04-02T10:00:00.000Z", cooked: "<p>Topic body</p>" },
            ] },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const dataset = await fetchDataset(createDatabase(":memory:"), {
      sourceConfig: { githubTargets: [], forums: [forumUrl] },
      fetchWindow,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    });

    expect(topicAttempts).toBe(3);
    expect(dataset.items[0].body).toBe("Topic body");
    expect(dataset.warnings.some((warning) => warning.message.includes("partially parsed"))).toBe(false);
  });
});
