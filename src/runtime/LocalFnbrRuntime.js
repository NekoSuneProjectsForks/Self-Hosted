import { createRequire } from 'node:module';
import { BaseRuntime, runtimeError } from './BaseRuntime.js';

const require = createRequire(import.meta.url);
const { Client, Enums } = require('fnbr');

// Verified against the installed fnbr 4.2.0 typings:
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
				presence: true,
				matchTracking: true,
				searchUsers: true,
				promoteMember: true,
				multiBot: false
			}
		};
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
			/invalid[_ ]grant|device auth|authorization code|not authorized|expired/i.test(message)
		);
	}

	async stop() {
		if (this.snapshotTimer) {
			clearTimeout(this.snapshotTimer);
			this.snapshotTimer = null;
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
		});

		client.on('party:member:message', (message) => {
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
			if (!this.autoAcceptFriendRequests()) {
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
			if (!this.autoAcceptInvites()) {
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

	async joinParty(target) {
		const client = this.requireClient();
		await client.joinParty(normalizeTarget(target, 'a party ID'));
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

	async setReadiness(ready) {
		const { member } = this.requireMember();
		await member.setReadiness(Boolean(ready));
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

	async clearEmote() {
		const { member } = this.requireMember();
		await member.clearEmote();
		const cosmetics = this.toBotCard().cosmetics;
		this.emit('cosmetics:updated', { botId: this.botId(), cosmetics });
		this.queueSnapshot();
		return { content: 'Emote cleared.', format: 1, source: 'fnbr', cosmetics };
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
