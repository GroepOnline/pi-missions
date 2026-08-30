import { describe, expect, it } from "vitest";
// @ts-ignore release.mjs is an executable JS helper without declarations
import { buildReleaseNotesFromSubjects, extractChangelogNotes, seedUnreleasedNotes } from "../scripts/release.mjs";

describe("release changelog fallback", () => {
  it("groups conventional commit subjects into useful release notes", () => {
    const notes = buildReleaseNotesFromSubjects([
      "feat(runtime): add resumable worker handoff",
      "fix(ci): remove broken caller",
      "docs: rewrite quick start",
      "chore: release 0.3.7",
    ]);

    expect(notes).toContain("### Added\n- add resumable worker handoff");
    expect(notes).toContain("### Fixed\n- remove broken caller");
    expect(notes).toContain("### Documentation\n- rewrite quick start");
    expect(notes).not.toContain("release 0.3.7");
  });

  it("seeds an empty Unreleased section and preserves authored notes", () => {
    const empty = "# Changelog\n\n## [Unreleased]\n\n## [0.3.7] - 2026-08-30\n";
    const seeded = seedUnreleasedNotes(empty, ["fix: stop blank releases"]);
    expect(seeded.seeded).toBe(true);
    expect(seeded.changelog).toContain("### Fixed\n- stop blank releases");

    const authored = "# Changelog\n\n## [Unreleased]\n\n### Added\n- Human note\n\n## [0.3.7] - 2026-08-30\n";
    const preserved = seedUnreleasedNotes(authored, ["fix: should not replace"]);
    expect(preserved.seeded).toBe(false);
    expect(preserved.changelog).toBe(authored);
  });

  it("produces a non-empty version body after the normal roll", async () => {
    // @ts-ignore release.mjs is an executable JS helper without declarations
    const { rewriteUnreleasedHeading } = await import("../scripts/release.mjs");
    const base = "# Changelog\n\n## [Unreleased]\n\n## [0.3.7] - 2026-08-30\n";
    const seeded = seedUnreleasedNotes(base, ["ci: refresh release action"]);
    const rolled = rewriteUnreleasedHeading(seeded.changelog, "0.3.8", "2026-08-31");
    expect(extractChangelogNotes(rolled.changelog, "0.3.8")).toContain("refresh release action");
  });
});
