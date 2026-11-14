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
		runtime.readyDelayMs = 5;
		return { client, runtime };
	}
	const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

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

describe('auto-ready event timing (fnbr emits before updating)', () => {
	it('reacts to the new value, not the stale one fnbr still holds during the event', async () => {
		const { EventEmitter } = await import('node:events');
		const client = Object.assign(new EventEmitter(), fakeClient('bot'));
		client.party.me.id = 'bot';
		client.party.me.isReady = false;
		client.party.me.setReadiness = async (ready) => {
			client.calls.push(['setReadiness', ready]);
			client.party.me.isReady = ready;
		};
		const player = { id: 'p1', isReady: false };
		client.party.members = new Map([['bot', client.party.me], ['p1', player]]);
		const runtime = runtimeFor(client);
		runtime.readyDelayMs = 5;
		runtime.bindEvents(client);

		// Exactly what fnbr does: emit while the member still has the OLD state,
		// then apply the update.
		const playerReadies = () => {
			client.emit('party:member:readiness:updated', player, true, false);
			player.isReady = true;
		};
		const playerUnreadies = () => {
			client.emit('party:member:readiness:updated', player, false, true);
			player.isReady = false;
		};

		playerReadies();
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.deepEqual(client.calls.filter((c) => c[0] === 'setReadiness'), [['setReadiness', true]], 'bot readies after the player readies');

		playerUnreadies();
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.deepEqual(client.calls.filter((c) => c[0] === 'setReadiness').at(-1), ['setReadiness', false], 'bot unreadies after the player unreadies');
	});

	it('does not ready while the squad is only partly ready', async () => {
		const client = fakeClient('bot');
		client.party.me.id = 'bot';
		client.party.me.isReady = false;
		client.party.me.setReadiness = async (ready) => client.calls.push(['setReadiness', ready]);
		client.party.members = new Map([
			['bot', client.party.me],
			['p1', { id: 'p1', isReady: true }],
			['p2', { id: 'p2', isReady: true }],
			['p3', { id: 'p3', isReady: false }]
		]);
		const runtime = runtimeFor(client);
		runtime.readyDelayMs = 5;
		runtime.syncReadiness();
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(client.calls.length, 0);
	});
});

describe('loadout', () => {
	it('equips only the slots given, so the outfit is never reset', async () => {
		const client = fakeClient('bot');
		client.party.me.setBackpack = async (id) => client.calls.push(['setBackpack', id]);
		client.party.me.setPickaxe = async (id) => client.calls.push(['setPickaxe', id]);
		const result = await runtimeFor(client).setLoadout({ backpack: 'BID_1', pickaxe: 'Pickaxe_ID_2' });
		assert.deepEqual(client.calls, [['setBackpack', 'BID_1'], ['setPickaxe', 'Pickaxe_ID_2']]);
		assert.equal(result.applied.length, 2);
	});

	it('plays the emote last, after the outfit', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client).setLoadout({ emote: 'EID_Floss', outfit: 'CID_1' });
		assert.deepEqual(client.calls.map((c) => c[0]), ['setOutfit', 'setEmote']);
	});

	it('reports items Epic rejects without failing the rest', async () => {
		const client = fakeClient('bot');
		client.party.me.setBackpack = async () => {
			throw new Error('not owned');
		};
		const result = await runtimeFor(client).setLoadout({ outfit: 'CID_1', backpack: 'BID_x' });
		assert.equal(result.applied.length, 1);
		assert.equal(result.failed[0].slot, 'backpack');
	});
});

describe('profile (battle pass, banner, crowns)', () => {
	async function profileClient() {
		const client = fakeClient('bot');
		client.party.me.meta = { battlepass: { bHasPurchasedPass: false, passLevel: 1 } };
		client.party.me.banner = { bannerIconId: 'BRSeason01', bannerColorId: 'defaultcolor1' };
		client.party.me.setBattlePass = async (owned, level) => client.calls.push(['setBattlePass', owned, level]);
		client.party.me.setBanner = async (id, color) => client.calls.push(['setBanner', id, color]);
		client.party.me.setCosmeticStats = async (crowns, ranked) => client.calls.push(['setCosmeticStats', crowns, ranked]);
		return client;
	}

	it('sets battle pass level 100 and keeps ownership unless told', async () => {
		const client = await profileClient();
		await runtimeFor(client).setProfile({ battlePassLevel: '100' });
		assert.deepEqual(client.calls, [['setBattlePass', false, 100]]);
	});

	it('changes only the banner colour when only that is given', async () => {
		const client = await profileClient();
		await runtimeFor(client).setProfile({ bannerColor: 'defaultcolor15' });
		assert.deepEqual(client.calls, [['setBanner', 'BRSeason01', 'defaultcolor15']]);
	});

	it('sets crowns', async () => {
		const client = await profileClient();
		await runtimeFor(client).setProfile({ crowns: 50 });
		assert.deepEqual(client.calls, [['setCosmeticStats', 50, 0]]);
	});

	it('rejects nonsense and empty edits', async () => {
		const client = await profileClient();
		await assert.rejects(runtimeFor(client).setProfile({ battlePassLevel: 'abc' }), (error) => error.status === 400);
		await assert.rejects(runtimeFor(client).setProfile({}), (error) => error.status === 400);
	});
});

