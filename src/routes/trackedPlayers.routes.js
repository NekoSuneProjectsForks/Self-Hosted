import { asyncRoute, httpError } from '../http/helpers.js';
import {
	addTrackedPlayer,
	listTrackedPlayers,
	removeTrackedPlayer,
	setTrackedPlayerEnabled,
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

	const overview = async (userId) => {
		const source = runtime.statsSource(userId);
		return {
			players: await listTrackedPlayers(userId),
			source: source
				? {
						botId: source.botId(),
						displayName: source.client?.user?.self?.displayName || null,
						tracker: Boolean(source.isTracker?.()),
						server: source === runtime.serverTracker?.adapter
					}
				: null,
			...(await trackedMatches(userId)),
			fnlbQueues: await fnlbQueues(userId)
		};
	};

	app.get(
		'/api/tracked-players',
		...guard,
		asyncRoute(async (req, res) => res.json(await overview(req.user.id)))
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
			return res.status(201).json(await overview(req.user.id));
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
			return res.json({ recorded: recorded.length, ...(await overview(req.user.id)) });
		})
	);
}
