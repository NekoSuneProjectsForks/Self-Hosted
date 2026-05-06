import { BotSession, ReplayUpload, SessionMedia, SessionStat } from './models.js';

function snapshotFromBot(bot) {
	const partyMembers = Array.isArray(bot.party?.members) ? bot.party.members.length : bot.partyMembers;
	return {
		botName: bot.nickname || null,
		matches: Number.isFinite(Number(bot.matches)) ? Number(bot.matches) : null,
		partyId: bot.party?.id || null,
		playlistId: bot.party?.playlistId || null,
		partyMembers: Number.isFinite(Number(partyMembers)) ? Number(partyMembers) : null,
		statsJson: JSON.stringify(bot)
	};
}

export async function recordBotSnapshot(userId, bot) {
	if (!bot?.id) return null;
	const values = snapshotFromBot(bot);
	const now = new Date();

	const active = await BotSession.findOne({
		where: { userId, botId: bot.id, isActive: true },
		order: [['startedAt', 'DESC']]
	});

	if (active) {
		await active.update({ ...values, lastSeenAt: now });
		return active;
	}

	return BotSession.create({
		userId,
		botId: bot.id,
		...values,
		startedAt: now,
		lastSeenAt: now,
		isActive: true
	});
}

export async function recordBotSnapshots(userId, bots) {
	if (!Array.isArray(bots)) return [];
	return Promise.all(bots.map((bot) => recordBotSnapshot(userId, bot)));
}

export async function getBotSessions(userId, botId, limit = 30) {
	const sessions = await BotSession.findAll({
		where: { userId, botId },
		order: [['startedAt', 'DESC']],
		limit,
		include: [
			{ model: ReplayUpload, required: false },
			{ model: SessionStat, required: false },
			{ model: SessionMedia, required: false }
		]
	});

	return sessions.map((session) => session.toJSON());
}

export async function resolveUploadSession(userId, botId, requestedSessionId) {
	if (requestedSessionId) {
		const session = await BotSession.findOne({ where: { id: requestedSessionId, userId, botId } });
		if (session) return session;
	}

	let session = await BotSession.findOne({
		where: { userId, botId, isActive: true },
		order: [['startedAt', 'DESC']]
	});

	if (!session) {
		session = await BotSession.create({
			userId,
			botId,
			startedAt: new Date(),
			lastSeenAt: new Date(),
			isActive: true
		});
	}

	return session;
}

export function sessionTotals(session) {
	const stats = Array.isArray(session.SessionStats) ? session.SessionStats : [];
	return stats.reduce(
		(total, row) => ({
			kills: total.kills + (Number(row.kills) || 0),
			deaths: total.deaths + (Number(row.deaths) || 0),
			assists: total.assists + (Number(row.assists) || 0),
			matches: total.matches + (Number(row.matches) || 0),
			wins: total.wins + (Number(row.wins) || 0)
		}),
		{ kills: Number(session.kills) || 0, deaths: Number(session.deaths) || 0, assists: 0, matches: 0, wins: 0 }
	);
}
