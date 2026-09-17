import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuntimeManager } from '../src/runtime/RuntimeManager.js';

function fakeIo() {
	return { to: () => ({ emit: () => {} }) };
}

class StoppableAdapter {
	constructor(engine = 'fnbr') {
		this.engine = engine;
		this.stopped = false;
	}
	async start() {}
	async stop() {
		this.stopped = true;
	}
	botId() {
		return 'bot-1';
	}
	getCapabilities() {
		return { engine: this.engine, capabilities: {} };
	}
}

const config = {
	runtimeMode: 'fnbr',
	deviceAuth: { accountId: 'a', deviceId: 'd', secret: 's' },
	platform: 'WIN',
	defaultStatus: 'Lobby',
	restartInterval: 3600,
	localCategory: { config: {} }
};

describe('graceful shutdown', () => {
	it('stops every running runtime', async () => {
		const manager = new RuntimeManager(fakeIo());
		manager.appendLog = () => {};

		const adapters = [];
		manager.createAdapter = () => {
			const adapter = new StoppableAdapter();
			adapters.push(adapter);
			return adapter;
		};

		await manager.start({ id: 'u1', status: 'active' }, config);
		await manager.start({ id: 'u2', status: 'active' }, config);
		assert.equal(adapters.length, 2);

		await manager.stopAll();

		assert.ok(
			adapters.every((a) => a.stopped),
			'every adapter must be stopped before the process exits'
		);
		assert.equal(manager.serialize('u1').status, 'offline');
		assert.equal(manager.serialize('u2').status, 'offline');
		assert.equal(manager.serialize('u1').activeMode, null);
	});

	it('clears the restart timer on stop so nothing fires after shutdown', async () => {
		const manager = new RuntimeManager(fakeIo());
		manager.appendLog = () => {};
		manager.createAdapter = () => new StoppableAdapter();

		await manager.start({ id: 'u3', status: 'active' }, { ...config, restartInterval: 60 });
		assert.ok(manager.get('u3').restartTimer, 'a restart timer should have been scheduled');

		await manager.stop('u3');
		assert.equal(manager.get('u3').restartTimer, null);
	});

	it('is safe to call when nothing is running', async () => {
		const manager = new RuntimeManager(fakeIo());
		manager.appendLog = () => {};
		await manager.stopAll();
		await manager.stop('never-started');
		assert.equal(manager.serialize('never-started').status, 'offline');
	});
});
