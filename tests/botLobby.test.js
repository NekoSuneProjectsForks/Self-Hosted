import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalFnbrRuntime } from '../src/runtime/LocalFnbrRuntime.js';
import { RuntimeManager } from '../src/runtime/RuntimeManager.js';

/**
 * Bot Lobby: extra bot routing, mutual trust, joining the main lobby and the
 * friend-DM commands. Fake fnbr clients only, no Epic account.
 */

function fakeIo() {
	const emitted = [];
	return { emitted, to: () => ({ emit: (event, payload) => emitted.push({ event, payload }) }) };
}

function fakeClient(id, { partyId = `party-${id}`, privacy = 'public' } = {}) {
	const calls = [];
	const client = {
		isReady: true,
		calls,
		user: { self: { id, displayName: id }, blocklist: new Map() },
		friend: {
			list: new Map(),
			pendingList: new Map(),
			add: async (target) => calls.push(['add', target]),
			sendMessage: async (target, content) => calls.push(['dm', target, content]),
			resolve: (target) => client.friend.list.get(target),
			resolvePending: (target) => client.friend.pendingList.get(target)
		},
		party: {
			id: partyId,
			size: 1,
			maxSize: 16,
			privacy,
			members: new Map([[id, { id }]]),
			me: {
				isLeader: true,
				setOutfit: async (item) => calls.push(['setOutfit', item]),
				setEmote: async (item) => calls.push(['setEmote', item]),
				setReadiness: async (ready) => calls.push(['setReadiness', ready])
			}
		},
		joinParty: async (target) => calls.push(['joinParty', target]),
		invite: async (target) => calls.push(['invite', target]),
		leaveParty: async () => calls.push(['leaveParty']),
		setStatus: () => {}
	};
	return client;
}

function runtimeFor(client, options = {}) {
	const runtime = new LocalFnbrRuntime({
		userId: 'user-1',
		startConfig: { defaultStatus: 'Lobby', localCategory: { config: options.config || {} } },
		appendLog: () => {},
		emit: () => {},
		trustedIds: options.trustedIds,
		onFriendMessage: options.onFriendMessage
	});
	runtime.client = client;
	return runtime;
}

function managerWithMainAndHelper() {
	const manager = new RuntimeManager(fakeIo());
	manager.appendLog = () => {};
	manager.emitHelpers = () => {};

	const mainClient = fakeClient('main-bot');
	const main = runtimeFor(mainClient);
	const runtime = manager.get('user-1');
	runtime.adapter = main;
	runtime.status = 'online';
	runtime.activeMode = 'fnbr';

	const helperClient = fakeClient('helper-bot');
	const helper = runtimeFor(helperClient);
	const entry = manager.helperEntry('user-1', { id: 'acc-1', label: 'Bot 2', accountId: 'helper-bot' });
	entry.adapter = helper;
	entry.status = 'online';

	return { manager, main, mainClient, helper, helperClient, entry };
}

describe('Bot Lobby routing', () => {
	it('routes a helper botId to the helper and everything else to the main bot', () => {
		const { manager, main, helper } = managerWithMainAndHelper();
		assert.equal(manager.requireActive('user-1', 'helper-bot'), helper);
		assert.equal(manager.requireActive('user-1', 'main-bot'), main);
		assert.equal(manager.requireActive('user-1'), main);
		assert.equal(manager.requireActive('user-1', 'some-fnlb-bot'), main);
	});

	it('refuses an offline helper with 409 instead of falling back to the main bot', () => {
		const { manager, entry } = managerWithMainAndHelper();
		entry.status = 'offline';
		entry.adapter = null;
		assert.throws(() => manager.requireActive('user-1', 'helper-bot'), (error) => error.status === 409);
	});

	it('trusts every bot the user runs', () => {
		const { manager } = managerWithMainAndHelper();
		assert.deepEqual(manager.allBotIds('user-1').sort(), ['helper-bot', 'main-bot']);
	});
});

