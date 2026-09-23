import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
	throw new Error("Could not locate pi package.");
}
const piRoot = findPiPackageRoot();
const jiti = createRequire(path.join(piRoot, "package.json"))("jiti")(import.meta.url, {
	interopDefault: true,
	moduleCache: false,
	fsCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": path.join(piRoot, "dist", "index.js"),
	},
});

function ctx(cwd, ui, entries, idle = true) {
	return {
		cwd, ui, mode: "tui", hasUI: true, signal: undefined, isIdle: () => idle,
		sessionManager: { getBranch: () => entries }, modelRegistry: {}, model: undefined,
		isProjectTrusted: () => true, abort() {}, hasPendingMessages: () => false, shutdown() {}, getContextUsage: () => undefined,
		compact() {}, getSystemPrompt: () => "", getSystemPromptOptions: () => ({}), waitForIdle: async () => {}, newSession: async () => ({ cancelled: false }), fork: async () => ({ cancelled: false }), navigateTree: async () => ({ cancelled: false }), switchSession: async () => ({ cancelled: false }), reload: async () => {},
	};
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-hunk-smoke-"));
try {
	const binary = path.join(tmp, "fake-hunk.mjs");
	await writeFile(binary, `#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const marker = ".fake-hunk-live";
const notesFile = ".fake-hunk-notes.json";
const patchFile = ".fake-hunk-patch";
const payload = () => ({
  sessionId: "smoke-session", title: "pi-hunk main...smoke", sourceLabel: process.cwd(),
  files: [{ path: "smoke.ts", patch: readFileSync(patchFile, "utf8"), additions: 1, deletions: 1, hunkCount: 1, hunks: [{ oldStart: 1, newStart: 1 }] }],
  reviewNotes: JSON.parse(readFileSync(notesFile, "utf8"))
});
if (args[0] === "diff" && args[1] === "--watch") {
  writeFileSync(".fake-hunk-args", args.join("\\n"));
  writeFileSync(marker, "live");
  setTimeout(() => { try { rmSync(marker); } catch {} process.exit(0); }, 700);
} else if (args[0] === "session" && args[1] === "get") {
  if (!existsSync(marker)) { console.error("No active Hunk sessions are registered"); process.exit(1); }
  console.log(JSON.stringify({ id: "smoke-session" }));
} else if (args[0] === "session" && args[1] === "review") {
  if (!existsSync(marker)) { console.error("No active Hunk sessions are registered"); process.exit(1); }
  if (!args.includes("--include-patch") || !args.includes("--include-notes") || !args.includes("--json")) process.exit(2);
  console.log(JSON.stringify(payload()));
} else if (args[0] === "session" && args[1] === "navigate") {
  writeFileSync(".fake-hunk-navigate", args.join("\\n"));
  process.exit(0);
} else process.exit(2);
`, "utf8");
	await chmod(binary, 0o755);
	await mkdir(path.join(tmp, ".pi"));
	await writeFile(path.join(tmp, ".pi", "hunk.json"), JSON.stringify({ ignoredSetting: true, hunk: { binary, enabled: true } }));
	await writeFile(path.join(tmp, ".fake-hunk-notes.json"), JSON.stringify([{ source: "user", filePath: "smoke.ts", newRange: [1, 1], hunk: 1, body: "exact smoke note", author: "human" }]));
	const originalPatch = "--- a/smoke.ts\n+++ b/smoke.ts\n@@ -1,1 +1,1 @@\n-old\n+new";
	await writeFile(path.join(tmp, ".fake-hunk-patch"), originalPatch);
	await writeFile(path.join(tmp, "smoke.ts"), "extension must not mutate this\n");

	const entries = [];
	const notifications = [];
	const sent = [];
	const statuses = new Map();
	const selectors = [];
	const inputs = [];
	const shortcuts = new Map();
	const tui = { stopped: 0, started: 0, redraws: 0, stop() { this.stopped++; }, start() { this.started++; }, requestRender() { this.redraws++; } };
	const ui = {
		setStatus: (key, value) => statuses.set(key, value),
		notify: (message, type = "info") => notifications.push({ message, type }),
		select: async (title, options) => {
			selectors.push({ title, options });
			return options.includes("Keep for later") ? "Keep for later" : options[0];
		},
		input: async (title, placeholder) => {
			inputs.push({ title, placeholder });
			return "";
		},
		custom: (factory) => new Promise((resolve, reject) => {
			let done = false;
			const finish = (value) => { if (!done) { done = true; resolve(value); } };
			Promise.resolve(factory(tui, {}, {}, finish)).catch(reject);
		}),
	};
	const tools = new Map();
	const commands = new Map();
	const handlers = new Map();
	const pi = {
		on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); },
		registerTool(tool) { tools.set(tool.name, tool); }, registerCommand(name, options) { commands.set(name, options); }, registerShortcut(key, options) { shortcuts.set(key, options); }, registerFlag() {}, getFlag() {}, registerMessageRenderer() {}, registerEntryRenderer() {},
		sendMessage(message, options) { sent.push({ message, options }); }, sendUserMessage() { throw new Error("implicit delivery must not run"); }, appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		setSessionName() {}, getSessionName() {}, setLabel() {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }), getActiveTools: () => [...tools.keys()], getAllTools: () => [], setActiveTools() {}, getCommands: () => [], setModel: async () => true, getThinkingLevel: () => "high", setThinkingLevel() {}, registerProvider() {}, unregisterProvider() {}, events: { on() {}, emit() {} },
	};

	const extension = await jiti.import(path.join(repoRoot, "src", "index.ts"), { default: true });
	await extension(pi);
	assert.equal(tools.size, 0, "extension leaves Pi tools untouched");
	assert.ok(commands.has("hunk"));
	assert.equal(shortcuts.get("ctrl+shift+h").description, "Open Hunk review checkpoint.");
	const command = commands.get("hunk");
	assert.deepEqual(command.getArgumentCompletions("").map((item) => item.value), ["status", "review", "submit", "abandon", "configure"]);
	assert.equal(handlers.has("before_agent_start"), false);
	assert.equal(handlers.has("tool_result"), true);

	const commandCtx = ctx(tmp, ui, entries);
	for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start" }, commandCtx);
	assert.equal(statuses.get("hunk"), "hunk · ready");

	// Observe successful native file tools only for Hunk focus; never execute, replace, or alter them.
	const writeEvent = { type: "tool_result", toolName: "write", toolCallId: "write-1", input: { path: "smoke.ts", content: "ignored" }, content: [], details: undefined, isError: false };
	const unchangedWriteEvent = structuredClone(writeEvent);
	const failedEditEvent = { type: "tool_result", toolName: "edit", toolCallId: "edit-failed", input: { path: "other.ts", edits: [] }, content: [], details: undefined, isError: true };
	for (const handler of handlers.get("tool_result") ?? []) {
		await handler(writeEvent, commandCtx);
		await handler(failedEditEvent, commandCtx);
	}
	assert.deepEqual(writeEvent, unchangedWriteEvent);
	assert.equal(await readFile(path.join(tmp, "smoke.ts"), "utf8"), "extension must not mutate this\n");

	// Existing side pane: attach, capture, navigate, and submit exactly once.
	await writeFile(path.join(tmp, ".fake-hunk-live"), "live");
	await command.handler("review", commandCtx);
	assert.equal(tui.stopped, 0);
	assert.equal(entries.filter((entry) => entry.customType === "hunk-checkpoint").length, 1);
	for (let i = 0; i < 20 && !existsSync(path.join(tmp, ".fake-hunk-navigate")); i++) await new Promise((resolve) => setTimeout(resolve, 25));
	assert.match(await readFile(path.join(tmp, ".fake-hunk-navigate"), "utf8"), /smoke\.ts[\s\S]*--hunk[\s\S]*1/);
	await writeFile(path.join(tmp, ".fake-hunk-patch"), "--- a/smoke.ts\n+++ b/smoke.ts\n@@ -1,1 +1,1 @@\n-old\n+stale");
	await command.handler("submit", commandCtx);
	assert.equal(sent.length, 0);
	assert.ok(notifications.some((notice) => notice.message.includes("re-review due")));
	await writeFile(path.join(tmp, ".fake-hunk-patch"), originalPatch);
	await command.handler("review", commandCtx);
	await rm(path.join(tmp, ".fake-hunk-live"), { force: true });
	await new Promise((resolve) => setTimeout(resolve, 600));
	await command.handler("submit", commandCtx);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].options.triggerTurn, true);
	assert.equal(sent[0].options.deliverAs, "followUp");
	assert.match(sent[0].message.content, /exact smoke note/);
	assert.doesNotMatch(sent[0].message.content, /--- a\/smoke/);
	await command.handler("submit", commandCtx);
	assert.equal(sent.length, 1);

	// Session entries fold after reload; abandonment stays local.
	for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start" }, commandCtx);
	await command.handler("abandon", commandCtx);
	assert.equal(sent.length, 1);

	// No session: one direct child handoff, then automatic empty approval on close.
	await writeFile(path.join(tmp, ".fake-hunk-notes.json"), "[]");
	const noticeStart = notifications.length;
	await command.handler("review", commandCtx);
	assert.deepEqual([tui.stopped, tui.started, tui.redraws], [1, 1, 1]);
	assert.match(await readFile(path.join(tmp, ".fake-hunk-args"), "utf8"), /--no-exclude-untracked/);
	assert.equal(notifications.slice(noticeStart).some((notice) => notice.message === "Hunk session disappeared."), false);
	// Review close auto-submits: an empty review is approved without a model turn.
	assert.equal(sent.length, 1);
	assert.equal(entries.at(-1).data.state, "approved");
	assert.equal(entries.at(-1).data.version, 3);
	assert.ok(notifications.slice(noticeStart).some((notice) => /approved.*No model turn started/.test(notice.message)));
	assert.ok(entries.filter((entry) => entry.customType === "hunk-checkpoint").every((entry) => Number.isFinite(Date.parse(entry.data.at))));
	// Manual submit after automatic approval refuses instead of double-submitting.
	await command.handler("submit", commandCtx);
	assert.equal(sent.length, 1);
	assert.ok(notifications.some((notice) => notice.message.includes("requires one reviewing checkpoint")));

	// Approval is invalidated by later complete Hunk changeset change.
	await writeFile(path.join(tmp, ".fake-hunk-live"), "live");
	await writeFile(path.join(tmp, ".fake-hunk-patch"), "--- a/smoke.ts\n+++ b/smoke.ts\n@@ -1,1 +1,1 @@\n-old\n+post-approval");
	for (const handler of handlers.get("agent_settled") ?? []) await handler({ type: "agent_settled" }, commandCtx);
	assert.equal(entries.at(-1).data.state, "re_review_due");
	await writeFile(path.join(tmp, ".fake-hunk-patch"), originalPatch);
	await rm(path.join(tmp, ".fake-hunk-live"), { force: true });

	const hunkDir = path.join(tmp, ".pi", "hunk");
	let sidecars = [];
	try { sidecars = await readdir(hunkDir); } catch {}
	assert.equal(sidecars.length, 0);

	// Hunk-only configuration remains idle-only and preserves binary by blank input.
	const selectorStart = selectors.length;
	await command.handler("configure", ctx(tmp, ui, entries, false));
	assert.equal(selectors.length, selectorStart);
	assert.ok(notifications.some((notice) => notice.type === "warning" && notice.message.includes("cannot open while agent responds")));
	await command.handler("configure", commandCtx);
	assert.equal(selectors.at(-1).title, "Hunk integration");
	assert.deepEqual(selectors.at(-1).options, ["Enabled", "Disabled"]);
	assert.equal(inputs.at(-1).placeholder, binary);
	assert.deepEqual(JSON.parse(await readFile(path.join(tmp, ".pi", "hunk.json"), "utf8")), { hunk: { enabled: true, binary } });

	console.log("pi-hunk smoke ok");
} finally {
	await rm(tmp, { recursive: true, force: true });
}
