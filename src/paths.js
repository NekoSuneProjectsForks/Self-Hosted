import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicDir = join(rootDir, 'public');
export const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(rootDir, 'data');
export const fnlbDataDir = join(dataDir, 'fnlb');
export const replayDir = join(dataDir, 'replays');
export const mediaDir = join(dataDir, 'session-media');

export async function ensureDataDirs() {
	await mkdir(dataDir, { recursive: true });
	await mkdir(fnlbDataDir, { recursive: true });
	await mkdir(replayDir, { recursive: true });
	await mkdir(mediaDir, { recursive: true });
}
