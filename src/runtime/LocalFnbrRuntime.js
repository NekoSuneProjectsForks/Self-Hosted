import { createRequire } from 'node:module';
import { BaseRuntime, runtimeError } from './BaseRuntime.js';
import { PresenceProbe } from './presenceProbe.js';

const require = createRequire(import.meta.url);
const { Client, Enums } = require('@fnlb-project/fnbr');

// Verified against the installed @fnlb-project/fnbr 4.2.75 typings:
//   ClientPartyMember: setOutfit/setBackpack/setPickaxe/setShoes/setEmote/clearEmote,
//                      setReadiness/setSittingOut
//   ClientParty:       setPrivacy/setPlaylist/setSquadFill/kick/promote/invite/
//                      hideMembers/sendMessage/leave
//   FriendManager:     add/remove/sendMessage, list, pendingList
//   IncomingPendingFriend: accept()/decline()   (direction is 'INCOMING' | 'OUTGOING')
//   UserManager:       search/block/unblock, blocklist
const PRIVACY_PRESETS = {
	public: Enums.PartyPrivacy.PUBLIC,
	friends: Enums.PartyPrivacy.FRIENDS,
	friends_of_friends: Enums.PartyPrivacy.FRIENDS_ALLOW_FRIENDS_OF_FRIENDS,
	private: Enums.PartyPrivacy.PRIVATE,
	private_friends_of_friends: Enums.PartyPrivacy.PRIVATE_ALLOW_FRIENDS_OF_FRIENDS
};

const COSMETIC_SLOTS = {
	outfit: 'setOutfit',
	backpack: 'setBackpack',
	pickaxe: 'setPickaxe',
	shoes: 'setShoes',
	emote: 'setEmote'
};

function safeValue(getter, fallback = null) {
	try {
		const value = getter();
		return value === undefined ? fallback : value;
	} catch {
		return fallback;
	}
}

function collectionValues(collection) {
	if (!collection) return [];
	return Array.from(collection.values ? collection.values() : []);
}

function firstCosmetic(categoryConfig, ...slots) {
	for (const slot of slots) {
		const rows = categoryConfig?.[slot];
		if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
	}
	return null;
}

function normalizeTarget(value, label = 'a target or value') {
	const target = String(value || '').trim();
	if (!target) throw runtimeError(400, `This action needs ${label}.`);
	return target;
}

function normalizeSlot(value) {
	const slot = String(value || '').toLowerCase();
	for (const key of Object.keys(COSMETIC_SLOTS)) {
		if (slot.includes(key)) return key;
	}
	throw runtimeError(400, `Unsupported cosmetic slot: ${value}`);
}

function serializeUser(user) {
	if (!user) return null;
	return {
		id: user.id,
		displayName: user.displayName,
		externalAuths: user.externalAuths || null
	};
}

function serializePresence(presence) {
	if (!presence) return null;
	return {
		status: presence.status,
		receivedAt: presence.receivedAt,
		isPlaying: presence.isPlaying,
		isJoinable: presence.isJoinable,
		hasVoiceSupport: presence.hasVoiceSupport,
		sessionId: presence.sessionId,
		playlist: presence.playlist,
		partySize: presence.partySize,
		partyMaxSize: presence.partyMaxSize,
		gameSessionJoinKey: presence.gameSessionJoinKey,
		gameplayStats: presence.gameplayStats || null,
		platform: presence.platform,
		onlineType: presence.onlineType
	};
}

function serializeFriend(friend) {
	return {
		...serializeUser(friend),
		isOnline: friend.isOnline,
		isJoinable: friend.isJoinable,
		favorite: friend.favorite,
		createdAt: friend.createdAt,
		presence: serializePresence(friend.presence),
		status: friend.presence?.status,
		party: friend.party
			? {
					id: friend.party.id,
					size: friend.party.size,
					maxSize: friend.party.maxSize
				}
			: null
	};
}

function serializePendingFriend(pending) {
	return {
		...serializeUser(pending),
		direction: pending.direction === 'OUTGOING' ? 'outgoing' : 'incoming',
		createdAt: pending.createdAt
	};
}

function serializePartyMember(member) {
	return {
		...serializeUser(member),
		role: member.role,
		isLeader: member.isLeader,
		joinedAt: member.joinedAt,
		isReady: safeValue(() => member.isReady, false),
		isSittingOut: safeValue(() => member.isSittingOut, false),
		platform: safeValue(() => member.platform, null),
		outfit: safeValue(() => member.outfit, null),
		backpack: safeValue(() => member.backpack, null),
		pickaxe: safeValue(() => member.pickaxe, null),
		shoes: safeValue(() => member.shoes, null),
		emote: safeValue(() => member.emote, null),
		matchInfo: safeValue(() => member.matchInfo, null),
		playlist: safeValue(() => member.playlist, null)
	};
}

function serializeParty(party) {
	if (!party) return null;
	const playlist = safeValue(() => party.playlist, null);
	return {
		id: party.id,
		createdAt: party.createdAt,
		size: party.size,
		maxSize: party.maxSize,
		isPrivate: safeValue(() => party.isPrivate, false),
		playlist,
		playlistId: playlist?.linkId?.mnemonic || playlist?.LinkId || null,
		customMatchmakingKey: safeValue(() => party.customMatchmakingKey, null),
		squadFill: safeValue(() => party.squadFill, null),
		leader: serializeUser(safeValue(() => party.leader, null)),
		members: collectionValues(party.members).map(serializePartyMember)
	};
}

/** Epic's match meta only ever tells us where the member is, never how they did. */
function matchStateFrom(matchInfo) {
	const location = matchInfo?.location;
	if (location === 'InGame') return 'in_match';
	if (location === 'Matchmaking' || location === 'PostMatchmaking') return 'matchmaking';
	return 'lobby';
}

