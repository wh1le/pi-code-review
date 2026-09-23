import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function findPiPackageRoot() {
	for (const candidate of [process.env.PI_CODING_AGENT_ROOT, path.join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent"), "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent", "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent", path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "@earendil-works", "pi-coding-agent")].filter(Boolean)) {
		if (existsSync(path.join(candidate, "package.json"))) return candidate;
	}
	throw new Error("Could not locate @earendil-works/pi-coding-agent.");
}
const piRoot = findPiPackageRoot();
const requireFromPi = createRequire(path.join(piRoot, "package.json"));
const jiti = requireFromPi("jiti")(import.meta.url, {
	interopDefault: true,
	moduleCache: false,
	fsCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": path.join(piRoot, "dist", "index.js"),
	},
});

const { DEFAULT_CONFIG, mergeConfig } = await jiti.import(path.join(repoRoot, "src/config.ts"), { default: false });
const { createFileActivityStore } = await jiti.import(path.join(repoRoot, "src/file-activity.ts"), { default: false });
const { normalizeReviewExport, patchDigest, sameSnapshot } = await jiti.import(path.join(repoRoot, "src/review-export.ts"), { default: false });
const { createChangesetBaseline, changesetDigest, compareGitFingerprint, gitFingerprint, isDefaultGitWorkingTreeReview } = await jiti.import(path.join(repoRoot, "src/changeset.ts"), { default: false });
const { createGitChangesetAdapter } = await jiti.import(path.join(repoRoot, "src/git-changeset.ts"), { default: false });
const { presentHunk } = await jiti.import(path.join(repoRoot, "src/hunk-presentation.ts"), { default: false });
const { createCheckpointStore } = await jiti.import(path.join(repoRoot, "src/checkpoint-store.ts"), { default: false });
const { createHunkSessionClient } = await jiti.import(path.join(repoRoot, "src/hunk-session-client.ts"), { default: false });
const { createSamplingLease, handoffToSpawnedHunk } = await jiti.import(path.join(repoRoot, "src/hunk-handoff.ts"), { default: false });
const { createReviewCoordinator } = await jiti.import(path.join(repoRoot, "src/review-coordinator.ts"), { default: false });

const patchA = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n");
const patchB = ["--- a/b.ts", "+++ b/b.ts", "@@ -2,1 +2,1 @@", "-before", "+after"].join("\n");

function review({ notes = [{ source: "user", filePath: "a.ts", newRange: [1, 1], hunk: 1, body: "keep\nexact body", author: "human", createdAt: "2026-01-01T00:00:00.000Z" }], firstPatch = patchA } = {}) {
	return {
		sessionId: "session-1",
		title: "pi-hunk main...topic",
		sourceLabel: "/pi-hunk",
		repoRoot: "/pi-hunk",
		inputKind: "vcs",
		files: [
			{ id: "file-a", path: "a.ts", patch: firstPatch, additions: 1, deletions: 1, hunkCount: 1, hunks: [{ oldStart: 1, newStart: 1 }] },
			{ path: "b.ts", previousPath: "old-b.ts", patch: patchB, additions: 1, deletions: 1, hunkCount: 1, hunks: [{ oldStart: 2, newStart: 2 }] },
		],
		reviewNotes: notes,
	};
}

// Configuration contains only Hunk integration settings.
{
	assert.deepEqual(DEFAULT_CONFIG, { hunk: { enabled: true, binary: "hunk" } });
	assert.deepEqual(mergeConfig(DEFAULT_CONFIG, { hunk: { enabled: false, binary: "/opt/bin/hunk" } }), { hunk: { enabled: false, binary: "/opt/bin/hunk" } });
}

// Successful file activity only needs latest path for Hunk navigation.
{
	const activity = createFileActivityStore();
	assert.equal(activity.mostRecent(), undefined);
	activity.record("/repo/a.ts");
	activity.record("/repo/b.ts");
	assert.equal(activity.mostRecent(), "/repo/b.ts");
}

