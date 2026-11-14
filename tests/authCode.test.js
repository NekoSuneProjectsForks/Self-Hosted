import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractAuthorizationCode, normalizePlatform, PLATFORM_NAMES } from '../src/services/configStore.js';

describe('extractAuthorizationCode', () => {
	const code = '0123456789abcdef0123456789abcdef';

	it('keeps a bare code', () => {
		assert.equal(extractAuthorizationCode(`  ${code} `), code);
	});

	it('pulls the code out of the whole JSON page Epic shows', () => {
		const page = `{"warning":"Do not share this code with any 3rd party service.","redirectUrl":"https://localhost/launcher/authorized?code=${code}","authorizationCode":"${code}","exchangeCode":null,"sid":null}`;
		assert.equal(extractAuthorizationCode(page), code);
	});

	it('pulls the code out of a redirect URL', () => {
		assert.equal(extractAuthorizationCode(`https://localhost/launcher/authorized?code=${code}`), code);
	});

	it('returns empty for nothing', () => {
		assert.equal(extractAuthorizationCode(''), '');
		assert.equal(extractAuthorizationCode(undefined), '');
	});
});

describe('platforms', () => {
	it('accepts every named platform and rejects unknown ones', () => {
		for (const code of Object.keys(PLATFORM_NAMES)) assert.equal(normalizePlatform(code.toLowerCase()), code);
		assert.equal(normalizePlatform('NOPE', ''), '');
	});
});

describe('assertAuthorizationCode', async () => {
	const { assertAuthorizationCode } = await import('../src/services/configStore.js');
	it('accepts a 32 character code', () => {
		assert.equal(assertAuthorizationCode('0123456789abcdef0123456789ABCDEF'), '0123456789abcdef0123456789ABCDEF');
	});
	it('rejects an access token with a clear message', () => {
		assert.throws(() => assertAuthorizationCode('eg1~eyJraWQiOi.abc'), /access token/);
	});
	it('rejects a short paste', () => {
		assert.throws(() => assertAuthorizationCode('abc'), (error) => error.status === 400);
	});
});
