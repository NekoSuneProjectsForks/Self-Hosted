import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalFnbrRuntime, islandOf, followedMatchmakingData } from '../src/runtime/LocalFnbrRuntime.js';
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
	manager.engineAccess = async () => true;
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
		const runtime = runtimeFor(client, { trustedIds: () => trusted, config: { botsSitOut: false, ...config } });
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

	it('!ready in lobby chat readies the bot when sit-out is off', async () => {
		const client = fakeClient('bot');
		await runtimeFor(client, { config: { botsSitOut: false } }).handlePartyCommand(chat('!ready'));
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
		const runtime = runtimeFor(client, { config: { botsSitOut: false } });
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
		const runtime = runtimeFor(client, { config: { botsSitOut: false } });
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

describe('copy a player\'s look', () => {
	function partyWithPlayer(player) {
		const client = fakeClient('bot');
		client.party.me.setBackpack = async (id) => client.calls.push(['setBackpack', id]);
		client.party.me.setPickaxe = async (id) => client.calls.push(['setPickaxe', id]);
		client.party.me.setShoes = async (id) => client.calls.push(['setShoes', id]);
		client.party.me.setBattlePass = async (owned, level) => client.calls.push(['setBattlePass', owned, level]);
		client.party.me.setBanner = async (id, color) => client.calls.push(['setBanner', id, color]);
		client.party.me.meta = {};
		client.party.members = new Map([['bot', { id: 'bot' }], [player.id, player]]);
		return client;
	}

	it('copies outfit, back bling, pickaxe, kicks, level and banner', async () => {
		const client = partyWithPlayer({
			id: 'p1',
			displayName: 'NekoSuneVR',
			outfit: 'Character_FeelUnionSki',
			backpack: 'Backpack_FeelUnionSki',
			pickaxe: 'Pickaxe_FeelUnionSki',
			shoes: 'Shoes_HeatShineTorn',
			battlepass: { passLevel: 212, bHasPurchasedPass: true },
			banner: { bannerIconId: 'BRSeason01', bannerColorId: 'defaultcolor15' }
		});
		const result = await runtimeFor(client).copyMember('NekoSuneVR');
		assert.deepEqual(client.calls.map((c) => c[0]), ['setOutfit', 'setBackpack', 'setPickaxe', 'setShoes', 'setBattlePass', 'setBanner']);
		assert.deepEqual(client.calls.find((c) => c[0] === 'setBattlePass'), ['setBattlePass', true, 212]);
		assert.match(result.content, /Copied NekoSuneVR's look/);
	});

	it('only copies the slots the player actually has', async () => {
		const client = partyWithPlayer({ id: 'p1', displayName: 'P', outfit: 'CID_1' });
		await runtimeFor(client).copyMember('p1', { profile: false });
		assert.deepEqual(client.calls, [['setOutfit', 'CID_1']]);
	});

	it('refuses players not in the party, and itself', async () => {
		const client = partyWithPlayer({ id: 'p1', outfit: 'CID_1' });
		const runtime = runtimeFor(client);
		await assert.rejects(runtime.copyMember('ghost'), (error) => error.status === 404);
		await assert.rejects(runtime.copyMember('bot'), (error) => error.status === 400);
	});

	it('!copy in lobby chat copies the sender', async () => {
		const client = partyWithPlayer({ id: 'p1', displayName: 'P', outfit: 'CID_9' });
		await runtimeFor(client).handlePartyCommand({ author: { id: 'p1' }, content: '!copy' });
		assert.deepEqual(client.calls[0], ['setOutfit', 'CID_9']);
	});
});

describe('sit-out mode (opt-in)', () => {
	function sitOutClient() {
		const client = fakeClient('bot');
		client.party.me.id = 'bot';
		client.party.me.isSittingOut = false;
		client.party.me.isReady = false;
		client.party.me.setSittingOut = async (value) => {
			client.calls.push(['setSittingOut', value]);
			client.party.me.isSittingOut = value;
		};
		client.party.me.setReadiness = async (value) => client.calls.push(['setReadiness', value]);
		client.party.sendMessage = async (text) => client.calls.push(['partyMessage', text]);
		client.party.members = new Map([['bot', client.party.me], ['p1', { id: 'p1', isReady: true }]]);
		return client;
	}
	const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

	it('sits out instead of readying when everyone is ready', async () => {
		const client = sitOutClient();
		runtimeFor(client, { config: { botsSitOut: true } }).syncReadiness();
		await wait();
		assert.deepEqual(client.calls, [['setSittingOut', true]]);
	});

	it('never readies in sit-out mode', async () => {
		const client = sitOutClient();
		const runtime = runtimeFor(client, { config: { botsSitOut: true } });
		runtime.readyDelayMs = 1;
		runtime.syncReadiness();
		await wait();
		runtime.syncReadiness();
		await wait();
		assert.equal(client.calls.some((c) => c[0] === 'setReadiness'), false);
	});

	it('sits out when it lands in a new party', async () => {
		const client = sitOutClient();
		client.party.me.meta = {};
		await runtimeFor(client, { config: { botsSitOut: true } }).applyCategory({});
		assert.deepEqual(client.calls[0], ['setSittingOut', true]);
	});

	it('respects a manual "stop sitting out" until the bot changes party', async () => {
		const client = sitOutClient();
		const runtime = runtimeFor(client, { config: { botsSitOut: true } });
		await runtime.setSittingOut(false);
		runtime.syncReadiness();
		await wait();
		assert.deepEqual(client.calls, [['setSittingOut', false]]);
	});

	it('!ready in lobby chat explains instead of readying', async () => {
		const client = sitOutClient();
		await runtimeFor(client, { config: { botsSitOut: true } }).handlePartyCommand({ author: { id: 'p1' }, content: '!ready' });
		assert.equal(client.calls[0][0], 'partyMessage');
		assert.equal(client.calls.some((c) => c[0] === 'setReadiness'), false);
	});
});

describe('FNLB-style matchmaking', () => {
	function readyLobby({ playlistId = 'Playlist_DefaultDuo', leader = false, extraBots = [], players = 1 } = {}) {
		const client = fakeClient('bot');
		client.party.me.id = 'bot';
		client.party.me.isLeader = leader;
		client.party.me.isReady = false;
		client.party.me.setReadiness = async (ready) => {
			client.calls.push(['setReadiness', ready]);
			client.party.me.isReady = ready;
		};
		client.party.playlist = { linkId: { mnemonic: playlistId } };
		client.party.setPlaylist = async (id) => client.calls.push(['setPlaylist', id]);
		client.party.sendMessage = async (text) => client.calls.push(['partyMessage', text]);
		client.leaveParty = async () => client.calls.push(['leaveParty']);
		const members = [['bot', client.party.me]];
		for (let i = 1; i <= players; i += 1) members.push([`p${i}`, { id: `p${i}`, isReady: true }]);
		for (const id of extraBots) members.push([id, { id, isReady: false }]);
		client.party.members = new Map(members);
		const runtime = runtimeFor(client, { trustedIds: () => extraBots });
		runtime.readyDelayMs = 1;
		return { client, runtime };
	}
	const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

	it('readies with the players on Duos (the FNLB flow)', async () => {
		const { client, runtime } = readyLobby();
		runtime.syncReadiness();
		await wait();
		assert.deepEqual(client.calls, [['setReadiness', true]]);
	});

	it('on Solo as leader: switches to Duos instead of readying', async () => {
		const { client, runtime } = readyLobby({ playlistId: 'Playlist_DefaultSolo', leader: true });
		runtime.syncReadiness();
		await wait();
		assert.deepEqual(client.calls, [['setPlaylist', 'Playlist_DefaultDuo']]);
	});

	it('on Solo with 3 players picks Squads; Zero Build maps too', async () => {
		const { teamPlaylistFor } = await import('../src/runtime/LocalFnbrRuntime.js');
		assert.equal(teamPlaylistFor('Playlist_DefaultSolo', 4), 'Playlist_DefaultSquad');
		assert.equal(teamPlaylistFor('Playlist_NoBuildBR_Solo', 2), 'Playlist_NoBuildBR_Duo');
		assert.equal(teamPlaylistFor('Playlist_SomeLTM_Solo', 2), null);
	});

	it('on Solo when a player leads: explains once in chat, does not ready', async () => {
		const { client, runtime } = readyLobby({ playlistId: 'Playlist_DefaultSolo' });
		runtime.syncReadiness();
		runtime.syncReadiness();
		await wait();
		const messages = client.calls.filter((c) => c[0] === 'partyMessage');
		assert.equal(messages.length, 1);
		assert.match(messages[0][1], /Solo can't start with a bot/);
		assert.equal(client.calls.some((c) => c[0] === 'setReadiness'), false);
	});

	it('with two of your bots, only one goes along; the other leaves', async () => {
		const first = readyLobby({ extraBots: ['zzz-bot'] }); // 'bot' sorts first: it stays
		first.runtime.syncReadiness();
		await wait();
		assert.deepEqual(first.client.calls, [['setReadiness', true]]);

		const second = readyLobby({ extraBots: ['aaa-bot'] }); // 'aaa-bot' sorts first: this one leaves
		second.runtime.syncReadiness();
		await wait();
		assert.equal(second.client.calls.some((c) => c[0] === 'leaveParty'), true);
		assert.equal(second.client.calls.some((c) => c[0] === 'setReadiness'), false);
	});

	it('leaves when a player loads into the match, then rejoins them after', async () => {
		const { client, runtime } = readyLobby();
		runtime.leaveDelayMs = 1;
		client.party.leader = { id: 'p1' };
		runtime.onMemberMatchState({ id: 'p1' }, { location: 'InGame' });
		await wait();
		assert.equal(client.calls.some((c) => c[0] === 'leaveParty'), true);

		// Still playing: no rejoin.
		runtime.onFriendPresence({ friend: { id: 'p1', party: { id: 'their-party' } }, isPlaying: true });
		assert.equal(client.calls.some((c) => c[0] === 'joinParty'), false);
		// Back in the lobby: rejoin.
		runtime.onFriendPresence({ friend: { id: 'p1', displayName: 'P', party: { id: 'their-party' } }, isPlaying: false });
		await wait();
		assert.deepEqual(client.calls.find((c) => c[0] === 'joinParty'), ['joinParty', 'their-party']);
	});

	it('ignores match changes of your own bots', async () => {
		const { client, runtime } = readyLobby({ extraBots: ['other-bot'] });
		runtime.leaveDelayMs = 1;
		runtime.onMemberMatchState({ id: 'other-bot' }, { location: 'InGame' });
		await wait();
		assert.equal(client.calls.some((c) => c[0] === 'leaveParty'), false);
	});
});

describe('Fortnite build (netCL)', () => {
	function buildClient({ partyBuild = '1:3:', fetched = '1:3:51234567', size = 1 } = {}) {
		const client = fakeClient('bot');
		client.config = { partyBuildId: '1:3:' };
		client.party.size = size;
		client.party.meta = { get: (key) => (key === 'urn:epic:cfg:build-id_s' ? partyBuild : '') };
		client.fetchPartyBuildId = async () => {
			if (!fetched) throw new Error('Matchmaking response did not contain a party build ID');
			client.config.partyBuildId = fetched;
			return fetched;
		};
		client.leaveParty = async (createNew) => client.calls.push(['leaveParty', createNew]);
		client.setStatus = () => client.calls.push(['setStatus']);
		const runtime = runtimeFor(client);
		runtime.health = {};
		return { client, runtime };
	}

	it('normalizes build IDs', async () => {
		const { normalizeBuildId } = await import('../src/runtime/LocalFnbrRuntime.js');
		assert.equal(normalizeBuildId('51234567'), '1:3:51234567');
		assert.equal(normalizeBuildId('1:3:51234567'), '1:3:51234567');
		assert.equal(normalizeBuildId('1:3:'), null);
		assert.equal(normalizeBuildId(''), null);
	});

	it("looks the build up after login and recreates the bot's own party with it", async () => {
		const { client, runtime } = buildClient();
		await runtime.ensureGameBuild();
		assert.equal(client.config.partyBuildId, '1:3:51234567');
		assert.deepEqual(client.calls.find((c) => c[0] === 'leaveParty'), ['leaveParty', true]);
		assert.equal(runtime.health.gameBuild, '1:3:51234567');
	});

	it('never recreates a party other people are in', async () => {
		const { client, runtime } = buildClient({ size: 2 });
		await runtime.ensureGameBuild();
		assert.equal(client.calls.some((c) => c[0] === 'leaveParty'), false);
	});

	it('does nothing when the party already has the right build', async () => {
		const { client, runtime } = buildClient({ partyBuild: '1:3:51234567' });
		await runtime.ensureGameBuild();
		assert.equal(client.calls.some((c) => c[0] === 'leaveParty'), false);
	});

	it('the matchmaking check flags an unknown build', async () => {
		const { client, runtime } = buildClient({ fetched: null });
		await runtime.ensureGameBuild();
		client.party.members = new Map([['bot', { id: 'bot' }]]);
		const check = runtime.matchmakingCheck();
		assert.equal(check.botBuild, null);
		assert.match(check.problems.join(' '), /does not know the Fortnite build/);
	});
});

describe("copy the leader's mode (42.x lobbies)", () => {
	class FakeMeta {
		constructor(schema) {
			this.schema = { ...schema };
		}
		get(key) {
			const value = this.schema[key];
			if (key.endsWith('_j')) return value === undefined ? {} : JSON.parse(value);
			return value ?? '';
		}
		set(key, value, isRaw = false) {
			this.schema[key] = isRaw || !key.endsWith('_j') ? String(value) : JSON.stringify(value);
			return this.schema[key];
		}
	}
	const island = (teamSize, buildMode, squadFill = 'NoFill') =>
		JSON.stringify({
			LinkId: 'playlist_br',
			MatchmakingSettingsV2: {
				'/Fortnite.com/BattleRoyale/Matchmaking:TeamSize': teamSize,
				'/Fortnite.com/BattleRoyale/Matchmaking:BuildMode': buildMode,
				'/Fortnite.com/Matchmaking:SquadFill': squadFill,
				'/Fortnite.com/Matchmaking:Region': 'EU'
			}
		});
	const mm = (teamSize, buildMode, ts) =>
		JSON.stringify({ MatchmakingInfo: { readyStatus: 'NotReady', islandSelection: { island: island(teamSize, buildMode), timestamp: ts } } });

	function lobby() {
		const client = fakeClient('bot');
		const sent = [];
		const me = client.party.me;
		me.id = 'bot';
		me.meta = new FakeMeta({ 'Default:MatchmakingInfo_j': mm('Solo', 'Build', 0), 'Default:DownloadOnDemandProgress_d': '0.000000', 'Default:LobbyState_j': JSON.stringify({ LobbyState: { hasPreloadedAthena: false } }) });
		me.sendPatch = async (patch) => sent.push(patch);
		const leader = {
			id: 'p1',
			displayName: 'NekoSuneVR',
			isLeader: true,
			meta: new FakeMeta({ 'Default:MatchmakingInfo_j': mm('Duo', 'ZeroBuild', 123), 'Default:DownloadOnDemandProgress_d': '1.000000', 'Default:LobbyState_j': JSON.stringify({ LobbyState: { hasPreloadedAthena: true } }) })
		};
		client.party.leader = leader;
		client.party.members = new Map([['bot', me], ['p1', leader]]);
		return { client, runtime: runtimeFor(client), me, leader, sent };
	}

	it("copies the leader's mode, download progress and preload flag in one patch", async () => {
		const { runtime, me, sent } = lobby();
		assert.equal(await runtime.syncFromLeader(), true);
		assert.equal(sent.length, 1);
		const mode = islandOfFor(me);
		assert.equal(mode.teamSize, 'Duo');
		assert.equal(mode.buildMode, 'ZeroBuild');
		assert.equal(sent[0]['Default:DownloadOnDemandProgress_d'], '1.000000');
		assert.match(sent[0]['Default:LobbyState_j'], /"hasPreloadedAthena":true/);
	});

	it('does nothing when already in sync', async () => {
		const { runtime, sent } = lobby();
		await runtime.syncFromLeader();
		assert.equal(await runtime.syncFromLeader(), false);
		assert.equal(sent.length, 1);
	});

	it('copies before readying, so the ready patch carries the right mode', async () => {
		const { runtime, me } = lobby();
		const order = [];
		me.sendPatch = async () => order.push('mode');
		me.setReadiness = async () => order.push('ready');
		await runtime.setReadiness(true);
		assert.deepEqual(order, ['mode', 'ready']);
	});

	it('the matchmaking check reports the mismatch before syncing', async () => {
		const { runtime } = lobby();
		const check = runtime.matchmakingCheck();
		assert.ok(check.problems.some((text) => /Mode mismatch on teamSize/.test(text)));
		assert.ok(check.differences.some((row) => row.key === 'Default:MatchmakingInfo_j'));
	});

	it('can be switched off', async () => {
		const { client, sent } = lobby();
		const runtime = runtimeFor(client, { config: { mirrorLeader: false } });
		assert.equal(await runtime.syncFromLeader(), false);
		assert.equal(sent.length, 0);
	});

	it("never republishes the leader's MatchmakingData (it crashed the leader's console)", async () => {
		const { runtime, me, leader, sent } = lobby();
		leader.meta.schema['Default:MatchmakingData1_j'] = JSON.stringify({ MatchmakingData1: { groupMemberData: { iD: 'G1', barrierBits: 268, state: 1 } } });
		const leaderInfo = JSON.parse(leader.meta.schema['Default:MatchmakingInfo_j']);
		leaderInfo.MatchmakingInfo.bHasOwnerStartedMM = true;
		leader.meta.schema['Default:MatchmakingInfo_j'] = JSON.stringify(leaderInfo);
		await runtime.syncFromLeader();
		// It publishes its own idle slot, never the leader's record.
		assert.notEqual(sent[0]['Default:MatchmakingData1_j'], leader.meta.schema['Default:MatchmakingData1_j']);
		assert.match(sent[0]['Default:MatchmakingData1_j'], /"iD":""/);
		const mine = JSON.parse(me.meta.schema['Default:MatchmakingInfo_j']).MatchmakingInfo;
		assert.equal(mine.bHasOwnerStartedMM, undefined, "the leader's queue state is not copied");
	});

	it('clears a copy left over from the earlier version', async () => {
		const { runtime, me, leader, sent } = lobby();
		const copy = JSON.stringify({ MatchmakingData1: { groupMemberData: { iD: 'G1', barrierBits: 268 } } });
		leader.meta.schema['Default:MatchmakingData1_j'] = copy;
		me.meta.schema['Default:MatchmakingData1_j'] = copy;
		assert.ok(runtime.matchmakingCheck().problems.some((text) => /copy of the leader's MatchmakingData1/.test(text)));
		await runtime.syncFromLeader();
		assert.match(sent[0]['Default:MatchmakingData1_j'], /"iD":""/);
	});

	it('fallback: leaves when the leader starts the queue (only if switched on)', async () => {
		const { client, leader } = lobby();
		client.leaveParty = async () => client.calls.push(['leaveParty']);
		const runtime = runtimeFor(client, { config: { leaveWhenQueueStarts: true } });
		const info = (started) => {
			const data = JSON.parse(leader.meta.schema['Default:MatchmakingInfo_j']);
			data.MatchmakingInfo.bHasOwnerStartedMM = started;
			leader.meta.schema['Default:MatchmakingInfo_j'] = JSON.stringify(data);
		};
		info(false);
		runtime.recordMatchmaking(leader);
		info(true);
		runtime.recordMatchmaking(leader);
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(client.calls.filter((c) => c[0] === 'leaveParty').length, 1);
		assert.equal(runtime.rejoinHostId, 'p1');
	});

	it("records the leader's matchmaking progress and Epic's failReason", async () => {
		const { runtime, leader } = lobby();
		const set = (state, failReason) =>
			(leader.meta.schema['Default:MatchmakingData1_j'] = JSON.stringify({
				MatchmakingData1: { groupMemberData: { iD: 'G1', state, barrierBits: 12, timedOutBarrierIndex: 2, failReason } }
			}));
		set(1, '');
		runtime.recordMatchmaking(leader);
		runtime.recordMatchmaking(leader); // unchanged: not recorded twice
		set(3, 'BarrierTimeout');
		runtime.recordMatchmaking(leader);
		assert.equal(runtime.mmTimeline.length, 2);
		const check = runtime.matchmakingCheck();
		assert.ok(check.problems.some((text) => /failed: BarrierTimeout/.test(text)));
	});

	function islandOfFor(member) {
		return islandOf(member);
	}
});

describe('Not ready on join', () => {
	it('drops the "Ready" fnbr carries over from the last party', async () => {
		const client = fakeClient('bot');
		client.party.me.isReady = true;
		client.lastPartyMemberMeta = { 'Default:MatchmakingInfo_j': JSON.stringify({ MatchmakingInfo: { readyStatus: 'Ready', x: 1 } }) };
		const runtime = runtimeFor(client);
		runtime.defaultsDelayMs = 60000;
		runtime.checkNewParty();
		clearTimeout(runtime.defaultsTimer);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(client.calls.filter((c) => c[0] === 'setReadiness'), [['setReadiness', false]]);
		const carried = JSON.parse(client.lastPartyMemberMeta['Default:MatchmakingInfo_j']).MatchmakingInfo;
		assert.equal(carried.readyStatus, 'NotReady');
		assert.equal(carried.x, 1);
	});
});

describe("Follow the leader's queue (experimental)", () => {
	it('echoes queue progress into its own slot, never the match or session IDs', () => {
		const leaderGroup = { iD: 'GROUP', schemaId: 2967134841, barrierBits: 268, failReason: '', timedOutBarrierIndex: 4294967295, worldSessionId: 'SESSION', matchmakingDelay: 0, playlistVersion: 0, hiddenMatchmakingDelayMax: 0, state: 1, result: 0 };
		const data = JSON.parse(followedMatchmakingData(leaderGroup)).MatchmakingData1;
		assert.equal(data.groupMemberData.iD, 'GROUP');
		assert.equal(data.groupMemberData.barrierBits, 268);
		assert.equal(data.groupMemberData.state, 1);
		assert.equal(data.groupMemberData.worldSessionId, '', 'never the session');
		assert.equal(data.islandSelection.matchmakingId, '', 'never the matchmaking ID');
		assert.equal(data.priority, 1);
	});
	it('goes back to an idle slot when the leader is not queueing', () => {
		const data = JSON.parse(followedMatchmakingData({ iD: '', barrierBits: 12 })).MatchmakingData1;
		assert.equal(data.groupMemberData.iD, '');
		assert.equal(data.groupMemberData.barrierBits, 0);
	});
});

describe('SubGame (which part of Fortnite the member is in)', () => {
	it("matches the leader's SubGame_u with a direct patch (fnbr hard-codes 1)", async () => {
		const client = fakeClient('bot');
		const raw = [];
		const me = client.party.me;
		me.id = 'bot';
		me.meta = { schema: { SubGame_u: '1' }, get: () => ({}), set: (k, v) => (me.meta.schema[k] = String(v)) };
		me.sendPatch = async () => {};
		me.doPatch = async (update) => raw.push(update);
		const leader = { id: 'p1', isLeader: true, meta: { schema: { SubGame_u: '2' }, get: () => ({}) } };
		client.party.leader = leader;
		client.party.members = new Map([['bot', me], ['p1', leader]]);
		const runtime = runtimeFor(client);
		await runtime.syncSubGame();
		assert.deepEqual(raw, [{ SubGame_u: '2' }]);
		await runtime.syncSubGame();
		assert.equal(raw.length, 1, 'no repeat once it matches');
	});
});
