import { afterEach, describe, expect, it, vi } from "vitest";

import { parseGitHubTarget, resolveGitHubTargets } from "./github";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseGitHubTarget", () => {
  it("parses bare org shorthand and trims trailing slashes", () => {
    expect(parseGitHubTarget("logos-co")).toEqual({
      kind: "org",
      raw: "logos-co",
      org: "logos-co",
    });

    expect(parseGitHubTarget(" logos-co/ ")).toEqual({
      kind: "org",
      raw: "logos-co",
      org: "logos-co",
    });
  });

  it("keeps explicit org and repo targets working", () => {
    expect(parseGitHubTarget("org:logos-co")).toEqual({
      kind: "org",
      raw: "org:logos-co",
      org: "logos-co",
    });

    expect(parseGitHubTarget("logos-co/logos-scaffold")).toEqual({
      kind: "repo",
      raw: "logos-co/logos-scaffold",
      owner: "logos-co",
      repo: "logos-scaffold",
      repoFullName: "logos-co/logos-scaffold",
    });
  });

  it("rejects malformed targets", () => {
    expect(parseGitHubTarget("https://github.com/logos-co")).toBeNull();
    expect(parseGitHubTarget("logos-co/logos-scaffold/issues")).toBeNull();
    expect(parseGitHubTarget("org:logos-co/logos-scaffold")).toBeNull();
  });
});

describe("resolveGitHubTargets", () => {
  it("expands bare and explicit org targets into repository lists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url === "https://api.github.com/orgs/logos-co/repos?type=public&sort=updated&per_page=100&page=1") {
          return new Response(
            JSON.stringify([
              { full_name: "logos-co/logos-scaffold", private: false, fork: false, archived: false },
              { full_name: "logos-co/internal", private: true, fork: false, archived: false },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === "https://api.github.com/orgs/logos-co/repos?type=public&sort=updated&per_page=100&page=2") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        if (url === "https://api.github.com/orgs/openai/repos?type=public&sort=updated&per_page=100&page=1") {
          return new Response(
            JSON.stringify([
              { full_name: "openai/codex", private: false, fork: false, archived: false },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === "https://api.github.com/orgs/openai/repos?type=public&sort=updated&per_page=100&page=2") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        throw new Error(`Unexpected URL ${url}`);
      }),
    );

    const result = await resolveGitHubTargets([
      parseGitHubTarget("logos-co")!,
      parseGitHubTarget("org:openai")!,
      parseGitHubTarget("logos-co/logos-scaffold")!,
    ], "token");

    expect(result.warnings).toEqual([]);
    expect(result.repos).toHaveLength(2);
    expect(result.repos).toEqual(expect.arrayContaining([
      "logos-co/logos-scaffold",
      "openai/codex",
    ]));
  });

  it("returns a warning when bare org expansion fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })),
    );

    const result = await resolveGitHubTargets([parseGitHubTarget("missing-org")!], "token");

    expect(result.repos).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].sourceKey).toBe("missing-org");
    expect(result.warnings[0].message).toContain("GitHub org expansion failed for missing-org");
  });
});
