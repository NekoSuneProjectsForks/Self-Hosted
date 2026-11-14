import { MatchRound, TrackedPlayer } from '../models/index.js';

/**
 * Player match tracking from Epic's public stats (stats v2).
 *
 * Works with ANY engine, including Legacy FNLB bot lobbies, because nothing
 * joins the party: a bot account (ideally one set to "tracker") reads the
 * tracked players' stats every few minutes. Every playlist/input row whose
 * match count went up is a finished match; the stat differences are that
 * match's kills, win, top placements, score and minutes.
 *
 * Needs the player's stats to be public (Fortnite → Settings → Account and
 * Privacy → Show on career leaderboard).
 */

export const MAX_TRACKED_PLAYERS = 10;
export const TRACKED_ROUND_PREFIX = 'player:';

const STAT_KEY = /^br_(lastmodified|playersoutlived|kills|matchesplayed|minutesplayed|placetop\d\d?|score)_(gamepad|keyboardmouse|touch)_m0_(.+)$/;

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

/** Raw stats v2 map → { "<playlist>|<input>": { matchesplayed, kills, ... } }. */
export function groupStats(raw = {}) {
	const rows = {};
	for (const [key, value] of Object.entries(raw || {})) {
		const match = STAT_KEY.exec(key);
		if (!match) continue;
		const [, stat, input, playlist] = match;
		const id = `${playlist}|${input}`;
		rows[id] ||= {};
		rows[id][stat] = Number(value) || 0;
	}
	return rows;
}

/**
 * "playlist_nobuildbr_duo" → "Zero Build · Duo". Playlist IDs follow FNLB's
 * 43.x map: default and trios = Build, nobuildbr = Zero Build, figment = OG,
 * forbiddenfruit = Blitz. Unknown IDs come back as they are.
 */
export function playlistLabel(playlist = '') {
	const raw = String(playlist ?? '');
	const id = raw.toLowerCase().replace(/^playlist_/, '');
	if (!id) return raw;
	const team = /sixstack|stack$/.test(id)
		? 'Six Stack'
		: /quint/.test(id)
			? 'Quint'
			: /solo/.test(id)
				? 'Solo'
				: /duo/.test(id)
					? 'Duo'
					: /trio/.test(id)
						? 'Trio'
						: /squad/.test(id)
							? 'Squad'
							: null;
	let mode = null;
	if (/forbiddenfruit|blitz/.test(id)) mode = 'Blitz';
	else if (/figment/.test(id)) mode = /nobuild/.test(id) ? 'OG Zero Build' : 'OG';
	else if (/habanero|ranked/.test(id)) mode = /nobuild/.test(id) ? 'Ranked Zero Build' : 'Ranked';
	else if (/respawn|reload|punchberry/.test(id)) mode = 'Reload';
	else if (/nobuild|zerobuild/.test(id)) mode = 'Zero Build';
	else if (/^default|^trios$|^br_|_br_/.test(id)) mode = 'Build';
	const parts = [mode, team].filter(Boolean);
	return parts.length ? parts.join(' · ') : raw;
}

const INPUT_LABELS = { keyboardmouse: 'Keyboard & mouse', gamepad: 'Controller', touch: 'Touch' };

/**
 * Compares two grouped snapshots and returns one entry per playlist/input
 * whose match count went up. `matches` > 1 means several matches finished
 * between two polls; their numbers are combined.
 */
export function diffStats(before = {}, after = {}) {
	const results = [];
	for (const [id, now] of Object.entries(after)) {
		const was = before[id] || {};
		const matches = (now.matchesplayed || 0) - (was.matchesplayed || 0);
		if (matches <= 0) continue;
		const delta = (stat) => Math.max(0, (now[stat] || 0) - (was[stat] || 0));
		const [playlist, input] = id.split('|');
		const tops = {};
		for (const stat of Object.keys(now)) {
			if (/^placetop\d+$/.test(stat) && stat !== 'placetop1' && delta(stat) > 0) tops[stat.replace('placetop', 'top')] = delta(stat);
		}
		const wins = delta('placetop1');
		results.push({
			playlist,
			playlistLabel: playlistLabel(playlist),
			input,
			inputLabel: INPUT_LABELS[input] || input,
			matches,
			wins,
			kills: delta('kills'),
			score: delta('score'),
			minutes: delta('minutesplayed'),
			playersOutlived: delta('playersoutlived'),
			tops,
			// Best placement bucket reached (1 = win), when Epic reports one.
			bestPlacement: wins > 0 ? 1 : bestTop(tops),
			endedAt: now.lastmodified ? new Date(now.lastmodified * 1000) : new Date()
		});
	}
	return results.sort((a, b) => a.endedAt - b.endedAt);
}

function bestTop(tops) {
	const numbers = Object.keys(tops).map((key) => Number(key.replace('top', ''))).filter(Number.isFinite);
	return numbers.length ? Math.min(...numbers) : null;
}

function serializePlayer(row) {
	return {
		id: row.id,
		accountId: row.accountId,
		displayName: row.displayName,
		kind: row.kind || 'player',
		enabled: row.enabled,
		lastPolledAt: row.lastPolledAt,
		lastError: row.lastError,
		hasBaseline: Boolean(row.baselineJson)
	};
}