describe('join defaults', () => {
	function defaultsRuntime(config) {
		const client = fakeClient('bot');
		client.party.me.isLeader = false;
		client.party.setPrivacy = async () => client.calls.push(['setPrivacy']);
		client.party.me.setBattlePass = async (owned, level) => client.calls.push(['setBattlePass', owned, level]);
		client.party.me.meta = {};
		const runtime = runtimeFor(client, { config });
		runtime.defaultsDelayMs = 5;
		runtime.defaultsPartyId = client.party.id;
		return { client, runtime };
	}
	const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

	it('re-applies the default look when the bot lands in a different party', async () => {
		const { client, runtime } = defaultsRuntime({ startOutfit: [{ id: 'CID_DEFAULT' }], battlePassLevel: 100, battlePassPurchased: true });
		client.party.id = 'someone-elses-party';
		runtime.checkNewParty();
		await wait();
		assert.deepEqual(client.calls.find((c) => c[0] === 'setOutfit'), ['setOutfit', 'CID_DEFAULT']);
		assert.deepEqual(client.calls.find((c) => c[0] === 'setBattlePass'), ['setBattlePass', true, 100]);
	});

	it('leaves live edits alone while the bot stays in the same party', async () => {
		const { client, runtime } = defaultsRuntime({ startOutfit: [{ id: 'CID_DEFAULT' }] });
		runtime.checkNewParty();
		await wait();
		assert.equal(client.calls.length, 0);
	});

	it("does not try to set privacy in someone else's party", async () => {
		const { client, runtime } = defaultsRuntime({ privacy: 'private', startOutfit: [{ id: 'CID_DEFAULT' }] });
		await runtime.applyCategory(runtime.startConfig.localCategory.config);
		assert.equal(client.calls.some((c) => c[0] === 'setPrivacy'), false);
	});
});

describe('emotes play once', () => {
	function emoteClient(config) {
		const client = fakeClient('bot');
		client.party.me.emote = null;
		client.party.me.setEmote = async (id) => {
			client.calls.push(['setEmote', id]);
			client.party.me.emote = id;
		};
		client.party.me.clearEmote = async () => {
			client.calls.push(['clearEmote']);
			client.party.me.emote = null;
		};
		return { client, runtime: runtimeFor(client, { config }) };
	}
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	it('stops the emote after its length by default', async () => {
		const { client, runtime } = emoteClient({ emoteSeconds: 1 });
		await runtime.setCosmetic('emote', 'EID_Floss');
		assert.deepEqual(client.calls, [['setEmote', 'EID_Floss']]);
		await wait(1100);
		assert.deepEqual(client.calls.at(-1), ['clearEmote']);
	});

	it('loops when play-once is switched off', async () => {
		const { client, runtime } = emoteClient({ emotePlayOnce: false, emoteSeconds: 1 });
		await runtime.setCosmetic('emote', 'EID_Floss');
		await wait(1100);
		assert.equal(client.calls.some((c) => c[0] === 'clearEmote'), false);
	});

	it('a new emote restarts the timer instead of cutting it short', async () => {
		const { client, runtime } = emoteClient({ emoteSeconds: 1 });
		await runtime.setCosmetic('emote', 'EID_A');
		await wait(600);
		await runtime.setCosmetic('emote', 'EID_B');
		await wait(600);
		assert.equal(client.calls.some((c) => c[0] === 'clearEmote'), false, 'not cleared 0.6 s into the second emote');
		await wait(500);
		assert.deepEqual(client.calls.at(-1), ['clearEmote']);
	});
});
