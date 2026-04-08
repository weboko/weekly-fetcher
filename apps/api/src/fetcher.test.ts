import { DEFAULT_SCORING_WEIGHTS, type FetchRequest } from "@weekly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "./db";
import { fetchDataset } from "./services/fetcher";

const fetchWindow = {
  startDate: "2026-04-01",
  endDate: "2026-04-08",
  timeZone: "Europe/Prague",
} satisfies FetchRequest["fetchWindow"];

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
});
