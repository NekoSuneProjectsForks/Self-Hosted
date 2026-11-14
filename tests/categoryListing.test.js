import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Own throwaway database (node --test runs each file in its own process).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'listing-test-'));
process.env.SQLITE_PATH = join(process.env.DATA_DIR, 'test.sqlite');
const models = await import('../src/models/index.js');
const listings = await import('../src/services/botListings.js');

const live = { b1: { displayName: 'botOne', status: 'available' }, b2: { displayName: 'botTwo', status: 'busy' }, b3: { displayName: 'botThree', status: 'available' } };
const statusOf = async (_userId, engine, key) => (engine === 'fnlb' ? live[key] || null : null);
const noInfo = async () => new Map();
let clock = Date.now();
const list = () => listings.publicBots(statusOf, { fnlbInfo: noInfo, now: (clock += 60000) });

describe('FNLB category Public/Private', () => {
	let user;
	before(async () => {
		await models.initDatabase();
		user = await models.User.create({ username: 'cat', email: 'cat@example.com', passwordHash: 'x' });
	});

	it('makes every bot in the category public (busy ones stay hidden until free)', async () => {
		await listings.setCategoryListing(user.id, 'cat-A', true, [{ id: 'b1', name: 'botOne' }, { id: 'b2', name: 'botTwo' }]);
		const result = await list();
		assert.deepEqual(result.bots.map((bot) => bot.displayName), ['botOne']);
		assert.equal(result.counts.busy, 1);
		assert.ok(!result.bots.some((bot) => bot.engine === listings.CATEGORY_ENGINE), 'the category itself is never listed');
	});

	it('bots added to the category later inherit its choice', async () => {
		await listings.inheritCategoryChoice(user.id, [{ id: 'b3', name: 'botThree', categoryId: 'cat-A' }], new Map([['cat-A', true]]));
		assert.deepEqual((await list()).bots.map((bot) => bot.displayName), ['botOne', 'botThree']);
	});

	it('switching the category to private hides all of them', async () => {
		await listings.setCategoryListing(user.id, 'cat-A', false, [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }]);
		assert.deepEqual((await list()).bots, []);
	});

	it('a single bot can still be switched on its own afterwards', async () => {
		await listings.setListing(user.id, { engine: 'fnlb', botKey: 'b3', isPublic: true }, { verify: async () => true });
		assert.deepEqual((await list()).bots.map((bot) => bot.displayName), ['botThree']);
	});
});
