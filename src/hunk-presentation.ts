import type { ReviewCheckpoint } from "./checkpoint-store";
import type { ChangesetComparison } from "./changeset";

export type HunkLiveSession = "none" | "local" | "elsewhere";

export type HunkPresentationInput = Readonly<{
	enabled: boolean;
	checkpoint?: ReviewCheckpoint;
	liveSession: HunkLiveSession;
	freshness?: ChangesetComparison;
}>;

export type HunkPresentation = Readonly<{
	status?: string;
}>;

function notes(count: number): string {
	return `${count} note${count === 1 ? "" : "s"}`;
}

/** Pure mapping from review lifecycle and freshness to footer status. */
export function presentHunk(input: HunkPresentationInput): HunkPresentation {
	if (!input.enabled) return {};
	const checkpoint = input.checkpoint;
	if (!checkpoint || checkpoint.state === "abandoned") return { status: "hunk · ready" };

	if (checkpoint.state === "reviewing") {
		return {
			status: input.liveSession === "elsewhere"
				? `hunk · reviewing elsewhere · ${notes(checkpoint.snapshot.notes.length)}`
				: `hunk · reviewing · ${notes(checkpoint.snapshot.notes.length)}`,
		};
	}

	if (checkpoint.state === "changes_requested") {
		return { status: `hunk · ${notes(checkpoint.snapshot.notes.length)} submitted` };
	}

	if (checkpoint.state === "re_review_due") {
		return { status: input.freshness?.kind === "changed" ? "hunk · re-review · external changes" : "hunk · re-review" };
	}

	if (input.freshness?.kind === "unknown") return { status: "hunk · approved · state unknown" };
	return { status: "hunk · approved" };
}
