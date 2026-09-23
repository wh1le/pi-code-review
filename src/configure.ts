import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { saveProjectConfig, type HunkConfig } from "./config";

export async function openHunkConfig(
	ctx: ExtensionCommandContext,
	getConfig: () => HunkConfig,
	applyConfig: (next: HunkConfig) => void | Promise<void>,
): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/hunk configure requires TUI mode.", "error");
		return;
	}

	const current = getConfig();
	const enabledLabel = current.hunk.enabled ? "Enabled" : "Disabled";
	const enabled = await ctx.ui.select("Hunk integration", [enabledLabel, enabledLabel === "Enabled" ? "Disabled" : "Enabled"]);
	if (!enabled) return;

	const input = await ctx.ui.input("Hunk binary (leave blank to keep current)", current.hunk.binary);
	if (input === undefined) return;
	const binary = input.trim() || current.hunk.binary;
	const next: HunkConfig = { hunk: { enabled: enabled === "Enabled", binary } };

	try {
		await saveProjectConfig(ctx.cwd, next);
		await applyConfig(next);
		ctx.ui.notify("Saved Hunk config to .pi/hunk.json.", "info");
	} catch (error) {
		ctx.ui.notify(`Failed to save Hunk config: ${String(error)}`, "error");
	}
}
