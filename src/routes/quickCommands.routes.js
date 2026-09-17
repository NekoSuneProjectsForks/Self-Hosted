import { QuickCommand } from '../models/index.js';
import { asyncRoute, httpError } from '../http/helpers.js';

export function registerQuickCommandRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/quick-commands',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const commands = await QuickCommand.findAll({
				where: { userId: req.user.id },
				order: [['createdAt', 'ASC']]
			});
			return res.json({ commands });
		})
	);

	app.post(
		'/api/quick-commands',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const name = String(req.body.name || '').trim();
			const command = String(req.body.command || '').trim();
			const args = String(req.body.args || '').trim();
			const locale = String(req.body.locale || 'en').trim() || 'en';

			if (!name || name.length > 60) throw httpError(400, 'Command name must be 1-60 characters.');
			if (!command || command.length > 255) {
				throw httpError(400, 'Command must be 1-255 characters.');
			}
			if (args.length > 255) throw httpError(400, 'Command args must be 255 characters or less.');

			const count = await QuickCommand.count({ where: { userId: req.user.id } });
			if (count >= 40) throw httpError(400, 'You can save up to 40 quick commands.');

			const quickCommand = await QuickCommand.create({
				userId: req.user.id,
				name,
				command,
				args: args || null,
				locale
			});
			return res.status(201).json({ command: quickCommand });
		})
	);

	app.delete(
		'/api/quick-commands/:id',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			await QuickCommand.destroy({ where: { id: req.params.id, userId: req.user.id } });
			return res.json({ ok: true });
		})
	);
}
