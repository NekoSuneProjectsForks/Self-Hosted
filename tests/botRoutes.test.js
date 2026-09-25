import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerBotRoutes } from '../src/routes/bots.routes.js';

/** Captures route handlers so they can be called without an HTTP server. */
function captureRoutes(adapter) {
	const routes = new Map();
	const record = (method) => (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
	const app = { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') };
	const pass = (req, res, next) => next();
	registerBotRoutes({
		app,
		runtime: { requireActive: () => adapter },
		requireAuth: pass,
		requireActive: pass,
		requireAdmin: pass,
		io: { to: () => ({ emit: () => {} }) }
	});
	return routes;
}

function call(handler) {
	return new Promise((resolve, reject) => {
		const res = { status: () => res, json: resolve };
		handler({ user: { id: 'user-1' }, params: { botId: 'bot-1' } }, res, reject);
	});
}

describe('GET /api/bots/:botId/friends', () => {
	// Regression: the fnbr adapter returns plain objects, and the route used to
	// call `.catch()` on them ("getPendingFriends(...).catch is not a function").
	it('works with a synchronous (fnbr) adapter', async () => {
		const routes = captureRoutes({
			getFriends: () => ({ onlineFriends: [{ id: 'f1' }], offlineFriends: [] }),
			getPendingFriends: () => ({ incomingFriends: [{ id: 'p1' }], outgoingFriends: [] }),
			getBlockedUsers: () => [{ id: 'b1' }]
		});
		const body = await call(routes.get('GET /api/bots/:botId/friends'));
		assert.deepEqual(body.onlineFriends, [{ id: 'f1' }]);
		assert.deepEqual(body.pendingFriends.incomingFriends, [{ id: 'p1' }]);
		assert.deepEqual(body.blockedUsers, [{ id: 'b1' }]);
	});

	it('works with an async (FNLB) adapter', async () => {
		const routes = captureRoutes({
			getFriends: async () => ({ onlineFriends: [], offlineFriends: [] }),
			getPendingFriends: async () => ({ incomingFriends: [], outgoingFriends: [{ id: 'o1' }] }),
			getBlockedUsers: async () => []
		});
		const body = await call(routes.get('GET /api/bots/:botId/friends'));
		assert.deepEqual(body.pendingFriends.outgoingFriends, [{ id: 'o1' }]);
	});

	it('falls back to empty lists when the optional lists fail', async () => {
		const routes = captureRoutes({
			getFriends: () => ({ onlineFriends: [], offlineFriends: [] }),
			getPendingFriends: () => {
				throw new Error('boom');
			},
			getBlockedUsers: async () => {
				throw new Error('boom');
			}
		});
		const body = await call(routes.get('GET /api/bots/:botId/friends'));
		assert.deepEqual(body.pendingFriends, { incomingFriends: [], outgoingFriends: [] });
		assert.deepEqual(body.blockedUsers, []);
	});
});
