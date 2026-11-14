import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

/**
 * "Sign in with Epic": Epic's OAuth device-code flow. The user opens Epic's
 * activation page, signs in there with their email and password (Epic handles
 * captcha and 2FA), and this server never sees the password. The result is
 * turned straight into a device auth, which is what the bots log in with.
 *
 *   switch client token -> deviceAuthorization (user_code + link)
 *   poll device_code grant -> switch access token
 *   oauth/exchange -> exchange code -> android client token (fnbr's client)
 *   public/account/:id/deviceAuth -> { accountId, deviceId, secret }
 */
const require = createRequire(import.meta.url);
const AuthClientsModule = require('@fnlb-project/fnbr/dist/resources/AuthClients');
const AuthClients = AuthClientsModule.default || AuthClientsModule;

const ACCOUNT = 'https://account-public-service-prod.ol.epicgames.com/account/api';
const DEVICE_CLIENT = AuthClients.fortniteNewSwitchGameClient;
const BOT_CLIENT = AuthClients.fortniteAndroidGameClient; // fnbr's default authClient
const LOGIN_TTL_MS = 10 * 60 * 1000;

const logins = new Map(); // loginId -> pending login

function basic(client) {
	return `basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

async function epic(url, { method = 'POST', auth, form } = {}) {
	let response;
	try {
		response = await fetch(url, {
			method,
			headers: {
				Authorization: auth,
				...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
			},
			body: form ? new URLSearchParams(form).toString() : undefined
		});
	} catch (error) {
		throw httpError(502, `Could not reach Epic's login service (${error.cause?.code || error.message}). Check the server's internet connection.`);
	}
	const text = await response.text();
	let data = {};
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { errorMessage: text };
	}
	if (!response.ok) {
		const error = httpError(response.status >= 500 ? 502 : 400, data.errorMessage || `Epic returned ${response.status}.`);
		error.epicCode = data.errorCode || '';
		throw error;
	}
	return data;
}

function sweep() {
	const now = Date.now();
	for (const [id, login] of logins) if (login.expiresAt < now) logins.delete(id);
}

/** Starts a login. `target` says where the result goes: 'main', 'new' or a bot account id. */
export async function startDeviceLogin(userId, { target = 'main', label = '' } = {}) {
	sweep();
	for (const [id, login] of logins) if (login.userId === userId) logins.delete(id);

	const clientToken = await epic(`${ACCOUNT}/oauth/token`, {
		auth: basic(DEVICE_CLIENT),
		form: { grant_type: 'client_credentials' }
	});
	const device = await epic(`${ACCOUNT}/oauth/deviceAuthorization`, {
		auth: `bearer ${clientToken.access_token}`,
		form: { prompt: 'login' }
	});

	const id = randomUUID();
	const expiresAt = Date.now() + Math.min(LOGIN_TTL_MS, (device.expires_in || 600) * 1000);
	logins.set(id, {
		id,
		userId,
		target,
		label: String(label || '').slice(0, 64),
		deviceCode: device.device_code,
		userCode: device.user_code,
		url: device.verification_uri_complete || device.verification_uri,
		interval: Math.max(3, device.interval || 5),
		lastPollAt: 0,
		expiresAt
	});
	return publicLogin(logins.get(id), 'pending');
}

function publicLogin(login, status, extra = {}) {
	return {
		loginId: login.id,
		status,
		target: login.target,
		userCode: login.userCode,
		url: login.url,
		interval: login.interval,
		expiresAt: new Date(login.expiresAt).toISOString(),
		...extra
	};
}

/**
 * Checks once whether the user finished signing in. Returns `pending`, or
 * `done` with a fresh device auth (never sent to the browser by the routes).
 */
export async function pollDeviceLogin(userId, loginId) {
	const login = logins.get(loginId);
	if (!login || login.userId !== userId) throw httpError(404, 'That sign-in has expired. Start again.');
	if (login.expiresAt < Date.now()) {
		logins.delete(loginId);
		return publicLogin(login, 'expired');
	}
	// Epic rate-limits polling to its interval; answer pending in between.
	if (Date.now() - login.lastPollAt < login.interval * 1000 - 250) return publicLogin(login, 'pending');
	login.lastPollAt = Date.now();

	let token;
	try {
		token = await epic(`${ACCOUNT}/oauth/token`, {
			auth: basic(DEVICE_CLIENT),
			form: { grant_type: 'device_code', device_code: login.deviceCode }
		});
	} catch (error) {
		if (/authorization_pending|slow_down/.test(error.epicCode)) return publicLogin(login, 'pending');
		logins.delete(loginId);
		if (/not_found|expired/.test(error.epicCode)) return publicLogin(login, 'expired');
		throw error;
	}

	logins.delete(loginId);
	const exchange = await epic(`${ACCOUNT}/oauth/exchange`, { method: 'GET', auth: `bearer ${token.access_token}` });
	const botToken = await epic(`${ACCOUNT}/oauth/token`, {
		auth: basic(BOT_CLIENT),
		form: { grant_type: 'exchange_code', exchange_code: exchange.code, token_type: 'eg1' }
	});
	const deviceAuth = await epic(`${ACCOUNT}/public/account/${encodeURIComponent(botToken.account_id)}/deviceAuth`, {
		auth: `bearer ${botToken.access_token}`
	});

	// Best-effort: these short-lived sessions are no longer needed.
	for (const accessToken of [token.access_token, botToken.access_token]) {
		fetch(`${ACCOUNT}/oauth/sessions/kill/${accessToken}`, {
			method: 'DELETE',
			headers: { Authorization: `bearer ${accessToken}` }
		}).catch(() => {});
	}

	return {
		...publicLogin(login, 'done'),
		label: login.label,
		displayName: botToken.displayName || null,
		deviceAuth: {
			accountId: deviceAuth.accountId || botToken.account_id,
			deviceId: deviceAuth.deviceId,
			secret: deviceAuth.secret
		}
	};
}

export function cancelDeviceLogin(userId, loginId) {
	const login = logins.get(loginId);
	if (login?.userId === userId) logins.delete(loginId);
}
