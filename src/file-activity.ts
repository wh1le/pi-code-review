export interface FileActivityStore {
	record(filePath: string): void;
	mostRecent(): string | undefined;
}

/** Tracks successful Pi file mutations solely to focus Hunk near latest file. */
export function createFileActivityStore(): FileActivityStore {
	let latest: string | undefined;
	return {
		record(filePath) {
			latest = filePath;
		},
		mostRecent() {
			return latest;
		},
	};
}