// Complete export preserves raw patches, file order, and exact human note body.
const normalized = normalizeReviewExport(review({ notes: [
	{ noteId: "note-1", source: "user", filePath: "a.ts", newRange: [1, 1], hunk: 1, title: "Exact note", body: "  exact\nbody  ", author: "human", createdAt: "now" },
	{ source: "agent", filePath: "a.ts", newRange: [1, 1], body: "hidden" },
] }));
assert.equal(normalized.ok, true);
const snapshot = normalized.snapshot;
assert.deepEqual(snapshot.files.map((file) => file.path), ["a.ts", "b.ts"]);
assert.equal(snapshot.files[0].patch, patchA);
assert.equal(snapshot.notes.length, 1);
assert.equal(snapshot.notes[0].body, "  exact\nbody  ");
assert.equal(snapshot.notes[0].id, "note-1");
assert.equal(snapshot.notes[0].title, "Exact note");
assert.equal(snapshot.files[0].id, "file-a");
assert.equal(snapshot.source.repoRoot, "/pi-hunk");
assert.equal(snapshot.source.inputKind, "vcs");
assert.equal(snapshot.reviewedRef, undefined, "display titles are not reviewed refs");
const nestedRef = normalizeReviewExport({ ...review(), title: undefined, input: { range: "main...nested", kind: "vcs" } }).snapshot;
assert.equal(nestedRef.reviewedRef, "main...nested", "nested Hunk review coordinates are preserved");
assert.deepEqual(nestedRef.source.input, { range: "main...nested", kind: "vcs" });
assert.equal(snapshot.patchDigest, patchDigest(snapshot.files));
assert.equal(snapshot.patchDigest, patchDigest([...snapshot.files].reverse()), "file order does not change canonical patch identity");
const reorderedPayload = review({ notes: [
	{ noteId: "note-1", source: "user", filePath: "a.ts", newRange: [1, 1], hunk: 1, title: "Exact note", body: "  exact\nbody  ", author: "human", createdAt: "now" },
	{ source: "agent", filePath: "a.ts", newRange: [1, 1], body: "hidden" },
] });
reorderedPayload.files.reverse();
assert.equal(sameSnapshot(snapshot, normalizeReviewExport(reorderedPayload).snapshot), true, "export ordering does not create spurious revision");
assert.notEqual(snapshot.reviewIdentity, snapshot.patchDigest);
assert.equal(normalizeReviewExport({ comments: [{ type: "user", body: "legacy" }] }).ok, false, "comment-list payload rejected");
assert.equal(normalizeReviewExport({ sessionId: "s", files: [{ path: "a", additions: 1 }], reviewNotes: [] }).ok, false, "missing patch rejected");
assert.equal(normalizeReviewExport(review({ notes: [{ source: "user", filePath: "a.ts", body: 4 }] })).ok, false, "malformed human note rejected");
assert.equal(normalizeReviewExport({ ...review(), files: [...review().files, review().files[0]] }).ok, false, "duplicate reviewed file paths rejected");