export class LocalFnbrRuntime extends BaseRuntime {
	constructor(options) {
		super({ ...options, engine: 'fnbr' });
		this.client = null;
		this.disabled = false;
		this.snapshotTimer = null;
		this.authRequired = false;
		this.matchState = 'lobby';
		this.onDeviceAuth = options.onDeviceAuth;
		this.onSnapshot = options.onSnapshot;
		this.onFriendMessage = options.onFriendMessage;
		this.onMatchState = options.onMatchState;
		// Account IDs of the user's own other bots (main + extra accounts). Their
		// friend requests and party invites are always accepted, so bots can
		// gather in one lobby even when auto-accept is switched off.
		this.trustedIds = options.trustedIds || (() => []);
		this.health = {
			epicAuth: 'disconnected',
			xmpp: 'disconnected',
			stomp: 'disconnected',
			party: 'disconnected'
		};
	}

	getCapabilities() {
		return {
			engine: 'fnbr',
			capabilities: {
				friends: true,
				friendMessages: true,
				friendRequests: true,
				blockedUsers: true,
				party: true,
				partyChat: true,
				cosmetics: true,
				realtimeCosmetics: true,
				playlist: true,
				privacy: true,
				readiness: true,
				sittingOut: true,
				squadFill: true,
				presence: true,
				matchTracking: true,
				searchUsers: true,
				promoteMember: true,
				multiBot: true,
				dmCommands: true,
				autoReady: true,
				playerStats: true
			}
		};
	}

	isTrusted(accountId) {
		if (!accountId) return false;
		try {
			return this.trustedIds().includes(accountId);
		} catch {
			return false;
		}
	}

	// ---------------------------------------------------------------- start

	async start() {
		const auth = this.startConfig.deviceAuth
			? { deviceAuth: this.startConfig.deviceAuth }
			: { authorizationCode: async () => this.startConfig.authorizationCode };

		this.log('[Local fnbr] Preparing authentication', 2);

		const client = new Client({
			auth: { ...auth, killOtherTokens: this.startConfig.killOtherTokens },
			platform: this.startConfig.platform,
			defaultStatus: this.startConfig.defaultStatus,
			createParty: true,
			forceNewParty: false,
			restartOnInvalidRefresh: false,
			fetchFriends: true,
			connectToXMPP: true,
			connectToSTOMP: true
		});

		this.client = client;
		this.presenceProbe = new PresenceProbe();
		this.presenceProbe.install(client);
		this.bindEvents(client);

		this.log('[Local fnbr] Authenticating with Epic', 2);
		try {
			await client.login();
		} catch (error) {
			this.client = null;
			this.health.epicAuth = 'error';
			// Epic rejects stale device auth with an auth-shaped error. Surface that
			// as "authentication required" so the UI can offer re-auth instead of
			// showing a generic crash.
			const usedCode = !this.startConfig.deviceAuth && Boolean(this.startConfig.authorizationCode);
			if (usedCode && this.isAuthError(error)) {
				this.authRequired = true;
				const rejected = runtimeError(
					401,
					'Epic rejected the one-time authorization code. Codes work once and expire after about 5 minutes, and must come from the same account you want as the bot. Get a fresh code and start straight away, or use "Sign in with Epic".'
				);
				rejected.authCodeRejected = true;
				throw rejected;
			}
			if (this.isAuthError(error)) {
				this.authRequired = true;
				throw runtimeError(
					401,
					'Authentication Required — the stored Epic device auth was rejected. Clear it and sign in with a new authorization code.'
				);
			}
			throw error;
		}

		this.authRequired = false;
		this.health.epicAuth = 'connected';
		this.health.xmpp = client.xmpp?.connection ? 'connected' : 'unknown';
		this.health.stomp = client.stomp?.connection ? 'connected' : 'unknown';
		this.health.party = client.party ? 'connected' : 'disconnected';

		this.log(`[Local fnbr] Ready as ${client.user.self?.displayName || client.user.self?.id}`, 1);

		// A failed startup loadout must not take the whole bot down with it.
		await this.applyCategory(this.startConfig.localCategory?.config || {}, false).catch((error) =>
			this.log(`[Local fnbr] Startup loadout could not be applied: ${error.message}`, 4)
		);

		this.queueSnapshot();
	}

	isAuthError(error) {
		const code = String(error?.code || error?.errorCode || '');
		const message = String(error?.message || '');
		return (
			code.includes('authentication') ||
			code.includes('oauth') ||
			code.includes('account_not_active') ||
			code.includes('invalid_account_credentials') ||
			code.includes('invalid_exchange') ||
			/invalid[_ ]grant|device auth|authorization code|not authorized|expired|credentials you are using are invalid/i.test(message)
		);
	}

