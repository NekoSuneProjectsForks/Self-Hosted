import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { LocalFnbrRuntime } from '../src/runtime/LocalFnbrRuntime.js';

/**
 * Drives LocalFnbrRuntime against a hand-built fake fnbr client. No Epic account
 * is involved, so this runs anywhere.
 */
function fakeClient(overrides = {}) {
	const calls = [];
	const me = {
		isLeader: true,
		outfit: 'CID_OLD',
		backpack: null,
		pickaxe: null,
		shoes: null,
		emote: null,
		setOutfit: async (id) => {
			calls.push(['setOutfit', id]);
			me.outfit = id;
		},
		setBackpack: async (id) => {
			calls.push(['setBackpack', id]);
			me.backpack = id;
		},
		setPickaxe: async (id) => {
			calls.push(['setPickaxe', id]);
			me.pickaxe = id;
		},
		setShoes: async (id) => {
			calls.push(['setShoes', id]);
			me.shoes = id;
		},
		setEmote: async (id) => {
			calls.push(['setEmote', id]);
			me.emote = id;
		},
		clearEmote: async () => {
			calls.push(['clearEmote']);
			me.emote = null;
		},
		setReadiness: async (v) => calls.push(['setReadiness', v]),
		setSittingOut: async (v) => calls.push(['setSittingOut', v])
	};

	const client = {
		isReady: true,
		calls,
		user: {
			self: { id: 'bot-1', displayName: 'TestBot' },
			blocklist: new Map(),
			block: async (id) => calls.push(['block', id]),
			unblock: async (id) => calls.push(['unblock', id]),
			search: async (prefix) => [{ id: 'u1', displayName: prefix }]
		},
		friend: {
			list: new Map(),
			pendingList: new Map(),
			add: async (id) => calls.push(['add', id]),
			remove: async (id) => calls.push(['remove', id]),
			sendMessage: async (id, content) => calls.push(['sendMessage', id, content]),
			resolve: (id) => client.friend.list.get(id),
			resolvePending: (id) => client.friend.pendingList.get(id)
		},
		party: {
			id: 'party-1',
			size: 1,
			maxSize: 16,
			members: new Map([['bot-1', { id: 'bot-1' }]]),
			me,
			sendMessage: async (content) => calls.push(['partyMessage', content]),
			setPrivacy: async (p) => calls.push(['setPrivacy', p]),
			setPlaylist: async (p) => calls.push(['setPlaylist', p]),
			kick: async (id) => calls.push(['kick', id]),
			promote: async (id) => calls.push(['promote', id])
		},
		setStatus: (s) => calls.push(['setStatus', s]),
		...overrides
	};
	return client;
}

function runtimeWith(client, categoryConfig = {}) {
	const events = [];
	const runtime = new LocalFnbrRuntime({
		userId: 'user-1',
		startConfig: {
			defaultStatus: 'Lobby',
			localCategory: { config: categoryConfig }
		},
		appendLog: () => {},
		emit: (event, payload) => events.push({ event, payload })
	});
	runtime.client = client;
	runtime.events = events;
	return runtime;
}