// Complete changeset fingerprints include untracked files and conservative target checks.
{
	const untrackedPatch = "--- /dev/null\n+++ b/untracked.ts\n@@ -0,0 +1,1 @@\n+new file";
	const withUntracked = normalizeReviewExport({
		...review({ notes: [] }),
		files: [...review({ notes: [] }).files.slice(0, 1), { path: "untracked.ts", patch: untrackedPatch, additions: 1, deletions: 0, hunkCount: 1, hunks: [{ oldStart: 0, newStart: 1 }] }],
	}).snapshot;
	assert.equal(changesetDigest(withUntracked.files), changesetDigest([...withUntracked.files].reverse()));
	assert.notEqual(changesetDigest(withUntracked.files), changesetDigest(withUntracked.files.map((file) => file.path === "a.ts" ? { ...file, patch: patchB } : file)));
	assert.equal(isDefaultGitWorkingTreeReview(snapshot), true);
	assert.equal(isDefaultGitWorkingTreeReview(nestedRef), false);

	const calls = [];
	let tracked = patchA;
	const adapter = createGitChangesetAdapter(async (args) => {
		calls.push(args);
		if (args[0] === "diff" && args[1] === "--no-index") return { stdout: `diff --git a/untracked.ts b/untracked.ts\nnew file mode 100644\n${untrackedPatch}`, stderr: "", code: 1, signal: null };
		if (args[0] === "diff") return { stdout: `diff --git a/a.ts b/a.ts\nindex 1..2 100644\n${tracked}`, stderr: "", code: 0, signal: null };
		return { stdout: "?? untracked.ts\0", stderr: "", code: 0, signal: null };
	});
	const fallback = await adapter.captureFallback("/repo", withUntracked);
	assert.ok(fallback.fingerprint);
	assert.ok(calls.some((args) => args.includes("--no-optional-locks")));
	assert.ok(calls.some((args) => args.includes("--no-index")));
	const currentGit = await adapter.read("/repo");
	assert.equal(compareGitFingerprint({ hunk: { sessionId: "s", targetSignature: "", patchDigest: "h" }, git: fallback.fingerprint }, currentGit.value.fingerprint).kind, "unchanged");
	tracked = patchB;
	const changedGit = await adapter.read("/repo");
	assert.equal(compareGitFingerprint({ hunk: { sessionId: "s", targetSignature: "", patchDigest: "h" }, git: fallback.fingerprint }, changedGit.value.fingerprint).kind, "changed");

	const missingGit = createGitChangesetAdapter(async () => ({ stdout: "", stderr: "", code: null, signal: null, launchError: Object.assign(new Error("missing"), { code: "ENOENT" }) }));
	assert.equal((await missingGit.read("/repo")).reason, "git_unavailable");
	const timedGit = createGitChangesetAdapter(async () => ({ stdout: "", stderr: "", code: null, signal: null, timedOut: true }));
	assert.equal((await timedGit.read("/repo")).reason, "git_timeout");
	const malformedGit = createGitChangesetAdapter(async (args) => args[0] === "diff" ? { stdout: "not a diff", stderr: "", code: 0, signal: null } : { stdout: "", stderr: "", code: 0, signal: null });
	assert.equal((await malformedGit.read("/repo")).reason, "git_malformed");
	const stagedGit = createGitChangesetAdapter(async (args) => args[0] === "diff" ? { stdout: "", stderr: "", code: 0, signal: null } : { stdout: "M  staged.ts\0", stderr: "", code: 0, signal: null });
	assert.equal((await stagedGit.read("/repo")).reason, "git_staged_target");
}

