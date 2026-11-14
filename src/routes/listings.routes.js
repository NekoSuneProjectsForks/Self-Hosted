import { join } from 'node:path';
import { asyncRoute } from '../http/helpers.js';
import { publicDir } from '../lib/paths.js';
import { availability, fnlbBotInfo, listMyListings, publicBots, setListing } from '../services/botListings.js';
import { getPlainConfig } from '../services/configStore.js';
import { listBotAccounts } from '../services/botAccounts.js';
import { fetchFnlbBots } from '../services/fnlbApi.js';
import { localEngineAllowed } from '../services/serverSettings.js';

/**
 * Community bot list: owners mark each bot Public or Private; anyone (no
 * login) can see public bots at /community. The public side is read-only.
 */
export function registerListingRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	app.get('/community', (_req, res) => res.sendFile(join(publicDir, 'community.html')));

	app.get(
		'/api/public/bots',
		asyncRoute(async (_req, res) => {
			res.set('Cache-Control', 'public, max-age=15');
			// Only free, running, unbanned bots; busy ones are just counted.
			const { bots, counts } = await publicBots((userId, engine, botKey) => runtime.publicBotStatus(userId, engine, botKey));
			return res.json({ bots, counts });
		})
	);

	/** The user's bots that can be listed, each with its current Public/Private choice. */
	async function myBots(user) {
		const userId = user.id;
		const listings = await listMyListings(userId);
		const saved = new Map(listings.map((row) => [`${row.engine}:${row.botKey}`, row]));
		const rows = [];
		const add = (engine, botKey, name, note) => {
			if (!botKey) return;
			const listing = saved.get(`${engine}:${botKey}`);
			const live = runtime.publicBotStatus(userId, engine, botKey);
			const account = engine === 'fnlb' ? fnlbAccounts.get(botKey) : null;
			const { state, reason, until } = availability(live, account);
			rows.push({
				state,
				reason,
				until: until || null,
				engine,
				botKey,
				name: live?.displayName || listing?.displayName || name || botKey,
				note,
				online: Boolean(live),
				isPublic: Boolean(listing?.isPublic),
				description: listing?.description || ''
			});
		};
		const config = await getPlainConfig(userId);
		const fnlbAccounts = config.apiToken ? await fnlbBotInfo(userId) : new Map();
		if (await localEngineAllowed(user)) {
			add('fnbr', config.deviceAuth?.accountId, null, 'Main bot (local engine)');
			for (const account of await listBotAccounts(userId)) {
				if (!account.tracker) add('fnbr', account.accountId, account.displayName || account.label, `Extra bot · ${account.label}`);
			}
		}
		let fnlbError = null;
		if (config.apiToken) {
			try {
				for (const bot of await fetchFnlbBots(config.apiToken)) add('fnlb', bot.id, bot.nickname || bot.id, 'FNLB bot');
			} catch (error) {
				fnlbError = `Could not load your FNLB bots: ${error.message}`;
			}
		}
		return { bots: rows, fnlbError };
	}

	app.get('/api/listings', ...guard, asyncRoute(async (req, res) => res.json(await myBots(req.user))));

	app.put(
		'/api/listings',
		...guard,
		asyncRoute(async (req, res) => {
			const body = { ...(req.body || {}) };
			if (body.engine === 'fnbr' && !(await localEngineAllowed(req.user))) {
				const error = new Error('The local engine is admin-only for now.');
				error.status = 403;
				throw error;
			}
			// Remember the live name so the bot keeps it on the list while offline.
			const live = runtime.publicBotStatus(req.user.id, body.engine, body.botKey);
			if (live?.displayName) body.displayName = live.displayName;
			const listing = await setListing(req.user.id, body);
			return res.json({ listing, ...(await myBots(req.user)) });
		})
	);
}
