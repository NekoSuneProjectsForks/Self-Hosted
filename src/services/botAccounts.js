import { BotAccount } from '../models/index.js';
import { decryptText, encryptText, maskSecret } from '../lib/secrets.js';
import { assertAuthorizationCode, extractAuthorizationCode, normalizeDeviceAuth, normalizePlatform } from './configStore.js';

/** A Fortnite party holds 16; the main bot takes one seat. */
export const MAX_BOT_ACCOUNTS = 15;

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function cleanLabel(value, fallback) {
	const label = String(value ?? '').trim().slice(0, 64);
	return label || fallback;
}

function parseDeviceAuth(row) {
	const text = decryptText(row.deviceAuthEncrypted);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Full record for the runtime only. Never send this to the browser. */
export function plainAccount(row) {
	return {
		id: row.id,
		userId: row.userId,
		label: row.label,
		accountId: row.accountId,
		displayName: row.displayName,
		autoStart: row.autoStart,
		tracker: Boolean(row.tracker),
		// null = use the main bot's platform.
		platform: row.platform || null,
		deviceAuth: parseDeviceAuth(row),
		authorizationCode: decryptText(row.authorizationCodeEncrypted)
	};
}

/** Browser-safe view: no secrets, only whether they are configured. */
export function sanitizeAccount(account) {
	return {
		id: account.id,
		label: account.label,
		accountId: account.accountId,
		displayName: account.displayName,
		autoStart: account.autoStart,
		tracker: Boolean(account.tracker),
		platform: account.platform,
		deviceAuthConfigured: Boolean(account.deviceAuth?.accountId),
		deviceAuthMasked: account.deviceAuth?.accountId ? maskSecret(account.deviceAuth.accountId) : '',
		authorizationCodeConfigured: Boolean(account.authorizationCode)
	};
}

/** '' or 'main' means "same as the main bot". */
function platformFrom(value) {
	const text = String(value ?? '').trim().toUpperCase();
	if (!text || text === 'MAIN') return null;
	const platform = normalizePlatform(text, '');
	if (!platform) throw httpError(400, `Unsupported platform: ${value}`);
	return platform;
}

export async function listBotAccounts(userId) {
	const rows = await BotAccount.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
	return rows.map(plainAccount);
}

async function findRow(userId, id) {
	const row = await BotAccount.findOne({ where: { id, userId } });
	if (!row) throw httpError(404, 'Bot account not found.');
	return row;
}

export async function getBotAccount(userId, id) {
	return plainAccount(await findRow(userId, id));
}

function authFromPayload(payload) {
	const values = {};
	const code = assertAuthorizationCode(extractAuthorizationCode(payload.authorizationCode));
	if (code) {
		values.authorizationCodeEncrypted = encryptText(code);
		// A fresh code replaces stale device auth, which is what "re-auth" means.
		values.deviceAuthEncrypted = null;
	}
	const json = String(payload.deviceAuthJson ?? '').trim();
	if (json) {
		let deviceAuth;
		try {
			deviceAuth = normalizeDeviceAuth(json);
		} catch (error) {
			throw httpError(400, error.message.includes('JSON') ? 'Device auth JSON is not valid JSON.' : error.message);
		}
		values.deviceAuthEncrypted = encryptText(JSON.stringify(deviceAuth));
		values.authorizationCodeEncrypted = null;
		values.accountId = deviceAuth.accountId;
	}
	return values;
}

export async function createBotAccount(userId, payload) {
	const count = await BotAccount.count({ where: { userId } });
	if (count >= MAX_BOT_ACCOUNTS) {
		throw httpError(400, `You can add up to ${MAX_BOT_ACCOUNTS} extra bot accounts (a party holds 16).`);
	}
	const auth = authFromPayload(payload);
	if (!auth.authorizationCodeEncrypted && !auth.deviceAuthEncrypted) {
		throw httpError(400, 'Add a one-time Epic authorization code (or device auth JSON) for the bot account.');
	}
	const row = await BotAccount.create({
		userId,
		label: cleanLabel(payload.label, `Bot ${count + 2}`),
		autoStart: Boolean(payload.autoStart),
		tracker: Boolean(payload.tracker),
		platform: platformFrom(payload.platform),
		...auth
	});
	return plainAccount(row);
}

export async function updateBotAccount(userId, id, payload) {
	const row = await findRow(userId, id);
	const values = authFromPayload(payload);
	if (payload.label !== undefined) values.label = cleanLabel(payload.label, row.label);
	if (payload.autoStart !== undefined) values.autoStart = Boolean(payload.autoStart);
	if (payload.tracker !== undefined) values.tracker = Boolean(payload.tracker);
	if (payload.platform !== undefined) values.platform = platformFrom(payload.platform);
	await row.update(values);
	return plainAccount(row);
}

/** Called from the runtime's `deviceauth:created` event. */
export async function saveBotAccountDeviceAuth(userId, id, deviceAuth) {
	const row = await findRow(userId, id);
	const normalized = normalizeDeviceAuth(deviceAuth);
	await row.update({
		deviceAuthEncrypted: encryptText(JSON.stringify(normalized)),
		authorizationCodeEncrypted: null,
		accountId: normalized.accountId
	});
}

export async function saveBotAccountIdentity(userId, id, { accountId, displayName }) {
	const row = await findRow(userId, id);
	await row.update({ accountId: accountId || row.accountId, displayName: displayName || row.displayName });
}

export async function clearBotAccountAuth(userId, id) {
	const row = await findRow(userId, id);
	await row.update({ deviceAuthEncrypted: null, authorizationCodeEncrypted: null });
	return plainAccount(row);
}

/** A rejected one-time code is dead; drop it so it isn't retried forever. */
export async function clearBotAccountCode(userId, id) {
	const row = await BotAccount.findOne({ where: { id, userId } });
	if (row) await row.update({ authorizationCodeEncrypted: null });
}

export async function deleteBotAccount(userId, id) {
	const row = await findRow(userId, id);
	await row.destroy();
}
