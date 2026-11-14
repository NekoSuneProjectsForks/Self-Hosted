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

/** Profile fields shown in the lobby (level, battle pass, banner, crowns). */
const PROFILE_KEYS = ['battlePassLevel', 'battlePassPurchased', 'bannerId', 'bannerColor', 'crowns'];

function clampInt(value, min, max) {
	const number = Number.parseInt(value, 10);
	if (!Number.isFinite(number)) return null;
	return Math.min(max, Math.max(min, number));
}

/** Cleans a profile patch; unknown or empty fields are dropped (= no change). */
export function normalizeProfile(input = {}) {
	const out = {};
	if (input.battlePassLevel !== undefined && input.battlePassLevel !== null && input.battlePassLevel !== '') {
		const level = clampInt(input.battlePassLevel, 1, 10000);
		if (level === null) throw runtimeError(400, 'Battle pass level must be a number.');
		out.battlePassLevel = level;
	}
	if (input.battlePassPurchased !== undefined && input.battlePassPurchased !== null && input.battlePassPurchased !== '') {
		out.battlePassPurchased = input.battlePassPurchased === true || input.battlePassPurchased === 'true' || input.battlePassPurchased === 'on';
	}
	const bannerId = String(input.bannerId ?? '').trim();
	const bannerColor = String(input.bannerColor ?? '').trim();
	if (bannerId) out.bannerId = bannerId.slice(0, 64);
	if (bannerColor) out.bannerColor = bannerColor.slice(0, 64);
	if (input.crowns !== undefined && input.crowns !== null && input.crowns !== '') {
		const crowns = clampInt(input.crowns, 0, 100000);
		if (crowns === null) throw runtimeError(400, 'Crowns must be a number.');
		out.crowns = crowns;
	}
	return out;
}

/**
 * A member's mode selection from the 42.x lobby meta: each member publishes
 * its own MatchmakingInfo.islandSelection (LinkId + MatchmakingSettingsV2).
 */
export function islandOf(member) {
	const info = safeValue(() => member?.meta?.get?.('Default:MatchmakingInfo_j')?.MatchmakingInfo, null);
	let island = info?.islandSelection?.island ?? null;
	if (typeof island === 'string') {
		try {
			island = JSON.parse(island);
		} catch {
			island = null;
		}
	}
	const settings = island?.MatchmakingSettingsV2 || {};
	return {
		linkId: island?.LinkId || null,
		teamSize: settings['/Fortnite.com/BattleRoyale/Matchmaking:TeamSize'] || null,
		buildMode: settings['/Fortnite.com/BattleRoyale/Matchmaking:BuildMode'] || null,
		squadFill: settings['/Fortnite.com/Matchmaking:SquadFill'] || null,
		ranked: settings['/Fortnite.com/Matchmaking:Ranked'] || null,
		region: settings['/Fortnite.com/Matchmaking:Region'] || null,
		timestamp: info?.islandSelection?.timestamp ?? null
	};
}

/**
 * 42.x per-member queue records. The bot must never publish another member's
 * copy (see syncFromLeader). EMPTY_* is what a real client's unused slot holds.
 */
const MATCHMAKING_DATA_KEYS = ['Default:MatchmakingData1_j', 'Default:MatchmakingData2_j'];
const EMPTY_GROUP_MEMBER_DATA = {
	iD: '',
	schemaId: 0,
	barrierBits: 0,
	failReason: '',
	timedOutBarrierIndex: 4294967295,
	worldSessionId: '',
	matchmakingDelay: 0,
	playlistVersion: 0,
	hiddenMatchmakingDelayMax: 0,
	state: 0,
	result: 0
};
// Same shape rebootpy publishes for a bot by default (an idle, unused slot).
const EMPTY_ISLAND_SELECTION = {
	island: JSON.stringify({
		LinkId: '',
		Session: { iD: '', joinInfo: { joinability: 'CanNotBeJoinedOrWatched', sessionKey: '' } },
		MatchmakingSettingsV2: { '/Fortnite.com/Matchmaking:Region': 'EU' }
	}),
	timestamp: 0,
	bUsingGracefulUpgrade: true,
	matchmakingId: ''
};
const EMPTY_MATCHMAKING_DATA = {
	'Default:MatchmakingData1_j': JSON.stringify({ MatchmakingData1: { groupMemberData: EMPTY_GROUP_MEMBER_DATA, islandSelection: EMPTY_ISLAND_SELECTION, priority: 1 } }),
	'Default:MatchmakingData2_j': JSON.stringify({ MatchmakingData2: { groupMemberData: EMPTY_GROUP_MEMBER_DATA, islandSelection: EMPTY_ISLAND_SELECTION, priority: 1 } })
};

/**
 * Experimental "follow the leader's queue": the progress fields of the
 * leader's groupMemberData that the bot echoes into its OWN slot. Never the
 * IDs that name a match or session (worldSessionId, matchmakingId, the
 * island selection), which is what crashed the leader's PS5 when the whole
 * record was copied.
 */
const FOLLOWED_GROUP_FIELDS = ['iD', 'schemaId', 'barrierBits', 'state', 'result', 'failReason', 'timedOutBarrierIndex', 'matchmakingDelay', 'playlistVersion', 'hiddenMatchmakingDelayMax'];

/** The bot's MatchmakingData1 value for a leader groupMemberData (idle slot if not queueing). */
export function followedMatchmakingData(leaderGroup) {
	const group = { ...EMPTY_GROUP_MEMBER_DATA };
	if (leaderGroup?.iD) {
		for (const field of FOLLOWED_GROUP_FIELDS) if (leaderGroup[field] !== undefined) group[field] = leaderGroup[field];
	}
	return JSON.stringify({ MatchmakingData1: { groupMemberData: group, islandSelection: EMPTY_ISLAND_SELECTION, priority: 1 } });
}

