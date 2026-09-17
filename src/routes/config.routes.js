import { BotLog } from '../models/index.js';
import { getPlainConfig, sanitizeConfig, upsertPlainConfig } from '../services/configStore.js';
import { asyncRoute } from '../http/helpers.js';

export function registerConfigRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/me',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
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
