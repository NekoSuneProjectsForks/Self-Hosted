import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import FNLB from 'fnlb';
import { DEFAULT_LOCAL_CATEGORY_ID, saveDeviceAuthForUser, validateStartConfig } from './configStore.js';
import { LocalFnbrBot } from './fnbrRuntime.js';
import { BotLog, pruneLogs } from './models.js';
import { fnlbDataDir } from './paths.js';
import { recordBotSnapshot } from './sessionHistory.js';

const ROOM_PREFIX = 'user:';
const MEMORY_LOG_LIMIT = 200;

function roomFor(userId) {
	return `${ROOM_PREFIX}${userId}`;
}

function normalizeLogContent(content) {
	return String(content ?? '')
		.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
		.trimEnd();
}

function localCategory(config) {
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
		flags: 0,
		flagsList: [],
		isDisabled: false,
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
		party: null,
		partyMembers: null,
		cosmetics: {}
	};
}

export class BotRuntimeService {
	constructor(io) {
		this.io = io;
		this.runtimes = new Map();
	}

	get(userId) {
		if (!this.runtimes.has(userId)) {
			this.runtimes.set(userId, {
				status: 'offline',
				mode: 'fnbr',
				manager: null,
				restartTimer: null,
				startedAt: null,
				lastError: null,
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
			mode: runtime.mode,
			startedAt: runtime.startedAt,
			lastError: runtime.lastError,
			clusterName: runtime.clusterName,
			restartInterval: runtime.restartInterval,
			autoUpdateOnRestart: runtime.autoUpdateOnRestart
		};
	}

	emitStatus(userId) {
		this.io.to(roomFor(userId)).emit('bot:status', this.serialize(userId));
	}

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

			this.io.to(roomFor(userId)).emit('bot:log', entry);
			BotLog.create({
				id: entry.id,
				userId,
				format,
				content: line,
				createdAt: entry.createdAt
			})
				.then(() => pruneLogs(userId).catch(() => {}))
				.catch(() => {});
		}
	}

	async recentLogs(userId, limit = 200) {
		const rows = await BotLog.findAll({
			where: { userId },
			order: [['createdAt', 'DESC']],
			limit
		});
		return rows
			.reverse()
			.map((row) => ({
				id: row.id,
				userId: row.userId,
				format: row.format,
				content: row.content,
				createdAt: row.createdAt
			}));
	}

	async start(user, plainConfig) {
		const userId = user.id;
		const runtime = this.get(userId);
		if (['starting', 'online', 'restarting', 'stopping'].includes(runtime.status)) {
			const error = new Error('This bot cluster is already running or changing state.');
			error.status = 409;
			throw error;
		}
		if (user.status === 'suspended') {
			const error = new Error('This account is suspended and cannot start a cluster.');
			error.status = 403;
			throw error;
		}

		const startConfig = validateStartConfig(plainConfig);
		runtime.startConfig = startConfig;
		runtime.mode = startConfig.mode;
		runtime.clusterName = plainConfig.clusterName;
		runtime.restartInterval = plainConfig.restartInterval;
		runtime.autoUpdateOnRestart = plainConfig.autoUpdateOnRestart;
		runtime.status = 'starting';
		runtime.lastError = null;
		this.emitStatus(userId);

		try {
			if (startConfig.mode === 'fnlb') {
				await this.startFnlb(userId, runtime, plainConfig, startConfig);
			} else {
				await this.startFnbr(userId, runtime, startConfig);
			}

			runtime.status = 'online';
			runtime.startedAt = new Date().toISOString();
			runtime.lastError = null;
			this.scheduleRestart(userId);
			this.appendLog(userId, `${startConfig.mode === 'fnbr' ? 'Local fnbr bot' : 'FNLB cluster'} is online.`, 1);
			this.emitStatus(userId);
		} catch (error) {
			runtime.status = 'error';
			runtime.manager = null;
			runtime.startedAt = null;
			runtime.lastError = error.message;
			this.appendLog(userId, `Start failed: ${error.message}`, 4);
			this.emitStatus(userId);
			throw error;
		}
	}

	async startFnlb(userId, runtime, plainConfig, startConfig) {
		const clusterDir = join(fnlbDataDir, userId);
		await mkdir(clusterDir, { recursive: true });

		const manager = new FNLB({
			clusterName: plainConfig.clusterName,
			fnlbPath: clusterDir,
			onLogMessage: (message) => this.appendLog(userId, message.content, message.format),
			onSubProcessLogMessage: (message) => this.appendLog(userId, message.content, message.format)
		});

		runtime.manager = manager;
		this.appendLog(userId, `Starting legacy FNLB cluster ${plainConfig.clusterName}...`, 2);
		await manager.start(startConfig);
	}