// Append-only state transitions and immutable revisions.
{
	const events = [];
	let ids = 0;
	let clockTick = 0;
	const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clockTick++)).toISOString();
	const store = createCheckpointStore((event) => events.push(event), () => `checkpoint-${++ids}`, now);
	const one = store.captureDraft(snapshot);
	assert.equal(one.ok, true);
	assert.equal(one.checkpoint.revision, 1);
	assert.equal(one.checkpoint.createdAt, "2026-01-01T00:00:00.000Z");
	assert.equal(one.checkpoint.revisionCapturedAt, one.checkpoint.createdAt);
	assert.equal(store.captureDraft(snapshot).persisted, false);
	const changedNotes = normalizeReviewExport(review({ notes: [{ source: "user", filePath: "a.ts", newRange: [1, 1], body: "changed note" }] })).snapshot;
	const two = store.captureDraft(changedNotes);
	assert.equal(two.checkpoint.revision, 2);
	assert.equal(two.checkpoint.createdAt, one.checkpoint.createdAt);
	assert.notEqual(two.checkpoint.revisionCapturedAt, one.checkpoint.revisionCapturedAt);
	assert.equal(one.checkpoint.snapshot.notes[0].body, "  exact\nbody  ");
	const requested = store.submit().checkpoint;
	assert.equal(requested.state, "changes_requested");
	assert.equal(requested.submittedAt, requested.updatedAt);
	assert.equal(store.captureDraft(changedNotes).ok, false);
	assert.equal(store.reconcileChangeset({ kind: "changed", source: "hunk" }).checkpoint.state, "re_review_due");
	const empty = normalizeReviewExport(review({ notes: [] })).snapshot;
	assert.equal(store.beginReview(empty).checkpoint.revision, 3);
	const approved = store.submit().checkpoint;
	assert.equal(approved.state, "approved");
	assert.equal(approved.submittedAt, approved.updatedAt);
	assert.equal(store.submit().ok, false);
	const newReview = store.captureDraft(snapshot);
	assert.equal(newReview.checkpoint.revision, 1);
	assert.notEqual(newReview.checkpoint.id, one.checkpoint.id);
	const abandoned = store.abandon().checkpoint;
	assert.equal(abandoned.state, "abandoned");
	assert.equal(abandoned.abandonedAt, abandoned.updatedAt);
	assert.equal(events.filter((event) => event.kind === "capture").length, 4);
	assert.ok(events.every((event) => event.version === 3));
	assert.ok(events.every((event) => Number.isFinite(Date.parse(event.at))));

	const branch = events.map((data) => ({ type: "custom", customType: "hunk-checkpoint", data }));
	const corruptSnapshot = { ...events.find((event) => event.kind === "capture"), snapshot: { ...snapshot, notes: [null] } };
	const restored = createCheckpointStore(() => {});
	restored.rehydrate([
		{ type: "custom", customType: "hunk-checkpoint", data: { version: 99 } },
		{ type: "custom", customType: "hunk-checkpoint", data: corruptSnapshot },
		...branch,
	]);
	assert.equal(restored.current().state, "abandoned");
	assert.equal(restored.current().abandonedAt, abandoned.abandonedAt);
	assert.equal(restored.diagnostics().ignoredEntries, 2);

	const failedCapture = createCheckpointStore(() => { throw new Error("journal unavailable"); });
	assert.throws(() => failedCapture.captureDraft(snapshot), /journal unavailable/);
	assert.equal(failedCapture.current(), undefined);
	const throwingTransition = createCheckpointStore(() => { throw new Error("journal unavailable"); }, () => "atomic", now);
	throwingTransition.rehydrate([{ type: "custom", customType: "hunk-checkpoint", data: events[0] }]);
	assert.throws(() => throwingTransition.submit(), /journal unavailable/);
	assert.equal(throwingTransition.current().state, "reviewing");
}

// Changeset reconciliation is monotonic; older journal versions stay readable.
{
	const events = [];
	const baseline = createChangesetBaseline(snapshot);
	const store = createCheckpointStore((event) => events.push(event), () => "monotonic", () => "2026-01-01T00:00:00.000Z");
	assert.equal(store.beginReview(snapshot, baseline).ok, true);
	assert.equal(store.submit().checkpoint.state, "changes_requested");
	assert.equal(store.reconcileChangeset({ kind: "changed", source: "git" }).checkpoint.state, "re_review_due");
	assert.equal(events.at(-1).reason, "changeset_changed");
	assert.equal(store.reconcileChangeset({ kind: "unchanged", source: "git" }).checkpoint.state, "re_review_due");
	assert.equal(store.beginReview(snapshot, baseline).checkpoint.revision, 2);

	const approvedEmpty = createCheckpointStore(() => {}, () => "approved-id", () => "2026-01-01T00:00:00.000Z");
	assert.equal(approvedEmpty.beginReview(normalizeReviewExport(review({ notes: [] })).snapshot, baseline).ok, true);
	assert.equal(approvedEmpty.submit().checkpoint.state, "approved");
	assert.equal(approvedEmpty.beginReview(normalizeReviewExport(review({ notes: [] })).snapshot, baseline).checkpoint.revision, 1);

	const v1 = createCheckpointStore(() => {});
	v1.rehydrate([{ type: "custom", customType: "hunk-checkpoint", data: { version: 1, kind: "capture", checkpointId: "v1", revision: 1, at: "2026-01-01T00:00:00.000Z", snapshot } }]);
	assert.equal(v1.current().baseline.git, undefined);
	const v2 = createCheckpointStore(() => {});
	v2.rehydrate([{ type: "custom", customType: "hunk-checkpoint", data: { version: 2, kind: "capture", checkpointId: "v2", revision: 1, at: "2026-01-01T00:00:00.000Z", snapshot, baseline: { ...baseline, obsolete: 4 } } }]);
	assert.equal(v2.current().id, "v2");
	const malformed = createCheckpointStore(() => {});
	malformed.rehydrate([{ type: "custom", customType: "hunk-checkpoint", data: { version: 2, kind: "capture", checkpointId: "bad", revision: 1, at: "2026-01-01T00:00:00.000Z", snapshot, baseline: { hunk: {} } } }]);
	assert.equal(malformed.current(), undefined);
}

