import bcrypt from 'bcryptjs';
import connectSessionSequelize from 'connect-session-sequelize';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { Op } from 'sequelize';
import { Server as SocketServer } from 'socket.io';
import { getPlainConfig, sanitizeConfig, updateLocalCategoryConfig, upsertPlainConfig } from './configStore.js';
import {
	fetchFnlbBotDetails,
	fetchFnlbBots,
	fetchFnlbDashboard,
	runFnlbCommand,
	searchFnlbUsers,
	sendFnlbChatMessage,
	updateFnlbBot,
	updateFnlbCategory
} from './fnlbApi.js';
import { BotRuntimeService, userRoom } from './botRuntime.js';
import {
	BotLog,
	initDatabase,
	normalizeSuspension,
	PasswordReset,
	QuickCommand,
	sequelize,
	SessionMedia,
	SessionStat,
	User
} from './models.js';
import { initMailer, sendPasswordResetEmail } from './mailer.js';
import { searchFortniteCosmetics } from './fortniteItems.js';
import { mediaDir, publicDir, replayDir, rootDir } from './paths.js';
import { parseReplayFile } from './replayParser.js';
import { getSessionSecret, initSecrets } from './secrets.js';
import { getBotSessions, recordBotSnapshot, recordBotSnapshots, resolveUploadSession } from './sessionHistory.js';
import { ReplayUpload } from './models.js';

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function asyncRoute(handler) {
	return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanEmail(value) {
	return String(value ?? '').trim().toLowerCase();
}

function cleanUsername(value) {
	return String(value ?? '').trim();
}

function validateAuthInput({ username, email, password }, requireUsername = false) {
	if (requireUsername && !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
		throw httpError(400, 'Username must be 3-40 characters and use letters, numbers, dots, dashes, or underscores.');
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw httpError(400, 'Enter a valid email address.');
	}
	if (String(password ?? '').length < 8) {
		throw httpError(400, 'Password must be at least 8 characters.');
	}
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
	return createHash('sha256').update(token).digest('hex');
}

function resetLinkBase(req) {
	const configured = process.env.APP_URL?.trim();
	if (configured) return configured.replace(/\/+$/, '');
	const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
	return `${proto}://${req.get('host')}`;
}

function suspensionPayload(user) {
	const permanent = user.status === 'suspended' && !user.suspendedUntil;
	return {
		status: user.status,
		permanent,
		suspendedUntil: user.suspendedUntil,
		suspendedReason: user.suspendedReason
	};
}

const botActionCommands = {
	add_friend: 'add_friend',
	remove_friend: 'remove_friend',
	block_user: 'block_user',
	unblock_user: 'unblock_user',
	invite: 'invite',
	join_party: 'join_party',
	kick: 'kick',
	kick_all: 'kick_all',
	hide_all: 'hide_all',
	unhide_all: 'unhide_all',
	set_playlist: 'set_playlist',
	ready: 'ready',
	unready: 'unready',
	set_status: 'set_status',
	say: 'say',
	leave_lobby: 'leave'
};

function cosmeticList(value, withVariants = false) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.map((id) => (withVariants ? { id, variants: [] } : { id }));
}

const cosmeticSlots = {
	startOutfit: true,
	startBackpack: true,
	startPickaxe: true,
	startShoes: true,
	startBanner: false,
	startBannerColor: false,
	joinOutfit: true,
	joinBackpack: true,
	joinPickaxe: true,
	joinShoes: true,
	joinEmote: false,
	memberJoinOutfit: true,
	memberJoinBackpack: true,
	memberJoinPickaxe: true,
	memberJoinShoes: true,
	memberJoinEmote: false
};

function equipCosmetic(currentConfig, slot, itemId, mode = 'replace') {
	if (!Object.hasOwn(cosmeticSlots, slot)) {
		throw httpError(400, 'Unsupported cosmetic slot.');
	}
	if (!itemId || itemId.length > 255) throw httpError(400, 'A valid Fortnite item ID is required.');

	const withVariants = cosmeticSlots[slot];
	const nextItem = withVariants ? { id: itemId, variants: [] } : { id: itemId };
	const currentItems = Array.isArray(currentConfig[slot]) ? currentConfig[slot] : [];

	if (mode === 'append') {
		const withoutDuplicate = currentItems.filter((item) => item.id !== itemId);
		currentConfig[slot] = [...withoutDuplicate, nextItem].slice(0, 30);
		return;
	}

	currentConfig[slot] = [nextItem];
}

