import { BotConfig } from '../models/index.js';
import { decryptText, encryptText, maskSecret } from '../lib/secrets.js';

export const DEFAULT_LOCAL_CATEGORY_ID = 'local-default';

const DEFAULT_LOCAL_CATEGORY = {
	id: DEFAULT_LOCAL_CATEGORY_ID,
	name: 'Local fnbr Loadout',
	flags: 0,
	config: {
		privacy: 'public',
		statusText: [],
		admins: [],
		whitelistUsers: [],
		blacklistUsers: [],
		startBannedBots: false,
		acceptInvites: true,
		acceptFriendRequests: true,
		startOutfit: [],
		startBackpack: [],
		startPickaxe: [],
		startShoes: [],
		joinEmote: [],
		memberJoinEmote: []
	}
};

const DEFAULT_CONFIG = {
	runtimeMode: 'fnbr',
	apiToken: '',
	deviceAuth: null,
	authorizationCode: '',
	categories: '',
	bots: '',
	releaseChannel: 'stable',
	clusterName: 'Local fnbr Cluster',
	defaultStatus: 'Battle Royale Lobby - 1 / 16',
	platform: 'WIN',
	killOtherTokens: false,
	localBotEnabled: true,
	numberOfShards: 2,
	botsPerShard: 32,
	restartInterval: 3600,
	hideUsernames: false,
	hideEmails: false,
	autoUpdateOnRestart: true,
	logLevel: 'INFO',
	localCategory: DEFAULT_LOCAL_CATEGORY
};

const SUPPORTED_PLATFORMS = new Set([
	'WIN',
	'MAC',
	'PSN',
	'XBL',
	'SWT',
	'SWT2',
	'IOS',
	'AND',
	'PS5',
	'XSX',
	'LUNA'
]);