export async function listTrackedPlayers(userId) {
	const rows = await TrackedPlayer.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
	return rows.map(serializePlayer);
}

export async function addTrackedPlayer(userId, { accountId, displayName }) {
	if (!accountId) throw httpError(400, 'Player not found.');
	const existing = await TrackedPlayer.findOne({ where: { userId, accountId } });
	if (existing) return serializePlayer(existing);
	if ((await TrackedPlayer.count({ where: { userId, kind: 'player' } })) >= MAX_TRACKED_PLAYERS) {
		throw httpError(400, `You can track up to ${MAX_TRACKED_PLAYERS} players.`);
	}
	return serializePlayer(await TrackedPlayer.create({ userId, accountId, displayName: displayName || null }));
}

/**
 * The user's own bot accounts are tracked automatically (no name to type):
 * local main/extra bots and FNLB bots (once their Epic ID is known).
 * `bots` = [{ accountId, displayName }]. Returns how many were new.
 */
export async function syncBotTracking(userId, bots) {
	let added = 0;
	for (const bot of bots) {
		if (!bot?.accountId) continue;
		const [row, created] = await TrackedPlayer.findOrCreate({
			where: { userId, accountId: bot.accountId },
			defaults: { kind: 'bot', displayName: bot.displayName || null }
		});
		if (created) added += 1;
		const updates = {};
		if (row.kind !== 'bot') updates.kind = 'bot';
		if (bot.displayName && bot.displayName !== row.displayName) updates.displayName = bot.displayName;
		if (Object.keys(updates).length) await row.update(updates);
	}
	return added;
}

export async function removeTrackedPlayer(userId, id) {
	const row = await TrackedPlayer.findOne({ where: { userId, id } });
	if (!row) throw httpError(404, 'Tracked player not found.');
	await row.destroy();
}

export async function setTrackedPlayerEnabled(userId, id, enabled) {
	const row = await TrackedPlayer.findOne({ where: { userId, id } });
	if (!row) throw httpError(404, 'Tracked player not found.');
	await row.update({ enabled: Boolean(enabled) });
	return serializePlayer(row);
}

/**
 * Polls one player with `fetchRaw(accountId)` → raw stats map. The first poll
 * only stores a baseline (it can't tell which old matches are new).
 * Returns the match rounds it recorded.
 */
// One check per tracked account at a time. Overlapping checks (Check now,
// the background timer, Admin "check everyone") used to read the same
// baseline and record the same match twice.
const pollLocks = new Map();

export async function pollTrackedPlayer(row, fetchRaw) {
	const previous = pollLocks.get(row.id) || Promise.resolve();
	const run = previous.catch(() => {}).then(() => pollTrackedPlayerNow(row, fetchRaw));
	pollLocks.set(row.id, run);
	try {
		return await run;
	} finally {
		if (pollLocks.get(row.id) === run) pollLocks.delete(row.id);
	}
}

async function pollTrackedPlayerNow(row, fetchRaw) {
	// Always diff against the latest saved baseline (another check may have moved it).
	await row.reload().catch(() => {});
	let raw;
	try {
		raw = await fetchRaw(row.accountId);
	} catch (error) {
		const message = /private/i.test(error?.message || '') || error?.name === 'StatsPrivacyError'
			? 'Stats are private. Turn on "Show on career leaderboard" in Fortnite.'
			: String(error?.message || 'Could not load stats').slice(0, 250);
		await row.update({ lastPolledAt: new Date(), lastError: message });
		return [];
	}
	const after = groupStats(raw);
	let before = null;
	try {
		before = row.baselineJson ? JSON.parse(row.baselineJson) : null;
	} catch {
		before = null;
	}
	const finished = before ? diffStats(before, after) : [];
	const rounds = [];
	for (const match of finished) {
		const endedAt = match.endedAt;
		// Same account + mode + end time = the same match: never save it twice.
		const exists = await MatchRound.findOne({
			where: { userId: row.userId, botId: `${TRACKED_ROUND_PREFIX}${row.accountId}`, playlistId: match.playlist, endedAt, source: 'epic' }
		});
		if (exists) continue;
		const duration = match.minutes ? match.minutes * 60 : null;
		const startedAt = duration ? new Date(endedAt.getTime() - duration * 1000) : endedAt;
		const round = await MatchRound.create({
			userId: row.userId,
			botId: `${TRACKED_ROUND_PREFIX}${row.accountId}`,
			playlistId: match.playlist,
			startedAt,
			endedAt,
			duration,
			status: 'ended',
			kills: match.kills,
			win: match.wins > 0,
			placement: match.bestPlacement,
			source: 'epic',
			metadataJson: JSON.stringify({ tracked: true, player: row.displayName || row.accountId, ...match })
		});
		rounds.push(round.toJSON());
	}
	await row.update({ baselineJson: JSON.stringify(after), lastPolledAt: new Date(), lastError: null });
	return rounds;
}