describe('Bot Lobby joining the main lobby', () => {
	it('joins directly when the main party is joinable', async () => {
		const { manager, helperClient } = managerWithMainAndHelper();
		helperClient.joinParty = async (partyId) => {
			helperClient.calls.push(['joinParty', partyId]);
			helperClient.party.id = partyId;
		};
		const result = await manager.joinHelperToMain('user-1', 'acc-1');
		assert.deepEqual(helperClient.calls[0], ['joinParty', 'party-main-bot']);
		assert.match(result.content, /joined the main lobby/);
	});

	it('falls back to friend + invite when a direct join is refused', async () => {
		const { manager, mainClient, helperClient } = managerWithMainAndHelper();
		helperClient.joinParty = async () => {
			throw new Error('PartyPermissionError');
		};
		// Already friends, so only the invite is needed; the helper "accepts".
		mainClient.friend.list.set('helper-bot', { id: 'helper-bot' });
		mainClient.invite = async (target) => {
			mainClient.calls.push(['invite', target]);
			helperClient.party.id = mainClient.party.id;
		};
		await manager.joinHelperToMain('user-1', 'acc-1');
		assert.deepEqual(mainClient.calls.at(-1), ['invite', 'helper-bot']);
	});

	it('does nothing when the helper is already there', async () => {
		const { manager, mainClient, helperClient } = managerWithMainAndHelper();
		helperClient.party.id = mainClient.party.id;
		const result = await manager.joinHelperToMain('user-1', 'acc-1');
		assert.match(result.content, /already/);
		assert.equal(helperClient.calls.length, 0);
	});

	it('refuses when the main lobby is full', async () => {
		const { manager, mainClient } = managerWithMainAndHelper();
		mainClient.party.size = 16;
		await assert.rejects(manager.joinHelperToMain('user-1', 'acc-1'), (error) => error.status === 409);
	});
});

describe('joinParty by friend', () => {
	it("joins a friend's party from their presence", async () => {
		const client = fakeClient('bot');
		client.friend.list.set('Friend', { id: 'f1', displayName: 'Friend', party: { id: 'their-party' } });
		const runtime = runtimeFor(client);
		await runtime.joinParty('Friend');
		assert.deepEqual(client.calls[0], ['joinParty', 'their-party']);
	});

	it('sends a join request when the friend party is not visible', async () => {
		const client = fakeClient('bot');
		let requested = false;
		client.friend.list.set('Friend', {
			id: 'f1',
			displayName: 'Friend',
			sendJoinRequest: async () => {
				requested = true;
			}
		});
		const result = await runtimeFor(client).joinParty('Friend');
		assert.equal(requested, true);
		assert.match(result.content, /join request/);
	});

	it('treats anything that is not a friend as a party ID', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).joinParty('raw-party-id');
		assert.deepEqual(client.calls[0], ['joinParty', 'raw-party-id']);
	});
});

describe('friend DM commands', () => {
	const dm = (content, id = 'friend-1') => ({ author: { id, displayName: 'Friend' }, content });

	it('equips a CID sent by a friend and replies', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).handleDmCommand(dm('CID_029_Athena_Commando_F_Halloween'));
		assert.deepEqual(client.calls[0], ['setOutfit', 'CID_029_Athena_Commando_F_Halloween']);
		assert.equal(client.calls[1][0], 'dm');
	});

	it('handles !ready', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).handleDmCommand(dm('!ready'));
		assert.deepEqual(client.calls[0], ['setReadiness', true]);
	});

	it('ignores ordinary chat', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).handleDmCommand(dm('hello there'));
		assert.equal(client.calls.length, 0);
	});

	it('ignores the user\'s own bots so two bots never loop', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client, { trustedIds: () => ['other-bot'] }).handleDmCommand(dm('!ready', 'other-bot'));
		assert.equal(client.calls.length, 0);
	});

	it('can be switched off with dmCommands: false', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client, { config: { dmCommands: false } }).handleDmCommand(dm('!ready'));
		assert.equal(client.calls.length, 0);
	});
});

