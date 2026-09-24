import {
	isEditToolResult,
	isWriteToolResult,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	isDefaultGitWorkingTreeReview,
	unknownReasonMessage,
} from "./changeset";
import { loadConfig, type HunkConfig } from "./config";
import { createFileActivityStore } from "./file-activity";
import {
	createGitChangesetAdapter,
	type GitChangesetResult,
} from "./git-changeset";
import { handoffToSpawnedHunk, watchHunkSession } from "./hunk-handoff";
import {
	createHunkSessionClient,
	type HunkSessionClient,
} from "./hunk-session-client";
import { displayPath, resolveUserPath } from "./paths";
import type { ReviewSnapshot } from "./review-export";

type GitAdapter = ReturnType<typeof createGitChangesetAdapter>;

function diagnostic(
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.mode === "print" || ctx.mode === "json") {
		process.stderr.write(`[pi-hunk] ${message}\n`);
		return;
	}
	ctx.ui.notify(message, type);
}

function submissionContent(snapshot: ReviewSnapshot): string {
	const lines = [
		"Hunk review submission:",
		`Session: ${snapshot.sessionId}`,
		`Patch digest: ${snapshot.patchDigest}`,
		`Captured: ${new Date().toISOString()}`,
	];
	if (snapshot.reviewedRef) lines.push(`Reviewed ref: ${snapshot.reviewedRef}`);
	for (const [index, note] of snapshot.notes.entries()) {
		lines.push("", `Note ${index + 1}:`, `File: ${note.file}`);
		if (note.id !== undefined) lines.push(`Note ID: ${note.id}`);
		if (note.title !== undefined) lines.push(`Title: ${note.title}`);
		if (note.hunk !== undefined)
			lines.push(`Hunk: ${JSON.stringify(note.hunk)}`);
		if (note.oldRange !== undefined)
			lines.push(`Old range: ${JSON.stringify(note.oldRange)}`);
		if (note.newRange !== undefined)
			lines.push(`New range: ${JSON.stringify(note.newRange)}`);
		if (note.author !== undefined)
			lines.push(`Author: ${JSON.stringify(note.author)}`);
		lines.push("Body:", note.body);
	}
	return lines.join("\n");
}

/** Freshness-check the closed review against the working tree, then forward its human notes as one agent turn.
 * Hunk's exported patches are not byte-comparable to `git diff` output, so freshness compares the
 * Git working tree at review start with the tree at close — same serialization on both sides. */
async function forwardReview(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	git: GitAdapter,
	snapshot: ReviewSnapshot,
	baseline: GitChangesetResult,
): Promise<void> {
	if (isDefaultGitWorkingTreeReview(snapshot)) {
		if (baseline.ok) {
			const current = await git.read(ctx.cwd, ctx.signal);
			if (current.ok) {
				if (
					current.value.fingerprint.patchDigest !==
					baseline.value.fingerprint.patchDigest
				) {
					diagnostic(
						ctx,
						"The working tree changed during the review. Run /code-review again to re-review before the notes can be submitted.",
						"warning",
					);
					return;
				}
			} else {
				diagnostic(
					ctx,
					`Freshness could not be verified: ${unknownReasonMessage(current.reason)} Forwarding the captured review snapshot.`,
					"warning",
				);
			}
		} else {
			diagnostic(
				ctx,
				`Freshness could not be verified: ${unknownReasonMessage(baseline.reason)} Forwarding the captured review snapshot.`,
				"warning",
			);
		}
	}
	if (!snapshot.notes.length) {
		diagnostic(
			ctx,
			"Hunk review approved with no notes. No agent turn started.",
			"info",
		);
		return;
	}
	pi.sendMessage(
		{
			customType: "hunk-review-submission",
			content: submissionContent(snapshot),
			display: true,
			details: {
				sessionId: snapshot.sessionId,
				reviewedRef: snapshot.reviewedRef,
				patchDigest: snapshot.patchDigest,
				notes: snapshot.notes,
			},
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	);
	diagnostic(
		ctx,
		`Forwarded ${snapshot.notes.length} Hunk note(s) to the agent.`,
		"info",
	);
}

/** Spawn an owned Hunk review in this terminal; submit automatically when it closes. */
async function runSpawnedReview(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	sessionClient: HunkSessionClient,
	git: GitAdapter,
	config: HunkConfig,
	baseline: GitChangesetResult,
	recentFile?: string,
): Promise<void> {
	let handoff: Awaited<ReturnType<typeof handoffToSpawnedHunk>> | undefined;
	await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
		void handoffToSpawnedHunk({
			client: sessionClient,
			cwd: ctx.cwd,
			config,
			tui,
			onSessionReady: (lease) => {
				if (recentFile)
					void sessionClient.navigate(
						ctx.cwd,
						config,
						lease.sessionId,
						{ file: displayPath(recentFile, ctx.cwd), hunk: 1 },
						ctx.signal,
					);
			},
		})
			.then((result) => (handoff = result))
			.finally(() => done());
		return { render: () => [], invalidate() {} };
	});
	if (!handoff) return;

	const snapshot = handoff.lastValidExport;
	const problem =
		handoff.exportError?.message ??
		handoff.launchError ??
		(handoff.signal
			? `Hunk ended by ${handoff.signal}.`
			: handoff.exitCode
				? `Hunk exited with code ${handoff.exitCode}.`
				: undefined);
	if (!snapshot) {
		diagnostic(
			ctx,
			problem ?? "Hunk closed without a complete review export.",
			"error",
		);
		return;
	}
	if (problem)
		diagnostic(
			ctx,
			`Hunk closed with a recoverable warning: ${problem} The complete review export was retained.`,
			"warning",
		);
	await forwardReview(ctx, pi, git, snapshot, baseline);
}

