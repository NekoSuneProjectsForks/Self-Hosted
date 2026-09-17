import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { RuntimeManager } from '../src/runtime/RuntimeManager.js';

/**
 * These tests drive RuntimeManager with fake adapters, so they never touch Epic,
 * FNLB or the network. CI does not need a real account.
 */
function fakeIo() {
	const emitted = [];
	return {
		emitted,
		to: () => ({ emit: (event, payload) => emitted.push({ event, payload }) })
	};
}

class FakeAdapter {
	constructor(engine) {
		this.engine = engine;
		this.started = false;
		this.stopped = false;
		this.localCategory = null;
		this.status = null;
		this.privacy = null;
	}
	async start() {
		this.started = true;
	}
	async stop() {
		this.stopped = true;
	}
	botId() {
		return 'bot-1';
	}
	updateLocalCategory(category) {
		this.localCategory = category;
	}
	async setStatus(status) {
		this.status = status;
	}
	async setPrivacy(privacy) {
		this.privacy = privacy;
	}
	getCapabilities() {
		return { engine: this.engine, capabilities: {} };
	}
}

function managerWithFake(engine = 'fnbr') {
	const io = fakeIo();
	const manager = new RuntimeManager(io);
	const adapter = new FakeAdapter(engine);
	manager.createAdapter = () => adapter;
	// Logging writes to the database; not needed for these tests.
	manager.appendLog = () => {};
	return { manager, adapter, io };
}

const baseConfig = {
	runtimeMode: 'fnbr',
	deviceAuth: { accountId: 'a', deviceId: 'd', secret: 's' },
	authorizationCode: '',
	platform: 'WIN',
	defaultStatus: 'Lobby',
	killOtherTokens: false,
	restartInterval: 3600,
	autoUpdateOnRestart: true,
	clusterName: 'test',
	localCategory: { id: 'local-default', name: 'L', config: { privacy: 'public' } }
};

const user = { id: 'user-1', status: 'active' };

describe('RuntimeManager engine state', () => {
	let manager;
	let adapter;

	beforeEach(() => {
		({ manager, adapter } = managerWithFake());
	});

	it('reports no active engine before start', () => {
		const state = manager.serialize(user.id);
		assert.equal(state.activeMode, null);
		assert.equal(state.configuredMode, 'fnbr');
		assert.equal(state.status, 'offline');
	});

	it('sets activeMode only after the engine is really up', async () => {
		await manager.start(user, baseConfig);
		const state = manager.serialize(user.id);
		assert.equal(state.activeMode, 'fnbr');
		assert.equal(state.status, 'online');
		assert.ok(adapter.started);
	});

	it('leaves activeMode null when start fails', async () => {
		adapter.start = async () => {
			throw new Error('epic is down');
		};
		await assert.rejects(() => manager.start(user, baseConfig));
		const state = manager.serialize(user.id);
		assert.equal(state.activeMode, null);
		assert.equal(state.status, 'error');
	});

	it('flags authentication required rather than a generic error', async () => {
		adapter.start = async () => {
			const error = new Error('Authentication Required');
			error.status = 401;
			throw error;
		};
		await assert.rejects(() => manager.start(user, baseConfig));
		const state = manager.serialize(user.id);
		assert.equal(state.status, 'auth_required');
		assert.equal(state.authRequired, true);
	});

	// This is the regression test for the reported desync bug.
	it('does NOT swap the running engine when the saved engine changes', async () => {
		await manager.start(user, baseConfig);
		assert.equal(manager.serialize(user.id).activeMode, 'fnbr');

		const result = await manager.applySavedConfig(user.id, { ...baseConfig, runtimeMode: 'fnlb' });

		const state = manager.serialize(user.id);
		assert.equal(state.activeMode, 'fnbr', 'the running engine must not change');
		assert.equal(state.configuredMode, 'fnlb', 'the saved engine is recorded separately');
		assert.equal(state.restartRequired, true);
		assert.match(state.restartReason, /switch runtime engine/i);
		assert.equal(result.restartRequired, true);
	});

	it('routes to the active engine, not the newly saved one', async () => {
		await manager.start(user, baseConfig);
		await manager.applySavedConfig(user.id, { ...baseConfig, runtimeMode: 'fnlb' });

		// Even though config now says fnlb, the local engine is what is running.
		assert.equal(manager.isLocalEngine(user.id, { runtimeMode: 'fnlb' }), true);
		assert.equal(manager.requireActive(user.id).engine, 'fnbr');
	});

	it('falls back to the configured engine when nothing is running', () => {
		assert.equal(manager.isLocalEngine(user.id, { runtimeMode: 'fnlb' }), false);
		assert.equal(manager.isLocalEngine(user.id, { runtimeMode: 'fnbr' }), true);
	});

	it('refuses runtime calls when offline instead of throwing a 500', () => {
		assert.throws(
			() => manager.requireActive(user.id),
			(error) => error.status === 409
		);
	});

	it('applies lobby settings live without requiring a restart', async () => {
		await manager.start(user, baseConfig);
		const result = await manager.applySavedConfig(user.id, {
			...baseConfig,
			defaultStatus: 'New status',
			localCategory: { id: 'local-default', name: 'L', config: { privacy: 'friends' } }
		});

		assert.equal(result.restartRequired, false, 'lobby settings must not force a restart');
		assert.equal(adapter.status, 'New status');
		assert.equal(adapter.privacy, 'friends');
		assert.ok(result.appliedLive.includes('localCategory'));
	});

	it('requires a restart for process-level settings', async () => {
		await manager.start(user, baseConfig);
		const result = await manager.applySavedConfig(user.id, { ...baseConfig, platform: 'PSN' });
		assert.equal(result.restartRequired, true);
		assert.match(result.restartReason, /platform/i);
	});

	it('refuses to start a suspended account', async () => {
		await assert.rejects(
			() => manager.start({ id: 'user-2', status: 'suspended' }, baseConfig),
			(error) => error.status === 403
		);
	});

	it('refuses a second start while already running', async () => {
		await manager.start(user, baseConfig);
		await assert.rejects(
			() => manager.start(user, baseConfig),
			(error) => error.status === 409
		);
	});
});

describe('RuntimeManager capabilities', () => {
	it('reports fnbr capabilities while offline', () => {
		const { manager } = managerWithFake();
		const caps = manager.capabilities('user-x');
		assert.equal(caps.engine, 'fnbr');
		assert.equal(caps.capabilities.realtimeCosmetics, true);
	});

	it('reports honest fnlb capabilities while offline', () => {
		const { manager } = managerWithFake();
		manager.get('user-x').configuredMode = 'fnlb';
		const caps = manager.capabilities('user-x');
		assert.equal(caps.engine, 'fnlb');
		assert.equal(caps.capabilities.realtimeCosmetics, false, 'FNLB live cosmetics must not be claimed');
		assert.equal(caps.capabilities.friendMessages, false);
	});
});
