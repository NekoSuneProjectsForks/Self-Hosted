import { randomUUID } from 'node:crypto';
import {
	DEFAULT_LOCAL_CATEGORY_ID,
	getPlainConfig,
	saveDeviceAuthForUser,
	validateStartConfig
} from '../services/configStore.js';
import { LocalFnbrRuntime } from './LocalFnbrRuntime.js';
import { LegacyFnlbRuntime } from './LegacyFnlbRuntime.js';
import { runtimeError } from './BaseRuntime.js';
import { BotLog, FriendMessage, pruneLogs } from '../models/index.js';
import { closeActiveSessions, recordBotSnapshot } from '../services/sessionHistory.js';
import { closeMatchRound, openMatchRound } from '../services/matchTracker.js';

const ROOM_PREFIX = 'user:';
const MEMORY_LOG_LIMIT = 200;

/** Config keys that genuinely need a process restart to take effect. */
const RESTART_REQUIRED_KEYS = [
	'runtimeMode',
	'apiToken',
	'categories',
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
			presence: true,
			matchTracking: true,
			searchUsers: true,
			promoteMember: true,
			multiBot: false
		}
	},
	fnlb: {
		engine: 'fnlb',
		capabilities: {
			friends: true,
			friendMessages: false,
			friendRequests: false,
			blockedUsers: true,
			party: true,
			partyChat: true,
			cosmetics: true,
			realtimeCosmetics: false,
			playlist: true,
			privacy: false,
			readiness: true,
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
			onMatchState: (id, event) => this.handleMatchState(id, event)
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
		} catch (error) {
			runtime.status = error.status === 401 ? 'auth_required' : 'error';
			runtime.authRequired = error.status === 401;
			runtime.adapter = null;
			runtime.activeMode = null;
			runtime.startedAt = null;
			runtime.lastError = error.message;
			this.appendLog(userId, `Start failed: ${error.message}`, 4);
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
		await previous.stop().catch((error) => this.appendLog(userId, `Stop warning: ${error.message}`, 4));
		await closeActiveSessions(userId).catch(() => {});

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
			await runtime.adapter.stop();
			// Close out history so sessions and matches are not left "active".
			await closeMatchRound(userId, { botId: runtime.adapter.botId?.() }).catch(() => {});
			await closeActiveSessions(userId).catch(() => {});

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
		await Promise.allSettled(ids.map((userId) => this.stop(userId, 'Server shutting down.')));
	}

	// -------------------------------------------------------------- routing

	/**
	 * THE important accessor: returns the engine that is actually running.
	 * Routes must use this instead of reading the saved config, otherwise a
	 * config change can point the UI at an engine that is not running.
	 */
	requireActive(userId) {
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
}
