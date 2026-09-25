import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { LegacyFnlbRuntime } from '../src/runtime/LegacyFnlbRuntime.js';
import { validateStartConfig } from '../src/services/configStore.js';

/**
 * The adapter is exercised with `runCommand` stubbed, so no FNLB token, network
 * call or cloud service is involved.
 */
function makeRuntime() {
	const runtime = new LegacyFnlbRuntime({
		userId: 'user-1',
		startConfig: {},
		plainConfig: { apiToken: 'token-1234567890', clusterName: 'test' },
		appendLog: () => {},
		emit: () => {}
	});
	runtime.calls = [];
	runtime.runCommand = async (command, args, botId) => {
		runtime.calls.push({ command, args, botId });
		return { ok: true };
	};
	return runtime;
}

describe('LegacyFnlbRuntime friend requests', () => {
	let runtime;

	beforeEach(() => {
		runtime = makeRuntime();
	});

	// Regression: this previously threw "does not support declining friend requests".
	it('declines an incoming friend request', async () => {
		const result = await runtime.declineFriend('friend-1', 'bot-1');
		assert.deepEqual(runtime.calls[0], {
			command: 'remove_friend',
			args: 'friend-1',
			botId: 'bot-1'
		});
		assert.match(result.content, /declined or cancelled/i);
		assert.equal(result.source, 'fnlb');
	});

	// Epic exposes accept as the same POST used to send a request.
	it('accepts a friend request via add_friend', async () => {
		const result = await runtime.acceptFriend('friend-1', 'bot-1');
		assert.deepEqual(runtime.calls[0], {
			command: 'add_friend',
			args: 'friend-1',
			botId: 'bot-1'
		});
		assert.match(result.content, /accepted/i);
	});

	it('adds and removes friends', async () => {
		await runtime.addFriend('someone', 'bot-1');
		await runtime.removeFriend('friend-1', 'bot-1');
		assert.deepEqual(
			runtime.calls.map((c) => c.command),
			['add_friend', 'remove_friend']
		);
	});

	it('blocks and unblocks users', async () => {
		await runtime.blockUser('u1', 'bot-1');
		await runtime.unblockUser('u1', 'bot-1');
		assert.deepEqual(
			runtime.calls.map((c) => c.command),
			['block_user', 'unblock_user']
		);
	});

	it('reports friendRequests as supported', () => {
		const caps = runtime.getCapabilities();
		assert.equal(caps.capabilities.friendRequests, true);
	});

	it('still reports friendMessages as unsupported', () => {
		// No verified FNLB direct-message command exists.
		const caps = runtime.getCapabilities();
		assert.equal(caps.capabilities.friendMessages, false);
	});
});

describe('LegacyFnlbRuntime party actions', () => {
	let runtime;

	beforeEach(() => {
		runtime = makeRuntime();
	});

	it('routes party actions to the verified command set', async () => {
		await runtime.inviteUser('u1', 'bot-1');
		await runtime.joinParty('party-1', 'bot-1');
		await runtime.kickMember('u2', 'bot-1');
		await runtime.leaveParty('bot-1');
		await runtime.setPlaylist('Playlist_DefaultSolo', 'bot-1');
		await runtime.setStatus('Lobby', 'bot-1');

		assert.deepEqual(
			runtime.calls.map((c) => c.command),
			['invite', 'join_party', 'kick', 'leave_lobby', 'set_playlist', 'set_status']
		);
		assert.ok(runtime.calls.every((c) => c.botId === 'bot-1'));
	});

	it('maps readiness to ready/unready', async () => {
		await runtime.setReadiness(true, 'bot-1');
		await runtime.setReadiness(false, 'bot-1');
		assert.deepEqual(
			runtime.calls.map((c) => c.command),
			['ready', 'unready']
		);
	});

	it('maps hide members to hide_all/unhide_all', async () => {
		await runtime.hideMembers(true, 'bot-1');
		await runtime.hideMembers(false, 'bot-1');
		assert.deepEqual(
			runtime.calls.map((c) => c.command),
			['hide_all', 'unhide_all']
		);
	});

	it('honestly refuses what FNLB has no command for', async () => {
		for (const call of [
			() => runtime.setPrivacy('public', 'bot-1'),
			() => runtime.promoteMember('u1', 'bot-1'),
			() => runtime.setSittingOut(true, 'bot-1'),
			() => runtime.setSquadFill(true, 'bot-1'),
			() => runtime.sendFriendMessage('u1', 'hi', 'bot-1')
		]) {
			await assert.rejects(call, (error) => error.status === 501 && error.unsupported === true);
		}
	});
});

describe('LegacyFnlbRuntime cosmetics safety', () => {
	it('refuses a cosmetic write that would wipe the category config', async () => {
		const runtime = makeRuntime();
		await assert.rejects(
			() => runtime.setCosmetic('outfit', 'CID_1', { categoryId: 'cat-1' }),
			(error) => error.status === 400 && /preserved/i.test(error.message)
		);
	});

	it('requires a category id', async () => {
		const runtime = makeRuntime();
		await assert.rejects(
			() => runtime.setCosmetic('outfit', 'CID_1', {}),
			(error) => error.status === 400
		);
	});
});

describe('LegacyFnlbRuntime start options', () => {
	it('maps the release channel and bot filter onto fnlb options', () => {
		const runtime = makeRuntime();
		runtime.startConfig = validateStartConfig({
			runtimeMode: 'fnlb',
			apiToken: 'token-1234567890',
			releaseChannel: 'beta',
			categories: ' cat-1 , ,cat-2 ',
			bots: 'bot-1',
			numberOfShards: 2,
			botsPerShard: 32
		});
		const options = runtime.fnlbStartOptions();
		assert.equal(options.channel, 'beta');
		assert.deepEqual(options.categories, ['cat-1', 'cat-2']);
		assert.deepEqual(options.bots, ['bot-1']);
		assert.equal(options.mode, undefined);
		assert.equal(options.releaseChannel, undefined);
	});

	it('starts without filters and defaults to the stable channel', () => {
		const runtime = makeRuntime();
		runtime.startConfig = validateStartConfig({
			runtimeMode: 'fnlb',
			apiToken: 'token-1234567890',
			categories: '',
			bots: ''
		});
		const options = runtime.fnlbStartOptions();
		assert.equal(options.channel, 'stable');
		assert.equal(options.categories, undefined);
		assert.equal(options.bots, undefined);
	});
});
