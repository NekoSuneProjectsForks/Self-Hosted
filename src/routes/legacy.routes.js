import {
	fetchFnlbBotDetails,
	fetchFnlbBots,
	fetchFnlbDashboard,
	updateFnlbBot,
	updateFnlbCategory
} from '../services/fnlbApi.js';
import {
	getPlainConfig,
	setLocalBotEnabled,
	updateLocalCategoryConfig
} from '../services/configStore.js';
import { getBotSessions, recordBotSnapshot, recordBotSnapshots } from '../services/sessionHistory.js';
import { getCurrentMatchRound, getMatchRounds } from '../services/matchTracker.js';
import {
	asyncRoute,
	botActionCommands,
	cosmeticList,
	equipCosmetic,
	httpError
} from '../http/helpers.js';

export function registerLegacyRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/fnlb/bots',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalEngine(req.user.id, config)) {
				const adapter = runtime.active(req.user.id);
				const dashboard = adapter
					? adapter.getDashboard(runtime.localCategory(config))
					: runtime.offlineDashboard(req.user.id, config);
				return res.json({ bots: dashboard.bots, capabilities: runtime.capabilities(req.user.id) });
			}
			const fnlbAdapter = runtime.active(req.user.id);
			const bots = fnlbAdapter ? await fnlbAdapter.getBots() : await fetchFnlbBots(config.apiToken);
			return res.json({ bots, capabilities: runtime.capabilities(req.user.id) });
		})
	);

	app.get(
		'/api/fnlb/dashboard',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			// Routed by the ACTIVE engine when one is running, so this can never
			// read from a different engine than the one the bot is on.
			if (runtime.isLocalEngine(req.user.id, config)) {
				const adapter = runtime.active(req.user.id);
				const dashboard = adapter
					? adapter.getDashboard(runtime.localCategory(config))
					: runtime.offlineDashboard(req.user.id, config);
				await recordBotSnapshots(req.user.id, dashboard.bots);
				return res.json({
					...dashboard,
					runtime: runtime.serialize(req.user.id),
					capabilities: runtime.capabilities(req.user.id)
				});
			}
			const fnlbAdapter = runtime.active(req.user.id);
			const dashboard = fnlbAdapter
				? await fnlbAdapter.getDashboard()
				: await fetchFnlbDashboard(config.apiToken);
			await recordBotSnapshots(req.user.id, dashboard.bots);
			return res.json({
				...dashboard,
				runtime: runtime.serialize(req.user.id),
				capabilities: runtime.capabilities(req.user.id)
			});
		})
	);

	app.get(
		'/api/fnlb/bots/:botId/details',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalEngine(req.user.id, config)) {
				const adapter = runtime.active(req.user.id);
				const details = adapter
					? adapter.getBotDetails(runtime.localCategory(config))
					: runtime.offlineDetails(config, req.params.botId);
				await recordBotSnapshot(req.user.id, details.bot);
				details.sessions = await getBotSessions(req.user.id, details.bot.id);
				details.matches = await getMatchRounds(req.user.id, details.bot.id);
				details.currentMatch = await getCurrentMatchRound(req.user.id, details.bot.id);
				details.capabilities = runtime.capabilities(req.user.id);
				return res.json(details);
			}
			const fnlbAdapter = runtime.active(req.user.id);
			const details = fnlbAdapter
				? await fnlbAdapter.getBotDetails(req.params.botId)
				: await fetchFnlbBotDetails(config.apiToken, req.params.botId);
			await recordBotSnapshot(req.user.id, details.bot);
			const sessions = await getBotSessions(req.user.id, req.params.botId);
			details.sessions = sessions;
			return res.json(details);
		})
	);

	app.patch(
		'/api/fnlb/bots/:botId',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalEngine(req.user.id, config)) {
				if (typeof req.body.disabled !== 'boolean') {
					throw httpError(400, 'No supported bot update was provided.');
				}
				// Persisted so the disabled state survives a server restart.
				await setLocalBotEnabled(req.user.id, !req.body.disabled);
				if (req.body.disabled) {
					await runtime.stop(req.user.id, 'Local fnbr bot disabled.');
					return res.json({ ok: true, disabled: true, runtime: runtime.serialize(req.user.id) });
				}
				await runtime.start(req.user, await getPlainConfig(req.user.id));
				return res.json({ ok: true, disabled: false, runtime: runtime.serialize(req.user.id) });
			}
			const payload = {};
			if (typeof req.body.disabled === 'boolean') payload.disabled = req.body.disabled;
			if (!Object.keys(payload).length) throw httpError(400, 'No supported bot update was provided.');
			const fnlbAdapter = runtime.active(req.user.id);
			const result = fnlbAdapter
				? await fnlbAdapter.updateBot(req.params.botId, payload)
				: await updateFnlbBot(config.apiToken, req.params.botId, payload);
			return res.json(result);
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/commands/run',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (!String(req.body.command || '').trim()) throw httpError(400, 'Command is required.');
			const adapter = runtime.requireActive(req.user.id);
			const result = await adapter.runCommand(
				req.body.command,
				String(req.body.args || '').trim(),
				req.params.botId,
				req.body.locale || 'en'
			);
			return res.json(result);
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/actions',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const action = String(req.body.action || '').trim();
			const command = botActionCommands[action];
			if (!command) throw httpError(400, 'Unsupported bot action.');

			const target = String(req.body.target || '').trim();
			const content = String(req.body.content || '').trim();
			const args = action === 'say' || action === 'set_status' ? content || target : target || content;
			if (!args && !['kick_all', 'hide_all', 'unhide_all', 'ready', 'unready', 'leave_lobby'].includes(action)) {
				throw httpError(400, 'This action needs a target user or value.');
			}

			const adapter = runtime.requireActive(req.user.id);
			const result = await adapter.runCommand(command, args, req.params.botId, req.body.locale || 'en');
			return res.json(result);
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/chat/messages',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			if (!String(req.body.content || '').trim()) throw httpError(400, 'Message content is required.');
			const adapter = runtime.requireActive(req.user.id);
			const result = await adapter.sendPartyMessage(
				req.body.content,
				req.params.botId,
				req.body.locale || 'en'
			);
			return res.json(result);
		})
	);

	app.get(
		'/api/fnlb/bots/:botId/users/search',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const prefix = String(req.query.prefix || '').trim();
			if (!prefix) throw httpError(400, 'Search prefix is required.');
			const adapter = runtime.requireActive(req.user.id);
			const users = await adapter.searchUsers(prefix, req.query.platform || 'epic', req.params.botId);
			return res.json({ users });
		})
	);

	app.patch(
		'/api/fnlb/categories/:categoryId/cosmetics',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalEngine(req.user.id, config)) {
				const directSlot = req.body.slot ? String(req.body.slot).trim() : '';
				const directItemId = req.body.itemId ? String(req.body.itemId).trim() : '';
				// Two independent concepts:
				//   applyNow   -> change the running bot immediately ("Equip Now")
				//   saveDefault-> persist as the startup loadout
				// Neither implies the other and neither requires a restart.
				const applyNow = req.body.applyNow !== false;
				const saveDefault = req.body.saveDefault !== false;
				const adapter = runtime.active(req.user.id);

				// Apply to the live bot FIRST so a rejected cosmetic is never saved as
				// a default and never reported to the UI as equipped.
				let applied = null;
				if (applyNow && adapter && directSlot && directItemId) {
					applied = await adapter.setCosmetic(directSlot, directItemId);
				}

				let localCategory = runtime.localCategory(config);
				if (saveDefault) {
					localCategory = await updateLocalCategoryConfig(req.user.id, async (nextConfig) => {
						if (directSlot && directItemId) {
							equipCosmetic(
								nextConfig,
								directSlot,
								directItemId,
								String(req.body.mode || 'replace').trim()
							);
						} else {
							if (req.body.startOutfit !== undefined) nextConfig.startOutfit = cosmeticList(req.body.startOutfit, true);
							if (req.body.startBackpack !== undefined) nextConfig.startBackpack = cosmeticList(req.body.startBackpack, true);
							if (req.body.startPickaxe !== undefined) nextConfig.startPickaxe = cosmeticList(req.body.startPickaxe, true);
							if (req.body.startShoes !== undefined) nextConfig.startShoes = cosmeticList(req.body.startShoes, true);
							if (req.body.joinEmote !== undefined) nextConfig.joinEmote = cosmeticList(req.body.joinEmote, false);
						}
					});
					// Keep the running adapter's view of the loadout in sync without a restart.
					adapter?.updateLocalCategory?.(localCategory);
				}

				// A whole-loadout save with no specific slot still applies live.
				if (applyNow && adapter && !(directSlot && directItemId)) {
					applied = await adapter.applyCategory(localCategory.config);
				}

				return res.json({
					ok: true,
					source: 'fnbr',
					categoryId: localCategory.id,
					config: localCategory.config,
					appliedLive: Boolean(applied),
					requiresRestart: false,
					cosmetics: applied?.cosmetics ?? null,
					savedAsDefault: saveDefault
				});
			}
			const dashboard = await fetchFnlbDashboard(config.apiToken);
			const category = dashboard.categories.find((item) => item.id === req.params.categoryId);
			if (!category) throw httpError(404, 'Category not found.');

			const nextConfig = { ...(category.config || {}) };
			if (req.body.slot && req.body.itemId) {
				equipCosmetic(
					nextConfig,
					String(req.body.slot).trim(),
					String(req.body.itemId).trim(),
					String(req.body.mode || 'replace').trim()
				);
			} else {
				if (req.body.startOutfit !== undefined) nextConfig.startOutfit = cosmeticList(req.body.startOutfit, true);
				if (req.body.startBackpack !== undefined) nextConfig.startBackpack = cosmeticList(req.body.startBackpack, true);
				if (req.body.startPickaxe !== undefined) nextConfig.startPickaxe = cosmeticList(req.body.startPickaxe, true);
				if (req.body.startShoes !== undefined) nextConfig.startShoes = cosmeticList(req.body.startShoes, true);
				if (req.body.joinEmote !== undefined) nextConfig.joinEmote = cosmeticList(req.body.joinEmote, false);
			}

			const fnlbAdapter = runtime.active(req.user.id);
			if (fnlbAdapter) {
				// The adapter persists the category and reports honestly whether the
				// running bot actually changed (FNLB has no verified live cosmetic
				// command, so it reports appliedLive: false rather than pretending).
				const result = await fnlbAdapter.setCosmetic(
					String(req.body.slot || '').trim(),
					String(req.body.itemId || '').trim(),
					{ categoryId: req.params.categoryId, category, nextConfig }
				);
				return res.json(result);
			}
			const result = await updateFnlbCategory(config.apiToken, req.params.categoryId, {
				name: category.name,
				config: nextConfig
			});
			return res.json({
				...result,
				categoryId: category.id,
				config: nextConfig,
				appliedLive: false,
				requiresReload: true
			});
		})
	);
}
