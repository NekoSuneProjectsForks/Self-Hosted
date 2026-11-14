import { join } from 'node:path';
import { asyncRoute } from '../http/helpers.js';
import { publicDir } from '../lib/paths.js';
import {
	CATEGORY_ENGINE,
	availability,
	fnlbBotInfo,
	inheritCategoryChoice,
	listMyListings,
	publicBots,
	setCategoryListing,
	setListing
} from '../services/botListings.js';
import { BotListing } from '../models/index.js';
import { getPlainConfig, parseIdList } from '../services/configStore.js';
import { listBotAccounts } from '../services/botAccounts.js';
import { fetchFnlbBots, fetchFnlbCategories } from '../services/fnlbApi.js';
import { localEngineAllowed } from '../services/serverSettings.js';

/**
 * Community bot list: owners mark each bot Public or Private; anyone (no
 * login) can see public bots at /community. The public side is read-only.
 */
export function registerListingRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	app.get('/public-lists', (_req, res) => res.sendFile(join(publicDir, 'community.html')));
	app.get('/community', (_req, res) => res.redirect(301, '/public-lists'));

	app.get(
		'/api/public/bots',
		asyncRoute(async (_req, res) => {
			res.set('Cache-Control', 'public, max-age=2');
			// Only free, running, unbanned bots; busy ones are just counted.
			const { bots, counts } = await publicBots((userId, engine, botKey) => runtime.publicBotStatus(userId, engine, botKey));
			return res.json({ bots, counts });
		})
	);

	/** The user's bots that can be listed, each with its current Public/Private choice. */
	async function myBots(user) {
		const userId = user.id;
		const config = await getPlainConfig(userId);

		// Legacy FNLB: bots and categories from the user's token. Bots new to a
		// category that has a saved choice inherit it first.
		let fnlbBots = [];
		let fnlbCategories = [];
		let fnlbError = null;
		if (config.apiToken) {
			try {
				const [bots, categories] = await Promise.all([fetchFnlbBots(config.apiToken), fetchFnlbCategories(config.apiToken).catch(() => [])]);
				fnlbBots = bots.map((bot) => ({ id: bot.id, name: bot.nickname || bot.id, categoryId: bot.parent || null }));
				fnlbCategories = categories;
			} catch (error) {
				fnlbError = `Could not load your FNLB bots: ${error.message}`;
			}
		}
		const categoryRows = await BotListing.findAll({ where: { userId, engine: CATEGORY_ENGINE } });
		const categoryChoices = new Map(categoryRows.map((row) => [row.botKey, row.isPublic]));
		await inheritCategoryChoice(userId, fnlbBots, categoryChoices);

		const listings = await listMyListings(userId);
		const saved = new Map(listings.map((row) => [`${row.engine}:${row.botKey}`, row]));
		const rows = [];
		const add = (engine, botKey, name, note, extra = {}) => {
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
				name: live?.displayName || listing?.displayName || name || 'Not signed in yet',
				note,
				online: Boolean(live),
				isPublic: Boolean(listing?.isPublic),
				description: listing?.description || '',
				...extra
			});
		};
		const fnlbAccounts = config.apiToken ? await fnlbBotInfo(userId) : new Map();
		// Local bots only while the local engine is selected (and allowed).
		if (config.runtimeMode !== 'fnlb' && (await localEngineAllowed(user))) {
			add('fnbr', config.deviceAuth?.accountId, 'Main bot', 'Main bot (local engine)');
			for (const account of await listBotAccounts(userId)) {
				if (!account.tracker) add('fnbr', account.accountId, account.displayName || account.label, `Extra bot · ${account.label}`);
			}
		}
		const names = new Map(fnlbCategories.map((category) => [category.id, category.name || category.id]));
		for (const bot of fnlbBots) {
			add('fnlb', bot.id, bot.name, 'FNLB bot', { categoryId: bot.categoryId, categoryName: bot.categoryId ? names.get(bot.categoryId) || bot.categoryId : null });
		}

		// Categories the cluster boots (the Advanced "categories" filter), or
		// every category that has bots when no filter is set.
		const booted = parseIdList(config.categories);
		const categories = fnlbCategories
			.filter((category) => (booted.length ? booted.includes(category.id) : fnlbBots.some((bot) => bot.categoryId === category.id)))
			.map((category) => {
				const inCategory = rows.filter((row) => row.engine === 'fnlb' && row.categoryId === category.id);
				return {
					id: category.id,
					name: category.name || category.id,
					booted: !booted.length || booted.includes(category.id),
					bots: inCategory.length,
					publicBots: inCategory.filter((row) => row.isPublic).length,
					choice: categoryChoices.has(category.id) ? categoryChoices.get(category.id) : null
				};
			});
		return { bots: rows, categories, fnlbError };
	}

	/**
	 * Live public list (Server-Sent Events, no login). One shared check every
	 * 2 seconds while anyone is watching; clients only get a message when the
	 * list changes, plus a keep-alive every 25 seconds.
	 */
	const watchers = new Set();
	const MAX_WATCHERS = 500;
	let lastPayload = '';
	let ticking = false;
	let liveTimer = null;
	let pingTimer = null;
	const statusOf = (userId, engine, botKey) => runtime.publicBotStatus(userId, engine, botKey);

	const send = (res, payload) => res.write(`event: bots\ndata: ${payload}\n\n`);
	const tick = async () => {
		if (ticking) return;
		ticking = true;
		try {
			const payload = JSON.stringify(await publicBots(statusOf, { maxAgeMs: 1500 }));
			if (payload !== lastPayload) {
				lastPayload = payload;
				for (const res of watchers) send(res, payload);
			}
		} catch {
			// Keep the stream alive; the next tick tries again.
		} finally {
			ticking = false;
		}
	};
	const startLive = () => {
		if (liveTimer) return;
		liveTimer = setInterval(() => tick(), 2000);
		pingTimer = setInterval(() => {
			for (const res of watchers) res.write(': ping\n\n');
		}, 25000);
		liveTimer.unref?.();
		pingTimer.unref?.();
	};
	const stopLive = () => {
		clearInterval(liveTimer);
		clearInterval(pingTimer);
		liveTimer = null;
		pingTimer = null;
		lastPayload = '';
	};

	app.get('/api/public/bots/stream', async (req, res) => {
		if (watchers.size >= MAX_WATCHERS) return res.status(503).json({ error: 'Too many viewers right now. Try again soon.' });
		res.set({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// Nginx and similar proxies must not buffer the stream.
			'X-Accel-Buffering': 'no'
		});
		res.flushHeaders?.();
		res.write('retry: 3000\n\n');
		watchers.add(res);
		startLive();
		try {
			send(res, lastPayload || JSON.stringify(await publicBots(statusOf, { maxAgeMs: 1500 })));
		} catch {
			// The next tick sends it.
		}
		req.on('close', () => {
			watchers.delete(res);
			if (!watchers.size) stopLive();
		});
	});

	app.get('/api/listings', ...guard, asyncRoute(async (req, res) => res.json(await myBots(req.user))));

	/** Legacy FNLB: make every bot in a category Public or Private (new bots inherit it). */
	app.put(
		'/api/listings/category',
		...guard,
		asyncRoute(async (req, res) => {
			const categoryId = String(req.body?.categoryId || '').trim();
			const config = await getPlainConfig(req.user.id);
			if (!config.apiToken) {
				const error = new Error('Save your FNLB API token first.');
				error.status = 400;
				throw error;
			}
			const [categories, bots] = await Promise.all([fetchFnlbCategories(config.apiToken), fetchFnlbBots(config.apiToken)]);
			if (!categories.some((category) => category.id === categoryId)) {
				const error = new Error('That category is not one of yours.');
				error.status = 403;
				throw error;
			}
			const inCategory = bots.filter((bot) => bot.parent === categoryId).map((bot) => ({ id: bot.id, name: bot.nickname || bot.id }));
			const result = await setCategoryListing(req.user.id, categoryId, req.body?.isPublic === true, inCategory);
			return res.json({ result, ...(await myBots(req.user)) });
		})
	);

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
