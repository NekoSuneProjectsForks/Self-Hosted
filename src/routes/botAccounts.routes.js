import {
	clearBotAccountAuth,
	createBotAccount,
	deleteBotAccount,
	getBotAccount,
	MAX_BOT_ACCOUNTS,
	updateBotAccount
} from '../services/botAccounts.js';
import { asyncRoute, httpError } from '../http/helpers.js';
import { getPlainConfig, updateLocalCategoryConfig } from '../services/configStore.js';

const LOBBY_SETTINGS = ['autoReady', 'leaveOnMatchStart', 'rejoinAfterMatch', 'botsSitOut', 'partyCommands', 'dmCommands', 'emotePlayOnce', 'acceptInvites', 'acceptFriendRequests'];

function settingsOf(config = {}) {
	const seconds = Number(config.emoteSeconds);
	return {
		...Object.fromEntries(LOBBY_SETTINGS.map((key) => [key, key === 'botsSitOut' ? config[key] === true : config[key] !== false])),
		emoteSeconds: Number.isFinite(seconds) ? seconds : 6
	};
}

/**
 * Bot Lobby: extra Epic accounts that run as their own local fnbr clients next
 * to the main bot, so several bots can sit in one party. Once online, every
 * existing /api/bots/:botId/* route works for them too, using their account ID.
 */
export function registerBotAccountRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	const list = async (userId) => ({
		accounts: await runtime.listHelpers(userId),
		maxAccounts: MAX_BOT_ACCOUNTS,
		mainBotId: runtime.mainBotId(userId)
	});

	app.get(
		'/api/bot-accounts',
		...guard,
		asyncRoute(async (req, res) => res.json(await list(req.user.id)))
	);

	app.post(
		'/api/bot-accounts',
		...guard,
		asyncRoute(async (req, res) => {
			const account = await createBotAccount(req.user.id, req.body || {});
			runtime.emitHelpers(req.user.id);
			return res.status(201).json({ account: runtime.serializeHelper(req.user.id, account) });
		})
	);

	app.patch(
		'/api/bot-accounts/:id',
		...guard,
		asyncRoute(async (req, res) => {
			const account = await updateBotAccount(req.user.id, req.params.id, req.body || {});
			runtime.emitHelpers(req.user.id);
			return res.json({ account: runtime.serializeHelper(req.user.id, account) });
		})
	);

	app.delete(
		'/api/bot-accounts/:id',
		...guard,
		asyncRoute(async (req, res) => {
			await getBotAccount(req.user.id, req.params.id);
			await runtime.stopHelper(req.user.id, req.params.id, 'Extra bot removed.').catch(() => {});
			await deleteBotAccount(req.user.id, req.params.id);
			runtime.helperMap(req.user.id).delete(req.params.id);
			runtime.emitHelpers(req.user.id);
			return res.json({ ok: true });
		})
	);

	app.post(
		'/api/bot-accounts/:id/clear-auth',
		...guard,
		asyncRoute(async (req, res) => {
			await runtime.stopHelper(req.user.id, req.params.id, 'Stopped to clear Epic device auth.').catch(() => {});
			const account = await clearBotAccountAuth(req.user.id, req.params.id);
			runtime.emitHelpers(req.user.id);
			return res.json({ account: runtime.serializeHelper(req.user.id, account) });
		})
	);

	app.post(
		'/api/bot-accounts/:id/start',
		...guard,
		asyncRoute(async (req, res) => {
			await runtime.startHelper(req.user, req.params.id);
			const result = { ok: true, content: 'Extra bot is online.', format: 1 };
			if (req.body?.joinMain && runtime.mainBotId(req.user.id)) {
				result.join = await runtime
					.joinHelperToMain(req.user.id, req.params.id)
					.catch((error) => ({ ok: false, content: error.message, format: 4 }));
			}
			return res.json({ ...result, ...(await list(req.user.id)) });
		})
	);

	app.post(
		'/api/bot-accounts/:id/stop',
		...guard,
		asyncRoute(async (req, res) => {
			await getBotAccount(req.user.id, req.params.id);
			await runtime.stopHelper(req.user.id, req.params.id);
			return res.json({ ok: true, content: 'Extra bot stopped.', format: 1, ...(await list(req.user.id)) });
		})
	);

	app.post(
		'/api/bot-accounts/:id/join-main',
		...guard,
		asyncRoute(async (req, res) => {
			return res.json(await runtime.joinHelperToMain(req.user.id, req.params.id));
		})
	);

	// ---- bulk ----------------------------------------------------------

	app.post(
		'/api/bot-lobby/start-all',
		...guard,
		asyncRoute(async (req, res) => {
			const results = await runtime.startHelpers(req.user);
			let joins = [];
			if (req.body?.joinMain && runtime.mainBotId(req.user.id)) joins = await runtime.joinAllHelpersToMain(req.user.id);
			return res.json({ results, joins, ...(await list(req.user.id)) });
		})
	);

	app.post(
		'/api/bot-lobby/stop-all',
		...guard,
		asyncRoute(async (req, res) => {
			await runtime.stopHelpers(req.user.id, 'Extra bot stopped.');
			return res.json({ ok: true, ...(await list(req.user.id)) });
		})
	);

	app.post(
		'/api/bot-lobby/join-main',
		...guard,
		asyncRoute(async (req, res) => {
			return res.json({ results: await runtime.joinAllHelpersToMain(req.user.id) });
		})
	);

	app.post(
		'/api/bot-lobby/join',
		...guard,
		asyncRoute(async (req, res) => {
			const target = String(req.body?.target || '').trim();
			if (!target) throw httpError(400, 'Give a friend name or party ID for the bots to join.');
			return res.json({ results: await runtime.joinAllHelpersTo(req.user.id, target) });
		})
	);

	// Lobby behaviour switches shared by the main bot and every extra bot.
	app.get(
		'/api/bot-lobby/settings',
		...guard,
		asyncRoute(async (req, res) => {
			const config = (await getPlainConfig(req.user.id)).localCategory?.config || {};
			return res.json({ settings: settingsOf(config) });
		})
	);

	app.patch(
		'/api/bot-lobby/settings',
		...guard,
		asyncRoute(async (req, res) => {
			const body = req.body || {};
			const changes = LOBBY_SETTINGS.filter((key) => body[key] !== undefined);
			let seconds;
			if (body.emoteSeconds !== undefined) {
				seconds = Number(body.emoteSeconds);
				if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw httpError(400, 'Emote length must be 1 to 60 seconds.');
			}
			if (!changes.length && seconds === undefined) throw httpError(400, 'No lobby setting was provided.');
			const localCategory = await updateLocalCategoryConfig(req.user.id, async (next) => {
				for (const key of changes) next[key] = Boolean(body[key]);
				if (seconds !== undefined) next.emoteSeconds = Math.round(seconds * 10) / 10;
			});
			runtime.applyLocalCategoryLive(req.user.id, localCategory);
			return res.json({
				settings: settingsOf(localCategory.config),
				content: 'Lobby settings saved and applied to the running bots.'
			});
		})
	);

	app.post(
		'/api/bot-lobby/leave',
		...guard,
		asyncRoute(async (req, res) => {
			return res.json({ results: await runtime.leaveAllHelpers(req.user.id) });
		})
	);
}
