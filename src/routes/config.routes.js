import { BotLog } from '../models/index.js';
import { getPlainConfig, sanitizeConfig, updateMainBotSettings, upsertPlainConfig } from '../services/configStore.js';
import { httpError, asyncRoute } from '../http/helpers.js';

import { localEngineAllowed } from '../services/serverSettings.js';
export function registerConfigRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	// Main bot platform / status from the Bots page. Status applies live; a
	// platform change flags a restart (it is fixed at login).
	app.patch(
		'/api/config/main-bot',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await updateMainBotSettings(req.user.id, {
				platform: req.body?.platform,
				defaultStatus: req.body?.defaultStatus
			});
			const applied = await runtime.applySavedConfig(req.user.id, config);
			return res.json({ config: sanitizeConfig(config), ...applied, runtime: runtime.serialize(req.user.id) });
		})
	);

	app.get(
		'/api/me',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			let config = await getPlainConfig(req.user.id);
			// Local engine is admin-only: move members still on it (new accounts
			// default to it) over to Legacy FNLB while their bot is stopped.
			if (config.runtimeMode !== 'fnlb' && !runtime.isRunning(req.user.id) && !(await localEngineAllowed(req.user))) {
				config = await upsertPlainConfig(req.user.id, { runtimeMode: 'fnlb' });
				await runtime.applySavedConfig(req.user.id, config).catch(() => {});
			}
			return res.json({
				user: req.user.toSafeJSON(),
				config: sanitizeConfig(config),
				runtime: runtime.serialize(req.user.id)
			});
		})
	);

	app.put(
		'/api/config',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			if (req.body?.runtimeMode === 'fnbr' && !(await localEngineAllowed(req.user))) {
				throw httpError(403, 'The local engine is admin-only for now. Use the Legacy FNLB engine.');
			}
			const config = await upsertPlainConfig(req.user.id, req.body);
			// Applies everything that can be applied live and only flags a restart
			// for settings that genuinely need one. Changing the engine while online
			// sets restartRequired instead of silently swapping the running runtime.
			const applied = await runtime.applySavedConfig(req.user.id, config);
			return res.json({
				config: sanitizeConfig(config),
				runtime: runtime.serialize(req.user.id),
				restartRequired: applied.restartRequired,
				restartReason: applied.restartReason,
				appliedLive: applied.appliedLive
			});
		})
	);

	app.get(
		'/api/bot/status',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			return res.json({ runtime: runtime.serialize(req.user.id) });
		})
	);

	app.post(
		'/api/bot/start',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			await runtime.start(req.user, config);
			return res.json({ runtime: runtime.serialize(req.user.id) });
		})
	);

	app.post(
		'/api/bot/stop',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			await runtime.stop(req.user.id, 'Bot cluster stopped.');
			return res.json({ runtime: runtime.serialize(req.user.id) });
		})
	);

	app.get(
		'/api/bot/logs',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			return res.json({ logs: await runtime.recentLogs(req.user.id) });
		})
	);

	app.delete(
		'/api/bot/logs',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			await BotLog.destroy({ where: { userId: req.user.id } });
			return res.json({ logs: [] });
		})
	);
}