	async stop() {
		if (this.snapshotTimer) {
			clearTimeout(this.snapshotTimer);
			this.snapshotTimer = null;
		}
		if (this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		this.health = { epicAuth: 'disconnected', xmpp: 'disconnected', stomp: 'disconnected', party: 'disconnected' };
		if (!this.client) return;
		const client = this.client;
		this.client = null;
		await client.logout().catch((error) => this.log(`Logout warning: ${error.message}`, 4));
	}

	// --------------------------------------------------------------- events

	bindEvents(client) {
		client.on('deviceauth:created', async (deviceAuth) => {
			this.startConfig.deviceAuth = deviceAuth;
			this.startConfig.authorizationCode = '';
			await this.onDeviceAuth?.(this.userId, deviceAuth);
			// Never log the secret itself.
			this.log('[Local fnbr] Device auth accepted, encrypted in SQLite, authorization code deleted.', 1);
		});

		client.on('ready', () => {
			this.health.epicAuth = 'connected';
			this.queueSnapshot();
		});

		client.on('friend:message', (message) => {
			const friendId = message.author?.id;
			this.log(
				`Friend message from ${message.author?.displayName || friendId}: ${message.content}`,
				2
			);
			this.onFriendMessage?.(this.userId, {
				botId: this.botId(),
				friendId,
				friendName: message.author?.displayName || null,
				direction: 'incoming',
				content: String(message.content ?? ''),
				sentAt: new Date().toISOString()
			});
			this.handleDmCommand(message).catch((error) => this.log(`DM command failed: ${error.message}`, 4));
		});

		// Auto-ready: follow the humans in the lobby. Each of the user's bots
		// runs this independently, so every bot in the party converges.
		// fnbr emits readiness:updated BEFORE it stores the member's new state,
		// so reading member.isReady inside the handler gives the OLD value (that
		// made the bot ready up when a player unreadied). Re-check on the next
		// tick, after fnbr has applied the update, and again on member:updated,
		// which fires after it.
		for (const event of ['party:member:readiness:updated', 'party:member:joined', 'party:member:left', 'party:member:kicked']) {
			client.on(event, () => setImmediate(() => this.syncReadiness()));
		}
		client.on('party:member:updated', () => this.syncReadiness());

		client.on('party:member:message', (message) => {
			this.handlePartyCommand(message).catch((error) => this.log(`Party command failed: ${error.message}`, 4));
			this.log(`Party message from ${message.author?.displayName || message.author?.id}: ${message.content}`, 2);
			this.emit('party:message', {
				botId: this.botId(),
				authorId: message.author?.id,
				authorName: message.author?.displayName || null,
				content: String(message.content ?? ''),
				sentAt: new Date().toISOString()
			});
		});

		// Auto-accept incoming friend requests. `friend:request` only fires for
		// incoming requests in fnbr, but the direction is re-checked anyway so an
		// outgoing request can never be mistaken for an incoming one.
		client.on('friend:request', async (pendingFriend) => {
			this.emitFriends();
			if (!this.autoAcceptFriendRequests() && !this.isTrusted(pendingFriend.id)) {
				this.log(`Friend request from ${pendingFriend.displayName || pendingFriend.id} is pending.`, 2);
				return;
			}
			if (pendingFriend.direction !== 'INCOMING' || typeof pendingFriend.accept !== 'function') return;
			try {
				await pendingFriend.accept();
				this.log(`Auto-accepted friend request from ${pendingFriend.displayName || pendingFriend.id}.`, 1);
			} catch (error) {
				this.log(`Could not auto-accept friend request: ${error.message}`, 4);
			}
			this.emitFriends();
		});

		client.on('party:invite', async (invitation) => {
			if (!this.autoAcceptInvites() && !this.isTrusted(invitation.sender?.id)) {
				this.log(`Party invite from ${invitation.sender?.displayName || invitation.sender?.id} is pending.`, 2);
				this.emit('party:invite', {
					botId: this.botId(),
					senderId: invitation.sender?.id,
					senderName: invitation.sender?.displayName || null
				});
				return;
			}
			try {
				await invitation.accept();
				this.log(`Auto-accepted a party invite from ${invitation.sender?.displayName || invitation.sender?.id}.`, 1);
			} catch (error) {
				// Expired / full / private / already-joined all arrive here as
				// distinct Epic errors; report the reason instead of swallowing it.
				this.log(`Could not accept party invite: ${error.message}`, 4);
			}
			this.queueSnapshot();
		});

		for (const event of ['friend:added', 'friend:removed', 'friend:request:sent', 'friend:request:aborted', 'friend:request:declined']) {
			client.on(event, () => {
				this.emitFriends();
				this.queueSnapshot();
			});
		}

		for (const event of ['friend:presence', 'friend:online', 'friend:offline']) {
			client.on(event, () => this.emitFriendsThrottled());
		}

		for (const event of ['user:blocked', 'user:unblocked']) {
			client.on(event, () => {
				this.emit('friends:updated', { botId: this.botId() });
				this.queueSnapshot();
			});
		}

		for (const event of [
			'party:updated',
			'party:member:joined',
			'party:member:left',
			'party:member:kicked',
			'party:member:promoted',
			'party:member:updated',
			'party:member:expired',
			'party:member:disconnected',
			'party:member:readiness:updated',
			'party:member:outfit:updated',
			'party:member:emote:updated',
			'party:member:backpack:updated',
			'party:member:pickaxe:updated'
		]) {
			client.on(event, () => this.emitParty());
		}

		client.on('party:member:matchstate:updated', (member) => {
			this.emitParty();
			if (member?.id !== client.user?.self?.id) return;
			this.handleMatchState(safeValue(() => member.matchInfo, null));
		});

		client.on('xmpp:message:error', (error) => {
			this.health.xmpp = 'error';
			this.log(`XMPP message error: ${error.message}`, 4);
		});
		client.on('xmpp:presence:error', (error) => {
			this.health.xmpp = 'error';
			this.log(`XMPP presence error: ${error.message}`, 4);
		});
		client.on('xmpp:chat:error', (error) => {
			this.health.xmpp = 'error';
			this.log(`XMPP chat error: ${error.message}`, 4);
		});
	}

	handleMatchState(matchInfo) {
		const next = matchStateFrom(matchInfo);
		if (next === this.matchState) return;
		const previous = this.matchState;
		this.matchState = next;
		this.onMatchState?.(this.userId, {
			botId: this.botId(),
			previous,
			state: next,
			partyId: this.client?.party?.id || null,
			playlistId: serializeParty(this.client?.party)?.playlistId || null,
			partyMembers: this.client?.party?.size ?? null,
			matchInfo
		});
	}

	autoAcceptFriendRequests() {
		return this.startConfig.localCategory?.config?.acceptFriendRequests !== false;
	}

	autoAcceptInvites() {
		return this.startConfig.localCategory?.config?.acceptInvites !== false;
	}

	/**
	 * Live config updates. Everything here takes effect without a restart.
	 */
	updateLocalCategory(localCategory) {
		this.startConfig.localCategory = localCategory;
	}

	botId() {
		return this.client?.user?.self?.id || this.startConfig.deviceAuth?.accountId || 'local-fnbr-bot';
	}

	emitFriends() {
		if (!this.client?.isReady) return;
		this.emit('friends:updated', { botId: this.botId() });
	}

	emitFriendsThrottled() {
		// Presence storms on login would otherwise emit hundreds of events.
		if (this.friendsEmitTimer) return;
		this.friendsEmitTimer = setTimeout(() => {
			this.friendsEmitTimer = null;
			this.emitFriends();
		}, 1000);
		this.friendsEmitTimer.unref?.();
	}

	emitParty() {
		if (!this.client?.isReady) return;
		this.emit('party:updated', { botId: this.botId(), party: serializeParty(this.client.party) });
		this.queueSnapshot();
	}

	queueSnapshot() {
		if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
		this.snapshotTimer = setTimeout(() => {
			this.snapshotTimer = null;
			const bot = this.toBotCard();
			if (!bot?.id) return;
			this.emit('bot:updated', { bot });
			this.onSnapshot?.(this.userId, bot).catch(() => {});
		}, 500);
		this.snapshotTimer.unref?.();
	}

	requireClient() {
		if (this.authRequired) {
			throw runtimeError(401, 'Authentication Required — reauthenticate the Epic account.');
		}
		if (!this.client?.isReady) {
			throw runtimeError(409, 'The local fnbr bot is not online yet.');
		}
		return this.client;
	}

	requireMember() {
		const client = this.requireClient();
		const member = client.party?.me;
		if (!member) {
			throw runtimeError(409, 'The bot is not in a Fortnite party yet, so this action cannot be applied.');
		}
		return { client, member };
	}

	requireLeader() {
		const { client, member } = this.requireMember();
		if (!member.isLeader) {
			throw runtimeError(403, 'Requires Party Leader — the bot is not the leader of this party.');
		}
		return { client, member };
	}

	// ----------------------------------------------------------------- read

	toBotCard() {
		const client = this.client;
		const self = client?.user?.self;
		const party = serializeParty(client?.party);
		const me = client?.party?.me;
		const match = safeValue(() => me?.matchInfo, null);

		return {
			id: this.botId(),
			nickname: self?.displayName || 'Local fnbr bot',
			email: self?.email || null,
			parent: null,
			flags: this.disabled ? 1 : 0,
			flagsList: this.disabled ? ['Disabled'] : [],
			isDisabled: this.disabled,
			hasInvalidAuth: this.authRequired,
			mmsBannedUntil: null,
			banState: 'not_exposed_by_epic_presence',
			source: 'fnbr',
			runtimeMode: 'fnbr',
			presenceStatus: this.startConfig.defaultStatus,
			platform: this.startConfig.platform || null,
			friendsCount: client?.friend?.list?.size ?? null,
			pendingFriendsCount: client?.friend?.pendingList?.size ?? null,
			blockedUsersCount: client?.user?.blocklist?.size ?? null,
			matches: match?.location === 'InGame' ? 1 : 0,
			isInMatch: match?.location === 'InGame',
			matchState: matchStateFrom(match),
			match,
			party,
			partyMembers: party?.size ?? null,
			health: { ...this.health },
			cosmetics: {
				outfit: safeValue(() => me?.outfit, null),
				backpack: safeValue(() => me?.backpack, null),
				pickaxe: safeValue(() => me?.pickaxe, null),
				shoes: safeValue(() => me?.shoes, null),
				emote: safeValue(() => me?.emote, null)
			}
		};
	}

	getDashboard(localCategory) {
		const bot = this.toBotCard();
		return {
			bots: [bot],
			stats: {
				local: {
					total: 1,
					connected: this.client?.isReady ? 1 : 0,
					friends: bot.friendsCount || 0,
					partyMembers: bot.partyMembers || 0,
					matches: bot.matches || 0
				}
			},
			categories: localCategory ? [localCategory] : [],
			user: serializeUser(this.client?.user?.self),
			health: { ...this.health },
			source: 'fnbr'
		};
	}

	getFriends() {
		const client = this.requireClient();
		const onlineFriends = [];
		const offlineFriends = [];
		for (const friend of collectionValues(client.friend.list).map(serializeFriend)) {
			if (friend.isOnline) onlineFriends.push(friend);
			else offlineFriends.push(friend);
		}
		return { onlineFriends, offlineFriends };
	}

	getPendingFriends() {
		const client = this.requireClient();
		const incomingFriends = [];
		const outgoingFriends = [];
		for (const pending of collectionValues(client.friend.pendingList)) {
			const row = serializePendingFriend(pending);
			if (row.direction === 'outgoing') outgoingFriends.push(row);
			else incomingFriends.push(row);
		}
		return { incomingFriends, outgoingFriends };
	}

	/**
	 * Raw presence the bot last published next to what a friend's real client
	 * last published, for working out why Fortnite won't offer Invite/Join.
	 */
	comparePresence(friendId) {
		const client = this.requireClient();
		const target = friendId ? client.friend.resolve(normalizeTarget(friendId, 'a friend')) : null;
		if (friendId && !target) throw runtimeError(404, 'That user is not a friend of the bot.');
		return {
			...this.presenceProbe.compare(target?.id),
			friendId: target?.id || null,
			friendName: target?.displayName || null
		};
	}

	getBlockedUsers() {
		const client = this.requireClient();
		return collectionValues(client.user.blocklist).map(serializeUser);
	}

	getParty() {
		const client = this.requireClient();
		return serializeParty(client.party);
	}

	getBotDetails(localCategory) {
		return {
			bot: this.toBotCard(),
			friends: this.getFriends(),
			pendingFriends: this.getPendingFriends(),
			blockedUsers: this.getBlockedUsers(),
			party: this.getParty(),
			categories: localCategory ? [localCategory] : [],
			health: { ...this.health },
			source: 'fnbr'
		};
	}

	// -------------------------------------------------------------- friends

	resolvePending(friendId) {
		const client = this.requireClient();
		const pending = client.friend.resolvePending(normalizeTarget(friendId, 'a friend'));
		if (!pending) throw runtimeError(404, 'That friend request is no longer pending.');
		return pending;
	}

	async addFriend(target) {
		const client = this.requireClient();
		await client.friend.add(normalizeTarget(target, 'an account ID or display name'));
		this.emitFriends();
		return { content: 'Friend request sent.', format: 1, source: 'fnbr' };
	}

	async acceptFriend(friendId) {
		const pending = this.resolvePending(friendId);
		if (pending.direction !== 'INCOMING') {
			throw runtimeError(400, 'That request is outgoing — cancel it instead of accepting it.');
		}
		await pending.accept();
		this.emitFriends();
		return { content: 'Friend request accepted.', format: 1, source: 'fnbr' };
	}

	async declineFriend(friendId) {
		const pending = this.resolvePending(friendId);
		if (pending.direction === 'OUTGOING') {
			// fnbr models cancelling an outgoing request as removing the friendship.
			await this.requireClient().friend.remove(pending.id);
			this.emitFriends();
			return { content: 'Outgoing friend request cancelled.', format: 1, source: 'fnbr' };
		}
		await pending.decline();
		this.emitFriends();
		return { content: 'Friend request declined.', format: 1, source: 'fnbr' };
	}

	async removeFriend(friendId) {
		const client = this.requireClient();
		await client.friend.remove(normalizeTarget(friendId, 'a friend'));
		this.emitFriends();
		return { content: 'Friend removed.', format: 1, source: 'fnbr' };
	}

	async blockUser(target) {
		const client = this.requireClient();
		await client.user.block(normalizeTarget(target, 'a user'));
		this.emitFriends();
		return { content: 'User blocked.', format: 1, source: 'fnbr' };
	}

	async unblockUser(target) {
		const client = this.requireClient();
		await client.user.unblock(normalizeTarget(target, 'a user'));
		this.emitFriends();
		return { content: 'User unblocked.', format: 1, source: 'fnbr' };
	}

	async sendFriendMessage(friendId, content) {
		const client = this.requireClient();
		const target = normalizeTarget(friendId, 'a friend');
		const message = normalizeTarget(content, 'message content');
		const friend = client.friend.resolve(target);
		if (!friend) throw runtimeError(404, 'That account is not on the bot friend list.');

		await client.friend.sendMessage(target, message);

		const record = {
			botId: this.botId(),
			friendId: friend.id,
			friendName: friend.displayName || null,
			direction: 'outgoing',
			content: message,
			sentAt: new Date().toISOString()
		};
		this.onFriendMessage?.(this.userId, record);
		return { content: 'Direct message sent.', format: 1, source: 'fnbr', message: record };
	}

	// ---------------------------------------------------------------- party

	async sendPartyMessage(content) {
		const client = this.requireClient();
		const message = normalizeTarget(content, 'message content');
		const party = client.party;
		if (!party) throw runtimeError(409, 'The bot is not in a Fortnite party yet.');
		if ((party.size ?? 1) <= 1) {
			throw runtimeError(
				409,
				'The bot is alone in its party, so there is nobody to receive a lobby chat message. Invite someone first.'
			);
		}
		await party.sendMessage(message);
		return { content: 'Party chat message sent.', format: 1, source: 'fnbr' };
	}

	async inviteUser(target) {
		const client = this.requireClient();
		await client.invite(normalizeTarget(target, 'a friend to invite'));
		return { content: 'Party invite sent.', format: 1, source: 'fnbr' };
	}

	/**
	 * Accepts a party ID or a friend (display name / account ID). For a friend
	 * the bot joins the party from their presence; when that party is not
	 * visible (private) it sends a join request the friend accepts in-game.
	 */
	async joinParty(target) {
		const client = this.requireClient();
		const value = normalizeTarget(target, 'a party ID or friend');
		const friend = client.friend.resolve(value);
		if (friend) {
			const name = friend.displayName || 'that friend';
			const partyId = safeValue(() => friend.party?.id, null);
			if (partyId && partyId === client.party?.id) {
				return { content: `Already in ${name}'s party.`, format: 1, source: 'fnbr' };
			}
			if (partyId) {
				await client.joinParty(partyId);
				this.emitParty();
				return { content: `Joined ${name}'s party.`, format: 1, source: 'fnbr' };
			}
			await friend.sendJoinRequest();
			return {
				content: `${name}'s party is not joinable directly, so a join request was sent. Accept it in Fortnite.`,
				format: 2,
				source: 'fnbr'
			};
		}
		await client.joinParty(value);
		this.emitParty();
		return { content: 'Joined party.', format: 1, source: 'fnbr' };
	}

	async leaveParty() {
		const client = this.requireClient();
		await client.leaveParty(true);
		this.emitParty();
		return { content: 'Left the party and created a fresh lobby.', format: 1, source: 'fnbr' };
	}

	async kickMember(target) {
		const { client } = this.requireLeader();
		await client.party.kick(normalizeTarget(target, 'a party member'));
		this.emitParty();
		return { content: 'Party member kicked.', format: 1, source: 'fnbr' };
	}

	async promoteMember(target) {
		const { client } = this.requireLeader();
		await client.party.promote(normalizeTarget(target, 'a party member'));
		this.emitParty();
		return { content: 'Party member promoted to leader.', format: 1, source: 'fnbr' };
	}

	async setStatus(status) {
		const client = this.requireClient();
		const text = normalizeTarget(status, 'a presence status');
		client.setStatus(text);
		this.startConfig.defaultStatus = text;
		this.queueSnapshot();
		return { content: 'Presence status updated.', format: 1, source: 'fnbr' };
	}

	async setPlaylist(mnemonic) {
		const { client } = this.requireLeader();
		await client.party.setPlaylist(normalizeTarget(mnemonic, 'a playlist'));
		this.emitParty();
		return { content: 'Playlist updated.', format: 1, source: 'fnbr' };
	}

	async setPrivacy(privacy) {
		const { client } = this.requireLeader();
		const key = String(privacy || '').toLowerCase().replace(/[\s-]+/g, '_');
		const preset = PRIVACY_PRESETS[key];
		if (!preset) {
			throw runtimeError(400, `Unsupported party privacy: ${privacy}. Use ${Object.keys(PRIVACY_PRESETS).join(', ')}.`);
		}
		await client.party.setPrivacy(preset);
		this.emitParty();
		return { content: `Party privacy set to ${key}.`, format: 1, source: 'fnbr' };
	}

	async setSquadFill(fill) {
		const { client } = this.requireLeader();
		await client.party.setSquadFill(Boolean(fill));
		this.emitParty();
		return { content: fill ? 'Squad fill enabled.' : 'Squad fill disabled.', format: 1, source: 'fnbr' };
	}

	async setReadiness(ready, { auto = false } = {}) {
		const { member } = this.requireMember();
		await member.setReadiness(Boolean(ready));
		// A manual ready/unready takes over from auto-ready until the humans
		// change readiness again.
		this.autoReadied = auto && Boolean(ready);
		this.emitParty();
		return { content: ready ? 'Bot marked ready.' : 'Bot marked not ready.', format: 1, source: 'fnbr' };
	}

	async setSittingOut(sittingOut) {
		const { member } = this.requireMember();
		await member.setSittingOut(Boolean(sittingOut));
		this.emitParty();
		return { content: sittingOut ? 'Bot is sitting out.' : 'Bot is no longer sitting out.', format: 1, source: 'fnbr' };
	}

	async hideMembers(hide) {
		const { client } = this.requireLeader();
		await client.party.hideMembers(Boolean(hide));
		this.emitParty();
		return { content: hide ? 'Party members hidden.' : 'Party members unhidden.', format: 1, source: 'fnbr' };
	}

	// ------------------------------------------------------------ cosmetics

	/**
	 * Applies a saved loadout to the running bot. Never throws on a missing
	 * party so that startup can proceed; individual item failures are reported.
	 */
	async applyCategory(categoryConfig, emitUpdate = true) {
		const client = this.requireClient();
		const member = client.party?.me;
		if (!member) return { applied: [], skipped: 'The bot is not in a party yet.' };

		const wanted = {
			outfit: firstCosmetic(categoryConfig, 'startOutfit', 'joinOutfit', 'memberJoinOutfit'),
			backpack: firstCosmetic(categoryConfig, 'startBackpack', 'joinBackpack', 'memberJoinBackpack'),
			pickaxe: firstCosmetic(categoryConfig, 'startPickaxe', 'joinPickaxe', 'memberJoinPickaxe'),
			shoes: firstCosmetic(categoryConfig, 'startShoes', 'joinShoes', 'memberJoinShoes'),
			emote: firstCosmetic(categoryConfig, 'joinEmote', 'memberJoinEmote')
		};

		const applied = [];
		const failed = [];
		for (const [slot, itemId] of Object.entries(wanted)) {
			if (!itemId) continue;
			try {
				await member[COSMETIC_SLOTS[slot]](itemId);
				applied.push({ slot, itemId });
			} catch (error) {
				failed.push({ slot, itemId, error: error.message });
			}
		}

		if (categoryConfig?.privacy) {
			await this.setPrivacy(categoryConfig.privacy).catch((error) =>
				this.log(`Party privacy could not be applied: ${error.message}`, 4)
			);
		}

		if (emitUpdate) {
			this.emit('cosmetics:updated', { botId: this.botId(), cosmetics: this.toBotCard().cosmetics });
			this.queueSnapshot();
		}
		if (failed.length) {
			this.log(`Some cosmetics were rejected: ${failed.map((row) => `${row.slot} (${row.error})`).join(', ')}`, 4);
		}
		return { applied, failed };
	}

	/**
	 * Equip Now. Only reports success once the runtime has confirmed it, so the
	 * UI never shows a cosmetic the bot is not actually wearing.
	 */
	async setCosmetic(slot, itemId) {
		const { member } = this.requireMember();
		const key = normalizeSlot(slot);
		const id = normalizeTarget(itemId, 'a cosmetic item ID');

		try {
			await member[COSMETIC_SLOTS[key]](id);
		} catch (error) {
			throw runtimeError(error.status || 502, `Failed to equip cosmetic: ${error.message}`);
		}

		const cosmetics = this.toBotCard().cosmetics;
		this.emit('cosmetics:updated', { botId: this.botId(), cosmetics });
		this.queueSnapshot();
		return { content: `${key} equipped.`, format: 1, source: 'fnbr', slot: key, itemId: id, cosmetics };
	}

	async setEmote(itemId) {
		return this.setCosmetic('emote', itemId);
	}

	/**
	 * Equips several slots at once ("inventory" loadout). Only the slots given
	 * change, so equipping a backpack never touches the outfit. The emote goes
	 * last so it plays wearing the new outfit.
	 */
	async setLoadout(items = {}) {
		const { member } = this.requireMember();
		const applied = [];
		const failed = [];
		for (const slot of ['outfit', 'backpack', 'pickaxe', 'shoes', 'emote']) {
			const itemId = String(items?.[slot] || '').trim();
			if (!itemId) continue;
			try {
				await member[COSMETIC_SLOTS[slot]](itemId);
				applied.push({ slot, itemId });
			} catch (error) {
				failed.push({ slot, itemId, error: error.message });
			}
		}
		if (!applied.length && !failed.length) throw runtimeError(400, 'Pick at least one item for the loadout.');
		const cosmetics = this.toBotCard().cosmetics;
		this.emit('cosmetics:updated', { botId: this.botId(), cosmetics });
		this.queueSnapshot();
		if (failed.length) this.log(`Some loadout items were rejected: ${failed.map((row) => `${row.slot} (${row.error})`).join(', ')}`, 4);
		return {
			content: failed.length
				? `Equipped ${applied.length}, rejected ${failed.length}: ${failed.map((row) => `${row.slot} ${row.error}`).join('; ')}`
				: `Loadout equipped (${applied.map((row) => row.slot).join(', ')}).`,
			format: failed.length ? 4 : 1,
			source: 'fnbr',
			applied,
			failed,
			cosmetics
		};
	}

	async clearEmote() {
		const { member } = this.requireMember();
		await member.clearEmote();
		const cosmetics = this.toBotCard().cosmetics;
		this.emit('cosmetics:updated', { botId: this.botId(), cosmetics });
		this.queueSnapshot();
		return { content: 'Emote cleared.', format: 1, source: 'fnbr', cosmetics };
	}

	// ----------------------------------------------------------- auto-ready

	autoReadyEnabled() {
		return this.startConfig.localCategory?.config?.autoReady !== false;
	}

	partyCommandsEnabled() {
		return this.startConfig.localCategory?.config?.partyCommands !== false;
	}

	/** Party members that are real players, not this bot or the user's other bots. */
	humanMembers() {
		const client = this.client;
		const selfId = client?.user?.self?.id;
		return collectionValues(client?.party?.members).filter((member) => member.id !== selfId && !this.isTrusted(member.id));
	}

	/**
	 * Readies the bot once every human in the lobby is ready (sitting out
	 * counts as done), and unreadies it again when one of them backs out.
	 * It only undoes a ready it set itself, so a manual !ready is kept.
	 */
	/** True when every player in the lobby is ready (sitting out counts as done). */
	everyoneReady() {
		const humans = this.humanMembers();
		const ready = (member) => safeValue(() => member.isReady, false);
		const done = (member) => ready(member) || safeValue(() => member.isSittingOut, false);
		return humans.length > 0 && humans.every(done) && humans.some(ready);
	}

	syncReadiness() {
		if (!this.autoReadyEnabled() || this.readySyncing) return;
		const me = this.client?.party?.me;
		if (!me || !this.client?.isReady) return;

		const everyoneReady = this.everyoneReady();
		const botReady = safeValue(() => me.isReady, false);

		if (!everyoneReady && this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}

		if (everyoneReady && !botReady) {
			// Ready LAST: give the players a moment, then confirm they are all
			// still ready before the bot readies.
			if (this.readyTimer) return;
			this.readyTimer = setTimeout(() => {
				this.readyTimer = null;
				if (!this.everyoneReady() || safeValue(() => this.client?.party?.me?.isReady, false)) return;
				this.applyAutoReady(true);
			}, this.readyDelayMs ?? 1500);
			this.readyTimer.unref?.();
			return;
		}
		if (!everyoneReady && botReady && this.autoReadied) this.applyAutoReady(false);
	}

	applyAutoReady(want) {
		if (this.readySyncing) return;
		this.readySyncing = true;
		this.setReadiness(want, { auto: true })
			.then(() => this.log(want ? 'Auto-ready: everyone in the lobby is ready.' : 'Auto-ready: a player is no longer ready.', 2))
			.catch((error) => this.log(`Auto-ready failed: ${error.message}`, 4))
			.finally(() => {
				this.readySyncing = false;
			});
	}

	/** Lobby chat commands from players; every bot in the party reacts. */
	async handlePartyCommand(message) {
		if (!this.partyCommandsEnabled()) return;
		const authorId = message.author?.id;
		if (!authorId || authorId === this.client?.user?.self?.id || this.isTrusted(authorId)) return;
		const command = String(message.content ?? '').trim().toLowerCase();
		if (command === '!ready') return this.setReadiness(true);
		if (command === '!unready') return this.setReadiness(false);
		if (command === '!sitout') return this.setSittingOut(true);
		return undefined;
	}

	// ---------------------------------------------------------------- stats

	/**
	 * Battle royale stats from Epic's stats service for any player (or the bot
	 * itself). Players who set their stats to private get a clear 403.
	 */
	async getStats(target) {
		const client = this.requireClient();
		const value = String(target || '').trim() || client.user.self.id;
		const friend = client.friend.resolve(value);
		let stats;
		try {
			stats = await client.getBRStats(friend?.id || value);
		} catch (error) {
			if (error?.name === 'StatsPrivacyError' || /private/i.test(error?.message || '')) {
				throw runtimeError(403, `${friend?.displayName || value} has their stats set to private.`);
			}
			if (error?.name === 'UserNotFoundError') throw runtimeError(404, `No Epic account called ${value}.`);
			throw runtimeError(error.status || 502, `Could not load stats: ${error.message}`);
		}
		const pick = (row) =>
			row
				? {
						matches: row.matches ?? 0,
						wins: row.wins ?? 0,
						winRate: row.winRate ?? null,
						kills: row.kills ?? 0,
						kd: row.kd ?? null,
						killsPerMatch: row.killsPerMatch ?? null,
						top10: row.top10 ?? null,
						top25: row.top25 ?? null,
						minutesPlayed: row.minutesPlayed ?? null,
						lastModified: row.lastModified ?? null
					}
				: null;
		const all = stats?.stats?.all || {};
		return {
			user: serializeUser(stats?.user) || { id: friend?.id || value, displayName: friend?.displayName || value },
			overall: pick(all.overall),
			solo: pick(all.solo),
			duo: pick(all.duo),
			squad: pick(all.squad),
			ltm: pick(all.ltm),
			source: 'epic_stats'
		};
	}

	// ---------------------------------------------------------- DM commands

	dmCommandsEnabled() {
		return this.startConfig.localCategory?.config?.dmCommands !== false;
	}

	async replyTo(friendId, content) {
		const client = this.client;
		if (!client?.isReady) return;
		await client.friend.sendMessage(friendId, content);
		this.onFriendMessage?.(this.userId, {
			botId: this.botId(),
			friendId,
			friendName: client.friend.resolve(friendId)?.displayName || null,
			direction: 'outgoing',
			content,
			sentAt: new Date().toISOString()
		});
	}

	/**
	 * Classic lobby-bot DM commands: a friend messages a cosmetic ID or a
	 * !command and the bot applies it to itself. Messages from the user's own
	 * other bots are ignored so two bots can never loop on each other.
	 */
	async handleDmCommand(message) {
		if (!this.dmCommandsEnabled()) return;
		const friendId = message.author?.id;
		if (!friendId || this.isTrusted(friendId)) return;
		const text = String(message.content ?? '').trim();
		if (!text) return;

		const [rawCommand, ...rest] = text.split(/\s+/);
		const command = rawCommand.toLowerCase();
		const args = rest.join(' ');
		const reply = (content) => this.replyTo(friendId, content);
		const attempt = async (action, ok) => {
			try {
				const result = await action();
				await reply(typeof ok === 'function' ? ok(result) : ok);
			} catch (error) {
				await reply(`Could not do that: ${error.message}`);
			}
		};

		const upper = rawCommand.toUpperCase();
		for (const [prefix, slot] of [
			['CID_', 'outfit'],
			['BID_', 'backpack'],
			['PICKAXE_ID_', 'pickaxe'],
			['EID_', 'emote']
		]) {
			if (upper.startsWith(prefix)) {
				return attempt(() => this.setCosmetic(slot, rawCommand), `${slot} set to ${rawCommand}.`);
			}
		}

		switch (command) {
			case '!help':
			case '!commands':
				return reply(
					'Commands: CID_ / BID_ / Pickaxe_ID_ / EID_ <id>, !ready, !unready, !sitout, !stopemote, !status <text>, !stats [name], !join, !leave'
				);
			case '!ready':
				return attempt(() => this.setReadiness(true), 'Ready!');
			case '!unready':
				return attempt(() => this.setReadiness(false), 'Not ready.');
			case '!sitout':
				return attempt(() => this.setSittingOut(true), 'Sitting out.');
			case '!stopemote':
			case '!stop':
				return attempt(() => this.clearEmote(), 'Emote stopped.');
			case '!status':
				if (!args) return reply('Usage: !status <text>');
				return attempt(() => this.setStatus(args), `Status set to ${args}.`);
			case '!join':
				return attempt(() => this.joinParty(friendId), (result) => result.content);
			case '!stats':
				return attempt(
					() => this.getStats(args || friendId),
					(stats) => {
						const o = stats.overall;
						if (!o) return `${stats.user.displayName}: no stats yet.`;
						const kd = o.kd == null ? '-' : Number(o.kd).toFixed(2);
						return `${stats.user.displayName}: ${o.wins} wins, ${o.kills} kills, ${o.matches} matches, K/D ${kd}`;
					}
				);
			case '!leave':
				return attempt(() => this.leaveParty(), 'Left the party.');
			default:
				return undefined;
		}
	}

	// ----------------------------------------------------------------- misc

	async searchUsers(prefix, platform = 'epic') {
		const client = this.requireClient();
		const users = await client.user.search(normalizeTarget(prefix, 'a search prefix'), platform);
		return users.map(serializeUser);
	}

	async runCommand(command, args = '') {
		const normalized = String(command || '').trim().toLowerCase();
		const target = String(args || '').trim();

		switch (normalized) {
			case 'add_friend':
			case 'friend_add':
				return this.addFriend(target);
			case 'accept_friend':
				return this.acceptFriend(target);
			case 'decline_friend':
				return this.declineFriend(target);
			case 'remove_friend':
			case 'friend_remove':
				return this.removeFriend(target);
			case 'block_user':
			case 'block':
				return this.blockUser(target);
			case 'unblock_user':
			case 'unblock':
				return this.unblockUser(target);
			case 'invite':
				return this.inviteUser(target);
			case 'join_party':
				return this.joinParty(target);
			case 'leave':
			case 'leave_lobby':
				return this.leaveParty();
			case 'kick':
				return this.kickMember(target);
			case 'promote':
				return this.promoteMember(target);
			case 'kick_all': {
				const { client } = this.requireLeader();
				const selfId = client.user.self?.id;
				for (const member of collectionValues(client.party?.members)) {
					if (member.id !== selfId) await client.party.kick(member.id);
				}
				this.emitParty();
				return { content: 'All other party members were kicked.', format: 1, source: 'fnbr' };
			}
			case 'hide_all':
				return this.hideMembers(true);
			case 'unhide_all':
				return this.hideMembers(false);
			case 'set_status':
				return this.setStatus(target);
			case 'say':
				return this.sendPartyMessage(target);
			case 'set_playlist':
				return this.setPlaylist(target);
			case 'set_privacy':
				return this.setPrivacy(target);
			case 'fill':
				return this.setSquadFill(true);
			case 'no_fill':
				return this.setSquadFill(false);
			case 'ready':
				return this.setReadiness(true);
			case 'unready':
				return this.setReadiness(false);
			case 'sit_out':
				return this.setSittingOut(true);
			case 'stop_sitting_out':
				return this.setSittingOut(false);
			case 'outfit':
			case 'backpack':
			case 'pickaxe':
			case 'shoes':
			case 'emote':
				return this.setCosmetic(normalized, target);
			case 'clear_emote':
				return this.clearEmote();
			default:
				throw runtimeError(400, `Unsupported local fnbr command: ${command}`);
		}
	}
}

export { serializeParty, serializeUser, matchStateFrom };
