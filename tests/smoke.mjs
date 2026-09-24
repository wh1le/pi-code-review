import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
function findPiPackageRoot() {
	for (const candidate of [
		process.env.PI_CODING_AGENT_ROOT,
		path.join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent"),
		"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
		path.join(
			os.homedir(),
			".pi",
			"agent",
			"npm",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		),
	].filter(Boolean)) {
		if (existsSync(path.join(candidate, "package.json"))) return candidate;
	}
	throw new Error("Could not locate pi package.");
}
const piRoot = findPiPackageRoot();
const jiti = createRequire(path.join(piRoot, "package.json"))("jiti")(
	import.meta.url,
	{
		interopDefault: true,
		moduleCache: false,
		fsCache: false,
		alias: {
			"@earendil-works/pi-coding-agent": path.join(piRoot, "dist", "index.js"),
		},
	},
);

const run = promisify(execFile);

function ctx(cwd, ui, idle = true) {
	return { cwd, ui, mode: "tui", signal: undefined, isIdle: () => idle };
}

// The review happens in a real Git repository so the freshness check exercises
// its true path; the fake Hunk's marker files live outside it so its own book
// keeping never churns the working tree between baseline and close.
const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-hunk-smoke-"));
const markers = await mkdtemp(path.join(os.tmpdir(), "pi-hunk-markers-"));
let dummy;
try {
	await run("git", ["init", "-q"], { cwd: tmp });
	await run("git", ["config", "user.email", "smoke@example.com"], { cwd: tmp });
	await run("git", ["config", "user.name", "smoke"], { cwd: tmp });

	// A real live process the extension can stop by pid.
	dummy = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
		stdio: "ignore",
	});
	await new Promise((resolve) => dummy.on("spawn", resolve));

	const binary = path.join(markers, "fake-hunk.mjs");
	await writeFile(
		binary,
		`#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = ${JSON.stringify(markers)};
const args = process.argv.slice(2);
const marker = path.join(dir, ".fake-hunk-live");
const notesFile = path.join(dir, ".fake-hunk-notes.json");
const patchFile = path.join(dir, ".fake-hunk-patch");
const pidFile = path.join(dir, ".fake-hunk-pid");
const readsFile = path.join(dir, ".fake-hunk-reads");
const payload = () => ({
  sessionId: "smoke-session", title: "pi-hunk working tree", sourceLabel: process.cwd(), repoRoot: process.cwd(), inputKind: "vcs",
  files: [{ path: "smoke.ts", patch: readFileSync(patchFile, "utf8"), additions: 1, deletions: 1, hunkCount: 1, hunks: [{ oldStart: 1, newStart: 1 }] }],
  reviewNotes: JSON.parse(readFileSync(notesFile, "utf8"))
});
if (args[0] === "diff" && args[1] === "--watch") {
  writeFileSync(path.join(dir, ".fake-hunk-args"), args.join("\\n"));
  writeFileSync(marker, "live");
  writeFileSync(pidFile, String(process.pid));
  const exit = () => { try { rmSync(marker); } catch {} process.exit(0); };
  process.on("SIGTERM", exit);
  setTimeout(exit, 700);
} else if (args[0] === "session" && args[1] === "get") {
  if (!existsSync(marker)) { console.error("No active Hunk sessions are registered"); process.exit(1); }
  console.log(JSON.stringify({ id: "smoke-session", pid: Number(readFileSync(pidFile, "utf8")) }));
} else if (args[0] === "session" && args[1] === "review") {
  if (!existsSync(marker)) { console.error("No active Hunk sessions are registered"); process.exit(1); }
  if (!args.includes("--include-patch") || !args.includes("--include-notes") || !args.includes("--json")) process.exit(2);
  let count = 0;
  try { count = Number(readFileSync(readsFile, "utf8")); } catch {}
  writeFileSync(readsFile, String(count + 1));
  console.log(JSON.stringify(payload()));
} else if (args[0] === "session" && args[1] === "navigate") {
  writeFileSync(path.join(dir, ".fake-hunk-navigate"), args.join("\\n"));
  process.exit(0);
} else process.exit(2);
`,
		"utf8",
	);
	await chmod(binary, 0o755);
	await mkdir(path.join(tmp, ".pi"));
	await writeFile(
		path.join(tmp, ".pi", "hunk.json"),
		JSON.stringify({ ignoredSetting: true, hunk: { binary, enabled: true } }),
	);
	await writeFile(path.join(tmp, "smoke.ts"), "committed baseline\n");
	await run("git", ["add", "-A"], { cwd: tmp });
	await run("git", ["commit", "-qm", "base"], { cwd: tmp });
	// Agent-style edit after the commit: exactly what /hunk reviews.
	await writeFile(
		path.join(tmp, "smoke.ts"),
		"extension must not mutate this\n",
	);
	await writeFile(
		path.join(markers, ".fake-hunk-notes.json"),
		JSON.stringify([
			{
				source: "user",
				filePath: "smoke.ts",
				newRange: [1, 1],
				hunk: 1,
				body: "exact smoke note",
				author: "human",
			},
		]),
	);
	const originalPatch =
		"--- a/smoke.ts\n+++ b/smoke.ts\n@@ -1,1 +1,1 @@\n-old\n+new";
	await writeFile(path.join(markers, ".fake-hunk-patch"), originalPatch);
	await writeFile(path.join(markers, ".fake-hunk-reads"), "0");

	const notifications = [];
	const sent = [];
	const selections = [];
	const selectQueue = [];
	const tui = {
		stopped: 0,
		started: 0,
		redraws: 0,
		stop() {
			this.stopped++;
		},
		start() {
			this.started++;
		},
		requestRender() {
			this.redraws++;
		},
	};
	const ui = {
		notify: (message, type = "info") => notifications.push({ message, type }),
		select: async (title, options) => {
			selections.push({ title, options });
			return selectQueue.shift() ?? "Cancel";
		},
		custom: (factory) =>
			new Promise((resolve, reject) => {
				let done = false;
				const finish = (value) => {
					if (!done) {
						done = true;
						resolve(value);
					}
				};
				Promise.resolve(factory(tui, {}, {}, finish)).catch(reject);
			}),
	};
	const handlers = new Map();
	const commands = new Map();
	const shortcuts = new Map();
	const pi = {
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name, options) {
			commands.set(name, options);
		},
		registerShortcut(key, options) {
			shortcuts.set(key, options);
		},
		sendMessage(message, options) {
			sent.push({ message, options });
		},
	};

	const extension = await jiti.import(path.join(repoRoot, "src", "index.ts"), {
		default: true,
	});
	await extension(pi);
	assert.ok(commands.has("hunk"));
	assert.equal(shortcuts.size, 0, "no shortcut: /hunk is the only entry point");
	const command = commands.get("hunk");
	assert.equal(command.getArgumentCompletions, undefined, "no subcommands");
	assert.equal(handlers.has("tool_result"), true);

	const commandCtx = ctx(tmp, ui);

	// Observe successful native file tools only for Hunk focus; never execute, replace, or alter them.
	const writeEvent = {
		type: "tool_result",
		toolName: "write",
		toolCallId: "write-1",
		input: { path: "smoke.ts", content: "ignored" },
		content: [],
		details: undefined,
		isError: false,
	};
	const unchangedWriteEvent = structuredClone(writeEvent);
	const failedEditEvent = {
		type: "tool_result",
		toolName: "edit",
		toolCallId: "edit-failed",
		input: { path: "other.ts", edits: [] },
		content: [],
		details: undefined,
		isError: true,
	};
	for (const handler of handlers.get("tool_result") ?? []) {
		await handler(writeEvent, commandCtx);
		await handler(failedEditEvent, commandCtx);
	}
	assert.deepEqual(writeEvent, unchangedWriteEvent);
	assert.equal(
		await readFile(path.join(tmp, "smoke.ts"), "utf8"),
		"extension must not mutate this\n",
	);

	// Busy agent: single command refuses instead of racing a turn.
	const noticeStart = notifications.length;
	await command.handler("", ctx(tmp, ui, false));
	assert.ok(
		notifications
			.slice(noticeStart)
			.some((notice) => notice.message.includes("requires idle Pi")),
	);

	// No session: one direct child handoff, focused on the latest file, auto-submitted on close.
	await command.handler("", commandCtx);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [1, 1, 1]);
	assert.match(
		await readFile(path.join(markers, ".fake-hunk-args"), "utf8"),
		/--no-exclude-untracked/,
	);
	for (
		let i = 0;
		i < 40 && !existsSync(path.join(markers, ".fake-hunk-navigate"));
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 25));
	assert.match(
		await readFile(path.join(markers, ".fake-hunk-navigate"), "utf8"),
		/smoke\.ts[\s\S]*--hunk[\s\S]*1/,
	);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].options.triggerTurn, true);
	assert.equal(sent[0].options.deliverAs, "followUp");
	assert.match(sent[0].message.content, /exact smoke note/);
	assert.doesNotMatch(sent[0].message.content, /--- a\/smoke/);
	assert.equal(sent[0].message.details.notes.length, 1);
	assert.ok(
		!notifications.some(
			(notice) =>
				/Freshness could not be verified/.test(notice.message) ||
				/working tree changed/.test(notice.message),
		),
		"freshness verified silently",
	);

	// Working tree changed during the review: the notes are withheld as stale.
	await writeFile(
		path.join(markers, ".fake-hunk-notes.json"),
		JSON.stringify([
			{
				source: "user",
				filePath: "smoke.ts",
				newRange: [1, 1],
				hunk: 1,
				body: "stale note",
				author: "human",
			},
		]),
	);
	await writeFile(path.join(markers, ".fake-hunk-patch"), originalPatch);
	await writeFile(path.join(markers, ".fake-hunk-reads"), "0");
	const staleStart = notifications.length;
	const staleReview = command.handler("", commandCtx);
	for (
		let i = 0;
		i < 40 && !existsSync(path.join(markers, ".fake-hunk-live"));
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 25));
	await writeFile(path.join(tmp, "smoke.ts"), "changed while reviewing\n");
	await staleReview;
	assert.ok(
		notifications
			.slice(staleStart)
			.some((notice) =>
				/working tree changed during the review/.test(notice.message),
			),
		"stale review warns",
	);
	assert.equal(sent.length, 1, "stale notes are never forwarded");

	// Empty review: approved silently, no model turn.
	await writeFile(path.join(markers, ".fake-hunk-notes.json"), "[]");
	const approveStart = notifications.length;
	await command.handler("", commandCtx);
	assert.equal(sent.length, 1);
	assert.ok(
		notifications
			.slice(approveStart)
			.some((notice) => /approved with no notes/.test(notice.message)),
	);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [3, 3, 3]);

	// Existing session: attach, forward once it closes.
	await writeFile(
		path.join(markers, ".fake-hunk-notes.json"),
		JSON.stringify([
			{
				source: "user",
				filePath: "smoke.ts",
				newRange: [1, 1],
				hunk: 1,
				body: "attached note",
				author: "human",
			},
		]),
	);
	await writeFile(path.join(markers, ".fake-hunk-patch"), originalPatch);
	await writeFile(path.join(markers, ".fake-hunk-reads"), "0");
	await writeFile(path.join(markers, ".fake-hunk-live"), "live");
	await writeFile(path.join(markers, ".fake-hunk-pid"), String(dummy.pid));
	selectQueue.push("Attach: forward its notes when Hunk closes");
	const attached = command.handler("", commandCtx);
	for (
		let i = 0;
		i < 80 &&
		Number(await readFile(path.join(markers, ".fake-hunk-reads"), "utf8")) < 1;
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 25));
	await rm(path.join(markers, ".fake-hunk-live"), { force: true });
	await attached;
	assert.equal(tui.stopped, 3, "attach never takes over the terminal");
	assert.equal(sent.length, 2);
	assert.match(sent[1].message.content, /attached note/);
	assert.ok(
		selections.at(-1).options.some((option) => option.startsWith("Attach:")),
	);
	assert.ok(selections.at(-1).options.includes("Cancel"));

	// Existing session: stop it by pid, then spawn a fresh review.
	await writeFile(
		path.join(markers, ".fake-hunk-notes.json"),
		JSON.stringify([
			{
				source: "user",
				filePath: "smoke.ts",
				newRange: [1, 1],
				hunk: 1,
				body: "restarted note",
				author: "human",
			},
		]),
	);
	await writeFile(path.join(markers, ".fake-hunk-live"), "live");
	await writeFile(path.join(markers, ".fake-hunk-pid"), String(dummy.pid));
	selectQueue.push(`Stop Hunk (pid ${dummy.pid}) and start a new review`);
	const dummyExited = new Promise((resolve) =>
		dummy.once("exit", () => resolve(true)),
	);
	await command.handler("", commandCtx);
	assert.equal(
		await Promise.race([
			dummyExited,
			new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
		]),
		true,
		"running Hunk was stopped by pid",
	);
	assert.ok(
		notifications.some((notice) => /Stopped Hunk/.test(notice.message)),
	);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [4, 4, 4]);
	assert.equal(sent.length, 3);
	assert.match(sent[2].message.content, /restarted note/);

	// Existing session: cancel does nothing.
	await writeFile(path.join(markers, ".fake-hunk-live"), "live");
	await writeFile(path.join(markers, ".fake-hunk-pid"), String(process.pid));
	await command.handler("", commandCtx);
	assert.equal(sent.length, 3);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [4, 4, 4]);

	console.log("pi-hunk smoke ok");
} finally {
	dummy?.kill("SIGKILL");
	await rm(tmp, { recursive: true, force: true });
	await rm(markers, { recursive: true, force: true });
}
