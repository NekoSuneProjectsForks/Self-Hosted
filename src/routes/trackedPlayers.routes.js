import { asyncRoute, httpError } from '../http/helpers.js';
import {
	addTrackedPlayer,
	listTrackedPlayers,
	removeTrackedPlayer,
	setTrackedPlayerEnabled,
	syncBotTracking,
	trackedMatches
} from '../services/playerTracker.js';
import { fnlbQueues } from '../services/fnlbQueues.js';

/**
 * Player match tracking (works with any engine, including Legacy FNLB bot
 * lobbies): a tracker bot reads the players' public Epic stats from outside
 * the party and records each finished match.
 */
export function registerTrackedPlayerRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	/**
	 * Matches page data. `bot` = a tracked account ID (or empty for all),
	 * `page` = match page, `qpage` = FNLB queue page. Who reads the stats is
	 * never named: members only see whether the server tracker is on.
	 */
	const overview = async (userId, query = {}) => {
		await syncBotTracking(userId, await runtime.userBotAccounts(userId)).catch(() => 0);
		const source = runtime.statsSource(userId);
		const tracked = await listTrackedPlayers(userId);
		const selected = tracked.find((row) => row.accountId === query.bot) || null;
		const botName = selected?.displayName || null;
		return {
			players: tracked.filter((row) => row.kind !== 'bot'),
			bots: tracked
				.slice()
				.sort((a, b) => (a.kind === b.kind ? String(a.displayName || '').localeCompare(String(b.displayName || '')) : a.kind === 'bot' ? -1 : 1))
				.map((row) => ({ accountId: row.accountId, name: row.displayName || 'Unnamed bot', kind: row.kind, lastError: row.lastError, lastPolledAt: row.lastPolledAt })),
			selected: selected ? { accountId: selected.accountId, name: selected.displayName, kind: selected.kind } : null,
			source: source ? { active: true, server: source === runtime.serverTracker?.adapter } : null,
			...(await trackedMatches(userId, selected?.accountId || null, { page: query.page, pageSize: query.pageSize })),
			fnlb: await fnlbQueues(userId, { bot: botName, page: query.qpage })
		};
	};

	app.get(
		'/api/tracked-players',
		...guard,
		asyncRoute(async (req, res) => res.json(await overview(req.user.id, req.query)))
	);

	// Lifetime Epic stats for one tracked account (cached 5 minutes).
	const careerCache = new Map();
	app.get(
		'/api/tracked-players/career/:accountId',
		...guard,
		asyncRoute(async (req, res) => {
			const tracked = await listTrackedPlayers(req.user.id);
			if (!tracked.some((row) => row.accountId === req.params.accountId)) throw httpError(404, 'That account is not tracked.');
			const key = req.params.accountId;
			const cached = careerCache.get(key);
			if (cached && Date.now() - cached.at < 300000) return res.json(cached.data);
			const source = runtime.statsSource(req.user.id);
			if (!source?.getStats) throw httpError(409, 'The server tracker is off, so career stats can\'t be read right now.');
			const stats = await source.getStats(key);
			const data = { overall: stats.overall, solo: stats.solo, duo: stats.duo, trio: stats.trio || null, squad: stats.squad, ltm: stats.ltm || null };
			careerCache.set(key, { at: Date.now(), data });
			return res.json(data);
		})
	);

	app.post(
		'/api/tracked-players',
		...guard,
		asyncRoute(async (req, res) => {
			const name = String(req.body?.player || '').trim();
			if (!name) throw httpError(400, 'Enter an Epic display name or account ID.');
			const source = runtime.statsSource(req.user.id);
			if (!source?.client) throw httpError(409, 'No bot is running to look the player up. Ask an admin to start the server tracker (Admin → Tracker), or start one of your bots.');
			let user = null;
			try {
				user = await source.client.user.fetch(name);
			} catch {
				user = null;
			}
			if (!user?.id) throw httpError(404, `No Epic account called ${name}.`);
			await addTrackedPlayer(req.user.id, { accountId: user.id, displayName: user.displayName || name });
			// Take the baseline straight away so the next match counts.
			await runtime.pollTrackedPlayers(req.user.id).catch(() => {});
			return res.status(201).json(await overview(req.user.id, { bot: user.id }));
		})
	);

	app.patch(
		'/api/tracked-players/:id',
		...guard,
		asyncRoute(async (req, res) => {
			await setTrackedPlayerEnabled(req.user.id, req.params.id, req.body?.enabled !== false);
			return res.json(await overview(req.user.id));
		})
	);

	app.delete(
		'/api/tracked-players/:id',
		...guard,
		asyncRoute(async (req, res) => {
			await removeTrackedPlayer(req.user.id, req.params.id);
			return res.json(await overview(req.user.id));
		})
	);

	app.post(
		'/api/tracked-players/poll',
		...guard,
		asyncRoute(async (req, res) => {
			const recorded = await runtime.pollTrackedPlayers(req.user.id);
			return res.json({ recorded: recorded.length, ...(await overview(req.user.id, req.body || {})) });
		})
	);
}
