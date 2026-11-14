import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFnlbLog } from '../src/runtime/fnlbLogParser.js';
import { playlistLabel } from '../src/services/playerTracker.js';

// Real lines from a Legacy FNLB v2.0.269 run (Nov 2026).
const START = '[Bot] [nekouwu4] [i] Starting matchmaking [v3]... (playlist_nobuildbr_duo)';
const TICKET = '[Bot] [nekouwu4] [i] Using Matchmaking V3 for playlist_nobuildbr_duo {\n  "netCL": 59543849,\n  "region": "EU",\n  "hotfixId": 1,\n  "ticketId": "efc78b908fb74e5a8c72f2d0d5fcf259"\n}';
const DONE = '[Bot] [nekouwu4] [✓] Matchmaking ended successfully (playlist_nobuildbr_duo). Real players in the match: 1';

describe('FNLB log → matchmaking events', () => {
	it('reads a queue start', () => {
		assert.deepEqual(parseFnlbLog(START), { type: 'start', bot: 'nekouwu4', version: 'v3', playlist: 'playlist_nobuildbr_duo' });
	});
	it('reads the ticket and region', () => {
		const event = parseFnlbLog(TICKET);
		assert.equal(event.type, 'ticket');
		assert.equal(event.ticketId, 'efc78b908fb74e5a8c72f2d0d5fcf259');
		assert.equal(event.region, 'EU');
	});
	it('reads a successful match and the real player count', () => {
		assert.deepEqual(parseFnlbLog(DONE), { type: 'success', bot: 'nekouwu4', playlist: 'playlist_nobuildbr_duo', realPlayers: 1 });
	});
	it('strips colour codes and reads failures', () => {
		const event = parseFnlbLog('\u001b[31m[Bot] [nekouwu4] [✗] Matchmaking failed (playlist_defaultduo): timed out\u001b[0m');
		assert.equal(event.type, 'failed');
		assert.equal(event.playlist, 'playlist_defaultduo');
	});
	it('ignores unrelated lines', () => {
		assert.equal(parseFnlbLog('[Bot] [nekouwu4] [i] Accepted invite from: NekoSuneVR'), null);
		assert.equal(parseFnlbLog('[Client] [5fj-00] [i] Requesting bots... Next request at 16s'), null);
	});
	it('labels FNLB 43.x playlists', () => {
		assert.equal(playlistLabel('playlist_trios'), 'Build · Trio');
		assert.equal(playlistLabel('playlist_figmentnobuildduo'), 'OG Zero Build · Duo');
		assert.equal(playlistLabel('playlist_forbiddenfruitnobuildbrstack'), 'Blitz · Six Stack');
	});
});

import { friendlyMatchmakingError } from '../src/runtime/fnlbLogParser.js';

describe('Readable FNLB matchmaking errors', () => {
	it('turns the heartbeat dump into one line', () => {
		const raw = '[Bot] [nekouwu4] [! ERR] Error: Failed to request heartbeat { "name": "EpicgamesAPIError", "message": "Service threw error: matchmaking_service_error.ticket_heartbeat_failure.200007 with message: Ticket ffb8378e';
		assert.equal(friendlyMatchmakingError(raw), 'The matchmaking ticket expired (heartbeat failed). Try readying up again. (200007)');
	});
	it('names unknown Epic matchmaking errors in plain words', () => {
		assert.match(friendlyMatchmakingError('matchmaking_service_error.region_unavailable.1'), /region unavailable/);
	});
	it('falls back to the first line without the JSON', () => {
		assert.equal(friendlyMatchmakingError('[Bot] [x] [! ERR] Error: Matchmaking failed: timed out { "a": 1 }'), 'Matchmaking failed: timed out');
	});
});
