import { randomUUID } from 'node:crypto';
import {
	DEFAULT_LOCAL_CATEGORY_ID,
	clearAuthorizationCodeForUser,
	getPlainConfig,
	normalizePlatform,
	saveDeviceAuthForUser,
	validateStartConfig
} from '../services/configStore.js';
import { LocalFnbrRuntime } from './LocalFnbrRuntime.js';
import { LegacyFnlbRuntime } from './LegacyFnlbRuntime.js';
import { runtimeError } from './BaseRuntime.js';
import { BotLog, FriendMessage, pruneLogs } from '../models/index.js';
import { closeActiveSessions, recordBotSnapshot } from '../services/sessionHistory.js';
import { closeMatchRound, openMatchRound } from '../services/matchTracker.js';
import { pollUserPlayers, usersWithTrackedPlayers } from '../services/playerTracker.js';
import {
	clearBotAccountCode,
	getBotAccount,
	listBotAccounts,
	sanitizeAccount,
	saveBotAccountDeviceAuth,
	saveBotAccountIdentity
} from '../services/botAccounts.js';

const ROOM_PREFIX = 'user:';
const MEMORY_LOG_LIMIT = 200;
const FRIEND_WAIT_MS = 15000;
const INVITE_WAIT_MS = 15000;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, stepMs = 500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return true;
		await sleep(stepMs);
	}
	return check();
}

/** Config keys that genuinely need a process restart to take effect. */
const RESTART_REQUIRED_KEYS = [
	'runtimeMode',
	'apiToken',
	'categories',
	'bots',
	'releaseChannel',
	'platform',
	'killOtherTokens',
	'numberOfShards',
	'botsPerShard',
	'clusterName',
	'hideUsernames',
	'hideEmails',
	'logLevel'
];

export function userRoom(userId) {
	return `${ROOM_PREFIX}${userId}`;
}

function normalizeLogContent(content) {
	return String(content ?? '')
		.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
		.trimEnd();
}

function localCategoryOf(config) {
	const category = config.localCategory || {};
	return {
		id: DEFAULT_LOCAL_CATEGORY_ID,
		name: category.name || 'Local fnbr Loadout',
		flags: 0,
		flagsList: [],
		isDisabled: false,
		isManaged: false,
		source: 'fnbr',
		config: category.config || {}
	};
}

function offlineLocalBot(config) {
	if (!config.deviceAuth?.accountId && !config.authorizationCode) return null;
	return {
		id: config.deviceAuth?.accountId || 'pending-device-auth',
		nickname: config.deviceAuth?.accountId ? 'Local fnbr bot' : 'Pending auth-code login',
		email: null,
		parent: null,
		flags: config.localBotEnabled === false ? 1 : 0,
		flagsList: config.localBotEnabled === false ? ['Disabled'] : [],
		isDisabled: config.localBotEnabled === false,
		hasInvalidAuth: false,
		mmsBannedUntil: null,
		banState: 'not_exposed_by_epic_presence',
		source: 'fnbr',
		runtimeMode: 'fnbr',
		presenceStatus: config.defaultStatus,
		platform: config.platform || null,
		friendsCount: null,
		pendingFriendsCount: null,
		blockedUsersCount: null,
		matches: 0,
		isInMatch: false,
		matchState: 'offline',
		party: null,
		partyMembers: null,
		cosmetics: {}
	};
}

const OFFLINE_CAPABILITIES = {
	fnbr: {
		engine: 'fnbr',
		capabilities: {
			friends: true,
			friendMessages: true,
			friendRequests: true,
			blockedUsers: true,
			party: true,
			partyChat: true,
			cosmetics: true,
			realtimeCosmetics: true,
			playlist: true,
			privacy: true,
			readiness: true,
			sittingOut: true,
			squadFill: true,
			presence: true,
			matchTracking: true,
			searchUsers: true,
			promoteMember: true,
			multiBot: true,
			dmCommands: true,
			autoReady: true,
			playerStats: true
		}
	},
	fnlb: {
		engine: 'fnlb',
		capabilities: {
			friends: true,
			friendMessages: false,
			friendRequests: true,
			blockedUsers: true,
			party: true,
			partyChat: true,
			cosmetics: true,
			realtimeCosmetics: false,
			playlist: true,
			privacy: false,
			readiness: true,
			sittingOut: true,
			squadFill: true,
			sittingOut: false,
			squadFill: false,
			presence: true,
			matchTracking: false,
			searchUsers: true,
			promoteMember: false,
			multiBot: true
		}
	}
};

/**
 * Owns one runtime per user and keeps `configuredMode` (what is saved) strictly
 * separate from `activeMode` (what is actually running). Routes always resolve
 * the ACTIVE runtime, so saving a new engine while a bot is online can never
 * make the UI talk to the wrong engine — it sets `restartRequired` instead.
 */
