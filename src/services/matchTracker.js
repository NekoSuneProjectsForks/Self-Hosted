import { MatchRound } from '../models/index.js';
import { resolveUploadSession } from './sessionHistory.js';

/**
 * Match rounds are derived from Epic party match state only. Presence tells us
 * WHERE the bot is (lobby / matchmaking / in match) and nothing else, so kills,
 * placement and win stay null unless a replay upload or manual entry fills them
 * in later. `source` records where any numbers actually came from.
 */
export async function openMatchRound(userId, event) {
	const botId = event.botId;
	if (!botId) return null;

	// Never open a second concurrent round for the same bot.
	const existing = await MatchRound.findOne({
		where: { userId, botId, status: 'in_match' },
		order: [['startedAt', 'DESC']]
	});
	if (existing) return existing.toJSON();

	const session = await resolveUploadSession(userId, botId, null);

	const round = await MatchRound.create({
		userId,
		botId,
		botSessionId: session?.id ?? null,
		partyId: event.partyId ?? null,
		playlistId: event.playlistId ?? null,
		partyMembers: Number.isFinite(Number(event.partyMembers)) ? Number(event.partyMembers) : null,
		startedAt: new Date(),
		status: 'in_match',
		source: 'presence',
		metadataJson: event.matchInfo ? JSON.stringify(event.matchInfo) : null
	});

	return round.toJSON();
}

export async function closeMatchRound(userId, event = {}) {
	const where = { userId, status: 'in_match' };
	if (event.botId) where.botId = event.botId;

	const round = await MatchRound.findOne({ where, order: [['startedAt', 'DESC']] });
	if (!round) return null;

	const endedAt = new Date();
	const duration = Math.max(0, Math.round((endedAt.getTime() - new Date(round.startedAt).getTime()) / 1000));

	await round.update({ endedAt, duration, status: 'ended' });
	return round.toJSON();
}

export async function getMatchRounds(userId, botId, limit = 50) {
	const rounds = await MatchRound.findAll({
		where: { userId, botId },
		order: [['startedAt', 'DESC']],
		limit
	});
	return rounds.map((round) => round.toJSON());
}

export async function getCurrentMatchRound(userId, botId) {
	const round = await MatchRound.findOne({
		where: { userId, botId, status: 'in_match' },
		order: [['startedAt', 'DESC']]
	});
	return round ? round.toJSON() : null;
}

export async function getMatchRound(userId, matchId) {
	const round = await MatchRound.findOne({ where: { userId, id: matchId } });
	return round ? round.toJSON() : null;
}

/** Closes any round left open by a crash or an unclean shutdown. */
export async function closeOrphanedMatchRounds(userId = null) {
	const where = { status: 'in_match' };
	if (userId) where.userId = userId;
	const rounds = await MatchRound.findAll({ where });
	for (const round of rounds) {
		const endedAt = new Date();
		await round.update({
			endedAt,
			duration: Math.max(0, Math.round((endedAt.getTime() - new Date(round.startedAt).getTime()) / 1000)),
			status: 'ended'
		});
	}
	return rounds.length;
}
