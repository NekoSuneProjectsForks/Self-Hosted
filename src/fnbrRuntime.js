import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('fnbr');

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

function normalizeTarget(value) {
	const target = String(value || '').trim();
	if (!target) {
		const error = new Error('This command needs a target or value.');
		error.status = 400;
		throw error;
	}
	return target;
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

function serializePartyMember(member) {
	const matchInfo = safeValue(() => member.matchInfo, null);
	const playlist = safeValue(() => member.playlist, null);
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
		matchInfo,
		playlist
	};
}

function serializeParty(party) {
	if (!party) return null;
	const members = collectionValues(party.members).map(serializePartyMember);
	const playlist = safeValue(() => party.playlist, null);
	const leader = safeValue(() => party.leader, null);
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
		leader: serializeUser(leader),
		members
	};
}

export class LocalFnbrBot {
	constructor({ userId, startConfig, appendLog, onDeviceAuth, onSnapshot }) {
		this.kind = 'fnbr';
		this.userId = userId;
		this.startConfig = startConfig;
		this.appendLog = appendLog;
		this.onDeviceAuth = onDeviceAuth;
		this.onSnapshot = onSnapshot;
		this.client = null;
		this.disabled = false;
		this.snapshotTimer = null;
	}

	log(content, format = 0) {
		this.appendLog(this.userId, content, format);
	}

	bindEvents(client) {
		const snapshotEvents = [
			'friend:presence',
			'friend:online',
			'friend:offline',
			'friend:added',
			'friend:removed',
			'friend:request',
			'friend:request:sent',
			'friend:request:aborted',
			'friend:request:declined',
			'user:blocked',
			'user:unblocked',
			'party:invite',
			'party:member:joined',
			'party:member:updated',
			'party:member:left',
			'party:member:kicked',
			'party:member:promoted',
			'party:updated',
			'party:member:readiness:updated',
			'party:member:matchstate:updated',
			'party:member:outfit:updated',
			'party:member:emote:updated',
			'party:member:backpack:updated',
			'party:member:pickaxe:updated'
		];

		client.on('deviceauth:created', async (deviceAuth) => {
			this.startConfig.deviceAuth = deviceAuth;
			this.startConfig.authorizationCode = '';
			await this.onDeviceAuth?.(this.userId, deviceAuth);
			this.log('New device auth was created and encrypted in SQLite.', 1);
		});

		client.on('ready', () => {
			this.log(`Logged in with fnbr.js as ${client.user.self?.displayName || client.user.self?.id}.`, 1);
			this.queueSnapshot();
		});

		client.on('friend:message', (message) => {
			this.log(`Friend message from ${message.author.displayName || message.author.id}: ${message.content}`, 2);
			if (String(message.content || '').toLowerCase() === 'ping') {
				message.reply('Pong!').catch((error) => this.log(`Reply failed: ${error.message}`, 4));
			}
		});

		client.on('party:member:message', (message) => {
			this.log(`Party message from ${message.author.displayName || message.author.id}: ${message.content}`, 2);
		});

		for (const event of snapshotEvents) {
			client.on(event, () => this.queueSnapshot());
		}

		client.on('xmpp:message:error', (error) => this.log(`XMPP message error: ${error.message}`, 4));
		client.on('xmpp:presence:error', (error) => this.log(`XMPP presence error: ${error.message}`, 4));
		client.on('xmpp:chat:error', (error) => this.log(`XMPP chat error: ${error.message}`, 4));
	}