describe('LocalFnbrRuntime cosmetics', () => {
	let client;
	let runtime;

	beforeEach(() => {
		client = fakeClient();
		runtime = runtimeWith(client);
	});

	it('equips an outfit on the running bot with no restart', async () => {
		const result = await runtime.setCosmetic('outfit', 'CID_NEW');
		assert.deepEqual(client.calls[0], ['setOutfit', 'CID_NEW']);
		assert.equal(result.slot, 'outfit');
		assert.equal(result.cosmetics.outfit, 'CID_NEW');
	});

	it('supports every cosmetic slot', async () => {
		await runtime.setCosmetic('backpack', 'BID_1');
		await runtime.setCosmetic('pickaxe', 'PID_1');
		await runtime.setCosmetic('shoes', 'SID_1');
		await runtime.setCosmetic('emote', 'EID_1');
		assert.deepEqual(
			client.calls.map((c) => c[0]),
			['setBackpack', 'setPickaxe', 'setShoes', 'setEmote']
		);
	});

	it('clears an emote', async () => {
		await runtime.setCosmetic('emote', 'EID_1');
		const result = await runtime.clearEmote();
		assert.equal(result.cosmetics.emote, null);
	});

	it('emits a cosmetics:updated event after a confirmed change', async () => {
		await runtime.setCosmetic('outfit', 'CID_NEW');
		assert.ok(runtime.events.some((e) => e.event === 'cosmetics:updated'));
	});

	// Regression: the UI must never be told a cosmetic applied when it did not.
	it('surfaces a rejection instead of reporting false success', async () => {
		client.party.me.setOutfit = async () => {
			throw new Error('Item not owned');
		};
		await assert.rejects(
			() => runtime.setCosmetic('outfit', 'CID_BAD'),
			(error) => /Failed to equip cosmetic: Item not owned/.test(error.message)
		);
		assert.ok(
			!runtime.events.some((e) => e.event === 'cosmetics:updated'),
			'no update event may be emitted for a failed equip'
		);
	});

	it('rejects an unknown slot', async () => {
		await assert.rejects(
			() => runtime.setCosmetic('hat', 'X'),
			(error) => error.status === 400
		);
	});

	it('refuses when the bot is offline', async () => {
		runtime.client = null;
		await assert.rejects(
			() => runtime.setCosmetic('outfit', 'CID_NEW'),
			(error) => error.status === 409
		);
	});

	it('applies a startup loadout and reports per-item failures', async () => {
		client.party.me.setPickaxe = async () => {
			throw new Error('bad pickaxe');
		};
		const result = await runtime.applyCategory({
			startOutfit: [{ id: 'CID_1' }],
			startPickaxe: [{ id: 'PID_BAD' }]
		});
		assert.equal(result.applied.length, 1);
		assert.equal(result.failed.length, 1);
		assert.equal(result.failed[0].slot, 'pickaxe');
	});
});

describe('LocalFnbrRuntime party', () => {
	it('gives a useful error for party chat when alone', async () => {
		const runtime = runtimeWith(fakeClient());
		await assert.rejects(
			() => runtime.sendPartyMessage('hello'),
			(error) => error.status === 409 && /alone in its party/.test(error.message)
		);
	});

	it('sends a party message when others are present', async () => {
		const client = fakeClient();
		client.party.size = 2;
		const runtime = runtimeWith(client);
		await runtime.sendPartyMessage('hello');
		assert.deepEqual(client.calls[0], ['partyMessage', 'hello']);
	});

	it('maps friendly privacy names to fnbr presets', async () => {
		const client = fakeClient();
		const runtime = runtimeWith(client);
		await runtime.setPrivacy('friends');
		assert.equal(client.calls[0][0], 'setPrivacy');
		assert.equal(client.calls[0][1].partyType, 'FriendsOnly');
	});

	it('rejects an unknown privacy value', async () => {
		const runtime = runtimeWith(fakeClient());
		await assert.rejects(
			() => runtime.setPrivacy('nonsense'),
			(error) => error.status === 400
		);
	});

	it('says "Requires Party Leader" instead of a cryptic error', async () => {
		const client = fakeClient();
		client.party.me.isLeader = false;
		const runtime = runtimeWith(client);
		await assert.rejects(
			() => runtime.setPlaylist('Playlist_DefaultSolo'),
			(error) => error.status === 403 && /Requires Party Leader/.test(error.message)
		);
	});

	it('allows non-leader readiness changes', async () => {
		const client = fakeClient();
		client.party.me.isLeader = false;
		const runtime = runtimeWith(client);
		await runtime.setReadiness(true);
		assert.deepEqual(client.calls[0], ['setReadiness', true]);
	});
});