	async startFnbr(userId, runtime, startConfig) {
		const manager = new LocalFnbrBot({
			userId,
			startConfig,
			appendLog: this.appendLog.bind(this),
			onDeviceAuth: saveDeviceAuthForUser,
			onSnapshot: recordBotSnapshot
		});
		runtime.manager = manager;
		this.appendLog(userId, 'Starting local fnbr.js Fortnite bot...', 2);
		await manager.start();
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

	async restart(userId) {
		const runtime = this.get(userId);
		if (!runtime.manager || !runtime.startConfig) return;
		runtime.status = 'restarting';
		this.emitStatus(userId);
		this.appendLog(userId, 'Automatic restart started.', 2);
		await runtime.manager.stop();
		if (runtime.mode === 'fnlb' && runtime.autoUpdateOnRestart) {
			this.appendLog(userId, 'Checking for FNLB updates before restart...', 2);
			await runtime.manager.update(true);
		}
		if (runtime.mode === 'fnbr') await runtime.manager.start();
		else await runtime.manager.start(runtime.startConfig);
		runtime.status = 'online';
		runtime.startedAt = new Date().toISOString();
		runtime.lastError = null;
		this.appendLog(userId, 'Automatic restart finished.', 1);
		this.emitStatus(userId);
	}

	async stop(userId, reason = 'Bot cluster stopped.') {
		const runtime = this.get(userId);
		if (runtime.restartTimer) {
			clearInterval(runtime.restartTimer);
			runtime.restartTimer = null;
		}

		if (!runtime.manager) {
			runtime.status = 'offline';
			runtime.startedAt = null;
			runtime.lastError = null;
			this.emitStatus(userId);
			return;
		}

		runtime.status = 'stopping';
		this.emitStatus(userId);
		this.appendLog(userId, `Stopping ${runtime.mode === 'fnbr' ? 'local fnbr bot' : 'FNLB cluster'}...`, 2);
		try {
			await runtime.manager.stop();
			runtime.status = 'offline';
			runtime.manager = null;
			runtime.startedAt = null;
			runtime.lastError = null;
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

	isLocalMode(config) {
		return config.runtimeMode !== 'fnlb';
	}

	getLocalManager(userId) {
		const runtime = this.get(userId);
		if (runtime.mode !== 'fnbr' || runtime.manager?.kind !== 'fnbr') {
			const error = new Error('The local fnbr bot is not online.');
			error.status = 409;
			throw error;
		}
		return runtime.manager;
	}

	localDashboard(userId, config) {
		const runtime = this.get(userId);
		const category = localCategory(config);
		if (runtime.mode === 'fnbr' && runtime.manager?.kind === 'fnbr' && runtime.status === 'online') {
			return runtime.manager.dashboard(category);
		}
		const bot = offlineLocalBot(config);
		return {
			bots: bot ? [bot] : [],
			stats: {
				local: {
					total: bot ? 1 : 0,
					connected: 0,
					friends: 0,
					partyMembers: 0,
					matches: 0
				}
			},
			categories: [category],
			user: null,
			source: 'fnbr'
		};
	}

	async localDetails(userId, config, botId) {
		const category = localCategory(config);
		const runtime = this.get(userId);
		if (runtime.mode === 'fnbr' && runtime.manager?.kind === 'fnbr' && runtime.status === 'online') {
			return runtime.manager.details(category);
		}

		const bot = offlineLocalBot(config);
		if (!bot || bot.id !== botId) {
			const error = new Error('Local bot not found.');
			error.status = 404;
			throw error;
		}
		return {
			bot,
			friends: { onlineFriends: [], offlineFriends: [] },
			pendingFriends: { incomingFriends: [], outgoingFriends: [] },
			blockedUsers: [],
			categories: [category],
			source: 'fnbr'
		};
	}

	async runLocalCommand(userId, command, args) {
		return this.getLocalManager(userId).runCommand(command, args);
	}

	async sendLocalChatMessage(userId, content) {
		return this.getLocalManager(userId).sendChatMessage(content);
	}

	async searchLocalUsers(userId, prefix, platform) {
		return this.getLocalManager(userId).searchUsers(prefix, platform);
	}

	async applyLocalCategory(userId, categoryConfig) {
		const runtime = this.get(userId);
		if (runtime.mode === 'fnbr' && runtime.manager?.kind === 'fnbr' && runtime.status === 'online') {
			await runtime.manager.applyCategory(categoryConfig);
		}
	}

	async applyLocalCosmetic(userId, slot, itemId) {
		const runtime = this.get(userId);
		if (runtime.mode === 'fnbr' && runtime.manager?.kind === 'fnbr' && runtime.status === 'online') {
			await runtime.manager.applyCosmetic(slot, itemId);
		}
	}
}

export function userRoom(userId) {
	return roomFor(userId);
}