function toInteger(value, fallback, min, max) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function cleanText(value, fallback = '') {
	if (value === undefined || value === null) return fallback;
	return String(value).trim();
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function parseJson(value, fallback) {
	const text = decryptText(value);
	if (!text) return clone(fallback);
	try {
		return JSON.parse(text);
	} catch {
		return clone(fallback);
	}
}

function normalizeRuntimeMode(value) {
	return value === 'fnlb' ? 'fnlb' : 'fnbr';
}

// `dev` exists in the fnlb package but is internal; only expose stable/beta.
function normalizeReleaseChannel(value) {
	return value === 'beta' ? 'beta' : 'stable';
}

function normalizePlatform(value, fallback = DEFAULT_CONFIG.platform) {
	const platform = cleanText(value, fallback).toUpperCase();
	return SUPPORTED_PLATFORMS.has(platform) ? platform : fallback;
}

function normalizeDeviceAuth(value) {
	if (!value) return null;
	const deviceAuth = typeof value === 'string' ? JSON.parse(value) : value;
	const normalized = {
		accountId: cleanText(deviceAuth.accountId || deviceAuth.account_id),
		deviceId: cleanText(deviceAuth.deviceId || deviceAuth.device_id),
		secret: cleanText(deviceAuth.secret)
	};
	if (!normalized.accountId || !normalized.deviceId || !normalized.secret) {
		const error = new Error('Device auth must include accountId, deviceId, and secret.');
		error.status = 400;
		throw error;
	}
	return normalized;
}

function deviceAuthFromPayload(payload, current) {
	if (payload.clearDeviceAuth === true) return null;

	const json = cleanText(payload.deviceAuthJson);
	if (json) return normalizeDeviceAuth(json);

	const accountId = cleanText(payload.deviceAuthAccountId);
	const deviceId = cleanText(payload.deviceAuthDeviceId);
	const secret = cleanText(payload.deviceAuthSecret);
	if (accountId || deviceId || secret) {
		return normalizeDeviceAuth({ accountId, deviceId, secret });
	}

	return current.deviceAuth;
}

function normalizeLocalCategory(value) {
	const next = {
		...clone(DEFAULT_LOCAL_CATEGORY),
		...(value || {}),
		id: DEFAULT_LOCAL_CATEGORY_ID,
		name: cleanText(value?.name, DEFAULT_LOCAL_CATEGORY.name),
		config: {
			...clone(DEFAULT_LOCAL_CATEGORY.config),
			...(value?.config || {})
		}
	};
	return next;
}

export function parseIdList(value) {
	return cleanText(value)
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}

export const parseCategories = parseIdList;

export async function getPlainConfig(userId) {
	const row = await BotConfig.findOne({ where: { userId } });
	if (!row) return clone(DEFAULT_CONFIG);

	return {
		runtimeMode: normalizeRuntimeMode(row.runtimeMode),
		apiToken: decryptText(row.apiTokenEncrypted),
		deviceAuth: parseJson(row.deviceAuthEncrypted, null),
		authorizationCode: decryptText(row.authorizationCodeEncrypted),
		categories: decryptText(row.categoriesEncrypted),
		bots: decryptText(row.botsEncrypted),
		releaseChannel: normalizeReleaseChannel(row.releaseChannel),
		clusterName: decryptText(row.clusterNameEncrypted) || DEFAULT_CONFIG.clusterName,
		defaultStatus: decryptText(row.defaultStatusEncrypted) || DEFAULT_CONFIG.defaultStatus,
		platform: normalizePlatform(row.platform),
		killOtherTokens: row.killOtherTokens,
		localBotEnabled: row.localBotEnabled !== false,
		numberOfShards: row.numberOfShards,
		botsPerShard: row.botsPerShard,
		restartInterval: row.restartInterval,
		hideUsernames: row.hideUsernames,
		hideEmails: row.hideEmails,
		autoUpdateOnRestart: row.autoUpdateOnRestart,
		logLevel: row.logLevel,
		localCategory: normalizeLocalCategory(parseJson(row.localCategoryEncrypted, DEFAULT_LOCAL_CATEGORY))
	};
}

export function sanitizeConfig(config) {
	return {
		...config,
		apiToken: undefined,
		deviceAuth: undefined,
		authorizationCode: undefined,
		apiTokenConfigured: Boolean(config.apiToken),
		apiTokenMasked: maskSecret(config.apiToken),
		deviceAuthConfigured: Boolean(
			config.deviceAuth?.accountId && config.deviceAuth?.deviceId && config.deviceAuth?.secret
		),
		deviceAuthMasked: config.deviceAuth?.accountId
			? `${maskSecret(config.deviceAuth.accountId)} / ${maskSecret(config.deviceAuth.deviceId)}`
			: '',
		authorizationCodeConfigured: Boolean(config.authorizationCode)
	};
}

export async function upsertPlainConfig(userId, payload) {
	const existing = await BotConfig.findOne({ where: { userId } });
	const current = await getPlainConfig(userId);
	const deviceAuth = deviceAuthFromPayload(payload, current);

	const next = {
		runtimeMode: normalizeRuntimeMode(payload.runtimeMode ?? current.runtimeMode),
		apiToken:
			payload.apiToken === undefined || payload.apiToken === ''
				? current.apiToken
				: cleanText(payload.apiToken),
		deviceAuth,
		authorizationCode:
			payload.authorizationCode === undefined || payload.authorizationCode === ''
				? current.authorizationCode
				: cleanText(payload.authorizationCode),
		categories: cleanText(payload.categories, current.categories),
		bots: cleanText(payload.bots, current.bots),
		releaseChannel: normalizeReleaseChannel(payload.releaseChannel ?? current.releaseChannel),
		clusterName: cleanText(payload.clusterName, current.clusterName || DEFAULT_CONFIG.clusterName),
		defaultStatus: cleanText(payload.defaultStatus, current.defaultStatus || DEFAULT_CONFIG.defaultStatus),
		platform: normalizePlatform(payload.platform, current.platform),
		killOtherTokens: Boolean(payload.killOtherTokens),
		localBotEnabled:
			payload.localBotEnabled === undefined ? current.localBotEnabled !== false : Boolean(payload.localBotEnabled),
		numberOfShards: toInteger(payload.numberOfShards, current.numberOfShards, 1, 64),
		botsPerShard: toInteger(payload.botsPerShard, current.botsPerShard, 1, 256),
		restartInterval: toInteger(payload.restartInterval, current.restartInterval, 60, 604800),
		hideUsernames: Boolean(payload.hideUsernames),
		hideEmails: Boolean(payload.hideEmails),
		autoUpdateOnRestart: Boolean(payload.autoUpdateOnRestart),
		logLevel: payload.logLevel === 'DEBUG' ? 'DEBUG' : 'INFO',
		// Lobby settings (privacy, auto-accept, loadout) are merged in here so they
		// can be saved without touching anything that needs a restart.
		localCategory: normalizeLocalCategory({
			...current.localCategory,
			...(payload.localCategory || {}),
			config: {
				...(current.localCategory?.config || {}),
				...(payload.localCategory?.config || {})
			}
		})
	};

	const values = {
		userId,
		runtimeMode: next.runtimeMode,
		apiTokenEncrypted: encryptText(next.apiToken),
		deviceAuthEncrypted: encryptText(deviceAuth ? JSON.stringify(deviceAuth) : ''),
		authorizationCodeEncrypted: encryptText(next.authorizationCode),
		categoriesEncrypted: encryptText(next.categories),
		botsEncrypted: encryptText(next.bots),
		releaseChannel: next.releaseChannel,
		clusterNameEncrypted: encryptText(next.clusterName),
		defaultStatusEncrypted: encryptText(next.defaultStatus),
		localCategoryEncrypted: encryptText(JSON.stringify(next.localCategory)),
		platform: next.platform,
		killOtherTokens: next.killOtherTokens,
		localBotEnabled: next.localBotEnabled,
		numberOfShards: next.numberOfShards,
		botsPerShard: next.botsPerShard,
		restartInterval: next.restartInterval,
		hideUsernames: next.hideUsernames,
		hideEmails: next.hideEmails,
		autoUpdateOnRestart: next.autoUpdateOnRestart,
		logLevel: next.logLevel
	};

	if (existing) await existing.update(values);
	else await BotConfig.create(values);

	return next;
}

export async function saveDeviceAuthForUser(userId, deviceAuth) {
	const normalized = normalizeDeviceAuth(deviceAuth);
	const row = await BotConfig.findOne({ where: { userId } });
	const values = {
		userId,
		deviceAuthEncrypted: encryptText(JSON.stringify(normalized)),
		authorizationCodeEncrypted: null
	};
	if (row) await row.update(values);
	else await BotConfig.create(values);
	return normalized;
}

export async function saveLocalCategoryConfig(userId, categoryConfig) {
	const current = await getPlainConfig(userId);
	const localCategory = normalizeLocalCategory({
		...current.localCategory,
		config: categoryConfig
	});
	const row = await BotConfig.findOne({ where: { userId } });
	const values = {
		userId,
		localCategoryEncrypted: encryptText(JSON.stringify(localCategory))
	};
	if (row) await row.update(values);
	else await BotConfig.create(values);
	return localCategory;
}

export async function updateLocalCategoryConfig(userId, mutator) {
	const current = await getPlainConfig(userId);
	const nextConfig = {
		...clone(DEFAULT_LOCAL_CATEGORY.config),
		...(current.localCategory?.config || {})
	};
	await mutator(nextConfig);
	return saveLocalCategoryConfig(userId, nextConfig);
}

export function validateStartConfig(config) {
	const runtimeMode = normalizeRuntimeMode(config.runtimeMode);
	if (runtimeMode === 'fnlb') {
		if (!config.apiToken || config.apiToken.length < 10) {
			const error = new Error('Save a valid FNLB API token before starting the legacy FNLB cluster.');
			error.status = 400;
			throw error;
		}

		// Both filters are optional: an empty list means "all categories / all bots".
		return {
			mode: 'fnlb',
			apiToken: config.apiToken,
			releaseChannel: normalizeReleaseChannel(config.releaseChannel),
			categories: parseIdList(config.categories),
			bots: parseIdList(config.bots),
			numberOfShards: config.numberOfShards,
			botsPerShard: config.botsPerShard,
			hideUsernames: config.hideUsernames,
			hideEmails: config.hideEmails,
			logLevel: config.logLevel
		};
	}

	const hasDeviceAuth = Boolean(
		config.deviceAuth?.accountId && config.deviceAuth?.deviceId && config.deviceAuth?.secret
	);
	if (!hasDeviceAuth && !config.authorizationCode) {
		const error = new Error('Add Epic device auth or a one-time Epic authorization code before starting the local fnbr bot.');
		error.status = 400;
		throw error;
	}

	return {
		mode: 'fnbr',
		deviceAuth: hasDeviceAuth ? normalizeDeviceAuth(config.deviceAuth) : null,
		authorizationCode: hasDeviceAuth ? '' : cleanText(config.authorizationCode),
		platform: normalizePlatform(config.platform),
		defaultStatus: cleanText(config.defaultStatus, DEFAULT_CONFIG.defaultStatus),
		killOtherTokens: Boolean(config.killOtherTokens),
		localCategory: normalizeLocalCategory(config.localCategory)
	};
}

export async function setLocalBotEnabled(userId, enabled) {
	const row = await BotConfig.findOne({ where: { userId } });
	const values = { userId, localBotEnabled: Boolean(enabled) };
	if (row) await row.update(values);
	else await BotConfig.create(values);
	return Boolean(enabled);
}

/**
 * "Clear Device Auth" / "Reauthenticate". Removes the stored Epic credentials so
 * the next start requires a fresh one-time authorization code. Secrets are never
 * returned to the caller.
 */
export async function clearDeviceAuthForUser(userId) {
	const row = await BotConfig.findOne({ where: { userId } });
	const values = { userId, deviceAuthEncrypted: null, authorizationCodeEncrypted: null };
	if (row) await row.update(values);
	else await BotConfig.create(values);
	return { deviceAuthConfigured: false, authorizationCodeConfigured: false };
}
