import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { PresenceProbe, diffPresence, stompBody } from '../src/runtime/presenceProbe.js';

const NS = 'deployment-1';

function frame(body) {
	return `MESSAGE\ndestination:x\n\n${JSON.stringify(body)}\0`;
}

function presenceUpdate(accountId, props, activity = 'Battle Royale Lobby') {
	return frame({
		type: 'presence.v1.UPDATE',
		payload: { accountId, status: 'online', perNs: [{ ns: NS, status: 'online', activity: { value: activity }, props }] }
	});
}

/** Minimal stand-in for fnbr's Client with a STOMP socket that can be replaced. */
function fakeClient() {
	const stomp = {
		connection: new EventEmitter(),
		patched: [],
		async patchPresence(activity, props, status) {
			this.patched.push({ activity, props, status });
		},
		async connect() {
			this.connection = new EventEmitter();
		}
	};
	return { stomp, config: { eosDeploymentId: NS } };
}

describe('PresenceProbe', () => {
	it('records what the bot publishes without changing it', async () => {
		const client = fakeClient();
		const probe = new PresenceProbe();
		probe.install(client);

		await client.stomp.patchPresence('Lobby - 1 / 16', { EOS_Platform: 'PSN' }, 'online');

		assert.deepEqual(client.stomp.patched, [{ activity: 'Lobby - 1 / 16', props: { EOS_Platform: 'PSN' }, status: 'online' }]);
		assert.equal(probe.sent.activity, 'Lobby - 1 / 16');
		assert.deepEqual(probe.sent.props, { EOS_Platform: 'PSN' });
	});

	it('records raw friend presence from STOMP, including after a reconnect', async () => {
		const client = fakeClient();
		const probe = new PresenceProbe();
		probe.install(client);

		client.stomp.connection.emit('message', presenceUpdate('friend-1', { EOS_Platform: 'PS5' }));
		assert.deepEqual(probe.received.get('friend-1').props, { EOS_Platform: 'PS5' });

		await client.stomp.connect();
		client.stomp.connection.emit('message', presenceUpdate('friend-2', { EOS_Platform: 'WIN' }));
		assert.deepEqual(probe.received.get('friend-2').props, { EOS_Platform: 'WIN' });
	});

	it('ignores frames that are not presence updates', () => {
		const client = fakeClient();
		const probe = new PresenceProbe();
		probe.install(client);
		client.stomp.connection.emit('message', 'CONNECTED\nversion:1.2\n\n\0');
		client.stomp.connection.emit('message', frame({ type: 'social.chat.v1.NEW_WHISPER', payload: {} }));
		assert.equal(probe.received.size, 0);
	});

	it('compares the bot against a recorded friend', async () => {
		const client = fakeClient();
		const probe = new PresenceProbe();
		probe.install(client);
		await client.stomp.patchPresence('Lobby', { EOS_Platform: 'PSN', EOS_ProductVersion: 'CL-0', FortLFG: 'i0' });
		client.stomp.connection.emit(
			'message',
			presenceUpdate('friend-1', { EOS_Platform: 'PSN', EOS_ProductVersion: 'CL-1', SessionIdAttributeKey: 'sabc' })
		);

		const result = probe.compare('friend-1');
		assert.deepEqual(result.recordedFriends, ['friend-1']);
		assert.deepEqual(result.diff, {
			onlyFriend: ['SessionIdAttributeKey'],
			onlyBot: ['FortLFG'],
			different: [{ key: 'EOS_ProductVersion', bot: 'CL-0', friend: 'CL-1' }]
		});
	});
});

describe('presence helpers', () => {
	it('parses a STOMP frame body', () => {
		assert.deepEqual(stompBody(frame({ a: 1 })), { a: 1 });
		assert.equal(stompBody('no body'), null);
		assert.equal(stompBody('MESSAGE\n\nnot json\0'), null);
	});

	it('diffs empty presences safely', () => {
		assert.deepEqual(diffPresence(null, undefined), { onlyFriend: [], onlyBot: [], different: [] });
	});
});
