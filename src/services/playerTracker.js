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

/** "playlist_nobuildbr_duo" → "Zero Build · Duo" (best effort, raw ID kept too). */
export function playlistLabel(playlist = '') {
	const id = String(playlist).toLowerCase().replace(/^playlist_/, '');
	const team = /solo/.test(id) ? 'Solo' : /duo/.test(id) ? 'Duo' : /trio/.test(id) ? 'Trio' : /squad/.test(id) ? 'Squad' : null;
	const mode = /nobuild|zerobuild/.test(id) ? 'Zero Build' : /habanero|ranked/.test(id) ? 'Ranked' : /respawn|reload/.test(id) ? 'Reload' : /defaultsolo|defaultduo|defaulttrio|defaultsquad|^br_|_br_/.test(id) || /^default/.test(id) ? 'Build' : null;
	const parts = [mode, team].filter(Boolean);
	return parts.length ? parts.join(' · ') : playlist;
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
	if ((await TrackedPlayer.count({ where: { userId } })) >= MAX_TRACKED_PLAYERS) {
		throw httpError(400, `You can track up to ${MAX_TRACKED_PLAYERS} players.`);
	}
	return serializePlayer(await TrackedPlayer.create({ userId, accountId, displayName: displayName || null }));
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
export async function pollTrackedPlayer(row, fetchRaw) {
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

/** Recent tracked matches plus totals (today and all recorded). */
export async function trackedMatches(userId, accountId = null, limit = 100) {
	const { Op } = await import('sequelize');
	const where = { userId, source: 'epic' };
	where.botId = accountId ? `${TRACKED_ROUND_PREFIX}${accountId}` : { [Op.like]: `${TRACKED_ROUND_PREFIX}%` };
	const rows = await MatchRound.findAll({ where, order: [['endedAt', 'DESC']], limit });
	const matches = rows.map((row) => {
		const json = row.toJSON();
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
			startedAt: json.startedAt,
			endedAt: json.endedAt
		};
	});
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);
	const total = (list) => ({
		matches: list.reduce((sum, m) => sum + m.matches, 0),
		wins: list.reduce((sum, m) => sum + (m.wins || 0), 0),
		kills: list.reduce((sum, m) => sum + (m.kills || 0), 0)
	});
	return {
		matches,
		totals: {
			today: total(matches.filter((m) => new Date(m.endedAt) >= startOfDay)),
			recorded: total(matches)
		}
	};
}