// Footer status is pure review-state presentation.
{
	const checkpoint = createCheckpointStore(() => {}, () => "presentation-id", () => "2026-01-01T00:00:00.000Z");
	const reviewed = checkpoint.beginReview(snapshot).checkpoint;
	assert.deepEqual(presentHunk({ enabled: true, checkpoint: reviewed, liveSession: "none" }), { status: "hunk · reviewing · 1 note" });
	assert.deepEqual(presentHunk({ enabled: true, checkpoint: reviewed, liveSession: "elsewhere" }), { status: "hunk · reviewing elsewhere · 1 note" });
	const external = checkpoint.reconcileChangeset({ kind: "changed", source: "git" }).checkpoint;
	assert.deepEqual(presentHunk({ enabled: true, checkpoint: external, liveSession: "none", freshness: { kind: "changed", source: "git" } }), { status: "hunk · re-review · external changes" });
	assert.deepEqual(presentHunk({ enabled: true, checkpoint: { ...external, state: "approved" }, liveSession: "none", freshness: { kind: "unchanged", source: "hunk" } }), { status: "hunk · approved" });
	assert.deepEqual(presentHunk({ enabled: true, checkpoint: { ...external, state: "approved" }, liveSession: "none", freshness: { kind: "unknown", reason: "missing_git_fallback" } }), { status: "hunk · approved · state unknown" });
	assert.deepEqual(presentHunk({ enabled: false, checkpoint: reviewed, liveSession: "none" }), {});
}

// Read-only client uses complete review export command and no comment API.
{
	const calls = [];
	const client = createHunkSessionClient(async (_binary, args) => {
		calls.push(args);
		if (args[1] === "get") return { stdout: JSON.stringify({ id: "session-1", pid: "4242" }), stderr: "", code: 0, signal: null };
		if (args[1] === "review") return { stdout: JSON.stringify(review()), stderr: "", code: 0, signal: null };
		return { stdout: "", stderr: "", code: 0, signal: null };
	});
	const probe = await client.probe("/repo", DEFAULT_CONFIG);
	assert.equal(probe.ok, true);
	assert.equal(probe.value.pid, 4242);
	assert.equal((await client.readReview("/repo", DEFAULT_CONFIG, "session-1")).ok, true);
	assert.deepEqual(calls[0], ["session", "get", "--repo", "/repo", "--json"]);
	assert.deepEqual(calls[1], ["session", "review", "session-1", "--include-patch", "--include-notes", "--json"]);
	await client.navigate("/repo", DEFAULT_CONFIG, "session-1", { file: "a.ts", hunk: 1 });
	assert.deepEqual(calls[2], ["session", "navigate", "session-1", "--file", "a.ts", "--hunk", "1"]);
	assert.equal(calls.some((args) => args.includes("comment") || args.includes("reload")), false);
	const unsupported = createHunkSessionClient(async () => ({ stdout: "", stderr: "unknown command", code: 1, signal: null }));
	assert.equal((await unsupported.readReview("/repo", DEFAULT_CONFIG)).error.kind, "unsupported_command");
	const malformed = createHunkSessionClient(async () => ({ stdout: "not json", stderr: "", code: 0, signal: null }));
	assert.equal((await malformed.readReview("/repo", DEFAULT_CONFIG)).error.kind, "malformed_json");
	const missing = createHunkSessionClient(async () => ({ stdout: "", stderr: "", code: null, signal: null, launchError: Object.assign(new Error("missing"), { code: "ENOENT" }) }));
	assert.equal((await missing.probe("/repo", DEFAULT_CONFIG)).error.kind, "missing_binary");
	const signalled = createHunkSessionClient(async () => ({ stdout: "", stderr: "", code: null, signal: "SIGTERM" }));
	assert.equal((await signalled.probe("/repo", DEFAULT_CONFIG)).error.kind, "signal");
	const timedOut = createHunkSessionClient(async () => ({ stdout: "", stderr: "", code: null, signal: null, timedOut: true }));
	assert.equal((await timedOut.probe("/repo", DEFAULT_CONFIG)).error.kind, "timeout");
	// Hunk 0.22 reports "no live session for this repo" as protocol-validation-failed.
	const noSession = createHunkSessionClient(async () => ({ stdout: "", stderr: "hunk: protocol-validation-failed", code: 1, signal: null }));
	assert.equal((await noSession.probe("/repo", DEFAULT_CONFIG)).error.kind, "session_disappeared");
}

