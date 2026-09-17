import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { BotSession, QuickCommand, User, normalizeSuspension, sequelize } from '../models/index.js';
import { getPlainConfig } from '../services/configStore.js';
import { asyncRoute, httpError } from '../http/helpers.js';

export function registerAdminRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/admin/overview',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const [users, admins, suspended] = await Promise.all([
				User.count(),
				User.count({ where: { role: 'admin' } }),
				User.count({ where: { status: 'suspended' } })
			]);
			return res.json({ users, admins, suspended });
		})
	);

	app.get(
		'/api/admin/users',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const users = await User.findAll({ order: [['createdAt', 'ASC']] });
			const rows = await Promise.all(
				users.map(async (user) => {
					const config = await getPlainConfig(user.id);
					return {
						...user.toSafeJSON(),
						runtime: runtime.serialize(user.id),
						apiTokenConfigured: Boolean(config.apiToken),
						deviceAuthConfigured: Boolean(config.deviceAuth),
						runtimeMode: config.runtimeMode,
						categoriesConfigured: Boolean(config.categories)
					};
				})
			);
			return res.json({ users: rows });
		})
	);

	app.patch(
		'/api/admin/users/:id',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const user = await User.findByPk(req.params.id);
			if (!user) throw httpError(404, 'User not found.');

			const updates = {};
			if (req.body.role) {
				if (!['user', 'admin'].includes(req.body.role)) throw httpError(400, 'Invalid role.');
				if (user.role === 'admin' && req.body.role === 'user') {
					const adminCount = await User.count({ where: { role: 'admin' } });
					if (adminCount <= 1) throw httpError(400, 'The last admin cannot be demoted.');
				}
				updates.role = req.body.role;
			}

			if (req.body.status) {
				if (!['active', 'suspended'].includes(req.body.status)) throw httpError(400, 'Invalid status.');
				if (user.id === req.user.id && req.body.status === 'suspended') {
					throw httpError(400, 'You cannot suspend your own account.');
				}
				if (req.body.status === 'active') {
					updates.status = 'active';
					updates.suspendedUntil = null;
					updates.suspendedReason = null;
				} else {
					let suspendedUntil = null;
					if (req.body.suspendedUntil) {
						suspendedUntil = new Date(req.body.suspendedUntil);
						if (!Number.isFinite(suspendedUntil.getTime()) || suspendedUntil.getTime() <= Date.now()) {
							throw httpError(400, 'Temporary suspensions must end in the future.');
						}
					}
					updates.status = 'suspended';
					updates.suspendedUntil = suspendedUntil;
					updates.suspendedReason = String(req.body.suspendedReason ?? '').trim() || null;
					await runtime.stop(user.id, 'Bot cluster stopped because the account was suspended.');
				}
			}

			await user.update(updates);
			return res.json({ user: user.toSafeJSON(), runtime: runtime.serialize(user.id) });
		})
	);

	app.post(
		'/api/admin/users/:id/bot/start',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const user = await normalizeSuspension(await User.findByPk(req.params.id));
			if (!user) throw httpError(404, 'User not found.');
			const config = await getPlainConfig(user.id);
			await runtime.start(user, config);
			return res.json({ runtime: runtime.serialize(user.id) });
		})
	);

	app.post(
		'/api/admin/users/:id/bot/stop',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const user = await User.findByPk(req.params.id);
			if (!user) throw httpError(404, 'User not found.');
			await runtime.stop(user.id, 'Bot cluster stopped by an admin.');
			return res.json({ runtime: runtime.serialize(user.id) });
		})
	);
}
