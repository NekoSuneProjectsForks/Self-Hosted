import { Op } from 'sequelize';
import { MatchRound } from '../models/index.js';
import { playlistLabel } from './playerTracker.js';
import { friendlyMatchmakingError } from '../runtime/fnlbLogParser.js';

/**
 * Bot-lobby queue history for the Legacy FNLB engine, built from FNLB's own
 * log lines (see runtime/fnlbLogParser.js). One MatchRound per queue:
 * status "matchmaking" while queued, "ended" once FNLB reports the result.
 */
export const FNLB_ROUND_PREFIX = 'fnlb:';

function meta(round) {
	try {
		return round.metadataJson ? JSON.parse(round.metadataJson) : {};
	} catch {
		return {};
	}
}

async function openQueue(userId, bot) {
	return MatchRound.findOne({
		where: { userId, botId: `${FNLB_ROUND_PREFIX}${bot}`, source: 'fnlb', status: 'matchmaking' },
		order: [['startedAt', 'DESC']]
	});
}

async function finish(round, extra) {
	const endedAt = new Date();
	await round.update({
		status: 'ended',
		endedAt,
		duration: Math.max(0, Math.round((endedAt.getTime() - new Date(round.startedAt).getTime()) / 1000)),
		metadataJson: JSON.stringify({ ...meta(round), ...extra })
	});
	return round.toJSON();
}

/** Applies one parsed FNLB matchmaking event; returns the updated round (or null). */
export async function recordFnlbMatchmaking(userId, event) {
	if (!event?.bot) return null;
	const open = await openQueue(userId, event.bot);
	if (event.type === 'start') {
		if (open) await finish(open, { outcome: 'replaced' });
		const round = await MatchRound.create({
			userId,
			botId: `${FNLB_ROUND_PREFIX}${event.bot}`,
			playlistId: event.playlist || null,
			startedAt: new Date(),
			status: 'matchmaking',
			source: 'fnlb',
			metadataJson: JSON.stringify({ bot: event.bot, version: event.version || null, outcome: 'queued', party: event.party || null })
		});
		return round.toJSON();
	}
	if (!open) return null;
	if (event.type === 'ticket') {
		await open.update({ metadataJson: JSON.stringify({ ...meta(open), ticketId: event.ticketId, region: event.region, version: event.version }) });
		return open.toJSON();
	}
	if (event.type === 'success') {
		return finish(open, { outcome: 'matched', realPlayers: event.realPlayers, ...(event.party ? { party: event.party } : {}) });
	}
	if (event.type === 'failed') {
		return finish(open, { outcome: 'failed', reason: event.reason || null });
	}
	return null;
}

/**
 * FNLB queues for the Matches page, newest first, one page at a time, for
 * one bot (by name) or all, with a summary (bot lobby rate, queue time).
 */
export async function fnlbQueues(userId, { bot = null, page = 1, pageSize = 10 } = {}) {
	const where = { userId, source: 'fnlb' };
	where.botId = bot ? `${FNLB_ROUND_PREFIX}${bot}` : { [Op.like]: `${FNLB_ROUND_PREFIX}%` };
	const rows = await MatchRound.findAll({ where, order: [['startedAt', 'DESC']], limit: 1000 });
	const all = rows.map((row) => {
		const json = row.toJSON();
		const info = meta(json);
		return {
			id: json.id,
			bot: info.bot || json.botId.slice(FNLB_ROUND_PREFIX.length),
			playlistId: json.playlistId,
			playlistLabel: playlistLabel(json.playlistId),
			status: json.status,
			outcome: info.outcome || null,
			realPlayers: info.realPlayers ?? null,
			region: info.region || null,
			reason: info.reason ? friendlyMatchmakingError(info.reason) : null,
			party: Array.isArray(info.party) ? info.party : null,
			startedAt: json.startedAt,
			queueSeconds: json.duration
		};
	});
	const matched = all.filter((q) => q.outcome === 'matched');
	const timed = matched.filter((q) => Number.isFinite(q.queueSeconds));
	const size = Math.min(50, Math.max(5, Number(pageSize) || 10));
	const pages = Math.max(1, Math.ceil(all.length / size));
	const current = Math.min(pages, Math.max(1, Number(page) || 1));
	return {
		queues: all.slice((current - 1) * size, current * size),
		paging: { page: current, pages, pageSize: size, total: all.length },
		summary: {
			queues: all.length,
			matched: matched.length,
			botLobbies: matched.filter((q) => q.realPlayers === 1).length,
			failed: all.filter((q) => q.outcome === 'failed').length,
			avgQueueSeconds: timed.length ? Math.round(timed.reduce((sum, q) => sum + q.queueSeconds, 0) / timed.length) : null
		},
		bots: [...new Set(all.map((q) => q.bot))]
	};
}

/**
 * The FNLB queue that most likely led to a recorded match: same bot, matched,
 * and queued between 15 minutes before and 5 minutes after the match began.
 */
export async function queueForMatch(userId, botName, startedAt) {
	if (!botName || !startedAt) return null;
	const start = new Date(startedAt).getTime();
	const rows = await MatchRound.findAll({
		where: {
			userId,
			source: 'fnlb',
			botId: `${FNLB_ROUND_PREFIX}${botName}`,
			startedAt: { [Op.between]: [new Date(start - 15 * 60000), new Date(start + 5 * 60000)] }
		}
	});
	const matched = rows.filter((row) => meta(row.toJSON()).outcome === 'matched');
	if (!matched.length) return null;
	matched.sort((a, b) => Math.abs(new Date(a.startedAt).getTime() - start) - Math.abs(new Date(b.startedAt).getTime() - start));
	const json = matched[0].toJSON();
	const info = meta(json);
	return {
		bot: info.bot || botName,
		queuedAt: json.startedAt,
		queueSeconds: json.duration,
		region: info.region || null,
		realPlayers: info.realPlayers ?? null,
		party: Array.isArray(info.party) ? info.party : null
	};
}