export class RuntimeManager {
	constructor(io) {
		this.io = io;
		this.runtimes = new Map();
		// userId -> Map(botAccountId -> extra bot entry). Extra bots are always
		// local fnbr clients and run independently of the main runtime.
		this.helpers = new Map();
	}

	get(userId) {
		if (!this.runtimes.has(userId)) {
			this.runtimes.set(userId, {
				status: 'offline',
				configuredMode: 'fnbr',
				activeMode: null,
				restartRequired: false,
				restartReason: null,
				adapter: null,
				restartTimer: null,
				startedAt: null,
				lastError: null,
				authRequired: false,
				clusterName: null,
				startConfig: null,
				restartInterval: null,
				autoUpdateOnRestart: true,
				logs: []
			});
		}
		return this.runtimes.get(userId);
	}

	serialize(userId) {
		const runtime = this.get(userId);
		return {
			status: runtime.status,
			// `mode` is kept for the existing frontend; it now always reports the
			// engine that is really running, falling back to the configured one.
			mode: runtime.activeMode || runtime.configuredMode,
			configuredMode: runtime.configuredMode,
			activeMode: runtime.activeMode,
			restartRequired: runtime.restartRequired,
			restartReason: runtime.restartReason,
			startedAt: runtime.startedAt,
			lastError: runtime.lastError,
			authRequired: runtime.authRequired,
			clusterName: runtime.clusterName,
			restartInterval: runtime.restartInterval,
			autoUpdateOnRestart: runtime.autoUpdateOnRestart,
			capabilities: this.capabilities(userId),
			health: runtime.adapter?.health || null
		};
	}

	capabilities(userId) {
		const runtime = this.get(userId);
		if (runtime.adapter) return runtime.adapter.getCapabilities();
		return OFFLINE_CAPABILITIES[runtime.configuredMode] || OFFLINE_CAPABILITIES.fnbr;
	}

	isRunning(userId) {
		return ['starting', 'online', 'restarting', 'stopping'].includes(this.get(userId).status);
	}

	emitStatus(userId) {
		this.io.to(userRoom(userId)).emit('bot:status', this.serialize(userId));
	}

	emitTo(userId, event, payload) {
		this.io.to(userRoom(userId)).emit(event, payload);
	}

	/**
	 * Called after a config save. Never swaps the running engine underneath the
	 * user — it flags that a restart is needed and applies whatever CAN be
	 * applied live.
	 */
	async applySavedConfig(userId, config) {
		const runtime = this.get(userId);
		runtime.configuredMode = config.runtimeMode;
		runtime.restartInterval = config.restartInterval;
		runtime.autoUpdateOnRestart = config.autoUpdateOnRestart;

		if (!runtime.adapter || !this.isRunning(userId)) {
			runtime.restartRequired = false;
			runtime.restartReason = null;
			this.emitStatus(userId);
			return { restartRequired: false, appliedLive: [] };
		}

		const appliedLive = [];
		const reasons = [];

		if (runtime.activeMode && runtime.activeMode !== config.runtimeMode) {
			reasons.push('Restart required to switch runtime engine');
		}

		const previous = runtime.startConfig || {};
		for (const key of RESTART_REQUIRED_KEYS) {
			if (key === 'runtimeMode') continue;
			const before = previous[key];
			const after = config[key];
			if (before !== undefined && after !== undefined && String(before) !== String(after)) {
				reasons.push(`Restart required to apply ${key}`);
			}
		}

		// Everything below applies to the RUNNING bot right now.
		if (runtime.activeMode === 'fnbr') {
			runtime.adapter.updateLocalCategory(config.localCategory);
			appliedLive.push('localCategory');

			if (config.defaultStatus && config.defaultStatus !== previous.defaultStatus) {
				await runtime.adapter
					.setStatus(config.defaultStatus)
					.then(() => appliedLive.push('defaultStatus'))
					.catch((error) => this.appendLog(userId, `Could not apply presence status: ${error.message}`, 4));
			}
			const privacy = config.localCategory?.config?.privacy;
			if (privacy && privacy !== previous.localCategory?.config?.privacy) {
				await runtime.adapter
					.setPrivacy(privacy)
					.then(() => appliedLive.push('privacy'))
					.catch((error) => this.appendLog(userId, `Could not apply party privacy: ${error.message}`, 4));
			}
		}

		runtime.startConfig = { ...previous, ...config };
		runtime.restartRequired = reasons.length > 0;
		runtime.restartReason = reasons[0] || null;
		if (runtime.restartRequired) {
			this.appendLog(userId, `Configuration changed. ${reasons[0]}.`, 2);
		} else if (appliedLive.length) {
			this.appendLog(userId, 'Configuration saved and applied to the running bot.', 1);
		}
		this.scheduleRestart(userId);
		this.emitStatus(userId);
		return { restartRequired: runtime.restartRequired, restartReason: runtime.restartReason, appliedLive };
	}