/** Attach to a Hunk session running elsewhere; submit automatically when it closes. */
async function runAttachedReview(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	sessionClient: HunkSessionClient,
	git: GitAdapter,
	config: HunkConfig,
	baseline: GitChangesetResult,
	sessionId: string,
	recentFile?: string,
): Promise<void> {
	if (recentFile)
		void sessionClient.navigate(
			ctx.cwd,
			config,
			sessionId,
			{ file: displayPath(recentFile, ctx.cwd), hunk: 1 },
			ctx.signal,
		);
	const watch = watchHunkSession({
		client: sessionClient,
		cwd: ctx.cwd,
		config,
		sessionId,
	});
	try {
		await ctx.ui.custom<void>((_tui, _theme, _keys, done) => {
			void watch.done.then(() => done());
			return {
				render: () => [
					"  hunk · attached to the running review · notes are forwarded when Hunk closes",
				],
				invalidate() {},
			};
		});
	} finally {
		watch.stop();
	}
	const snapshot = await watch.done;
	if (!snapshot) {
		diagnostic(
			ctx,
			"The attached Hunk session closed without a complete review export.",
			"error",
		);
		return;
	}
	await forwardReview(ctx, pi, git, snapshot, baseline);
}

export default async function (pi: ExtensionAPI) {
	const sessionClient = createHunkSessionClient();
	const git = createGitChangesetAdapter();
	const activity = createFileActivityStore();

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		if (!isEditToolResult(event) && !isWriteToolResult(event)) return;
		if (typeof event.input.path !== "string") return;
		activity.record(resolveUserPath(event.input.path, ctx.cwd));
	});

	pi.registerCommand("code-review", {
		description:
			"Open a Hunk review; when it closes, its human notes are forwarded to the agent",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				diagnostic(
					ctx,
					"/code-review requires idle Pi. Wait for the agent response to finish.",
					"warning",
				);
				return;
			}
			if (ctx.mode !== "tui") {
				diagnostic(
					ctx,
					"/code-review needs TUI mode to run Hunk. Start it externally with: hunk diff --watch --no-exclude-untracked",
					"warning",
				);
				return;
			}
			const config = await loadConfig(ctx.cwd);
			if (!config.hunk.enabled) {
				diagnostic(ctx, "Hunk integration is disabled in config.", "warning");
				return;
			}
			// Baseline for the post-close freshness check; captured before the review window opens.
			const baseline = await git.read(ctx.cwd, ctx.signal);

			const probe = await sessionClient.probe(ctx.cwd, config, ctx.signal);
			if (probe.ok) {
				const pid = probe.value.pid;
				const attach = "Attach: forward its notes when Hunk closes";
				const choices = [attach];
				if (pid !== undefined)
					choices.push(`Stop Hunk (pid ${pid}) and start a new review`);
				choices.push("Cancel");
				const choice = await ctx.ui.select(
					"A Hunk session is already active for this repo",
					choices,
				);
				if (!choice || choice === "Cancel") return;
				if (choice === attach) {
					await runAttachedReview(
						ctx,
						pi,
						sessionClient,
						git,
						config,
						baseline,
						probe.value.sessionId,
						activity.mostRecent(),
					);
					return;
				}
				if (pid === undefined) return;
				try {
					process.kill(pid, "SIGTERM");
				} catch (error) {
					diagnostic(
						ctx,
						`Could not stop the running Hunk (pid ${pid}): ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}
				diagnostic(
					ctx,
					`Stopped Hunk (pid ${pid}). Starting a new review.`,
					"info",
				);
			} else if (probe.error.kind !== "session_disappeared") {
				diagnostic(ctx, probe.error.message, "error");
				return;
			}
			await runSpawnedReview(
				ctx,
				pi,
				sessionClient,
				git,
				config,
				baseline,
				activity.mostRecent(),
			);
		},
	});
}