function sameJson(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** "1:3:12345678" or a bare netCL → "1:3:12345678"; anything without a number → null. */
export function normalizeBuildId(value) {
	const text = String(value ?? '').trim();
	const netCL = text.split(':').pop();
	return /^\d{4,}$/.test(netCL || '') ? `1:3:${netCL}` : null;
}

/** The Duo/Trio/Squad version of a Solo playlist for `players` people. */
export function teamPlaylistFor(playlistId, players) {
	const id = String(playlistId || '');
	const size = players <= 2 ? 2 : players === 3 ? 3 : 4;
	if (/^Playlist_DefaultSolo$/i.test(id)) return { 2: 'Playlist_DefaultDuo', 3: 'Playlist_Trios', 4: 'Playlist_DefaultSquad' }[size];
	if (/^Playlist_NoBuildBR_Solo$/i.test(id)) return { 2: 'Playlist_NoBuildBR_Duo', 3: 'Playlist_NoBuildBR_Trio', 4: 'Playlist_NoBuildBR_Squad' }[size];
	return null;
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
		playlist: safeValue(() => member.playlist, null),
		battlePassLevel: safeValue(() => member.battlepass?.passLevel ?? member.meta?.battlepass?.passLevel, null),
		bannerId: safeValue(() => member.banner?.bannerIconId, null)
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
		playlistId: safeValue(() => party.playlistId, null) || playlist?.linkId?.mnemonic || playlist?.LinkId || null,
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
				matchmakingCheck: true,
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

		const manualBuild = normalizeBuildId(this.startConfig.partyBuildId || this.startConfig.localCategory?.config?.partyBuildId);
		const client = new Client({
			auth: { ...auth, killOtherTokens: this.startConfig.killOtherTokens },
			...(manualBuild ? { partyBuildId: manualBuild } : {}),
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

		// Must happen before the bot is used in a lobby; see ensureGameBuild().
		await this.ensureGameBuild().catch((error) => this.log(`[Local fnbr] Game build check failed: ${error.message}`, 4));

		// A failed startup loadout must not take the whole bot down with it.
		this.defaultsPartyId = client.party?.id || null;
		await this.applyCategory(this.startConfig.localCategory?.config || {}, false).catch((error) =>
			this.log(`[Local fnbr] Startup loadout could not be applied: ${error.message}`, 4)
		);

		this.queueSnapshot();
	}

	/**
	 * fnbr creates the bot's first party during login() with the default
	 * partyBuildId "1:3:" (no Fortnite build number / netCL), and puts the same
	 * value in the bot's presence. Fortnite then sees the bot as being on a
	 * different game version, which can stop the party from matchmaking even
	 * though everyone is ready. (fnbr >= 4.2.70 only looks the netCL up when
	 * joining a party.) Fix: look the build up now and, if the bot is alone,
	 * recreate its party so the party and presence carry the real build.
	 */
	async ensureGameBuild() {
		const client = this.client;
		if (!client) return;
		let build = normalizeBuildId(client.config.partyBuildId);
		if (!build) {
			try {
				build = normalizeBuildId(await client.fetchPartyBuildId());
			} catch (error) {
				this.log(`[Local fnbr] Could not look up the Fortnite build from Epic (${error.message}). It will be taken from a friend's party when one is seen, or set it under Bots → Lobby behaviour → Fortnite build.`, 3);
			}
		}
		this.health.gameBuild = build || 'unknown';
		if (!build) return;
		await this.adoptGameBuild(build, 'Epic');
	}

	/** Uses a build ID and refreshes the bot's own party/presence if it was wrong. */
	async adoptGameBuild(build, source) {
		const client = this.client;
		if (!client || !build) return;
		const partyBuild = safeValue(() => client.party?.meta?.get?.('urn:epic:cfg:build-id_s'), null);
		const changed = normalizeBuildId(client.config.partyBuildId) !== build;
		client.config.partyBuildId = build;
		this.health.gameBuild = build;
		const partyNeedsIt = partyBuild !== build || changed;
		if (!partyNeedsIt) return;
		this.log(`[Local fnbr] Fortnite build ${build.split(':').pop()} (from ${source}).`, 2);
		// Only rebuild the party when the bot is on its own, so nobody is kicked.
		if ((client.party?.size ?? 1) <= 1) {
			await client.leaveParty(true).catch((error) => this.log(`[Local fnbr] Could not refresh the party: ${error.message}`, 4));
			this.log('[Local fnbr] Party recreated with the correct game build.', 1);
		}
		try {
			client.setStatus(this.startConfig.defaultStatus);
		} catch {
			// Presence refresh is best-effort.
		}
		this.emitParty();
	}

	/** Diagnostics for "no match found": what the bot is telling Fortnite. */
	matchmakingCheck() {
		const client = this.requireClient();
		const party = client.party;
		const me = party?.me;
		const selfId = client.user.self.id;
		const meta = (member, key) => safeValue(() => member?.meta?.get?.(key), null);
		const raw = (member, key) => safeValue(() => member?.meta?.schema?.[key], null);
		const build = normalizeBuildId(client.config?.partyBuildId);
		const partyBuild = safeValue(() => party?.meta?.get?.('urn:epic:cfg:build-id_s'), null) || null;
		const allMembers = collectionValues(party?.members);
		const members = allMembers.map((member) => ({
			id: member.id,
			displayName: member.displayName || null,
			isBot: member.id === selfId || this.isTrusted(member.id),
			isLeader: safeValue(() => member.isLeader, false),
			ready: meta(member, 'Default:MatchmakingInfo_j')?.MatchmakingInfo?.readyStatus ?? null,
			mode: islandOf(member),
			downloadProgress: raw(member, 'Default:DownloadOnDemandProgress_d'),
			hasPreloadedAthena: meta(member, 'Default:LobbyState_j')?.LobbyState?.hasPreloadedAthena ?? null,
			platform: safeValue(() => member.platform, null),
			crossplay: meta(member, 'Default:CrossplayPreference_s') || null,
			location: safeValue(() => member.matchInfo?.location, null)
		}));
		const leader = safeValue(() => party?.leader, null);
		const leaderRow = members.find((row) => row.id === leader?.id) || members.find((row) => row.isLeader);
		const meRow = members.find((row) => row.id === selfId);
		const playlistId = serializeParty(party)?.playlistId || leaderRow?.mode?.linkId || null;

		const problems = [];
		if (!build) problems.push('The bot does not know the Fortnite build (netCL); it may look like a different game version. Set it under Bots → Lobby behaviour → Fortnite build.');
		if (build && partyBuild && partyBuild !== build) problems.push(`The party was created with build "${partyBuild}" but the bot now uses "${build}". Make the bot leave and rejoin.`);
		if (leaderRow && meRow && leaderRow.id !== meRow.id) {
			for (const key of ['linkId', 'teamSize', 'buildMode', 'squadFill', 'ranked', 'region']) {
				if ((leaderRow.mode[key] || null) !== (meRow.mode[key] || null)) {
					problems.push(`Mode mismatch on ${key}: leader has "${leaderRow.mode[key] ?? '-'}", bot has "${meRow.mode[key] ?? '-'}".`);
				}
			}
			if (leaderRow.downloadProgress && leaderRow.downloadProgress !== meRow.downloadProgress) problems.push(`Download progress differs: leader ${leaderRow.downloadProgress}, bot ${meRow.downloadProgress}.`);
		}
		if (leader && me && leader.id !== selfId && raw(leader, 'SubGame_u') && raw(leader, 'SubGame_u') !== raw(me, 'SubGame_u')) {
			problems.push(`Sub-game differs: leader ${raw(leader, 'SubGame_u')}, bot ${raw(me, 'SubGame_u')} (the bot fixes this when "Match the leader's mode" is on).`);
		}
		const teamSize = leaderRow?.mode?.teamSize;
		if (teamSize === 'Solo' && members.length > 1) problems.push('Team size is Solo with more than one member.');
		if (members.filter((m) => m.isBot).length > 1) problems.push('More than one of your bots is in the party.');
		if (leaderRow?.mode?.squadFill && leaderRow.mode.squadFill !== 'NoFill') problems.push(`Team fill is "${leaderRow.mode.squadFill}"; FNLB recommends No Fill.`);
		for (const m of members) if (m.crossplay && m.crossplay !== 'OptedIn') problems.push(`${m.displayName || m.id} has crossplay ${m.crossplay}.`);
		const failed = [...(this.mmTimeline || [])].reverse().find((row) => row.failReason);
		if (failed) problems.push(`Last matchmaking attempt failed: ${failed.failReason} (state ${failed.state}, barrier ${failed.timedOutBarrierIndex}).`);
		if (leader && me && leader.id !== selfId) {
			for (const key of MATCHMAKING_DATA_KEYS) {
				const ours = raw(me, key);
				if (ours && ours !== EMPTY_MATCHMAKING_DATA[key] && ours === raw(leader, key)) problems.push(`The bot is publishing a copy of the leader's ${key.replace('Default:', '')}. Stop and start the bot to clear it.`);
			}
		}
		const lastRow = (this.mmTimeline || [])[(this.mmTimeline || []).length - 1];
		if (lastRow && lastRow.groupId && lastRow.leaderReady === 'Ready' && lastRow.ownerStarted !== true && !lastRow.failReason) {
			problems.push(this.followLeaderQueue()
				? `The leader's queue stopped at barrier ${lastRow.barrierBits} with "Follow the leader's queue" on (bot at ${lastRow.botBarrierBits ?? 'none'}).`
				: `The leader's queue stopped at barrier ${lastRow.barrierBits} without starting. Their console waits for every member to follow the queue; try "Follow the leader's queue (experimental)" or "Step out when you ready up".`);
		}

		// Every non-cosmetic member field that differs between the bot and the leader.
		const COSMETIC = /Loadout|Cosmetic|Banner|BattlePass|Emote|Variant|Sidekick|Mimosa|AssistedChallenge|Sticker|Jam|Contrail|Pack|Outfit|Pickaxe|Glider|Shoes|Emoji|Spray|Wrap|Character|Avatar|Lobby_Map/i;
		const differences = [];
		if (leader && me && leader.id !== selfId) {
			const keys = new Set([...Object.keys(safeValue(() => leader.meta.schema, {}) || {}), ...Object.keys(safeValue(() => me.meta.schema, {}) || {})]);
			for (const key of [...keys].sort()) {
				if (COSMETIC.test(key)) continue;
				const theirs = raw(leader, key);
				const ours = raw(me, key);
				if (theirs === ours) continue;
				const cut = (value) => (value == null ? null : String(value).length > 600 ? `${String(value).slice(0, 600)}...` : String(value));
				differences.push({ key, leader: cut(theirs), bot: cut(ours) });
			}
		}

		return {
			botBuild: build || null,
			partyBuild,
			partyId: party?.id || null,
			playlistId,
			mirrorLeader: this.mirrorLeaderEnabled(),
			matchmakingTimeline: this.mmTimeline || [],
			members,
			problems,
			differences
		};
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
		if (this.defaultsTimer) {
			clearTimeout(this.defaultsTimer);
			this.defaultsTimer = null;
		}
		if (this.emoteTimer) {
			clearTimeout(this.emoteTimer);
			this.emoteTimer = null;
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
		client.on('party:member:updated', (member) => {
			if (member?.id && member.id !== client.user?.self?.id && safeValue(() => client.party?.leader?.id, null) === member.id) {
				this.recordMatchmaking(member);
				this.syncFromLeader().catch(() => {});
				this.syncSubGame().catch(() => {});
			}
			this.syncReadiness();
		});

		// Join defaults: whenever the bot lands in a different party (it joined
		// someone, was invited, or made its own fresh party), it goes back to the
		// saved default look. Live edits only last for the current party.
		for (const event of ['party:updated', 'party:member:joined', 'party:member:updated', 'party:recreated']) {
			client.on(event, () => this.checkNewParty());
		}

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
		client.on('friend:presence', (_before, after) => {
			this.onFriendPresence(after);
			// No build yet? A real player's party presence carries it.
			if (!normalizeBuildId(client.config.partyBuildId)) {
				const build = normalizeBuildId(safeValue(() => after?.friend?.party?.buildId, null));
				if (build) this.adoptGameBuild(build, `${after.friend.displayName || 'a friend'}'s party`).catch(() => {});
			}
		});

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

		client.on('party:member:matchstate:updated', (member, value) => {
			this.onMemberMatchState(member, value);
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
			profile: this.currentProfile(),
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
		if (ready) {
			await this.syncFromLeader().catch(() => false);
			await this.syncSubGame().catch(() => false);
		}
		await member.setReadiness(Boolean(ready));
		// A manual ready/unready takes over from auto-ready until the humans
		// change readiness again (and from sit-out until the bot changes party).
		this.autoReadied = auto && Boolean(ready);
		if (!auto) this.manualReadiness = true;
		this.emitParty();
		return { content: ready ? 'Bot marked ready.' : 'Bot marked not ready.', format: 1, source: 'fnbr' };
	}

	async setSittingOut(sittingOut, { auto = false } = {}) {
		const { member } = this.requireMember();
		await member.setSittingOut(Boolean(sittingOut));
		// A manual change (dashboard / command) wins until the bot changes party.
		if (!auto) this.manualReadiness = true;
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
	checkNewParty() {
		const partyId = this.client?.party?.id;
		if (!partyId || !this.client?.isReady || partyId === this.defaultsPartyId) return;
		this.defaultsPartyId = partyId;
		this.manualReadiness = false;
		// Let the join settle before patching our member meta.
		if (this.defaultsTimer) clearTimeout(this.defaultsTimer);
		this.defaultsTimer = setTimeout(() => {
			this.defaultsTimer = null;
			if (this.client?.party?.id !== partyId) return;
			this.applyCategory(this.startConfig.localCategory?.config || {})
				.then((result) => {
					if (result?.applied?.length) this.log('Joined a new party: default look applied.', 2);
				})
				.catch((error) => this.log(`Could not apply join defaults: ${error.message}`, 4));
		}, this.defaultsDelayMs ?? 1000);
		this.defaultsTimer.unref?.();
	}

	/**
	 * Copies another party member's look onto this bot: outfit, back bling,
	 * pickaxe, kicks, and (unless turned off) their battle pass level and banner.
	 * Item styles aren't copied: Epic stores them in a form fnbr can't send back.
	 * Like every live change, it lasts until the bot joins another party.
	 */
	async copyMember(target, { profile = true } = {}) {
		const client = this.requireClient();
		const value = normalizeTarget(target, 'a party member');
		const members = collectionValues(client.party?.members);
		const member =
			members.find((row) => row.id === value) ||
			members.find((row) => String(row.displayName || '').toLowerCase() === value.toLowerCase());
		if (!member) throw runtimeError(404, 'That player is not in the bot\'s party.');
		if (member.id === client.user.self.id) throw runtimeError(400, 'The bot cannot copy itself.');

		const items = {
			outfit: safeValue(() => member.outfit, null),
			backpack: safeValue(() => member.backpack, null),
			pickaxe: safeValue(() => member.pickaxe, null),
			shoes: safeValue(() => member.shoes, null)
		};
		const name = member.displayName || 'that player';
		if (!Object.values(items).some(Boolean)) throw runtimeError(409, `${name} isn't showing any cosmetics yet.`);
		const result = await this.setLoadout(items);

		let profileResult = null;
		if (profile) {
			const bp = safeValue(() => member.battlepass, null) || safeValue(() => member.meta?.battlepass, null);
			const banner = safeValue(() => member.banner, null);
			const patchProfile = {};
			if (bp?.passLevel) {
				patchProfile.battlePassLevel = bp.passLevel;
				patchProfile.battlePassPurchased = Boolean(bp.bHasPurchasedPass);
			}
			if (banner?.bannerIconId) patchProfile.bannerId = banner.bannerIconId;
			if (banner?.bannerColorId) patchProfile.bannerColor = banner.bannerColorId;
			if (Object.keys(patchProfile).length) profileResult = await this.setProfile(patchProfile).catch(() => null);
		}

		return {
			...result,
			content: `Copied ${name}'s look (${result.applied.map((row) => row.slot).join(', ') || 'nothing'}${profileResult?.applied?.length ? ', battle pass/banner' : ''}).${result.failed.length ? ` Rejected: ${result.failed.map((row) => row.slot).join(', ')}.` : ''}`,
			copiedFrom: { id: member.id, displayName: member.displayName || null }
		};
	}

	/** Level, battle pass, banner and crowns, applied live to this party only. */
	async setProfile(input = {}) {
		const { member } = this.requireMember();
		const profile = normalizeProfile(input);
		const applied = [];
		const failed = [];
		const attempt = async (key, action) => {
			try {
				await action();
				applied.push(key);
			} catch (error) {
				failed.push({ key, error: error.message });
			}
		};

		if (profile.battlePassLevel !== undefined || profile.battlePassPurchased !== undefined) {
			const current = safeValue(() => member.meta?.battlepass, null);
			const purchased = profile.battlePassPurchased ?? current?.bHasPurchasedPass ?? false;
			const level = profile.battlePassLevel ?? current?.passLevel ?? 1;
			await attempt('battlePass', () => member.setBattlePass(purchased, level));
		}
		if (profile.bannerId || profile.bannerColor) {
			const banner = safeValue(() => member.banner, null);
			const id = profile.bannerId || banner?.bannerIconId || 'BRSeason01';
			const color = profile.bannerColor || banner?.bannerColorId || 'defaultcolor1';
			await attempt('banner', () => member.setBanner(id, color));
		}
		if (profile.crowns !== undefined) {
			await attempt('crowns', () => member.setCosmeticStats(profile.crowns, 0));
		}
		if (!applied.length && !failed.length) throw runtimeError(400, 'Nothing to change: fill in at least one field.');
		this.emitParty();
		return {
			content: failed.length
				? `Updated ${applied.join(', ') || 'nothing'}; failed ${failed.map((row) => `${row.key} (${row.error})`).join(', ')}.`
				: `Updated ${applied.join(', ')} for this party.`,
			format: failed.length ? 4 : 1,
			source: 'fnbr',
			applied,
			failed,
			profile: this.currentProfile()
		};
	}

	currentProfile() {
		const member = this.client?.party?.me;
		if (!member) return null;
		const bp = safeValue(() => member.meta?.battlepass, null);
		const banner = safeValue(() => member.banner, null);
		return {
			battlePassLevel: bp?.passLevel ?? null,
			battlePassPurchased: bp?.bHasPurchasedPass ?? null,
			bannerId: banner?.bannerIconId ?? null,
			bannerColor: banner?.bannerColorId ?? null
		};
	}

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
				await this.equipSlot(member, slot, itemId);
				applied.push({ slot, itemId });
			} catch (error) {
				failed.push({ slot, itemId, error: error.message });
			}
		}

		// Default profile (level, battle pass, banner, crowns).
		const profile = {};
		for (const key of PROFILE_KEYS) if (categoryConfig?.[key] !== undefined && categoryConfig[key] !== null) profile[key] = categoryConfig[key];
		if (Object.keys(profile).length) {
			const result = await this.setProfile(profile).catch((error) => ({ failed: [{ key: 'profile', error: error.message }], applied: [] }));
			for (const key of result.applied || []) applied.push({ slot: key });
			for (const row of result.failed || []) failed.push({ slot: row.key, error: row.error });
		}

		// Sit out so the party can queue (see sitOutMode).
		if (this.sitOutMode() && typeof member.setSittingOut === 'function' && !safeValue(() => member.isSittingOut, false)) {
			try {
				await member.setSittingOut(true);
				applied.push({ slot: 'sitOut' });
			} catch (error) {
				failed.push({ slot: 'sitOut', error: error.message });
			}
		}

		// Privacy is the leader's call; in someone else's party just skip it.
		if (categoryConfig?.privacy && member.isLeader) {
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
			await this.equipSlot(member, key, id);
		} catch (error) {
			throw runtimeError(error.status || 502, `Failed to equip cosmetic: ${error.message}`);
		}

		const cosmetics = this.toBotCard().cosmetics;
		this.emit('cosmetics:updated', { botId: this.botId(), cosmetics });
		this.queueSnapshot();
		return { content: `${key} equipped.`, format: 1, source: 'fnbr', slot: key, itemId: id, cosmetics };
	}

	/** One place every cosmetic goes through, so emotes can be made to play once. */
	async equipSlot(member, slot, itemId) {
		await member[COSMETIC_SLOTS[slot]](itemId);
		if (slot === 'emote') this.scheduleEmoteStop();
	}

	emotePlayOnce() {
		return this.startConfig.localCategory?.config?.emotePlayOnce !== false;
	}

	emoteSeconds() {
		const seconds = Number(this.startConfig.localCategory?.config?.emoteSeconds);
		return Number.isFinite(seconds) ? Math.min(60, Math.max(1, seconds)) : 6;
	}

	/**
	 * Fortnite keeps showing a party member's emote until it is cleared, so a
	 * dance loops forever. "Play once" clears it after the emote's length. A
	 * new emote restarts the timer; a manual stop cancels it.
	 */
	scheduleEmoteStop() {
		if (this.emoteTimer) clearTimeout(this.emoteTimer);
		this.emoteTimer = null;
		if (!this.emotePlayOnce()) return;
		this.emoteTimer = setTimeout(() => {
			this.emoteTimer = null;
			const member = this.client?.party?.me;
			if (!member || !safeValue(() => member.emote, null)) return;
			member
				.clearEmote()
				.then(() => this.emit('cosmetics:updated', { botId: this.botId(), cosmetics: this.toBotCard().cosmetics }))
				.catch(() => {});
		}, this.emoteSeconds() * 1000);
		this.emoteTimer.unref?.();
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
				await this.equipSlot(member, slot, itemId);
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
		if (this.emoteTimer) clearTimeout(this.emoteTimer);
		this.emoteTimer = null;
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
	/**
	 * Bots can't load into a match. A Ready bot is counted as a player who then
	 * never connects, so matchmaking fails ("can't find a match"). Sitting out
	 * keeps the bot in the lobby while the rest of the party queues. On by
	 * default; auto-ready is only used when this is switched off.
	 */
	sitOutMode() {
		return this.startConfig.localCategory?.config?.botsSitOut === true;
	}

	leaveOnMatchStart() {
		return this.startConfig.localCategory?.config?.leaveOnMatchStart !== false;
	}

	/** Experimental, off by default: echo the leader's queue progress in the bot's own slot. */
	followLeaderQueue() {
		// Disabled: echoing the leader's barriers crashed the leader's PS5 twice
		// (CE-108255-1). Kept for the code path only; never turns on.
		return false;
	}

	/** Fallback, off by default: step out when the leader readies, rejoin after. */
	leaveWhenQueueStarts() {
		return this.startConfig.localCategory?.config?.leaveWhenQueueStarts === true;
	}

	rejoinAfterMatch() {
		return this.startConfig.localCategory?.config?.rejoinAfterMatch !== false;
	}

	/** The user's own bots in this party (this one included), by account ID. */
	ownBotIds() {
		const selfId = this.client?.user?.self?.id;
		return collectionValues(this.client?.party?.members)
			.map((member) => member.id)
			.filter((id) => id === selfId || this.isTrusted(id))
			.sort();
	}

	/**
	 * FNLB: "Two or more bots break the bot lobby." When several of the user's
	 * bots share a party, exactly one (the same one on every bot: lowest ID)
	 * goes along; the others leave once the players are ready.
	 */
	isDesignatedBot() {
		const ids = this.ownBotIds();
		return ids.length <= 1 || ids[0] === this.client?.user?.self?.id;
	}

	warnOnce(kind, text) {
		const key = `${this.client?.party?.id}:${kind}`;
		this.warned ||= new Set();
		if (this.warned.has(key)) return;
		this.warned.add(key);
		this.log(text, 3);
		this.client?.party?.sendMessage?.(text)?.catch?.(() => {});
	}

	ensureSittingOut() {
		if (!this.sitOutMode() || this.manualReadiness || this.sittingOutSyncing) return;
		const me = this.client?.party?.me;
		if (!me || !this.client?.isReady) return;
		if (safeValue(() => me.isSittingOut, false)) return;
		this.sittingOutSyncing = true;
		this.setSittingOut(true, { auto: true })
			.then(() => this.log('Sitting out so the party can matchmake (bots cannot play matches).', 2))
			.catch((error) => this.log(`Could not sit out: ${error.message}`, 4))
			.finally(() => {
				this.sittingOutSyncing = false;
			});
	}

	/** True when every player in the lobby is ready (sitting out counts as done). */
	everyoneReady() {
		const humans = this.humanMembers();
		const ready = (member) => safeValue(() => member.isReady, false);
		const done = (member) => ready(member) || safeValue(() => member.isSittingOut, false);
		return humans.length > 0 && humans.every(done) && humans.some(ready);
	}

	syncReadiness() {
		if (this.sitOutMode()) return this.ensureSittingOut();
		if (!this.autoReadyEnabled() || this.readySyncing) return;
		const me = this.client?.party?.me;
		if (!me || !this.client?.isReady) return;

		const everyoneReady = this.everyoneReady();
		const botReady = safeValue(() => me.isReady, false);

		if (!everyoneReady && this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}

		if (everyoneReady && !botReady && !this.matchmakingGuards()) return;

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

	/**
	 * Checks that the party can actually queue before the bot readies.
	 * Returns false (and fixes or explains) when it can't:
	 *  - Solo playlists can't take a party of 2+. As leader the bot switches to
	 *    the Duo/Trio/Squad version; otherwise it tells the leader in chat.
	 *  - More than one of the user's bots: the extra ones leave.
	 */
	matchmakingGuards() {
		const client = this.client;
		const party = client?.party;
		if (!party) return false;

		if (this.leaveWhenQueueStarts() && this.playerLeader()) {
			// The bot steps out when the leader readies, so readying is pointless.
			return false;
		}

		if (!this.isDesignatedBot()) {
			this.log('Another of your bots is in this party; leaving so the party can matchmake (one bot per party).', 2);
			party.sendMessage?.('Only one bot can go into a match. I\'ll step out so you can queue.')?.catch?.(() => {});
			this.leaveParty().catch((error) => this.log(`Could not leave: ${error.message}`, 4));
			return false;
		}

		const playlistId = serializeParty(party)?.playlistId || '';
		const leaderIsland = islandOf(safeValue(() => party.leader, null));
		if (/solo/i.test(playlistId) || leaderIsland.teamSize === 'Solo') {
			const players = this.humanMembers().length + 1;
			const fixed = teamPlaylistFor(playlistId, players);
			if (party.me?.isLeader && fixed) {
				this.log(`Solo can't queue with a bot in the party; switching to ${fixed}.`, 2);
				party.setPlaylist(fixed).catch((error) => this.log(`Could not switch playlist: ${error.message}`, 4));
				return false;
			}
			this.warnOnce(
				'solo',
				`Solo can't start with a bot in the party. Switch to ${fixed ? fixed.replace(/^Playlist_/, '') : 'Duos, Trios or Squads'} (No Fill) and ready up again.`
			);
			return false;
		}

		// FNLB turns fill off when it owns the party.
		if (party.me?.isLeader && safeValue(() => party.squadFill, false) === true) {
			party.setSquadFill?.(false)?.catch?.(() => {});
		}
		return true;
	}

	mirrorLeaderEnabled() {
		return this.startConfig.localCategory?.config?.mirrorLeader !== false;
	}

	/** The party leader when it's a real player (not this bot or the user's other bots). */
	playerLeader() {
		const party = this.client?.party;
		const leader = safeValue(() => party?.leader, null);
		if (!leader || leader.id === this.client?.user?.self?.id || this.isTrusted(leader.id)) return null;
		return leader;
	}

	/**
	 * In 42.x lobbies every member publishes its own mode selection
	 * (MatchmakingInfo.islandSelection) and loading state. A real client copies
	 * the leader's; fnbr never does when the bot isn't leader, so the bot kept
	 * advertising its default "Build / Solo / EU" while the leader picked e.g.
	 * Zero Build Duo, and the party could not find a match. Copy the leader's
	 * selection, download progress and preload flag onto the bot.
	 */
	async syncFromLeader() {
		if (!this.mirrorLeaderEnabled()) return false;
		if (this.mirroring) {
			// A leader update arrived mid-patch: run again once it lands.
			this.mirrorAgain = true;
			return false;
		}
		const me = this.client?.party?.me;
		const leader = this.playerLeader();
		if (!me || !leader || !this.client?.isReady) return false;

		const theirs = safeValue(() => leader.meta.get('Default:MatchmakingInfo_j')?.MatchmakingInfo, null);
		const mineData = safeValue(() => me.meta.get('Default:MatchmakingInfo_j'), null) || {};
		const mine = mineData.MatchmakingInfo || {};
		const patch = {};

		// Only the mode selection. Do NOT copy the leader's matchmaking state
		// (MatchmakingData1/2, matchmakingId, bHasOwnerStartedMM...): that is
		// the leader's own queue record, and republishing it as the bot's made
		// two members claim the same matchmaking slot, which crashed the
		// leader's console (PS5 CE-108255-1) when the queue started.
		if (theirs?.islandSelection && (!sameJson(mine.islandSelection, theirs.islandSelection) || (theirs.currentIsland && !sameJson(mine.currentIsland?.island, theirs.currentIsland?.island)))) {
			patch['Default:MatchmakingInfo_j'] = me.meta.set('Default:MatchmakingInfo_j', {
				...mineData,
				MatchmakingInfo: {
					...mine,
					islandSelection: theirs.islandSelection,
					...(theirs.currentIsland ? { currentIsland: { ...(mine.currentIsland || {}), island: theirs.currentIsland.island } } : {})
				}
			});
		}

		// Publish the bot's own idle slot; also replaces copies an earlier
		// version sent (they persist across parties).
		const follow = this.followLeaderQueue();
		if (follow) {
			const leaderGroup = safeValue(() => leader.meta.get('Default:MatchmakingData1_j')?.MatchmakingData1?.groupMemberData, null);
			const want = followedMatchmakingData(leaderGroup);
			if (want !== safeValue(() => me.meta.schema?.['Default:MatchmakingData1_j'], null)) {
				patch['Default:MatchmakingData1_j'] = me.meta.set('Default:MatchmakingData1_j', want, true);
			}
		}
		for (const key of MATCHMAKING_DATA_KEYS) {
			if (follow && key === 'Default:MatchmakingData1_j') continue;
			const ours = safeValue(() => me.meta.schema?.[key], null);
			if (!ours || (ours !== EMPTY_MATCHMAKING_DATA[key] && ours === safeValue(() => leader.meta.schema?.[key], null))) {
				patch[key] = me.meta.set(key, EMPTY_MATCHMAKING_DATA[key], true);
			}
		}

		const theirDownload = safeValue(() => leader.meta.schema?.['Default:DownloadOnDemandProgress_d'], null);
		if (theirDownload && theirDownload !== safeValue(() => me.meta.schema?.['Default:DownloadOnDemandProgress_d'], null)) {
			patch['Default:DownloadOnDemandProgress_d'] = me.meta.set('Default:DownloadOnDemandProgress_d', theirDownload, true);
		}

		const theirLobby = safeValue(() => leader.meta.get('Default:LobbyState_j')?.LobbyState, null);
		const myLobbyData = safeValue(() => me.meta.get('Default:LobbyState_j'), null) || {};
		const myLobby = myLobbyData.LobbyState || {};
		if (theirLobby && typeof theirLobby.hasPreloadedAthena === 'boolean' && theirLobby.hasPreloadedAthena !== myLobby.hasPreloadedAthena) {
			patch['Default:LobbyState_j'] = me.meta.set('Default:LobbyState_j', {
				...myLobbyData,
				LobbyState: { ...myLobby, hasPreloadedAthena: theirLobby.hasPreloadedAthena }
			});
		}

		if (!Object.keys(patch).length) return false;
		if (this.mirroring) {
			// A newer leader update arrived while a patch was in flight: run again after.
			this.mirrorAgain = true;
			return false;
		}
		this.mirroring = true;
		try {
			await me.sendPatch(patch);
			if (patch['Default:MatchmakingInfo_j']) {
				const island = islandOf(leader);
				this.log(`Matched the leader's mode: ${[island.buildMode, island.teamSize, island.squadFill, island.region].filter(Boolean).join(' · ') || island.linkId || 'updated'}.`, 2);
			}
			return true;
		} catch (error) {
			this.log(`Could not copy the leader's mode: ${error.message}`, 4);
			return false;
		} finally {
			this.mirroring = false;
			if (this.mirrorAgain) {
				this.mirrorAgain = false;
				this.syncFromLeader().catch(() => {});
			}
		}
	}

	/**
	 * Records the leader's matchmaking progress while they queue, so a failed
	 * attempt can be read back (including Epic's own failReason).
	 */
	recordMatchmaking(leader) {
		const data = safeValue(() => leader.meta.get('Default:MatchmakingData1_j')?.MatchmakingData1?.groupMemberData, null);
		const info = safeValue(() => leader.meta.get('Default:MatchmakingInfo_j')?.MatchmakingInfo, null);
		if (!data && !info) return;
		const entry = {
			state: data?.state ?? null,
			result: data?.result ?? info?.result ?? null,
			barrierBits: data?.barrierBits ?? null,
			timedOutBarrierIndex: data?.timedOutBarrierIndex ?? null,
			failReason: data?.failReason || null,
			groupId: data?.iD || null,
			ownerStarted: info?.bHasOwnerStartedMM ?? null,
			leaderReady: info?.readyStatus ?? null,
			botReady: safeValue(() => this.client.party.me.meta.get('Default:MatchmakingInfo_j')?.MatchmakingInfo?.readyStatus, null),
			botHasData: Boolean(safeValue(() => this.client.party.me.meta.schema?.['Default:MatchmakingData1_j'], null)),
			botBarrierBits: safeValue(() => this.client.party.me.meta.get('Default:MatchmakingData1_j')?.MatchmakingData1?.groupMemberData?.barrierBits, null),
			followQueue: this.followLeaderQueue()
		};
		this.mmTimeline ||= [];
		const last = this.mmTimeline[this.mmTimeline.length - 1];
		const { at, ...previous } = last || {};
		if (last && sameJson(previous, entry)) return;
		const leaderReadied = entry.leaderReady === 'Ready' && last?.leaderReady !== 'Ready';
		const queueStarted = entry.ownerStarted === true && last?.ownerStarted !== true;
		this.mmTimeline.push({ at: new Date().toISOString(), ...entry });
		if ((leaderReadied || queueStarted) && this.leaveWhenQueueStarts() && !this.leavingForQueue) {
			// Let the player queue on their own; come back once their match is over.
			this.leavingForQueue = true;
			this.rejoinHostId = leader.id;
			this.rejoinUntil = Date.now() + 3 * 60 * 60 * 1000;
			this.hostWasPlaying = false;
			this.log('The leader is ready to play; stepping out so they can queue. I\'ll rejoin after their match.', 2);
			this.client?.party
				?.sendMessage?.("Have fun! I'll step out so you can queue and rejoin after your match.")
				?.catch?.(() => {});
			this.leaveParty()
				.catch((error) => this.log(`Could not leave: ${error.message}`, 4))
				.finally(() => {
					this.leavingForQueue = false;
				});
		}
		if (this.mmTimeline.length > 40) this.mmTimeline.shift();
		if (entry.failReason) this.log(`Matchmaking failed for the party: ${entry.failReason}`, 4);
	}

	/**
	 * SubGame_u says which part of Fortnite a member is in. fnbr hard-codes
	 * "1" when it joins a party, while a PS5 in Battle Royale publishes "2";
	 * a member in a different sub-game can stop the leader from starting
	 * matchmaking. It has no "Default:" prefix, so fnbr's sendPatch filters it
	 * out: send it with a direct member patch instead.
	 */
	async syncSubGame() {
		if (!this.mirrorLeaderEnabled() || this.subGameSyncing) return false;
		const me = this.client?.party?.me;
		const leader = this.playerLeader();
		if (!me || !leader || typeof me.doPatch !== 'function') return false;
		const theirs = safeValue(() => leader.meta.schema?.SubGame_u, null);
		const ours = safeValue(() => me.meta.schema?.SubGame_u, null);
		if (!theirs || !/^\d+$/.test(theirs) || theirs === ours) return false;
		this.subGameSyncing = true;
		try {
			await me.doPatch({ SubGame_u: theirs });
			me.meta.set('SubGame_u', theirs, true);
			this.log(`Matched the leader's sub-game (SubGame ${theirs}).`, 2);
			return true;
		} catch (error) {
			this.log(`Could not match the leader's sub-game: ${error.message}`, 4);
			return false;
		} finally {
			this.subGameSyncing = false;
		}
	}

	/** A player's match location from the event's NEW value (fnbr emits before storing it). */
	onMemberMatchState(member, value) {
		const selfId = this.client?.user?.self?.id;
		if (!member || member.id === selfId || this.isTrusted(member.id)) return;
		if (!this.leaveOnMatchStart() || value?.location !== 'InGame' || this.leavingForMatch) return;

		// Remember who to come back to: the party leader if it's a player.
		const leader = safeValue(() => this.client.party.leader, null);
		this.rejoinHostId = leader && leader.id !== selfId && !this.isTrusted(leader.id) ? leader.id : member.id;
		this.rejoinUntil = Date.now() + 3 * 60 * 60 * 1000;
		this.hostWasPlaying = true;
		this.leavingForMatch = true;
		setTimeout(() => {
			this.log('The match has started; leaving the party so the bot is free for the next game.', 2);
			this.leaveParty()
				.catch((error) => this.log(`Could not leave after match start: ${error.message}`, 4))
				.finally(() => {
					this.leavingForMatch = false;
				});
		}, this.leaveDelayMs ?? 3000).unref?.();
	}

	/** After a match, rejoin the player once their presence shows them back in a lobby. */
	onFriendPresence(after) {
		const friend = after?.friend;
		if (!this.rejoinAfterMatch() || !this.rejoinHostId || friend?.id !== this.rejoinHostId) return;
		if (Date.now() > (this.rejoinUntil || 0)) {
			this.rejoinHostId = null;
			return;
		}
		if (after.isPlaying) {
			this.hostWasPlaying = true;
			return;
		}
		// Not back yet: they haven't been in a match since the bot stepped out.
		if (!this.hostWasPlaying || this.rejoining) return;
		const partyId = safeValue(() => friend.party?.id, null);
		if (!partyId || partyId === this.client?.party?.id) return;
		this.rejoining = true;
		this.client
			.joinParty(partyId)
			.then(() => {
				this.log(`Back with ${friend.displayName || 'the player'} after their match.`, 1);
				this.rejoinHostId = null;
				this.hostWasPlaying = false;
				this.emitParty();
			})
			.catch((error) => this.log(`Could not rejoin after the match (invite the bot instead): ${error.message}`, 3))
			.finally(() => {
				this.rejoining = false;
			});
	}

	applyAutoReady(want) {
		if (this.readySyncing) return;
		this.readySyncing = true;
		// Make sure the bot advertises the same mode as the leader before readying.
		(want ? this.syncFromLeader().catch(() => false) : Promise.resolve(false))
			.then(() => this.setReadiness(want, { auto: true }))
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
		if ((command === '!ready' || command === '!unready') && this.sitOutMode()) {
			// Readying would stop the party from finding a match.
			return this.client?.party
				?.sendMessage('Bots sit out so you can matchmake. Ready up and start: the bots stay in the lobby.')
				.catch(() => {});
		}
		if (command === '!ready') return this.setReadiness(true);
		if (command === '!unready') return this.setReadiness(false);
		if (command === '!sitout') return this.setSittingOut(true);
		if (command === '!copy') return this.copyMember(authorId);
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
					'Commands: CID_ / BID_ / Pickaxe_ID_ / EID_ <id>, !ready, !unready, !sitout, !stopemote, !status <text>, !level <n>, !crowns <n>, !copy, !stats [name], !join, !leave'
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
			case '!copy':
				return attempt(() => this.copyMember(friendId), (result) => result.content);
			case '!level':
			case '!bp':
				if (!args) return reply('Usage: !level <number>');
				return attempt(() => this.setProfile({ battlePassLevel: args, battlePassPurchased: true }), `Battle pass level set to ${args}.`);
			case '!crowns':
				if (!args) return reply('Usage: !crowns <number>');
				return attempt(() => this.setProfile({ crowns: args }), `Crowns set to ${args}.`);
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
