import { Op } from 'sequelize';
import { MatchRound } from '../models/index.js';
import { playlistLabel } from './playerTracker.js';

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
			metadataJson: JSON.stringify({ bot: event.bot, version: event.version || null, outcome: 'queued' })
		});
		return round.toJSON();
	}
	if (!open) return null;
	if (event.type === 'ticket') {
		await open.update({ metadataJson: JSON.stringify({ ...meta(open), ticketId: event.ticketId, region: event.region, version: event.version }) });
		return open.toJSON();
	}
	if (event.type === 'success') {
		return finish(open, { outcome: 'matched', realPlayers: event.realPlayers });
	}
	if (event.type === 'failed') {
		return finish(open, { outcome: 'failed', reason: event.reason || null });
	}
	return null;
}

/** Recent FNLB queues, newest first, for the Matches page. */
export async function fnlbQueues(userId, limit = 30) {
	const rows = await MatchRound.findAll({
		where: { userId, source: 'fnlb', botId: { [Op.like]: `${FNLB_ROUND_PREFIX}%` } },
		order: [['startedAt', 'DESC']],
		limit
	});
	return rows.map((row) => {
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
			reason: info.reason || null,
			startedAt: json.startedAt,
			queueSeconds: json.duration
		};
	});
}