// Spawn locks onto owned process instead of same-repository side pane.
{
	class FakeChild extends EventEmitter { pid = 45; kill() {} }
	const child = new FakeChild();
	let probes = 0;
	let scheduled;
	const clock = { setTimeout(fn) { scheduled = fn; return 1; }, clearTimeout() {} };
	const client = {
		async probe() { probes++; return { ok: true, value: { sessionId: probes === 1 ? "other-session" : "owned-session", pid: probes === 1 ? 99 : 45 } }; },
		async readReview(_cwd, _config, sessionId) {
			if (sessionId !== "owned-session") return { ok: false, error: { kind: "session_disappeared", message: "wrong session", args: [] } };
			const owned = normalizeReviewExport({ ...review(), sessionId: "owned-session" }).snapshot;
			return { ok: true, value: { sessionId: "owned-session", raw: review(), snapshot: owned } };
		},
	};
	const handoff = handoffToSpawnedHunk({ client, cwd: "/repo", config: DEFAULT_CONFIG, tui: { stop() {}, start() {}, requestRender() {} }, spawn: () => child, clock });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(probes, 1);
	scheduled();
	await new Promise((resolve) => setImmediate(resolve));
	child.emit("close", 0, null);
	assert.equal((await handoff).lastValidExport?.sessionId, "owned-session");
}

// Spawn handoff owns terminal lifecycle and retains final export.
{
	class FakeChild extends EventEmitter { pid = 42; kill() {} }
	const child = new FakeChild();
	const calls = [];
	const client = { async probe() { return { ok: true, value: { sessionId: "session-1" } }; }, async readReview() { return { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } }; } };
	const tui = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const handoff = handoffToSpawnedHunk({ client, cwd: "/repo", config: DEFAULT_CONFIG, tui, spawn: (_binary, args, options) => { calls.push({ args, options }); return child; } });
	await new Promise((resolve) => setImmediate(resolve));
	child.emit("close", 0, null);
	const result = await handoff;
	assert.deepEqual(calls[0].args, ["diff", "--watch", "--no-exclude-untracked"]);
	assert.equal(calls[0].options.shell, false);
	assert.equal(calls[0].options.stdio, "inherit");
	assert.equal(result.lastValidExport.patchDigest, snapshot.patchDigest);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [1, 1, 1]);
}

// Expected session disappearance after owned process exit is not failure.
{
	class FakeChild extends EventEmitter { pid = 43; kill() {} }
	const child = new FakeChild();
	let reads = 0;
	const client = {
		async probe() { return { ok: true, value: { sessionId: "session-1" } }; },
		async readReview() { reads++; return reads === 1 ? { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } } : { ok: false, error: { kind: "session_disappeared", message: "gone", args: [] } }; },
	};
	const tui = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const handoff = handoffToSpawnedHunk({ client, cwd: "/repo", config: DEFAULT_CONFIG, tui, spawn: () => child });
	await new Promise((resolve) => setImmediate(resolve));
	child.emit("close", 0, null);
	const result = await handoff;
	assert.ok(result.lastValidExport);
	assert.equal(result.exportError, undefined);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [1, 1, 1]);
}

