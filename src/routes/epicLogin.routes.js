import { asyncRoute, httpError } from '../http/helpers.js';
import { getPlainConfig, saveDeviceAuthForUser } from '../services/configStore.js';
import {
	createBotAccount,
	getBotAccount,
	listBotAccounts,
	saveBotAccountDeviceAuth,
	saveBotAccountIdentity
} from '../services/botAccounts.js';
import { cancelDeviceLogin, pollDeviceLogin, startDeviceLogin } from '../services/epicDeviceLogin.js';
import { updateTrackerSettings } from '../services/serverSettings.js';

/**
 * "Sign in with Epic" (device-code flow). The browser shows Epic's code and
 * link, the user signs in on Epic's own site, and the resulting device auth is
 * saved server-side. Secrets never go back to the browser.
 */
export function registerEpicLoginRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	async function assertNotInUse(userId, accountId, { exceptAccountRow = null, forMain = false } = {}) {
		const config = await getPlainConfig(userId);
		const accounts = await listBotAccounts(userId);
		if (!forMain && config.deviceAuth?.accountId === accountId) {
			throw httpError(409, 'That Epic account is already your main bot. Sign in with a different dummy account.');
		}
		const clash = accounts.find((account) => account.accountId === accountId && account.id !== exceptAccountRow);
		if (clash) throw httpError(409, `That Epic account is already used by the extra bot "${clash.label}".`);
	}

	app.post(
		'/api/epic-login',
		...guard,
		asyncRoute(async (req, res) => {
			const target = String(req.body?.target || 'main');
			if (target === 'server-tracker') {
				if (req.user.role !== 'admin') throw httpError(403, 'Only admins can sign in the server tracker.');
			} else if (target !== 'main' && target !== 'new') await getBotAccount(req.user.id, target);
			return res.status(201).json(await startDeviceLogin(req.user.id, { target, label: req.body?.label }));
		})
	);

	app.get(
		'/api/epic-login/:loginId',
		...guard,
		asyncRoute(async (req, res) => {
			const result = await pollDeviceLogin(req.user.id, req.params.loginId);
			if (result.status !== 'done') return res.json(result);

			const { deviceAuth, displayName, target, label } = result;
			const response = { status: 'done', target, displayName };
			if (target === 'server-tracker') {
				if (req.user.role !== 'admin') throw httpError(403, 'Only admins can sign in the server tracker.');
				await updateTrackerSettings({ deviceAuth, displayName });
				await runtime.stopServerTracker('Server tracker signed in again; restarting.').catch(() => {});
				await runtime.startServerTracker().catch(() => {});
			} else if (target === 'main') {
				await assertNotInUse(req.user.id, deviceAuth.accountId, { forMain: true });
				await saveDeviceAuthForUser(req.user.id, deviceAuth);
				runtime.appendLog(req.user.id, `Signed in with Epic as ${displayName || deviceAuth.accountId}. Device auth saved.`, 1);
			} else if (target === 'new') {
				await assertNotInUse(req.user.id, deviceAuth.accountId);
				const account = await createBotAccount(req.user.id, {
					label: label || displayName,
					deviceAuthJson: JSON.stringify(deviceAuth)
				});
				await saveBotAccountIdentity(req.user.id, account.id, { accountId: deviceAuth.accountId, displayName });
				response.accountRowId = account.id;
				runtime.emitHelpers(req.user.id);
			} else {
				await assertNotInUse(req.user.id, deviceAuth.accountId, { exceptAccountRow: target });
				await saveBotAccountDeviceAuth(req.user.id, target, deviceAuth);
				await saveBotAccountIdentity(req.user.id, target, { accountId: deviceAuth.accountId, displayName });
				runtime.emitHelpers(req.user.id);
			}
			return res.json(response);
		})
	);

	app.delete(
		'/api/epic-login/:loginId',
		...guard,
		asyncRoute(async (req, res) => {
			cancelDeviceLogin(req.user.id, req.params.loginId);
			return res.json({ ok: true });
		})
	);
}
