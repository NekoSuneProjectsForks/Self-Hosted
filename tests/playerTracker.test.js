import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffStats, groupStats, playlistLabel } from '../src/services/playerTracker.js';
import { LocalFnbrRuntime, trackerCategory } from '../src/runtime/LocalFnbrRuntime.js';

const key = (stat, playlist = 'playlist_nobuildbr_duo', input = 'gamepad') => `br_${stat}_${input}_m0_${playlist}`;

describe('Player match tracking (Epic stats diff)', () => {
	it('groups raw stats v2 keys by playlist and input', () => {
		const grouped = groupStats({ [key('kills')]: 5, [key('matchesplayed')]: 2, 's40_social_bp_level': 1234, junk: 1 });
		assert.deepEqual(grouped, { 'playlist_nobuildbr_duo|gamepad': { kills: 5, matchesplayed: 2 } });
	});

	it('turns a match-count increase into a finished match with its kills and win', () => {
		const before = groupStats({ [key('matchesplayed')]: 10, [key('kills')]: 20, [key('placetop1')]: 1, [key('placetop5')]: 3, [key('minutesplayed')]: 100 });
		const after = groupStats({
			[key('matchesplayed')]: 11,
			[key('kills')]: 27,
			[key('placetop1')]: 2,
			[key('placetop5')]: 4,
			[key('minutesplayed')]: 118,
			[key('lastmodified')]: 1794670000
		});
		const [match, ...rest] = diffStats(before, after);
		assert.equal(rest.length, 0);
		assert.equal(match.matches, 1);
		assert.equal(match.kills, 7);
		assert.equal(match.wins, 1);
		assert.equal(match.bestPlacement, 1);
		assert.equal(match.minutes, 18);
		assert.equal(match.playlistLabel, 'Zero Build · Duo');
		assert.equal(match.endedAt.getTime(), 1794670000 * 1000);
	});

	it('reports the best top-N bucket when the player did not win', () => {
		const before = groupStats({ [key('matchesplayed')]: 1, [key('placetop10')]: 0, [key('placetop25')]: 0 });
		const after = groupStats({ [key('matchesplayed')]: 2, [key('placetop10')]: 1, [key('placetop25')]: 1 });
		const [match] = diffStats(before, after);
		assert.equal(match.wins, 0);
		assert.equal(match.bestPlacement, 10);
	});

	it('ignores playlists whose match count did not change', () => {
		const snap = groupStats({ [key('matchesplayed')]: 3, [key('kills')]: 4 });
		assert.deepEqual(diffStats(snap, snap), []);
	});

	it('labels common playlists', () => {
		assert.equal(playlistLabel('playlist_defaultsquad'), 'Build · Squad');
		assert.equal(playlistLabel('playlist_nobuildbr_trio'), 'Zero Build · Trio');
	});
});

describe('Tracker bots', () => {
	it('never accept invites, auto-ready or rejoin, whatever the shared settings say', () => {
		const category = trackerCategory({ config: { acceptInvites: true, autoReady: true, rejoinAfterMatch: true, startOutfit: [{ id: 'CID_1' }] } });
		assert.equal(category.config.acceptInvites, false);
		assert.equal(category.config.autoReady, false);
		assert.equal(category.config.rejoinAfterMatch, false);
		assert.deepEqual(category.config.startOutfit, [{ id: 'CID_1' }], 'look settings kept');
	});

	it('refuses to join a party and keeps the overrides on live setting changes', async () => {
		const runtime = new LocalFnbrRuntime({
			userId: 'u',
			startConfig: { tracker: true, localCategory: { config: { autoReady: true } } },
			appendLog: () => {},
			emit: () => {}
		});
		assert.equal(runtime.isTracker(), true);
		assert.equal(runtime.startConfig.localCategory.config.autoReady, false);
		runtime.updateLocalCategory({ config: { autoReady: true, acceptInvites: true } });
		assert.equal(runtime.startConfig.localCategory.config.acceptInvites, false);
		await assert.rejects(() => runtime.joinParty('someone'), /tracker/);
	});
});

import { summarize } from '../src/services/playerTracker.js';

describe('Match totals (K/D and more)', () => {
	it('works out K/D, win rate, kills per match, top-10 rate and average time', () => {
		const t = summarize([
			{ matches: 1, wins: 1, kills: 8, minutes: 19, score: 300, placement: 1 },
			{ matches: 1, wins: 0, kills: 3, minutes: 14, score: 120, placement: 5 },
			{ matches: 2, wins: 0, kills: 1, minutes: 10, score: 40, placement: 25 }
		]);
		assert.equal(t.matches, 4);
		assert.equal(t.wins, 1);
		assert.equal(t.deaths, 3);
		assert.equal(t.kills, 12);
		assert.equal(t.kd, 4);
		assert.equal(t.winRate, 25);
		assert.equal(t.killsPerMatch, 3);
		assert.equal(t.top10Rate, 50);
		assert.equal(t.avgMinutes, 10.8);
	});
	it('is all zeros with no matches (no division by zero)', () => {
		const t = summarize([]);
		assert.equal(t.kd, 0);
		assert.equal(t.winRate, 0);
	});
	it('a flawless run counts K/D as kills (no deaths)', () => {
		assert.equal(summarize([{ matches: 2, wins: 2, kills: 10 }]).kd, 10);
	});
});