// Launch errors and signals always restore Pi terminal lifecycle.
{
	const absentClient = { async probe() { return { ok: false, error: { kind: "session_disappeared", message: "none", args: [] } }; } };
	const tui = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const failed = await handoffToSpawnedHunk({ client: absentClient, cwd: "/repo", config: DEFAULT_CONFIG, tui, spawn: () => { throw new Error("launch failed"); } });
	assert.match(failed.launchError, /launch failed/);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [1, 1, 1]);

	class FakeChild extends EventEmitter { pid = 44; kill() {} }
	const liveClient = { async probe() { return { ok: true, value: { sessionId: "session-1" } }; }, async readReview() { return { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } }; } };
	const child = new FakeChild();
	const tui2 = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const signalled = handoffToSpawnedHunk({ client: liveClient, cwd: "/repo", config: DEFAULT_CONFIG, tui: tui2, spawn: () => child });
	await new Promise((resolve) => setImmediate(resolve));
	child.emit("close", null, "SIGINT");
	assert.equal((await signalled).signal, "SIGINT");
	assert.deepEqual([tui2.stopped, tui2.started, tui2.redraws], [1, 1, 1]);

	const failedChild = new FakeChild();
	const tui3 = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const nonzero = handoffToSpawnedHunk({ client: liveClient, cwd: "/repo", config: DEFAULT_CONFIG, tui: tui3, spawn: () => failedChild });
	await new Promise((resolve) => setImmediate(resolve));
	failedChild.emit("close", 7, null);
	assert.equal((await nonzero).exitCode, 7);
	assert.deepEqual([tui3.stopped, tui3.started, tui3.redraws], [1, 1, 1]);
}

// Sampling keeps last complete export and cancellation suppresses late loss.
{
	let reads = 0;
	const client = { async readReview() { reads++; return reads === 1 ? { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } } : { ok: false, error: { kind: "malformed_export", message: "bad", args: [] } }; } };
	const lease = createSamplingLease({ mode: "reuse", client, cwd: "/repo", config: DEFAULT_CONFIG, sessionId: "session-1" });
	await lease.ready();
	await lease.finalSample();
	assert.equal(lease.latest(), snapshot);
	assert.equal(lease.lastError().kind, "malformed_export");
	lease.stop();

	let resolveRead;
	let losses = 0;
	const cancelled = createSamplingLease({ mode: "reuse", client: { readReview: () => new Promise((resolve) => (resolveRead = resolve)) }, cwd: "/repo", config: DEFAULT_CONFIG, sessionId: "session-1", onSessionLoss: () => losses++ });
	await new Promise((resolve) => setImmediate(resolve));
	cancelled.stop();
	resolveRead({ ok: false, error: { kind: "session_disappeared", message: "gone", args: [] } });
	await cancelled.ready();
	assert.equal(losses, 0);
}

// Reused side pane retains final complete export but rejects malformed live export.
{
	const ctx = { cwd: "/repo", signal: undefined, mode: "tui" };
	let reads = 0;
	const lostClient = {
		async probe() { return { ok: true, value: { sessionId: "session-1" } }; },
		async readReview() { reads++; return reads <= 2 ? { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } } : { ok: false, error: { kind: "session_disappeared", message: "gone", args: [] } }; },
		async navigate() { return { ok: true, value: undefined }; },
	};
	const retained = createReviewCoordinator({ client: lostClient, capture() {} });
	await retained.review(ctx, DEFAULT_CONFIG);
	await new Promise((resolve) => setImmediate(resolve));
	const final = await retained.finalExport();
	assert.equal(final.ok, true);
	assert.equal(final.value, snapshot);
	retained.cancel();

	reads = 0;
	const malformedClient = { ...lostClient, async readReview() { reads++; return reads <= 2 ? { ok: true, value: { sessionId: "session-1", raw: review(), snapshot } } : { ok: false, error: { kind: "malformed_export", message: "bad live export", args: [] } }; } };
	const refused = createReviewCoordinator({ client: malformedClient, capture() {} });
	await refused.review(ctx, DEFAULT_CONFIG);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal((await refused.finalExport()).ok, false);
	refused.cancel();
}

console.log("pi-hunk units ok");
