import { describe, expect, it } from "vitest";

import { extractTextualLinks } from "./services/github";
import { isReactivated } from "./services/reactivation";

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