	// ------------------------------------------------------------- logging

	appendLog(userId, content, format = 0) {
		const normalized = normalizeLogContent(content);
		if (!normalized) return;

		for (const line of normalized.split(/\r?\n/).filter(Boolean)) {
			const entry = {
				id: randomUUID(),
				userId,
				format,
				content: line,
				createdAt: new Date().toISOString()
			};

			const runtime = this.get(userId);
			runtime.logs.push(entry);
			if (runtime.logs.length > MEMORY_LOG_LIMIT) runtime.logs.shift();

			this.io.to(userRoom(userId)).emit('bot:log', entry);
			BotLog.create({ id: entry.id, userId, format, content: line, createdAt: entry.createdAt })
				.then(() => pruneLogs(userId).catch(() => {}))
				.catch(() => {});
		}
	}

	async recentLogs(userId, limit = 200) {
		const rows = await BotLog.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit });
		return rows.reverse().map((row) => ({
			id: row.id,
			userId: row.userId,
			format: row.format,
			content: row.content,
			createdAt: row.createdAt
		}));
	}

	// ------------------------------------------------------------ lifecycle

	createAdapter(userId, plainConfig, startConfig) {
		const shared = {
			userId,
			startConfig,
			plainConfig,
			appendLog: this.appendLog.bind(this),
			emit: (event, payload) => this.emitTo(userId, event, payload)
		};

		if (startConfig.mode === 'fnlb') return new LegacyFnlbRuntime(shared);

		return new LocalFnbrRuntime({
			...shared,
			onDeviceAuth: saveDeviceAuthForUser,
			onSnapshot: recordBotSnapshot,
			onFriendMessage: (id, message) => this.handleFriendMessage(id, message),
			onMatchState: (id, event) => this.handleMatchState(id, event),
			trustedIds: () => this.helperAccountIds(userId)
		});
	}

	async handleFriendMessage(userId, message) {
		this.emitTo(userId, 'friend:message', message);
		try {
			await FriendMessage.create({
				userId,
				botId: message.botId,
				friendId: message.friendId,
				friendName: message.friendName,
				direction: message.direction,
				content: message.content,
				sentAt: message.sentAt
			});
		} catch (error) {
			this.appendLog(userId, `Could not store friend message: ${error.message}`, 4);
		}
	}

	async handleMatchState(userId, event) {
		try {
			if (event.state === 'in_match') {
				const round = await openMatchRound(userId, event);
				this.emitTo(userId, 'match:started', { botId: event.botId, round });
				this.appendLog(userId, `Match started (${event.playlistId || 'unknown playlist'}).`, 2);
				return;
			}
			if (event.previous === 'in_match') {
				const round = await closeMatchRound(userId, event);
				this.emitTo(userId, 'match:ended', { botId: event.botId, round });
				this.appendLog(userId, 'Match ended, returning to lobby.', 2);
				return;
			}
			this.emitTo(userId, 'match:updated', { botId: event.botId, state: event.state });
		} catch (error) {
			this.appendLog(userId, `Match tracking error: ${error.message}`, 4);
		}
	}

	async start(user, plainConfig) {
		const userId = user.id;
		const runtime = this.get(userId);
		if (this.isRunning(userId)) {
			throw runtimeError(409, 'This bot is already running or changing state.');
		}
		if (user.status === 'suspended') {
			throw runtimeError(403, 'This account is suspended and cannot start a bot.');
		}

		const startConfig = validateStartConfig(plainConfig);
		runtime.startConfig = { ...plainConfig, ...startConfig };
		runtime.configuredMode = plainConfig.runtimeMode;
		runtime.clusterName = plainConfig.clusterName;
		runtime.restartInterval = plainConfig.restartInterval;
		runtime.autoUpdateOnRestart = plainConfig.autoUpdateOnRestart;
		runtime.status = 'starting';
		runtime.lastError = null;
		runtime.authRequired = false;
		runtime.restartRequired = false;
		runtime.restartReason = null;
		this.emitStatus(userId);

		try {
			runtime.adapter = this.createAdapter(userId, plainConfig, startConfig);
			this.appendLog(
				userId,
				startConfig.mode === 'fnbr' ? 'Starting local fnbr.js Fortnite bot...' : 'Starting legacy FNLB cluster...',
				2
			);
			await runtime.adapter.start();

			// activeMode is only set once the engine is genuinely up.
			runtime.activeMode = startConfig.mode;
			runtime.status = 'online';
			runtime.startedAt = new Date().toISOString();
			runtime.lastError = null;
			this.scheduleRestart(userId);
			this.appendLog(userId, `${startConfig.mode === 'fnbr' ? 'Local fnbr bot' : 'FNLB cluster'} is online.`, 1);
			this.emitStatus(userId);
			if (startConfig.mode === 'fnbr') {
				// Not awaited: extra bots logging in must not delay the main start.
				this.autoStartHelpers(user).catch((error) =>
					this.appendLog(userId, `Extra bot auto-start failed: ${error.message}`, 4)
				);
			}
		} catch (error) {
			runtime.status = error.status === 401 ? 'auth_required' : 'error';
			runtime.authRequired = error.status === 401;
			runtime.adapter = null;
			runtime.activeMode = null;
			runtime.startedAt = null;
			runtime.lastError = error.message;
			this.appendLog(userId, `Start failed: ${error.message}`, 4);
			if (error.authCodeRejected) {
				await clearAuthorizationCodeForUser(userId).catch(() => {});
				this.appendLog(userId, 'The rejected authorization code was removed. Paste a fresh one before starting again.', 2);
			}
			this.emitStatus(userId);
			throw error;
		}
	}

	scheduleRestart(userId) {
		const runtime = this.get(userId);
		if (runtime.restartTimer) clearInterval(runtime.restartTimer);
		if (!runtime.restartInterval || runtime.restartInterval < 60) return;

		runtime.restartTimer = setInterval(() => {
			this.restart(userId).catch((error) => {
				runtime.status = 'error';
				runtime.lastError = error.message;
				this.appendLog(userId, `Automatic restart failed: ${error.message}`, 4);
				this.emitStatus(userId);
			});
		}, runtime.restartInterval * 1000);
		runtime.restartTimer.unref?.();
	}

	/**
	 * Restarts using CURRENT database config, not the stale config the runtime
	 * happened to start with, and rebuilds the adapter so an engine change made
	 * while online is honoured here.
	 */
	async restart(userId, user = null) {
		const runtime = this.get(userId);
		if (!runtime.adapter) return;

		runtime.status = 'restarting';
		this.emitStatus(userId);
		this.appendLog(userId, 'Restart started: reloading configuration from the database.', 2);

		const plainConfig = await getPlainConfig(userId);
		const startConfig = validateStartConfig(plainConfig);

		const previous = runtime.adapter;
		const wasFnlb = runtime.activeMode === 'fnlb';
		const previousBotId = previous.engine === 'fnbr' ? previous.botId?.() : null;
		await previous.stop().catch((error) => this.appendLog(userId, `Stop warning: ${error.message}`, 4));
		await closeActiveSessions(userId, previousBotId).catch(() => {});

		if (wasFnlb && runtime.autoUpdateOnRestart && typeof previous.update === 'function') {
			this.appendLog(userId, 'Checking for FNLB updates before restart...', 2);
			await previous.update().catch((error) => this.appendLog(userId, `FNLB update warning: ${error.message}`, 4));
		}

		runtime.adapter = this.createAdapter(userId, plainConfig, startConfig);
		runtime.startConfig = { ...plainConfig, ...startConfig };
		runtime.configuredMode = plainConfig.runtimeMode;
		runtime.clusterName = plainConfig.clusterName;
		runtime.restartInterval = plainConfig.restartInterval;
		runtime.autoUpdateOnRestart = plainConfig.autoUpdateOnRestart;

		await runtime.adapter.start();

		runtime.activeMode = startConfig.mode;
		runtime.status = 'online';
		runtime.startedAt = new Date().toISOString();
		runtime.lastError = null;
		runtime.restartRequired = false;
		runtime.restartReason = null;
		this.scheduleRestart(userId);
		this.appendLog(userId, 'Restart finished.', 1);
		this.emitStatus(userId);
	}

	async stop(userId, reason = 'Bot stopped.') {
		const runtime = this.get(userId);
		if (runtime.restartTimer) {
			clearInterval(runtime.restartTimer);
			runtime.restartTimer = null;
		}

		if (!runtime.adapter) {
			runtime.status = 'offline';
			runtime.activeMode = null;
			runtime.startedAt = null;
			runtime.lastError = null;
			this.emitStatus(userId);
			return;
		}

		runtime.status = 'stopping';
		this.emitStatus(userId);
		this.appendLog(userId, `Stopping ${runtime.activeMode === 'fnbr' ? 'local fnbr bot' : 'FNLB cluster'}...`, 2);
		try {
			// Read before stop(): the fnbr adapter forgets its client on logout.
			const botId = runtime.adapter.botId?.();
			const mainOnly = runtime.adapter.engine === 'fnbr' ? botId : null;
			await runtime.adapter.stop();
			// Close out history so sessions and matches are not left "active".
			await closeMatchRound(userId, { botId }).catch(() => {});
			await closeActiveSessions(userId, mainOnly).catch(() => {});

			runtime.status = 'offline';
			runtime.adapter = null;
			runtime.activeMode = null;
			runtime.startedAt = null;
			runtime.lastError = null;
			runtime.restartRequired = false;
			runtime.restartReason = null;
			this.appendLog(userId, reason, 1);
		} catch (error) {
			runtime.status = 'error';
			runtime.lastError = error.message;
			this.appendLog(userId, `Stop failed: ${error.message}`, 4);
			throw error;
		} finally {
			this.emitStatus(userId);
		}
	}

	async stopAll() {
		const ids = [...this.runtimes.keys()];
		const helperUsers = [...this.helpers.keys()];
		await Promise.allSettled([
			...ids.map((userId) => this.stop(userId, 'Server shutting down.')),
			...helperUsers.map((userId) => this.stopHelpers(userId))
		]);
	}

	// -------------------------------------------------------------- routing

	/**
	 * THE important accessor: returns the engine that is actually running.
	 * Routes must use this instead of reading the saved config, otherwise a
	 * config change can point the UI at an engine that is not running.
	 */
	requireActive(userId, botId = null) {
		// A botId that belongs to one of the user's extra accounts routes to that
		// bot; anything else (including FNLB bot IDs) goes to the main runtime.
		if (botId) {
			const helper = this.findHelperByBotId(userId, botId);
			if (helper) {
				if (!helper.adapter || helper.status !== 'online') {
					throw runtimeError(409, `${helper.label} is not online. Start it from Bot Lobby first.`);
				}
				return helper.adapter;
			}
		}
		const runtime = this.get(userId);
		if (!runtime.adapter || runtime.status !== 'online') {
			throw runtimeError(409, 'No bot runtime is online. Start the bot first.');
		}
		return runtime.adapter;
	}

	active(userId) {
		const runtime = this.get(userId);
		return runtime.status === 'online' ? runtime.adapter : null;
	}

	activeMode(userId) {
		return this.get(userId).activeMode;
	}

	/** True when the engine to talk to (active if running, else configured) is local. */
	isLocalEngine(userId, config) {
		const runtime = this.get(userId);
		if (runtime.activeMode) return runtime.activeMode === 'fnbr';
		return (config?.runtimeMode ?? runtime.configuredMode) !== 'fnlb';
	}

	requireLocal(userId) {
		const adapter = this.requireActive(userId);
		if (adapter.engine !== 'fnbr') {
			throw runtimeError(409, 'The local fnbr bot is not the running engine.');
		}
		return adapter;
	}

	// --------------------------------------------------- offline fallbacks

	offlineDashboard(userId, config) {
		const category = localCategoryOf(config);
		const bot = offlineLocalBot(config);
		return {
			bots: bot ? [bot] : [],
			stats: { local: { total: bot ? 1 : 0, connected: 0, friends: 0, partyMembers: 0, matches: 0 } },
			categories: [category],
			user: null,
			source: 'fnbr'
		};
	}

	offlineDetails(config, botId) {
		const category = localCategoryOf(config);
		const bot = offlineLocalBot(config);
		if (!bot || bot.id !== botId) throw runtimeError(404, 'Local bot not found.');
		return {
			bot,
			friends: { onlineFriends: [], offlineFriends: [] },
			pendingFriends: { incomingFriends: [], outgoingFriends: [] },
			blockedUsers: [],
			party: null,
			categories: [category],
			source: 'fnbr'
		};
	}

	localCategory(config) {
		return localCategoryOf(config);
	}

	// ------------------------------------------------------------ extra bots

	helperMap(userId) {
		if (!this.helpers.has(userId)) this.helpers.set(userId, new Map());
		return this.helpers.get(userId);
	}

	helperEntry(userId, account) {
		const map = this.helperMap(userId);
		if (!map.has(account.id)) {
			map.set(account.id, {
				id: account.id,
				label: account.label,
				accountId: account.accountId || null,
				status: 'offline',
				adapter: null,
				lastError: null,
				authRequired: false,
				startedAt: null
			});
		}
		const entry = map.get(account.id);
		entry.label = account.label;
		if (account.accountId) entry.accountId = account.accountId;
		return entry;
	}

	findHelperByBotId(userId, botId) {
		for (const entry of this.helpers.get(userId)?.values() || []) {
			if (entry.accountId === botId || entry.adapter?.botId?.() === botId) return entry;
		}
		return null;
	}

	mainBotId(userId) {
		const adapter = this.get(userId).adapter;
		return adapter?.engine === 'fnbr' ? adapter.botId?.() || null : null;
	}

	helperAccountIds(userId) {
		return [...(this.helpers.get(userId)?.values() || [])].map((entry) => entry.accountId).filter(Boolean);
	}

	/** Account IDs of every bot this user runs, used for mutual trust. */
	allBotIds(userId) {
		return [this.mainBotId(userId), ...this.helperAccountIds(userId)].filter(Boolean);
	}

	isHelperRunning(entry) {
		return ['starting', 'online', 'stopping'].includes(entry?.status);
	}

	serializeHelper(userId, account) {
		const entry = this.helperEntry(userId, account);
		return {
			...sanitizeAccount(account),
			status: entry.status,
			lastError: entry.lastError,
			authRequired: entry.authRequired,
			startedAt: entry.startedAt,
			// What the running client actually logged in as (platform is fixed at login).
			activePlatform: entry.adapter?.startConfig?.platform || null,
			bot: entry.adapter && entry.status === 'online' ? entry.adapter.toBotCard() : null
		};
	}

	async listHelpers(userId) {
		const accounts = await listBotAccounts(userId);
		// Forget runtime entries for accounts that were deleted.
		const ids = new Set(accounts.map((account) => account.id));
		const map = this.helperMap(userId);
		for (const id of map.keys()) {
			if (!ids.has(id) && !map.get(id).adapter) map.delete(id);
		}
		return accounts.map((account) => this.serializeHelper(userId, account));
	}

	async emitHelpers(userId) {
		try {
			this.emitTo(userId, 'bot-accounts:updated', { accounts: await this.listHelpers(userId) });
		} catch {
			// Status pushes are best-effort.
		}
	}

	/** Builds an extra bot's start config from the main config plus its own auth. */
	async helperStartConfig(userId, account) {
		const mainConfig = await getPlainConfig(userId);
		const startConfig = validateStartConfig({
			...mainConfig,
			runtimeMode: 'fnbr',
			deviceAuth: account.deviceAuth,
			authorizationCode: account.authorizationCode
		});
		// Each account has its own tokens; never let one bot kick another's session.
		return {
			...startConfig,
			platform: account.platform ? normalizePlatform(account.platform, startConfig.platform) : startConfig.platform,
			tracker: Boolean(account.tracker),
			killOtherTokens: false
		};
	}

	createHelperAdapter(userId, account, startConfig) {
		const adapter = new LocalFnbrRuntime({
			userId,
			startConfig,
			plainConfig: startConfig,
			appendLog: (_id, content, format) => this.appendLog(userId, `[${account.label}] ${content}`, format),
			emit: (event, payload) => this.emitTo(userId, event, payload),
			onDeviceAuth: (_id, deviceAuth) => saveBotAccountDeviceAuth(userId, account.id, deviceAuth),
			onSnapshot: recordBotSnapshot,
			onFriendMessage: (id, message) => this.handleFriendMessage(id, message),
			onMatchState: (id, event) => this.handleMatchState(id, event),
			trustedIds: () => this.allBotIds(userId).filter((id) => id !== adapter.botId())
		});
		return adapter;
	}

	async startHelper(user, accountRowId) {
		const userId = user.id;
		if (user.status === 'suspended') throw runtimeError(403, 'This account is suspended and cannot start a bot.');
		const account = await getBotAccount(userId, accountRowId);
		const entry = this.helperEntry(userId, account);
		if (this.isHelperRunning(entry)) throw runtimeError(409, `${account.label} is already running.`);
		if (!account.deviceAuth?.accountId && !account.authorizationCode) {
			throw runtimeError(400, `${account.label} has no Epic login. Add a fresh authorization code first.`);
		}

		entry.status = 'starting';
		entry.lastError = null;
		entry.authRequired = false;
		this.emitHelpers(userId);

		try {
			const startConfig = await this.helperStartConfig(userId, account);
			const adapter = this.createHelperAdapter(userId, account, startConfig);
			entry.adapter = adapter;
			await adapter.start();

			const botId = adapter.botId();
			const duplicate =
				botId === this.mainBotId(userId) ||
				[...this.helperMap(userId).values()].some((other) => other !== entry && other.accountId === botId);
			if (duplicate) {
				await adapter.stop().catch(() => {});
				throw runtimeError(409, 'That Epic account is already running as another bot. Use a different account.');
			}

			entry.accountId = botId;
			entry.status = 'online';
			entry.startedAt = new Date().toISOString();
			await saveBotAccountIdentity(userId, account.id, {
				accountId: botId,
				displayName: adapter.client?.user?.self?.displayName
			}).catch(() => {});
			this.appendLog(userId, `[${account.label}] Extra bot is online.`, 1);
		} catch (error) {
			entry.adapter = null;
			entry.status = error.status === 401 ? 'auth_required' : 'error';
			entry.authRequired = error.status === 401;
			entry.lastError = error.message;
			entry.startedAt = null;
			this.appendLog(userId, `[${account.label}] Start failed: ${error.message}`, 4);
			if (error.authCodeRejected) await clearBotAccountCode(userId, account.id).catch(() => {});
			throw error;
		} finally {
			this.emitHelpers(userId);
		}
		return entry;
	}

	async stopHelper(userId, accountRowId, reason = 'Extra bot stopped.') {
		const entry = this.helperMap(userId).get(accountRowId);
		if (!entry) return;
		if (!entry.adapter) {
			entry.status = 'offline';
			entry.startedAt = null;
			this.emitHelpers(userId);
			return;
		}
		entry.status = 'stopping';
		this.emitHelpers(userId);
		const adapter = entry.adapter;
		try {
			const botId = adapter.botId();
			await adapter.stop();
			await closeMatchRound(userId, { botId }).catch(() => {});
			await closeActiveSessions(userId, botId).catch(() => {});
			this.appendLog(userId, `[${entry.label}] ${reason}`, 1);
		} finally {
			entry.adapter = null;
			entry.status = 'offline';
			entry.startedAt = null;
			this.emitHelpers(userId);
		}
	}

	async stopHelpers(userId, reason = 'Server shutting down.') {
		const ids = [...(this.helpers.get(userId)?.keys() || [])];
		await Promise.allSettled(ids.map((id) => this.stopHelper(userId, id, reason)));
	}

	async startHelpers(user, { onlyAutoStart = false } = {}) {
		const accounts = await listBotAccounts(user.id);
		const results = [];
		for (const account of accounts) {
			if (onlyAutoStart && !account.autoStart) continue;
			if (this.isHelperRunning(this.helperEntry(user.id, account))) continue;
			try {
				await this.startHelper(user, account.id);
				results.push({ id: account.id, label: account.label, ok: true });
			} catch (error) {
				results.push({ id: account.id, label: account.label, ok: false, error: error.message });
			}
		}
		return results;
	}

	/** Runs after the main bot comes online: start auto-start bots and seat them. */
	async autoStartHelpers(user) {
		const results = await this.startHelpers(user, { onlyAutoStart: true });
		for (const result of results.filter((row) => row.ok && !this.helperMap(user.id).get(row.id)?.adapter?.isTracker?.())) {
			await this.joinHelperToMain(user.id, result.id).catch((error) =>
				this.appendLog(user.id, `[${result.label}] Could not join the main lobby: ${error.message}`, 4)
			);
		}
	}

	requireOnlineHelper(userId, accountRowId) {
		const entry = this.helpers.get(userId)?.get(accountRowId);
		if (!entry?.adapter || entry.status !== 'online') {
			throw runtimeError(409, `${entry?.label || 'That bot'} is not online. Start it first.`);
		}
		return entry;
	}

	/** Makes `clientA` and `clientB` friends: A sends the request, B accepts it. */
	async ensureFriends(clientA, clientB) {
		const idA = clientA.user.self.id;
		const idB = clientB.user.self.id;
		if (clientA.friend.resolve(idB)) return;

		const incomingOnA = clientA.friend.resolvePending(idB);
		if (incomingOnA?.direction === 'INCOMING') {
			await incomingOnA.accept().catch(() => {});
		} else {
			await clientA.friend.add(idB);
			// B trusts A and auto-accepts; accept explicitly too in case that raced.
			await waitFor(() => Boolean(clientB.friend.resolvePending(idA) || clientB.friend.resolve(idA)), FRIEND_WAIT_MS);
			const pendingOnB = clientB.friend.resolvePending(idA);
			if (pendingOnB?.direction === 'INCOMING') await pendingOnB.accept().catch(() => {});
		}

		const ok = await waitFor(() => Boolean(clientA.friend.resolve(idB)), FRIEND_WAIT_MS);
		if (!ok) throw runtimeError(504, 'The bots did not become friends in time. Try again in a moment.');
	}

	/**
	 * Puts an extra bot into the main bot's lobby: a direct join when the party
	 * is joinable, otherwise friend + invite (the extra bot trusts the main bot,
	 * so it accepts that invite automatically).
	 */
	async joinHelperToMain(userId, accountRowId) {
		const main = this.requireLocal(userId);
		const entry = this.requireOnlineHelper(userId, accountRowId);
		if (entry.adapter?.isTracker?.()) throw runtimeError(409, `${entry.label} is a tracker: it never joins parties.`);
		const mainClient = main.requireClient();
		const helperClient = entry.adapter.requireClient();
		const partyId = mainClient.party?.id;
		if (!partyId) throw runtimeError(409, 'The main bot is not in a party yet.');
		if (helperClient.party?.id === partyId) {
			return { content: `${entry.label} is already in the main lobby.`, format: 1 };
		}
		if ((mainClient.party.size ?? 1) >= (mainClient.party.maxSize ?? 16)) {
			throw runtimeError(409, 'The main lobby is full.');
		}

		let joined = false;
		try {
			await helperClient.joinParty(partyId);
			joined = true;
		} catch {
			// Private party or not visible to this account: fall back to an invite.
		}

		if (!joined) {
			await this.ensureFriends(mainClient, helperClient);
			await mainClient.invite(helperClient.user.self.id);
			joined = await waitFor(() => helperClient.party?.id === partyId, INVITE_WAIT_MS);
			if (!joined) throw runtimeError(504, `${entry.label} was invited but did not join in time.`);
		}

		entry.adapter.emitParty();
		main.emitParty();
		this.appendLog(userId, `[${entry.label}] Joined the main bot's lobby.`, 1);
		return { content: `${entry.label} joined the main lobby.`, format: 1 };
	}

	async forEachOnlineHelper(userId, action, { includeTrackers = false } = {}) {
		const results = [];
		for (const entry of this.helpers.get(userId)?.values() || []) {
			if (entry.status !== 'online') continue;
			// Trackers stay out of parties (see LocalFnbrRuntime TRACKER_OVERRIDES).
			if (!includeTrackers && entry.adapter?.isTracker?.()) continue;
			try {
				results.push({ id: entry.id, label: entry.label, ok: true, ...(await action(entry)) });
			} catch (error) {
				results.push({ id: entry.id, label: entry.label, ok: false, error: error.message });
			}
		}
		return results;
	}

	joinAllHelpersToMain(userId) {
		return this.forEachOnlineHelper(userId, (entry) => this.joinHelperToMain(userId, entry.id));
	}

	/** Every online extra bot joins a friend's party (each must be their friend). */
	joinAllHelpersTo(userId, target) {
		return this.forEachOnlineHelper(userId, (entry) => entry.adapter.joinParty(target));
	}

	/** Pushes a saved loadout/behaviour change to every running bot of the user. */
	applyLocalCategoryLive(userId, localCategory) {
		const main = this.get(userId).adapter;
		if (main?.engine === 'fnbr') main.updateLocalCategory(localCategory);
		for (const entry of this.helpers.get(userId)?.values() || []) {
			entry.adapter?.updateLocalCategory(localCategory);
		}
		// Re-check readiness right away so turning auto-ready on takes effect now.
		for (const adapter of [main, ...[...(this.helpers.get(userId)?.values() || [])].map((e) => e.adapter)]) {
			if (adapter?.engine === 'fnbr') adapter.syncReadiness?.();
		}
	}

	/**
	 * The running bot that reads tracked players' stats: a tracker first, then
	 * any other running local bot. With the Legacy FNLB engine, add a tracker.
	 */
	statsSource(userId) {
		const helpers = [...(this.helpers.get(userId)?.values() || [])].filter((entry) => entry.status === 'online' && entry.adapter);
		const tracker = helpers.find((entry) => entry.adapter.isTracker?.());
		if (tracker) return tracker.adapter;
		return this.localAdapters(userId)[0] || null;
	}

	/** Reads every tracked player's stats now; records finished matches. */
	async pollTrackedPlayers(userId) {
		const source = this.statsSource(userId);
		if (!source) throw runtimeError(409, 'No bot is running to read stats. Start a tracker bot (Bots → extra bot → Tracker).');
		const recorded = await pollUserPlayers(userId, (accountId) => source.fetchRawStats(accountId));
		for (const round of recorded) {
			let meta = {};
			try {
				meta = JSON.parse(round.metadataJson || '{}');
			} catch {
				// ignore
			}
			this.appendLog(
				userId,
				`Match recorded for ${meta.player || 'a tracked player'}: ${meta.playlistLabel || round.playlistId}${round.win ? ', WIN' : ''}, ${round.kills ?? 0} kill(s).`,
				2
			);
		}
		this.emitTo(userId, 'tracked:updated', { recorded: recorded.length });
		return recorded;
	}

	/** Background poll for every user who tracks players (every 2 minutes). */
	startPlayerTracking(intervalMs = 120000) {
		if (this.trackingTimer) return;
		const tick = async () => {
			for (const userId of await usersWithTrackedPlayers().catch(() => [])) {
				if (!this.statsSource(userId)) continue;
				await this.pollTrackedPlayers(userId).catch((error) => this.appendLog(userId, `Player tracking failed: ${error.message}`, 4));
			}
		};
		this.trackingTimer = setInterval(() => tick().catch(() => {}), intervalMs);
		this.trackingTimer.unref?.();
	}

	/** Every running local fnbr bot of the user (main + extra). */
	localAdapters(userId) {
		const main = this.get(userId).adapter;
		const helpers = [...(this.helpers.get(userId)?.values() || [])].map((entry) => (entry.status === 'online' ? entry.adapter : null));
		return [main?.engine === 'fnbr' && this.get(userId).status === 'online' ? main : null, ...helpers].filter(Boolean);
	}

	/** Puts every running bot back to the saved join defaults right now. */
	async reapplyDefaults(userId, localCategory) {
		const results = [];
		for (const adapter of this.localAdapters(userId)) {
			try {
				const result = await adapter.applyCategory(localCategory.config);
				results.push({ botId: adapter.botId(), ok: true, applied: result.applied?.length || 0, failed: result.failed || [] });
			} catch (error) {
				results.push({ botId: adapter.botId(), ok: false, error: error.message });
			}
		}
		return results;
	}

	leaveAllHelpers(userId) {
		return this.forEachOnlineHelper(userId, (entry) => entry.adapter.leaveParty());
	}
}
