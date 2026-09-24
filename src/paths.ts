import os from "node:os";
import path from "node:path";

/** Resolve a user-typed path (handles @ prefix, ~, relative-to-cwd). */
export function resolveUserPath(inputPath: string, cwd: string): string {
	let p = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	if (p === "~") p = os.homedir();
	else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
	if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
	return path.resolve(p);
}

function stripPatchPrefix(input: string): string {
	return input.replace(/^[ab]\//, "");
}

function relativePath(filePath: string, cwd: string): string {
	const rel = path.relative(cwd, filePath);
	return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : filePath;
}

/** Repo-relative path for Hunk navigation and diagnostics. */
export function displayPath(filePath: string | undefined, cwd: string): string {
	if (!filePath) return "general";
	const stripped = stripPatchPrefix(filePath);
	const p = path.isAbsolute(stripped) ? stripped : path.resolve(cwd, stripped);
	return relativePath(p, cwd).replace(/\\/g, "/");
}
