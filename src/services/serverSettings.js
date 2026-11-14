import { ServerSetting } from '../models/index.js';
import { decryptText, encryptText, maskSecret } from '../lib/secrets.js';
import { normalizeDeviceAuth, normalizePlatform } from './configStore.js';

/**
 * Admin-managed, server-wide settings.
 *
 * - tracker: the server tracker bot (one Epic account that reads public stats
 *   for every user's Player tracking; it never joins a party).
 * - server: registration open/closed and an announcement shown to everyone.
 */

export const TRACKER_INTERVALS = [1, 2, 5, 10, 15];

const DEFAULTS = {
	tracker: { deviceAuth: null, authorizationCode: '', displayName: null, autoStart: true, intervalMinutes: 2, platform: 'WIN' },
	server: { registrationOpen: true, announcement: '', localEngineAdminOnly: true }
};

const cache = new Map();

async function read(key) {
	if (cache.has(key)) return cache.get(key);
	const row = await ServerSetting.findByPk(key);
	let value = {};
	if (row?.valueEncrypted) {
		try {
			value = JSON.parse(decryptText(row.valueEncrypted) || '{}');
		} catch {
			value = {};
		}
	}
	const merged = { ...DEFAULTS[key], ...value };
	cache.set(key, merged);
	return merged;
}

async function write(key, value) {
	const merged = { ...DEFAULTS[key], ...value };
	await ServerSetting.upsert({ key, valueEncrypted: encryptText(JSON.stringify(merged)) });
	cache.set(key, merged);
	return merged;
}

export function clearServerSettingsCache() {
	cache.clear();
}

/** Full tracker settings, secrets included. Never send to the browser. */
export function getTrackerSettings() {
	return read('tracker');
}

export function sanitizeTracker(settings) {
	return {
		configured: Boolean(settings.deviceAuth?.accountId || settings.authorizationCode),
		accountId: settings.deviceAuth?.accountId || null,
		accountMasked: settings.deviceAuth?.accountId ? maskSecret(settings.deviceAuth.accountId) : '',
		displayName: settings.displayName || null,
		authorizationCodeConfigured: Boolean(settings.authorizationCode),
		autoStart: settings.autoStart !== false,
		intervalMinutes: settings.intervalMinutes,
		platform: settings.platform
	};
}

export async function updateTrackerSettings(patch = {}) {
	const current = await read('tracker');
	const next = { ...current };
	if (patch.autoStart !== undefined) next.autoStart = Boolean(patch.autoStart);
	if (patch.intervalMinutes !== undefined) {
		const minutes = Number(patch.intervalMinutes);
		if (!TRACKER_INTERVALS.includes(minutes)) {
			const error = new Error(`Check interval must be one of ${TRACKER_INTERVALS.join(', ')} minutes.`);
			error.status = 400;
			throw error;
		}
		next.intervalMinutes = minutes;
	}
	if (patch.platform !== undefined) next.platform = normalizePlatform(patch.platform, current.platform);
	if (patch.deviceAuth !== undefined) {
		next.deviceAuth = patch.deviceAuth ? normalizeDeviceAuth(patch.deviceAuth) : null;
		if (next.deviceAuth) next.authorizationCode = '';
	}
	if (patch.authorizationCode !== undefined) {
		next.authorizationCode = patch.authorizationCode || '';
		if (next.authorizationCode) next.deviceAuth = null;
	}
	if (patch.displayName !== undefined) next.displayName = patch.displayName || null;
	return write('tracker', next);
}

export function getServerOptions() {
	return read('server');
}

export async function updateServerOptions(patch = {}) {
	const current = await read('server');
	const next = { ...current };
	if (patch.registrationOpen !== undefined) next.registrationOpen = Boolean(patch.registrationOpen);
	if (patch.announcement !== undefined) next.announcement = String(patch.announcement || '').trim().slice(0, 500);
	if (patch.localEngineAdminOnly !== undefined) next.localEngineAdminOnly = Boolean(patch.localEngineAdminOnly);
	return write('server', next);
}

/** Local fnbr engine is admin-only while it can't matchmake (default on). */
export async function localEngineAllowed(user) {
	if (user?.role === 'admin') return true;
	return (await getServerOptions()).localEngineAdminOnly === false;
}
