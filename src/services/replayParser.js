import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { FortniteReplayParser } = require('fn-replay-parser');

function bestNumber(values) {
	const numbers = values.map(Number).filter(Number.isFinite);
	return numbers.length ? Math.max(...numbers) : null;
}

export async function parseReplayFile(filePath) {
	const file = await readFile(filePath);
	const parser = new FortniteReplayParser(file);
	const replay = parser.parse();

	const playerStats = Array.isArray(replay.playerStats) ? replay.playerStats : [];
	const teamStats = Array.isArray(replay.teamStats) ? replay.teamStats : [];
	const eliminations = Array.isArray(replay.eliminations) ? replay.eliminations : [];
	const kills = bestNumber(playerStats.map((stats) => stats.eliminations));
	const placement = bestNumber(teamStats.map((stats) => stats.position));

	return {
		kills: kills ?? eliminations.length,
		deaths: null,
		placement,
		raw: {
			header: replay.header || null,
			meta: replay.replayMeta || replay.meta || null,
			playerStats,
			teamStats,
			eliminations: eliminations.slice(0, 250)
		}
	};
}