	async start() {
		const auth = this.startConfig.deviceAuth
			? { deviceAuth: this.startConfig.deviceAuth }
			: { authorizationCode: async () => this.startConfig.authorizationCode };
		const client = new Client({
			auth: {
				...auth,
				killOtherTokens: this.startConfig.killOtherTokens
			},
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
		await client.login();
		await this.applyCategory(this.startConfig.localCategory?.config || {}, false);
		this.queueSnapshot();
	}

	async stop() {
		if (this.snapshotTimer) {
			clearTimeout(this.snapshotTimer);
			this.snapshotTimer = null;
		}
		if (!this.client) return;
		const client = this.client;
		this.client = null;
		await client.logout().catch((error) => this.log(`Logout warning: ${error.message}`, 4));
	}

	queueSnapshot() {
		if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
		this.snapshotTimer = setTimeout(() => {
			this.snapshotTimer = null;
			const bot = this.toBotCard();
			if (bot?.id) this.onSnapshot?.(this.userId, bot).catch(() => {});
		}, 500);
		this.snapshotTimer.unref?.();
	}

	requireClient() {
		if (!this.client?.isReady) {
			const error = new Error('The local fnbr bot is not online yet.');
			error.status = 409;
			throw error;
		}
		return this.client;
	}

	toBotCard() {
		const client = this.client;
		const self = client?.user?.self;
		const party = serializeParty(client?.party);
		const me = client?.party?.me;
		const match = safeValue(() => me?.matchInfo, null);
		const cosmetics = {
			outfit: safeValue(() => me?.outfit, null),
			backpack: safeValue(() => me?.backpack, null),
			pickaxe: safeValue(() => me?.pickaxe, null),
			shoes: safeValue(() => me?.shoes, null),
			emote: safeValue(() => me?.emote, null)
		};

		return {
			id: self?.id || this.startConfig.deviceAuth?.accountId || 'local-fnbr-bot',
			nickname: self?.displayName || 'Local fnbr bot',
			email: self?.email || null,
			parent: null,
			flags: this.disabled ? 1 : 0,
			flagsList: this.disabled ? ['Disabled'] : [],
			isDisabled: this.disabled,
			hasInvalidAuth: false,
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
			match,
			party,
			partyMembers: party?.size ?? null,
			cosmetics
		};
	}

	dashboard(localCategory) {
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
			categories: [localCategory],
			user: serializeUser(this.client?.user?.self),
			source: 'fnbr'
		};
	}

	details(localCategory) {
		const client = this.requireClient();
		const onlineFriends = [];
		const offlineFriends = [];
		for (const friend of collectionValues(client.friend.list).map(serializeFriend)) {
			if (friend.isOnline) onlineFriends.push(friend);
			else offlineFriends.push(friend);
		}
		const incomingFriends = [];
		const outgoingFriends = [];
		for (const pending of collectionValues(client.friend.pendingList)) {
			const row = serializeUser(pending);
			if (pending.direction === 'OUTGOING') outgoingFriends.push(row);
			else incomingFriends.push(row);
		}
		return {
			bot: this.toBotCard(),
			friends: { onlineFriends, offlineFriends },
			pendingFriends: { incomingFriends, outgoingFriends },
			blockedUsers: collectionValues(client.user.blocklist).map(serializeUser),
			categories: [localCategory],
			source: 'fnbr'
		};
	}

	async applyCategory(categoryConfig, saveSnapshot = true) {
		const client = this.requireClient();
		const member = client.party?.me;
		if (!member) return;

		const outfit = firstCosmetic(categoryConfig, 'startOutfit', 'joinOutfit', 'memberJoinOutfit');
		const backpack = firstCosmetic(categoryConfig, 'startBackpack', 'joinBackpack', 'memberJoinBackpack');
		const pickaxe = firstCosmetic(categoryConfig, 'startPickaxe', 'joinPickaxe', 'memberJoinPickaxe');
		const shoes = firstCosmetic(categoryConfig, 'startShoes', 'joinShoes', 'memberJoinShoes');
		const emote = firstCosmetic(categoryConfig, 'joinEmote', 'memberJoinEmote');

		if (outfit) await member.setOutfit(outfit);
		if (backpack) await member.setBackpack(backpack);
		if (pickaxe) await member.setPickaxe(pickaxe);
		if (shoes) await member.setShoes(shoes);
		if (emote) await member.setEmote(emote);

		if (saveSnapshot) this.queueSnapshot();
	}

	async applyCosmetic(slot, itemId) {
		const client = this.requireClient();
		const member = client.party?.me;
		if (!member) return;

		if (slot.toLowerCase().includes('outfit')) await member.setOutfit(itemId);
		else if (slot.toLowerCase().includes('backpack')) await member.setBackpack(itemId);
		else if (slot.toLowerCase().includes('pickaxe')) await member.setPickaxe(itemId);
		else if (slot.toLowerCase().includes('shoes')) await member.setShoes(itemId);
		else if (slot.toLowerCase().includes('emote')) await member.setEmote(itemId);
		else {
			const error = new Error('Unsupported local fnbr cosmetic slot.');
			error.status = 400;
			throw error;
		}

		this.queueSnapshot();
	}

	async sendChatMessage(content) {
		const client = this.requireClient();
		const message = normalizeTarget(content);
		await client.party?.sendMessage(message);
		return { content: 'Party chat message sent.', format: 1, source: 'fnbr' };
	}

	async searchUsers(prefix, platform = 'epic') {
		const client = this.requireClient();
		const users = await client.user.search(normalizeTarget(prefix), platform);
		return users.map(serializeUser);
	}

	async runCommand(command, args = '') {
		const client = this.requireClient();
		const normalized = String(command || '').trim().toLowerCase();
		const target = String(args || '').trim();

		switch (normalized) {
			case 'add_friend':
			case 'friend_add':
				await client.friend.add(normalizeTarget(target));
				return { content: 'Friend request sent or accepted.', format: 1, source: 'fnbr' };
			case 'remove_friend':
			case 'friend_remove':
				await client.friend.remove(normalizeTarget(target));
				return { content: 'Friend removed or pending request cancelled.', format: 1, source: 'fnbr' };
			case 'block_user':
			case 'block':
				await client.user.block(normalizeTarget(target));
				return { content: 'User blocked.', format: 1, source: 'fnbr' };
			case 'unblock_user':
			case 'unblock':
				await client.user.unblock(normalizeTarget(target));
				return { content: 'User unblocked.', format: 1, source: 'fnbr' };
			case 'invite':
				await client.invite(normalizeTarget(target));
				return { content: 'Party invite sent.', format: 1, source: 'fnbr' };
			case 'join_party':
				await client.joinParty(normalizeTarget(target));
				return { content: 'Joined party.', format: 1, source: 'fnbr' };
			case 'leave':
			case 'leave_lobby':
				await client.leaveParty(true);
				return { content: 'Left current party and created a fresh lobby.', format: 1, source: 'fnbr' };
			case 'kick':
				await client.party?.kick(normalizeTarget(target));
				return { content: 'Party member kicked.', format: 1, source: 'fnbr' };
			case 'kick_all': {
				const selfId = client.user.self?.id;
				for (const member of collectionValues(client.party?.members)) {
					if (member.id !== selfId) await client.party.kick(member.id);
				}
				return { content: 'All other party members were kicked.', format: 1, source: 'fnbr' };
			}
			case 'hide_all':
				await client.party?.hideMembers(true);
				return { content: 'Party members hidden.', format: 1, source: 'fnbr' };
			case 'unhide_all':
				await client.party?.hideMembers(false);
				return { content: 'Party members unhidden.', format: 1, source: 'fnbr' };
			case 'set_status':
				client.setStatus(normalizeTarget(target));
				return { content: 'Presence status updated.', format: 1, source: 'fnbr' };
			case 'say':
				return this.sendChatMessage(target);
			case 'set_playlist':
				await client.party?.setPlaylist(normalizeTarget(target));
				return { content: 'Playlist updated.', format: 1, source: 'fnbr' };
			case 'ready':
				await client.party?.me?.setReadiness(true);
				return { content: 'Bot marked ready.', format: 1, source: 'fnbr' };
			case 'unready':
				await client.party?.me?.setReadiness(false);
				return { content: 'Bot marked not ready.', format: 1, source: 'fnbr' };
			case 'outfit':
				await this.applyCosmetic('outfit', normalizeTarget(target));
				return { content: 'Outfit equipped.', format: 1, source: 'fnbr' };
			case 'backpack':
				await this.applyCosmetic('backpack', normalizeTarget(target));
				return { content: 'Backpack equipped.', format: 1, source: 'fnbr' };
			case 'pickaxe':
				await this.applyCosmetic('pickaxe', normalizeTarget(target));
				return { content: 'Pickaxe equipped.', format: 1, source: 'fnbr' };
			case 'shoes':
				await this.applyCosmetic('shoes', normalizeTarget(target));
				return { content: 'Shoes equipped.', format: 1, source: 'fnbr' };
			case 'emote':
				await this.applyCosmetic('emote', normalizeTarget(target));
				return { content: 'Emote started.', format: 1, source: 'fnbr' };
			case 'clear_emote':
				await client.party?.me?.clearEmote();
				return { content: 'Emote cleared.', format: 1, source: 'fnbr' };
			default: {
				const error = new Error(`Unsupported local fnbr command: ${command}`);
				error.status = 400;
				throw error;
			}
		}
	}
}
