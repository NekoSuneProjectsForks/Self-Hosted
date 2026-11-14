import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { pollDeviceLogin, startDeviceLogin } from '../src/services/epicDeviceLogin.js';

/** Fakes Epic's account service so the device-code flow runs with no network. */
const realFetch = globalThis.fetch;
function fakeEpic({ pendingPolls = 0 } = {}) {
	const calls = [];
	let polls = 0;
	globalThis.fetch = async (url, options = {}) => {
		const body = new URLSearchParams(options.body || '');
		calls.push({ url: String(url), method: options.method, grant: body.get('grant_type') });
		const json = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
		if (url.endsWith('/oauth/token') && body.get('grant_type') === 'client_credentials') return json(200, { access_token: 'client' });
		if (url.endsWith('/oauth/deviceAuthorization'))
			return json(200, { device_code: 'dc', user_code: 'ABCD1234', verification_uri_complete: 'https://www.epicgames.com/activate?userCode=ABCD1234', expires_in: 600, interval: 5 });
		if (url.endsWith('/oauth/token') && body.get('grant_type') === 'device_code') {
			polls += 1;
			if (polls <= pendingPolls) return json(400, { errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' });
			return json(200, { access_token: 'switch' });
		}
		if (url.endsWith('/oauth/exchange')) return json(200, { code: 'exch' });
		if (url.endsWith('/oauth/token') && body.get('grant_type') === 'exchange_code')
			return json(200, { access_token: 'android', account_id: 'acc-1', displayName: 'DummyBot' });
		if (url.includes('/deviceAuth')) return json(200, { accountId: 'acc-1', deviceId: 'dev-1', secret: 'sec-1' });
		if (url.includes('/sessions/kill/')) return json(204, {});
		return json(404, { errorMessage: `unexpected ${url}` });
	};
	return calls;
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('Sign in with Epic (device code)', () => {
	it('starts with a user code and link, never a secret', async () => {
		fakeEpic();
		const login = await startDeviceLogin('user-a', { target: 'main' });
		assert.equal(login.status, 'pending');
		assert.equal(login.userCode, 'ABCD1234');
		assert.match(login.url, /epicgames\.com\/activate/);
		assert.equal(login.deviceCode, undefined);
	});

	it('stays pending until the user signs in, then returns device auth', async () => {
		fakeEpic({ pendingPolls: 1 });
		const login = await startDeviceLogin('user-b', { target: 'new', label: 'Bot 2' });
		const first = await pollDeviceLogin('user-b', login.loginId);
		assert.equal(first.status, 'pending');

		// Skip Epic's polling interval for the test.
		const realNow = Date.now;
		Date.now = () => realNow() + 10_000;
		try {
			const done = await pollDeviceLogin('user-b', login.loginId);
			assert.equal(done.status, 'done');
			assert.equal(done.displayName, 'DummyBot');
			assert.deepEqual(done.deviceAuth, { accountId: 'acc-1', deviceId: 'dev-1', secret: 'sec-1' });
			assert.equal(done.label, 'Bot 2');
		} finally {
			Date.now = realNow;
		}
	});

	it("does not let one user poll another user's sign-in", async () => {
		fakeEpic();
		const login = await startDeviceLogin('user-c');
		await assert.rejects(pollDeviceLogin('someone-else', login.loginId), (error) => error.status === 404);
	});
});
