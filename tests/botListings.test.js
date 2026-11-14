import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { availability } from '../src/services/botListings.js';

const NOW = Date.parse('2026-11-14T17:00:00Z');
const free = { displayName: 'nekouwu4', status: 'available', partySize: 1 };

describe('Community listing availability', () => {
	it('lists a running, unbanned bot that nobody is using', () => {
		assert.equal(availability(free, null, { now: NOW }).state, 'available');
	});

	it('hides bots that are not running', () => {
		assert.equal(availability(null, null, { now: NOW }).state, 'offline');
	});

	it('hides a bot someone already has in their party or match', () => {
		const result = availability({ ...free, status: 'busy', busyReason: 'In a party (2/16).' }, null, { now: NOW });
		assert.equal(result.state, 'busy');
		assert.match(result.reason, /party/);
	});

	it('hides FNLB bots with an active matchmaking ban, and lists them again after it ends', () => {
		const banned = availability(free, { mmsBannedUntil: '2026-11-15T00:00:00Z' }, { now: NOW });
		assert.equal(banned.state, 'banned');
		assert.equal(banned.until, '2026-11-15T00:00:00Z');
		assert.equal(availability(free, { mmsBannedUntil: '2026-11-14T10:00:00Z' }, { now: NOW }).state, 'available');
	});

	it('hides FNLB bots with an invalid login or disabled in FNLB', () => {
		assert.equal(availability(free, { hasInvalidAuth: true }, { now: NOW }).state, 'banned');
		assert.equal(availability(free, { isDisabled: true }, { now: NOW }).state, 'disabled');
	});

	it('hides bots the runtime itself reports as banned', () => {
		assert.equal(availability({ ...free, banned: true, banReason: 'Invalid login.' }, null, { now: NOW }).state, 'banned');
	});

	it('a ban wins over being offline (owner sees the real reason)', () => {
		assert.equal(availability(null, { mmsBannedUntil: '2026-11-15T00:00:00Z' }, { now: NOW }).state, 'banned');
	});
});
