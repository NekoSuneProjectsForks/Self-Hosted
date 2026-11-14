/**
 * Reads matchmaking events out of FNLB's own log lines (the Legacy FNLB
 * engine is closed source; its log is the only thing it tells us), e.g.
 *
 *   [Bot] [nekouwu4] [i] Starting matchmaking [v3]... (playlist_nobuildbr_duo)
 *   [Bot] [nekouwu4] [i] Using Matchmaking V3 for playlist_nobuildbr_duo { ..."ticketId": "efc7..." }
 *   [Bot] [nekouwu4] [✓] Matchmaking ended successfully (playlist_nobuildbr_duo). Real players in the match: 1
 *
 * FNLB's bot requests its own matchmaking ticket through FNLB's gateway; the
 * dashboard only records what happened (bot, mode, queue time, real players).
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const BOT = /\[Bot\]\s*\[([^\]]+)\]/;

export function parseFnlbLog(raw) {
	const text = String(raw ?? '').replace(ANSI, '');
	const bot = BOT.exec(text)?.[1]?.trim();
	if (!bot || !/matchmaking/i.test(text)) return null;

	let match = /Starting matchmaking(?:\s*\[(v\d+)\])?[^(]*\(([^)]+)\)/i.exec(text);
	if (match) return { type: 'start', bot, version: match[1] || null, playlist: match[2].trim() };

	match = /Matchmaking ended successfully\s*\(([^)]+)\)(?:.*?Real players in the match:\s*(\d+))?/i.exec(text);
	if (match) {
		return { type: 'success', bot, playlist: match[1].trim(), realPlayers: match[2] === undefined ? null : Number(match[2]) };
	}

	match = /Using Matchmaking (v\d+) for\s+(\S+)/i.exec(text);
	if (match) {
		const ticket = /"ticketId"\s*:\s*"([^"]+)"/.exec(text)?.[1] || null;
		const region = /"region"\s*:\s*"([^"]+)"/.exec(text)?.[1] || null;
		return { type: 'ticket', bot, version: match[1], playlist: match[2], ticketId: ticket, region };
	}

	match = /Matchmaking[^\n]*?(failed|cancel+ed|error|timed out|stopped)([^\n]*)/i.exec(text);
	if (match) {
		const playlist = /\((playlist_[^)]+)\)/i.exec(text)?.[1] || null;
		return { type: 'failed', bot, playlist, reason: text.replace(BOT, '').replace(/\[[^\]]{1,4}\]/g, '').trim().slice(0, 200) };
	}
	return null;
}
