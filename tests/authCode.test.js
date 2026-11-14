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