describe('auto-ready', () => {
	function lobby({ humans, trusted = [], config = {} }) {
		const client = fakeClient('bot');
		client.party.me.id = 'bot';
		client.party.me.isReady = false;
		client.party.me.setReadiness = async (ready) => {
			client.calls.push(['setReadiness', ready]);
			client.party.me.isReady = ready;
		};
		client.party.members = new Map([['bot', client.party.me], ...humans.map((m) => [m.id, m])]);
		const runtime = runtimeFor(client, { trustedIds: () => trusted, config });
		return { client, runtime };
	}
	const settle = () => new Promise((resolve) => setImmediate(resolve));

	it('readies once every player is ready', async () => {
		const { client, runtime } = lobby({ humans: [{ id: 'p1', isReady: true }, { id: 'p2', isReady: true }] });
		runtime.syncReadiness();
		await settle();
		assert.deepEqual(client.calls, [['setReadiness', true]]);
	});

	it('waits while a player is not ready', async () => {
		const { client, runtime } = lobby({ humans: [{ id: 'p1', isReady: true }, { id: 'p2', isReady: false }] });
		runtime.syncReadiness();
		await settle();
		assert.equal(client.calls.length, 0);
	});

	it('ignores the user\'s other bots when deciding', async () => {
		const { client, runtime } = lobby({
			humans: [{ id: 'p1', isReady: true }, { id: 'other-bot', isReady: false }],
			trusted: ['other-bot']
		});
		runtime.syncReadiness();
		await settle();
		assert.deepEqual(client.calls, [['setReadiness', true]]);
	});

	it('does nothing in a lobby with no players', async () => {
		const { client, runtime } = lobby({ humans: [{ id: 'other-bot', isReady: true }], trusted: ['other-bot'] });
		runtime.syncReadiness();
		await settle();
		assert.equal(client.calls.length, 0);
	});

	it('unreadies when a player backs out, but keeps a manual !ready', async () => {
		const player = { id: 'p1', isReady: true };
		const { client, runtime } = lobby({ humans: [player] });
		runtime.syncReadiness();
		await settle();
		player.isReady = false;
		runtime.syncReadiness();
		await settle();
		assert.deepEqual(client.calls.at(-1), ['setReadiness', false]);

		await runtime.setReadiness(true); // manual
		runtime.syncReadiness();
		await settle();
		assert.deepEqual(client.calls.at(-1), ['setReadiness', true]);
	});

	it('can be switched off', async () => {
		const { client, runtime } = lobby({ humans: [{ id: 'p1', isReady: true }], config: { autoReady: false } });
		runtime.syncReadiness();
		await settle();
		assert.equal(client.calls.length, 0);
	});
});

describe('lobby chat commands', () => {
	const chat = (content, id = 'p1') => ({ author: { id }, content });

	it('!ready in lobby chat readies the bot', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).handlePartyCommand(chat('!ready'));
		assert.deepEqual(client.calls[0], ['setReadiness', true]);
	});

	it('ignores its own and the user\'s other bots\' messages', async () => {
		const client = fakeClient('bot');
		const runtime = runtimeFor(client, { trustedIds: () => ['other-bot'] });
		await runtime.handlePartyCommand(chat('!ready', 'bot'));
		await runtime.handlePartyCommand(chat('!ready', 'other-bot'));
		assert.equal(client.calls.length, 0);
	});
});

describe('player stats', () => {
	it('returns overall stats from Epic', async () => {
		const client = fakeClient('bot');
		client.getBRStats = async (id) => ({
			user: { id, displayName: 'Player' },
			stats: { all: { overall: { matches: 10, wins: 2, kills: 30, kd: 3.75 } } }
		});
		const stats = await runtimeFor(client).getStats('p1');
		assert.equal(stats.overall.wins, 2);
		assert.equal(stats.overall.kills, 30);
		assert.equal(stats.source, 'epic_stats');
	});

	it('reports private stats as 403', async () => {
		const client = fakeClient('bot');
		client.getBRStats = async () => {
			const error = new Error('The user has set their stats to private');
			error.name = 'StatsPrivacyError';
			throw error;
		};
		await assert.rejects(runtimeFor(client).getStats('p1'), (error) => error.status === 403);
	});
});
