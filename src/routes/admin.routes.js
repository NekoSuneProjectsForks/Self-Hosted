import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Op } from 'sequelize';
import {
	BotAccount,
	BotConfig,
	BotListing,
	BotLog,
	BotSession,
	FriendMessage,
	MatchRound,
	PasswordReset,
	QuickCommand,
	ReplayUpload,
	TrackedPlayer,
	User,
	normalizeSuspension,
	sequelize
} from '../models/index.js';
import { assertAuthorizationCode, extractAuthorizationCode, getPlainConfig, normalizeDeviceAuth } from '../services/configStore.js';
import {
	TRACKER_INTERVALS,
	getServerOptions,
	getTrackerSettings,
	sanitizeTracker,
	updateServerOptions,
	updateTrackerSettings
} from '../services/serverSettings.js';
import { appCommit, appVersion, asyncRoute, httpError } from '../http/helpers.js';

const startedAt = Date.now();

function startOfToday() {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	return date;
}

async function dbSizeBytes() {
	try {
		const storage = sequelize.options.storage;
		return storage ? (await stat(storage)).size : null;
	} catch {
		return null;
	}
}

export function registerAdminRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/admin/overview',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const [users, admins, suspended, botAccounts, trackedPlayers, matchesToday, newUsersWeek] = await Promise.all([
				User.count(),
				User.count({ where: { role: 'admin' } }),
				User.count({ where: { status: 'suspended' } }),
				BotAccount.count(),
				TrackedPlayer.count(),
				MatchRound.count({ where: { endedAt: { [Op.gte]: startOfToday() } } }),
				User.count({ where: { createdAt: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } } })
			]);
			const running = runtime.allRunningBots();
			const memory = process.memoryUsage();
			const dbBytes = await dbSizeBytes();
			return res.json({
				users,
				admins,
				suspended,
				newUsersWeek,
				botAccounts,
				trackedPlayers,
				matchesToday,
				bots: {
					online: running.filter((row) => row.status === 'online').length,
					main: running.filter((row) => row.kind === 'main').length,
					extra: running.filter((row) => row.kind === 'extra').length
				},
				tracker: runtime.serializeServerTracker(),
				server: {
					version: appVersion,
					commit: appCommit,
					node: process.version,
					platform: `${process.platform} ${process.arch}`,
					uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
					memoryMb: Math.round(memory.rss / 1048576),
					dbSizeMb: dbBytes === null ? null : Math.round((dbBytes / 1048576) * 10) / 10
				}
			});
		})
	);

	// ------------------------------------------------------- running bots

	app.get(
		'/api/admin/bots',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const rows = runtime.allRunningBots();
			const users = await User.findAll({ where: { id: [...new Set(rows.map((row) => row.userId))] } });
			const names = new Map(users.map((user) => [user.id, user.username]));
			return res.json({ bots: rows.map((row) => ({ ...row, owner: names.get(row.userId) || row.userId })) });
		})
	);

	app.post(
		'/api/admin/users/:id/helpers/:rowId/stop',
		requireAdmin,
		asyncRoute(async (req, res) => {
			await runtime.stopHelper(req.params.id, req.params.rowId, 'Extra bot stopped by an admin.');
			return res.json({ ok: true });
		})
	);

	app.post(
		'/api/admin/stop-all',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const rows = runtime.allRunningBots();
			const users = [...new Set(rows.map((row) => row.userId))];
			await Promise.allSettled(
				users.flatMap((userId) => [runtime.stop(userId, 'All bots stopped by an admin.'), runtime.stopHelpers(userId, 'All bots stopped by an admin.')])
			);
			return res.json({ stopped: rows.length });
		})
	);

	// ------------------------------------------------------ server tracker

	const trackerPayload = async () => {
		const settings = await getTrackerSettings();
		const trackingUsers = (await TrackedPlayer.findAll({ attributes: ['userId'] })).map((row) => row.userId);
		return {
			settings: sanitizeTracker(settings),
			intervals: TRACKER_INTERVALS,
			runtime: runtime.serializeServerTracker(),
			usersTracking: new Set(trackingUsers).size,
			trackedPlayers: trackingUsers.length
		};
	};

	app.get('/api/admin/tracker', requireAdmin, asyncRoute(async (_req, res) => res.json(await trackerPayload())));

	app.patch(
		'/api/admin/tracker',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const body = req.body || {};
			const patch = {};
			if (body.autoStart !== undefined) patch.autoStart = body.autoStart;
			if (body.intervalMinutes !== undefined) patch.intervalMinutes = Number(body.intervalMinutes);
			if (body.platform !== undefined) patch.platform = body.platform;
			const code = String(body.authorizationCode || '').trim();
			if (code) patch.authorizationCode = assertAuthorizationCode(extractAuthorizationCode(code));
			const json = String(body.deviceAuthJson || '').trim();
			if (json) {
				try {
					patch.deviceAuth = normalizeDeviceAuth(json);
				} catch (error) {
					throw httpError(400, error.message.includes('JSON') ? 'Device auth JSON is not valid JSON.' : error.message);
				}
			}
			const settings = await updateTrackerSettings(patch);
			if (patch.intervalMinutes) runtime.restartTrackingTimer(settings.intervalMinutes);
			return res.json(await trackerPayload());
		})
	);

	app.post(
		'/api/admin/tracker/start',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			await runtime.startServerTracker();
			return res.json(await trackerPayload());
		})
	);

	app.post(
		'/api/admin/tracker/stop',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			await runtime.stopServerTracker('Server tracker stopped by an admin.');
			return res.json(await trackerPayload());
		})
	);

	app.post(
		'/api/admin/tracker/clear-auth',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			await runtime.stopServerTracker('Server tracker signed out.');
			await updateTrackerSettings({ deviceAuth: null, authorizationCode: '', displayName: null });
			return res.json(await trackerPayload());
		})
	);

	app.post(
		'/api/admin/tracker/poll',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const users = [...new Set((await TrackedPlayer.findAll({ where: { enabled: true }, attributes: ['userId'] })).map((row) => row.userId))];
			let recorded = 0;
			for (const userId of users) recorded += (await runtime.pollTrackedPlayers(userId).catch(() => [])).length;
			return res.json({ recorded, ...(await trackerPayload()) });
		})
	);

	// ---------------------------------------------------------- server

	app.get('/api/admin/server', requireAdmin, asyncRoute(async (_req, res) => res.json({ options: await getServerOptions() })));

	app.patch(
		'/api/admin/server',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const options = await updateServerOptions(req.body || {});
			io?.emit?.('server:announcement', { announcement: options.announcement });
			return res.json({ options });
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
					const helpers = runtime.helpers.get(user.id);
					const [extraBots, trackedPlayers, matches] = await Promise.all([
						BotAccount.count({ where: { userId: user.id } }),
						TrackedPlayer.count({ where: { userId: user.id } }),
						MatchRound.count({ where: { userId: user.id } })
					]);
					return {
						...user.toSafeJSON(),
						extraBots,
						extraOnline: [...(helpers?.values() || [])].filter((entry) => entry.status === 'online').length,
						trackedPlayers,
						matches,
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
		'/api/admin/users/:id/reset-password',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const user = await User.findByPk(req.params.id);
			if (!user) throw httpError(404, 'User not found.');
			// Readable one-time password; the admin passes it on and the user changes it.
			const password = randomBytes(9).toString('base64url');
			await user.update({ passwordHash: await bcrypt.hash(password, 12) });
			await PasswordReset.destroy({ where: { userId: user.id } }).catch(() => {});
			return res.json({ password });
		})
	);

	app.delete(
		'/api/admin/users/:id',
		requireAdmin,
		asyncRoute(async (req, res) => {
			const user = await User.findByPk(req.params.id);
			if (!user) throw httpError(404, 'User not found.');
			if (user.id === req.user.id) throw httpError(400, 'You cannot delete your own account here.');
			if (user.role === 'admin' && (await User.count({ where: { role: 'admin' } })) <= 1) {
				throw httpError(400, 'The last admin cannot be deleted.');
			}
			await runtime.stop(user.id, 'Account deleted by an admin.').catch(() => {});
			await runtime.stopHelpers(user.id, 'Account deleted by an admin.').catch(() => {});
			// SQLite may not enforce the FK cascades, so remove the user's rows explicitly.
			for (const model of [BotListing, TrackedPlayer, MatchRound, BotAccount, FriendMessage, QuickCommand, BotLog, ReplayUpload, BotSession, PasswordReset, BotConfig]) {
				if (model?.rawAttributes?.userId) await model.destroy({ where: { userId: user.id } }).catch(() => {});
			}
			await user.destroy();
			return res.json({ ok: true });
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
