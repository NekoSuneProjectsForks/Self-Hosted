import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'live-test-'));
process.env.SQLITE_PATH = join(process.env.DATA_DIR, 'test.sqlite');
const models = await import('../src/models/index.js');
const { registerListingRoutes } = await import('../src/routes/listings.routes.js');
const express = (await import('express')).default;

/** Reads SSE "bots" events from the stream until `until` returns true. */
function watch(port, until, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const events = [];
		const req = http.get({ port, path: '/api/public/bots/stream' }, (res) => {
			let buffer = '';
			res.on('data', (chunk) => {
				buffer += chunk;
				let index;
				while ((index = buffer.indexOf('\n\n')) >= 0) {
					const block = buffer.slice(0, index);
					buffer = buffer.slice(index + 2);
					const data = block.split('\n').find((line) => line.startsWith('data: '));
					if (block.includes('event: bots') && data) {
						events.push({ at: Date.now(), body: JSON.parse(data.slice(6)) });
						if (until(events)) {
							req.destroy();
							resolve(events);
						}
					}
				}
			});
		});
		req.on('error', () => {});
		setTimeout(() => {
			req.destroy();
			reject(new Error(`timed out with ${events.length} event(s)`));
		}, timeoutMs);
	});
}

describe('Public bot list updates live', () => {
	let server;
	let port;
	const status = { state: null };
	before(async () => {
		await models.initDatabase();
		const user = await models.User.create({ username: 'live', email: 'live@example.com', passwordHash: 'x' });
		await models.BotListing.create({ userId: user.id, engine: 'fnbr', botKey: 'epic-live', displayName: 'LiveBot', isPublic: true });
		const app = express();
		const pass = (_req, _res, next) => next();
		const runtime = { publicBotStatus: () => (status.state ? { displayName: 'LiveBot', status: status.state, partySize: 1 } : null) };
		registerListingRoutes({ app, runtime, requireAuth: pass, requireActive: pass });
		server = app.listen(0);
		port = server.address().port;
	});
	after(() => server?.close());

	it('pushes the current list straight away, then changes within ~3 seconds', async () => {
		status.state = 'busy';
		let freedAt = 0;
		const events = await watch(port, (list) => {
			if (list.length === 1) {
				assert.equal(list[0].body.counts.busy, 1, 'first message: bot in use, not listed');
				assert.equal(list[0].body.bots.length, 0);
				freedAt = Date.now();
				status.state = 'available';
			}
			return list.some((event) => event.body.bots.length === 1);
		});
		const shown = events.find((event) => event.body.bots.length === 1);
		assert.equal(shown.body.bots[0].displayName, 'LiveBot');
		assert.ok(shown.at - freedAt <= 4500, `took ${shown.at - freedAt} ms`);
	});
});