describe('LocalFnbrRuntime friends', () => {
	it('sends a direct message to a known friend', async () => {
		const client = fakeClient();
		client.friend.list.set('f1', { id: 'f1', displayName: 'Friendo' });
		const runtime = runtimeWith(client);
		const result = await runtime.sendFriendMessage('f1', 'hi there');
		assert.deepEqual(client.calls[0], ['sendMessage', 'f1', 'hi there']);
		assert.equal(result.message.direction, 'outgoing');
		assert.equal(result.message.friendName, 'Friendo');
	});

	it('refuses a DM to a non-friend', async () => {
		const runtime = runtimeWith(fakeClient());
		await assert.rejects(
			() => runtime.sendFriendMessage('nobody', 'hi'),
			(error) => error.status === 404
		);
	});

	it('refuses an empty DM', async () => {
		const client = fakeClient();
		client.friend.list.set('f1', { id: 'f1' });
		const runtime = runtimeWith(client);
		await assert.rejects(
			() => runtime.sendFriendMessage('f1', '   '),
			(error) => error.status === 400
		);
	});

	it('accepts an incoming friend request', async () => {
		const client = fakeClient();
		let accepted = false;
		client.friend.pendingList.set('p1', {
			id: 'p1',
			direction: 'INCOMING',
			accept: async () => {
				accepted = true;
			}
		});
		const runtime = runtimeWith(client);
		await runtime.acceptFriend('p1');
		assert.ok(accepted);
	});

	// Regression: an outgoing request must never be treated as incoming.
	it('refuses to "accept" an outgoing request', async () => {
		const client = fakeClient();
		client.friend.pendingList.set('p2', { id: 'p2', direction: 'OUTGOING' });
		const runtime = runtimeWith(client);
		await assert.rejects(
			() => runtime.acceptFriend('p2'),
			(error) => error.status === 400 && /outgoing/i.test(error.message)
		);
	});

	it('cancels an outgoing request via decline', async () => {
		const client = fakeClient();
		client.friend.pendingList.set('p2', { id: 'p2', direction: 'OUTGOING' });
		const runtime = runtimeWith(client);
		const result = await runtime.declineFriend('p2');
		assert.match(result.content, /cancelled/i);
		assert.deepEqual(client.calls[0], ['remove', 'p2']);
	});

	it('splits pending requests by direction', () => {
		const client = fakeClient();
		client.friend.pendingList.set('a', { id: 'a', direction: 'INCOMING', displayName: 'In' });
		client.friend.pendingList.set('b', { id: 'b', direction: 'OUTGOING', displayName: 'Out' });
		const runtime = runtimeWith(client);
		const pending = runtime.getPendingFriends();
		assert.equal(pending.incomingFriends.length, 1);
		assert.equal(pending.outgoingFriends.length, 1);
		assert.equal(pending.incomingFriends[0].id, 'a');
	});
});

describe('LocalFnbrRuntime auto-accept settings', () => {
	it('defaults to enabled', () => {
		const runtime = runtimeWith(fakeClient());
		assert.equal(runtime.autoAcceptFriendRequests(), true);
		assert.equal(runtime.autoAcceptInvites(), true);
	});

	it('honours disabled settings', () => {
		const runtime = runtimeWith(fakeClient(), {
			acceptFriendRequests: false,
			acceptInvites: false
		});
		assert.equal(runtime.autoAcceptFriendRequests(), false);
		assert.equal(runtime.autoAcceptInvites(), false);
	});

	it('picks up a live settings change with no restart', () => {
		const runtime = runtimeWith(fakeClient(), { acceptInvites: true });
		runtime.updateLocalCategory({ config: { acceptInvites: false } });
		assert.equal(runtime.autoAcceptInvites(), false);
	});
});

describe('LocalFnbrRuntime capabilities', () => {
	it('claims realtime cosmetics for fnbr', () => {
		const runtime = runtimeWith(fakeClient());
		const caps = runtime.getCapabilities();
		assert.equal(caps.engine, 'fnbr');
		assert.equal(caps.capabilities.realtimeCosmetics, true);
		assert.equal(caps.capabilities.friendMessages, true);
	});
});