function optionalInteger(value) {
	if (value === undefined || value === null || value === '') return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

async function createSessionMiddleware() {
	const SequelizeStore = connectSessionSequelize(session.Store);
	const store = new SequelizeStore({
		db: sequelize,
		tableName: 'Sessions',
		checkExpirationInterval: 15 * 60 * 1000,
		expiration: 7 * 24 * 60 * 60 * 1000
	});
	await store.sync();

	return session({
		name: 'fnlb.sid',
		secret: getSessionSecret(),
		store,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.COOKIE_SECURE === 'true',
			maxAge: 7 * 24 * 60 * 60 * 1000
		}
	});
}

export async function createServer() {
	await initSecrets();
	await initMailer();
	await initDatabase();
	if ((await User.count()) === 0) {
		console.log('[Lobby Bot Dashboard] No accounts exist yet. The first registered account will become admin.');
	}

	const app = express();
	const httpServer = createHttpServer(app);
	const io = new SocketServer(httpServer);
	const runtime = new BotRuntimeService(io);
	const sessionMiddleware = await createSessionMiddleware();
	const upload = multer({
		dest: replayDir,
		limits: {
			fileSize: 75 * 1024 * 1024,
			files: 1
		},
		fileFilter: (_req, file, cb) => {
			if (!file.originalname.toLowerCase().endsWith('.replay')) {
				return cb(httpError(400, 'Only .replay files can be uploaded.'));
			}
			return cb(null, true);
		}
	});
	const mediaUpload = multer({
		dest: mediaDir,
		limits: {
			fileSize: 250 * 1024 * 1024,
			files: 1
		},
		fileFilter: (_req, file, cb) => {
			const ok =
				file.mimetype.startsWith('image/') ||
				file.mimetype.startsWith('video/') ||
				/\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i.test(file.originalname);
			if (!ok) return cb(httpError(400, 'Only image or video evidence files can be uploaded.'));
			return cb(null, true);
		}
	});

	app.disable('x-powered-by');
	app.use(express.json({ limit: '1mb' }));
	app.use(sessionMiddleware);
	app.use('/vendor/lucide', express.static(join(rootDir, 'node_modules', 'lucide', 'dist', 'umd')));
	app.use(express.static(publicDir));

	app.use(
		asyncRoute(async (req, _res, next) => {
			if (!req.session.userId) return next();
			const user = await normalizeSuspension(await User.findByPk(req.session.userId));
			if (!user) {
				req.session.destroy(() => {});
				return next();
			}
			req.user = user;
			next();
		})
	);

	function requireAuth(req, _res, next) {
		if (!req.user) return next(httpError(401, 'Sign in to continue.'));
		return next();
	}

	function requireActive(req, _res, next) {
		if (req.user?.status === 'suspended') {
			return next(httpError(403, 'This account is suspended.'));
		}
		return next();
	}

	function requireAdmin(req, _res, next) {
		if (!req.user) return next(httpError(401, 'Sign in to continue.'));
		if (req.user.role !== 'admin') return next(httpError(403, 'Admin access is required.'));
		return next();
	}

	app.get(
		'/api/session',
		asyncRoute(async (req, res) => {
			if (!req.user) return res.json({ user: null });
			return res.json({
				user: req.user.toSafeJSON(),
				runtime: runtime.serialize(req.user.id),
				suspension: suspensionPayload(req.user)
			});
		})
	);

	app.post(
		'/api/auth/register',
		asyncRoute(async (req, res) => {
			const username = cleanUsername(req.body.username);
			const email = cleanEmail(req.body.email);
			const password = String(req.body.password ?? '');
			validateAuthInput({ username, email, password }, true);

			const firstUser = (await User.count()) === 0;
			const passwordHash = await bcrypt.hash(password, 12);

			const user = await User.create({
				username,
				email,
				passwordHash,
				role: firstUser ? 'admin' : 'user'
			}).catch((error) => {
				if (error.name === 'SequelizeUniqueConstraintError') {
					throw httpError(409, 'That username or email is already registered.');
				}
				throw error;
			});

			req.session.userId = user.id;
			return res.status(201).json({ user: user.toSafeJSON() });
		})
	);

	app.post(
		'/api/auth/login',
		asyncRoute(async (req, res) => {
			const email = cleanEmail(req.body.email);
			const password = String(req.body.password ?? '');
			validateAuthInput({ email, password }, false);

			const user = await normalizeSuspension(await User.findOne({ where: { email } }));
			if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
				throw httpError(401, 'Invalid email or password.');
			}
			if (user.status === 'suspended') {
				throw httpError(403, 'This account is suspended.');
			}

			req.session.userId = user.id;
			return res.json({ user: user.toSafeJSON() });
		})
	);

	app.post('/api/auth/logout', (req, res) => {
		req.session.destroy(() => res.json({ ok: true }));
	});

	app.post(
		'/api/auth/forgot-password',
		asyncRoute(async (req, res) => {
			const email = cleanEmail(req.body.email);
			// Always respond the same way so the endpoint cannot be used to enumerate accounts.
			const genericResponse = {
				ok: true,
				message: 'If an account exists for that email, a password reset link has been sent.'
			};
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(genericResponse);

			const user = await User.findOne({ where: { email } });
			if (!user) return res.json(genericResponse);

			// Invalidate any outstanding tokens for this user before issuing a new one.
			await PasswordReset.destroy({ where: { userId: user.id, usedAt: null } });

			const token = randomBytes(32).toString('hex');
			await PasswordReset.create({
				userId: user.id,
				tokenHash: hashToken(token),
				expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
			});

			const resetUrl = `${resetLinkBase(req)}/?reset_token=${token}`;
			try {
				await sendPasswordResetEmail({
					to: user.email,
					username: user.username,
					resetUrl,
					expiresMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000)
				});
			} catch (error) {
				console.error(`[Mailer] Failed to send password reset email: ${error.message}`);
			}
			return res.json(genericResponse);
		})
	);

	app.post(
		'/api/auth/reset-password',
		asyncRoute(async (req, res) => {
			const token = String(req.body.token ?? '').trim();
			const password = String(req.body.password ?? '');
			if (!token) throw httpError(400, 'A reset token is required.');
			if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');

			const record = await PasswordReset.findOne({
				where: {
					tokenHash: hashToken(token),
					usedAt: null,
					expiresAt: { [Op.gt]: new Date() }
				}
			});
			if (!record) throw httpError(400, 'This reset link is invalid or has expired. Request a new one.');

			const user = await User.findByPk(record.userId);
			if (!user) throw httpError(400, 'This reset link is invalid or has expired. Request a new one.');

			user.passwordHash = await bcrypt.hash(password, 12);
			await user.save();
			await record.update({ usedAt: new Date() });
			// Drop any other outstanding tokens for this account.
			await PasswordReset.destroy({ where: { userId: user.id, usedAt: null } });

			return res.json({ ok: true, message: 'Your password has been reset. You can now sign in.' });
		})
	);

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
			const status = runtime.serialize(req.user.id);
			if (['online', 'starting', 'restarting'].includes(status.status)) {
				runtime.appendLog(req.user.id, 'Configuration saved. Restart the cluster to apply changes.', 2);
			}
			return res.json({ config: sanitizeConfig(config), runtime: status });
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

	app.get(
		'/api/fnlb/bots',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const dashboard = runtime.localDashboard(req.user.id, config);
				return res.json({
					bots: dashboard.bots,
					capabilities: {
						engine: 'fnbr',
						flags: ['Disabled'],
						matchmakingBanField: null,
						permanentOrTemporaryAccountBan: false,
						localRuntime: true
					}
				});
			}
			const bots = await fetchFnlbBots(config.apiToken);
			return res.json({
				bots,
				capabilities: {
					engine: 'fnlb',
					flags: ['Disabled', 'Public', 'InvalidAuth'],
					matchmakingBanField: 'mmsBannedUntil',
					categoryCanStartBannedBots: 'startBannedBots',
					permanentOrTemporaryAccountBan: false
				}
			});
		})
	);

	app.get(
		'/api/fnlb/dashboard',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const dashboard = runtime.localDashboard(req.user.id, config);
				await recordBotSnapshots(req.user.id, dashboard.bots);
				return res.json({
					...dashboard,
					capabilities: {
						engine: 'fnbr',
						bots: ['localDetail', 'friends', 'pendingFriends', 'blockedUsers', 'presence', 'party', 'matchState'],
						commands: [
							'addFriend',
							'removeFriend',
							'blockUser',
							'unblockUser',
							'invite',
							'joinParty',
							'leaveParty',
							'kick',
							'setStatus',
							'setPlaylist',
							'cosmetics',
							'chat',
							'searchUsers'
						],
						categories: ['localLoadout', 'realtimeCosmetics'],
						stats: ['localPresence'],
						flags: ['Disabled'],
						matchmakingBanField: null,
						partyFieldsDependOnFnlbResponse: false
					}
				});
			}
			const dashboard = await fetchFnlbDashboard(config.apiToken);
			await recordBotSnapshots(req.user.id, dashboard.bots);
			return res.json({
				...dashboard,
				capabilities: {
					engine: 'fnlb',
					bots: ['list', 'detail', 'disable', 'friends', 'pendingFriends', 'blockedUsers'],
					commands: ['runCommand', 'sendChatMessage', 'searchUsers'],
					categories: ['list'],
					stats: ['public', 'vip'],
					flags: ['Disabled', 'Public', 'InvalidAuth'],
					matchmakingBanField: 'mmsBannedUntil',
					categoryCanStartBannedBots: 'startBannedBots',
					partyFieldsDependOnFnlbResponse: true
				}
			});
		})
	);

	app.get(
		'/api/fnlb/bots/:botId/details',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const details = await runtime.localDetails(req.user.id, config, req.params.botId);
				await recordBotSnapshot(req.user.id, details.bot);
				details.sessions = await getBotSessions(req.user.id, details.bot.id);
				return res.json(details);
			}
			const details = await fetchFnlbBotDetails(config.apiToken, req.params.botId);
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
			if (runtime.isLocalMode(config)) {
				if (typeof req.body.disabled !== 'boolean') {
					throw httpError(400, 'No supported bot update was provided.');
				}
				if (req.body.disabled) {
					await runtime.stop(req.user.id, 'Local fnbr bot disabled.');
					return res.json({ ok: true, disabled: true, runtime: runtime.serialize(req.user.id) });
				}
				await runtime.start(req.user, config);
				return res.json({ ok: true, disabled: false, runtime: runtime.serialize(req.user.id) });
			}
			const payload = {};
			if (typeof req.body.disabled === 'boolean') payload.disabled = req.body.disabled;
			if (!Object.keys(payload).length) throw httpError(400, 'No supported bot update was provided.');
			const result = await updateFnlbBot(config.apiToken, req.params.botId, payload);
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
			if (runtime.isLocalMode(config)) {
				const result = await runtime.runLocalCommand(
					req.user.id,
					req.body.command,
					String(req.body.args || '').trim()
				);
				return res.json(result);
			}
			const result = await runFnlbCommand(config.apiToken, req.params.botId, req.body);
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

			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const result = await runtime.runLocalCommand(req.user.id, command, args);
				return res.json(result);
			}
			const result = await runFnlbCommand(config.apiToken, req.params.botId, {
				command,
				args,
				locale: req.body.locale || 'en'
			});
			return res.json(result);
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/chat/messages',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (!String(req.body.content || '').trim()) throw httpError(400, 'Message content is required.');
			if (runtime.isLocalMode(config)) {
				const result = await runtime.sendLocalChatMessage(req.user.id, req.body.content);
				return res.json(result);
			}
			const result = await sendFnlbChatMessage(config.apiToken, req.params.botId, req.body);
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
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const users = await runtime.searchLocalUsers(req.user.id, prefix, req.query.platform || 'epic');
				return res.json({ users });
			}
			const users = await searchFnlbUsers(config.apiToken, req.params.botId, prefix);
			return res.json({ users });
		})
	);

	app.get(
		'/api/fnlb/bots/:botId/sessions',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.json({ sessions });
		})
	);

	app.patch(
		'/api/fnlb/categories/:categoryId/cosmetics',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			if (runtime.isLocalMode(config)) {
				const directSlot = req.body.slot ? String(req.body.slot).trim() : '';
				const directItemId = req.body.itemId ? String(req.body.itemId).trim() : '';
				const localCategory = await updateLocalCategoryConfig(req.user.id, async (nextConfig) => {
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
				if (directSlot && directItemId) await runtime.applyLocalCosmetic(req.user.id, directSlot, directItemId);
				else await runtime.applyLocalCategory(req.user.id, localCategory.config);
				return res.json({
					ok: true,
					source: 'fnbr',
					categoryId: localCategory.id,
					config: localCategory.config
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

			const result = await updateFnlbCategory(config.apiToken, req.params.categoryId, {
				name: category.name,
				config: nextConfig
			});
			return res.json({ ...result, categoryId: category.id, config: nextConfig });
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/replays',
		requireAuth,
		requireActive,
		upload.single('replay'),
		asyncRoute(async (req, res) => {
			if (!req.file) throw httpError(400, 'Replay file is required.');
			await mkdir(join(replayDir, req.user.id), { recursive: true });

			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			let parsed = false;
			let parseError = null;
			let parsedData = null;
			try {
				parsedData = await parseReplayFile(req.file.path);
				parsed = true;
			} catch (error) {
				parseError = error.message;
			}

			const replay = await ReplayUpload.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				originalName: req.file.originalname,
				fileName: req.file.filename,
				filePath: req.file.path,
				size: req.file.size,
				parsed,
				parseError,
				kills: parsedData?.kills ?? null,
				deaths: parsedData?.deaths ?? null,
				placement: parsedData?.placement ?? null,
				matchStatsJson: parsedData ? JSON.stringify(parsedData.raw) : null
			});

			if (parsedData) {
				await session.update({
					kills: parsedData.kills,
					deaths: parsedData.deaths,
					statsJson: JSON.stringify({
						...(session.statsJson ? JSON.parse(session.statsJson) : {}),
						replay: parsedData.raw
					})
				});
			}

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ replay, sessions });
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/session-stats',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			const stat = await SessionStat.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				source: 'manual',
				kills: optionalInteger(req.body.kills),
				deaths: optionalInteger(req.body.deaths),
				assists: optionalInteger(req.body.assists),
				placement: optionalInteger(req.body.placement),
				matches: optionalInteger(req.body.matches),
				wins: optionalInteger(req.body.wins),
				notes: String(req.body.notes || '').trim() || null
			});

			await session.update({
				kills: stat.kills ?? session.kills,
				deaths: stat.deaths ?? session.deaths,
				lastSeenAt: new Date()
			});

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ stat, sessions });
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/session-media',
		requireAuth,
		requireActive,
		mediaUpload.single('media'),
		asyncRoute(async (req, res) => {
			if (!req.file) throw httpError(400, 'Image or video file is required.');
			await mkdir(join(mediaDir, req.user.id), { recursive: true });

			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			const media = await SessionMedia.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				originalName: req.file.originalname,
				fileName: req.file.filename,
				filePath: req.file.path,
				mimeType: req.file.mimetype,
				size: req.file.size,
				notes: String(req.body.notes || '').trim() || null
			});

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ media, sessions });
		})
	);

	app.get(
		'/api/fortnite/items',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const query = String(req.query.q || '').trim();
			const type = String(req.query.type || '').trim();
			if (!query) throw httpError(400, 'Search text is required.');
			const items = await searchFortniteCosmetics(query, type);
			return res.json({ items, source: 'fortnite-api.com' });
		})
	);

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

	io.engine.use(sessionMiddleware);
	io.use(async (socket, next) => {
		try {
			const userId = socket.request.session?.userId;
			if (!userId) return next(new Error('unauthorized'));
			const user = await normalizeSuspension(await User.findByPk(userId));
			if (!user) return next(new Error('unauthorized'));
			socket.user = user;
			return next();
		} catch (error) {
			return next(error);
		}
	});

	io.on('connection', (socket) => {
		socket.join(userRoom(socket.user.id));
		socket.emit('bot:status', runtime.serialize(socket.user.id));
	});

	app.get(/.*/, (req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
		res.sendFile(join(publicDir, 'index.html'));
	});

	app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
		return next();
	});

	app.use((error, _req, res, _next) => {
		const status = error.status >= 400 && error.status < 600 ? error.status : 500;
		if (status >= 500) console.error(error);
		res.status(status).json({ error: error.message || 'Internal server error.' });
	});

	return { app, httpServer, io, runtime };
}
