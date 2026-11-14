import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bottrack-test-'));
process.env.SQLITE_PATH = join(process.env.DATA_DIR, 'test.sqlite');
const models = await import('../src/models/index.js');
const tracker = await import('../src/services/playerTracker.js');

const key = (stat) => `br_${stat}_gamepad_m0_playlist_nobuildbr_duo`;

describe('Bots are tracked automatically', () => {
	let user;
	before(async () => {
		await models.initDatabase();
		user = await models.User.create({ username: 'bt', email: 'bt@example.com', passwordHash: 'x' });
	});

	it('adds each bot account once, keeps its name current, and does not count toward the player limit', async () => {
		assert.equal(await tracker.syncBotTracking(user.id, [{ accountId: 'epic-1', displayName: 'nekouwu4' }]), 1);
		assert.equal(await tracker.syncBotTracking(user.id, [{ accountId: 'epic-1', displayName: 'nekouwu4-renamed' }]), 0);
		const list = await tracker.listTrackedPlayers(user.id);
		assert.equal(list.length, 1);
		assert.equal(list[0].kind, 'bot');
		assert.equal(list[0].displayName, 'nekouwu4-renamed');
		for (let i = 0; i < tracker.MAX_TRACKED_PLAYERS; i += 1) {
			await tracker.addTrackedPlayer(user.id, { accountId: `p-${i}`, displayName: `p${i}` });
		}
		await assert.rejects(() => tracker.addTrackedPlayer(user.id, { accountId: 'one-too-many' }), /up to/);
	});

	it('records the bot\'s matches and pages them', async () => {
		const row = await models.TrackedPlayer.findOne({ where: { userId: user.id, accountId: 'epic-1' } });
		let snap = { [key('matchesplayed')]: 0, [key('kills')]: 0 };
		await tracker.pollTrackedPlayer(row, async () => snap);
		for (let n = 1; n <= 25; n += 1) {
			snap = { ...snap, [key('matchesplayed')]: n, [key('kills')]: n * 2, [key('lastmodified')]: 1794670000 + n * 60 };
			await row.reload();
			await tracker.pollTrackedPlayer(row, async () => snap);
		}
		const first = await tracker.trackedMatches(user.id, 'epic-1', { page: 1, pageSize: 10 });
		assert.equal(first.paging.total, 25);
		assert.equal(first.paging.pages, 3);
		assert.equal(first.matches.length, 10);
		assert.equal(first.totals.recorded.matches, 25);
		assert.equal(first.totals.recorded.kills, 50);
		const last = await tracker.trackedMatches(user.id, 'epic-1', { page: 3, pageSize: 10 });
		assert.equal(last.matches.length, 5);
		assert.ok(new Date(first.matches[0].endedAt) > new Date(last.matches[0].endedAt), 'newest first');
	});
});

describe('No duplicate matches, and a safe shareable report', () => {
	let user;
	let row;
	before(async () => {
		user = await models.User.create({ username: 'dup', email: 'dup@example.com', passwordHash: 'x' });
		await tracker.syncBotTracking(user.id, [{ accountId: 'epic-dup-123456', displayName: 'NekoSuneVR' }]);
		row = await models.TrackedPlayer.findOne({ where: { userId: user.id, accountId: 'epic-dup-123456' } });
		await tracker.pollTrackedPlayer(row, async () => ({ [key('matchesplayed')]: 10, [key('kills')]: 0 }));
	});

	it('records a match once even when several checks run at the same moment', async () => {
		const after = { [key('matchesplayed')]: 11, [key('kills')]: 14, [key('placetop1')]: 1, [key('lastmodified')]: 1794672446 };
		const copies = [0, 1, 2].map(async () => {
			const fresh = await models.TrackedPlayer.findByPk(row.id);
			return tracker.pollTrackedPlayer(fresh, async () => after);
		});
		const recorded = (await Promise.all(copies)).flat();
		assert.equal(recorded.length, 1);
		const { paging } = await tracker.trackedMatches(user.id, 'epic-dup-123456');
		assert.equal(paging.total, 1);
	});

	it('cleans up duplicates an older version already saved', async () => {
		const [first] = (await tracker.trackedMatches(user.id, 'epic-dup-123456')).matches;
		const original = await models.MatchRound.findByPk(first.id);
		await models.MatchRound.create({ ...original.toJSON(), id: undefined, createdAt: undefined, updatedAt: undefined });
		assert.equal((await tracker.trackedMatches(user.id, 'epic-dup-123456')).paging.total, 2);
		assert.equal(await tracker.removeDuplicateMatches(user.id), 1);
		assert.equal((await tracker.trackedMatches(user.id, 'epic-dup-123456')).paging.total, 1);
	});

	it('exports an HTML report with names shortened and no account IDs', async () => {
		const { matchReportHtml, maskName } = await import('../src/services/matchReport.js');
		assert.equal(maskName('NekoSuneVR'), 'Neko****');
		assert.equal(maskName('Bob'), 'B***');
		const html = await matchReportHtml(user.id, {});
		assert.match(html, /<table>/);
		assert.match(html, /Neko\*\*\*\*/);
		assert.match(html, /Victory Royale/);
		assert.ok(!html.includes('NekoSuneVR'), 'full name never appears');
		assert.ok(!html.includes('epic-dup-123456'), 'account ID never appears');
		assert.ok(!/<script/i.test(html), 'static page, no scripts');
	});

	it('gives full match details to the owner', async () => {
		const { matchDetails } = await import('../src/services/matchReport.js');
		const [first] = (await tracker.trackedMatches(user.id, 'epic-dup-123456')).matches;
		const details = await matchDetails(user.id, first.id);
		assert.equal(details.who.name, 'NekoSuneVR');
		assert.equal(details.combat.kills, 14);
		assert.equal(details.result.win, true);
		assert.equal(await matchDetails('someone-else', first.id), null);
	});
});