/**
 * Removes matches that were saved twice by overlapping checks (same account,
 * mode and end time), keeping the first. Returns how many were removed.
 */
export async function removeDuplicateMatches(userId = null) {
	const where = { source: 'epic' };
	if (userId) where.userId = userId;
	const rows = await MatchRound.findAll({ where, order: [['createdAt', 'ASC']] });
	const seen = new Set();
	let removed = 0;
	for (const row of rows) {
		const key = `${row.userId}|${row.botId}|${row.playlistId}|${new Date(row.endedAt).getTime()}`;
		if (seen.has(key)) {
			await row.destroy();
			removed += 1;
		} else {
			seen.add(key);
		}
	}
	return removed;
}

/** Polls every enabled tracked player of a user. */
export async function pollUserPlayers(userId, fetchRaw) {
	const rows = await TrackedPlayer.findAll({ where: { userId, enabled: true } });
	const recorded = [];
	for (const row of rows) recorded.push(...(await pollTrackedPlayer(row, fetchRaw)));
	return recorded;
}

export async function usersWithTrackedPlayers() {
	const rows = await TrackedPlayer.findAll({ where: { enabled: true }, attributes: ['userId'] });
	return [...new Set(rows.map((row) => row.userId))];
}

function parseMeta(round) {
	try {
		return round.metadataJson ? JSON.parse(round.metadataJson) : {};
	} catch {
		return {};
	}
}

/**
 * Totals for a set of recorded matches. K/D follows Epic: kills per death,
 * where every match that isn't a win counts as one death.
 */
export function summarize(list) {
	const matches = list.reduce((sum, m) => sum + (m.matches || 1), 0);
	const wins = list.reduce((sum, m) => sum + (m.wins || 0), 0);
	const kills = list.reduce((sum, m) => sum + (m.kills || 0), 0);
	const minutes = list.reduce((sum, m) => sum + (m.minutes || 0), 0);
	const score = list.reduce((sum, m) => sum + (m.score || 0), 0);
	const top10 = list.reduce((sum, m) => sum + (m.wins || (m.placement && m.placement <= 10) ? m.matches || 1 : 0), 0);
	const deaths = Math.max(0, matches - wins);
	const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
	return {
		matches,
		wins,
		kills,
		deaths,
		kd: matches ? round(kills / Math.max(1, deaths)) : 0,
		winRate: matches ? round((wins / matches) * 100, 1) : 0,
		killsPerMatch: matches ? round(kills / matches) : 0,
		avgMinutes: matches ? round(minutes / matches, 1) : 0,
		minutes,
		score,
		top10Rate: matches ? round((top10 / matches) * 100, 1) : 0
	};
}

function toMatch(json) {
	const meta = parseMeta(json);
	return {
		id: json.id,
		accountId: json.botId.slice(TRACKED_ROUND_PREFIX.length),
		player: meta.player || null,
		playlistId: json.playlistId,
		playlistLabel: meta.playlistLabel || playlistLabel(json.playlistId),
		inputLabel: meta.inputLabel || meta.input || null,
		matches: meta.matches || 1,
		kills: json.kills,
		win: json.win,
		wins: meta.wins ?? (json.win ? 1 : 0),
		placement: json.placement,
		score: meta.score ?? null,
		minutes: meta.minutes ?? null,
		playersOutlived: meta.playersOutlived ?? null,
		startedAt: json.startedAt,
		endedAt: json.endedAt
	};
}

/** Every recorded match for one tracked account (or all), newest first (max 2000). */
export async function allTrackedMatches(userId, accountId = null) {
	const { Op } = await import('sequelize');
	const where = { userId, source: 'epic' };
	where.botId = accountId ? `${TRACKED_ROUND_PREFIX}${accountId}` : { [Op.like]: `${TRACKED_ROUND_PREFIX}%` };
	const rows = await MatchRound.findAll({ where, order: [['endedAt', 'DESC']], limit: 2000 });
	return rows.map((row) => toMatch(row.toJSON()));
}

/** One recorded match with everything saved about it (owner only). */
export async function trackedMatchById(userId, matchId) {
	const row = await MatchRound.findOne({ where: { userId, id: matchId, source: 'epic' } });
	if (!row) return null;
	const json = row.toJSON();
	return { ...toMatch(json), meta: parseMeta(json) };
}

/**
 * Recorded matches for one tracked account (or all), newest first, one page
 * at a time, with totals for today and for everything recorded.
 */
export async function trackedMatches(userId, accountId = null, { page = 1, pageSize = 20 } = {}) {
	const all = await allTrackedMatches(userId, accountId);
	const size = Math.min(100, Math.max(5, Number(pageSize) || 20));
	const pages = Math.max(1, Math.ceil(all.length / size));
	const current = Math.min(pages, Math.max(1, Number(page) || 1));
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);
	return {
		matches: all.slice((current - 1) * size, current * size),
		paging: { page: current, pages, pageSize: size, total: all.length },
		totals: {
			today: summarize(all.filter((m) => new Date(m.endedAt) >= startOfDay)),
			recorded: summarize(all)
		}
	};
}
