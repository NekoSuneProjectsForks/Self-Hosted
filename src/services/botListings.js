import { BotAccount, BotListing, User } from '../models/index.js';
import { getPlainConfig } from './configStore.js';
import { fetchFnlbBots } from './fnlbApi.js';

/**
 * Community bot list. Owners choose per bot: Public (anyone can see it on the
 * /community page and add it as a friend) or Private (only they use it).
 *
 * The public view is READ-ONLY: name, status, party size, engine, platform
 * and the owner's short description. No owner details, no account IDs and
 * no controls (friends, DMs, skins stay with the owner).
 */

export const ENGINES = ['fnbr', 'fnlb'];
// Live status changes fast (someone invites a bot): keep this short. Ban info
// from FNLB's API is cached separately (2 minutes per owner).
const CACHE_MS = 2000;
let publicCache = { at: 0, rows: null };

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function clean(value, max) {
	return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function clearPublicCache() {
	publicCache = { at: 0, rows: null };
}

/** True when `botKey` really is one of this user's bots on that engine. */
export async function ownsBot(userId, engine, botKey) {
	if (engine === 'fnbr') {
		const config = await getPlainConfig(userId);
		if (config.deviceAuth?.accountId === botKey) return true;
		return Boolean(await BotAccount.findOne({ where: { userId, accountId: botKey } }));
	}
	if (engine === 'fnlb') {
		const config = await getPlainConfig(userId);
		if (!config.apiToken) throw httpError(400, 'Save your FNLB API token first.');
		const bots = await fetchFnlbBots(config.apiToken);
		return bots.some((bot) => bot.id === botKey);
	}
	return false;
}

function serializeMine(row) {
	return {
		engine: row.engine,
		botKey: row.botKey,
		displayName: row.displayName,
		isPublic: row.isPublic,
		description: row.description || ''
	};
}

export async function listMyListings(userId) {
	const rows = await BotListing.findAll({ where: { userId } });
	return rows.map(serializeMine);
}

export async function setListing(userId, payload, { verify = ownsBot } = {}) {
	const engine = String(payload.engine || '');
	const botKey = clean(payload.botKey, 64);
	if (!ENGINES.includes(engine)) throw httpError(400, 'Unknown engine.');
	if (!botKey) throw httpError(400, 'Pick a bot.');
	if (!(await verify(userId, engine, botKey))) throw httpError(403, 'That bot is not one of yours.');
	const values = {};
	if (payload.isPublic !== undefined) values.isPublic = Boolean(payload.isPublic);
	if (payload.description !== undefined) values.description = clean(payload.description, 160) || null;
	if (payload.displayName !== undefined) values.displayName = clean(payload.displayName, 64) || null;
	const [row] = await BotListing.findOrCreate({ where: { userId, engine, botKey }, defaults: { ...values } });
	await row.update(values);
	clearPublicCache();
	return serializeMine(row);
}

/**
 * Category-wide choice for Legacy FNLB: every bot in the category becomes
 * Public or Private, and bots added to the category later inherit it.
 * Stored as engine "fnlb-cat" (never shown publicly itself).
 */
export const CATEGORY_ENGINE = 'fnlb-cat';

export async function setCategoryListing(userId, categoryId, isPublic, botsInCategory) {
	const key = clean(categoryId, 64);
	if (!key) throw httpError(400, 'Pick a category.');
	const [row] = await BotListing.findOrCreate({ where: { userId, engine: CATEGORY_ENGINE, botKey: key }, defaults: { isPublic: Boolean(isPublic) } });
	await row.update({ isPublic: Boolean(isPublic) });
	for (const bot of botsInCategory) {
		const [botRow] = await BotListing.findOrCreate({
			where: { userId, engine: 'fnlb', botKey: bot.id },
			defaults: { isPublic: Boolean(isPublic), displayName: bot.name || null }
		});
		await botRow.update({ isPublic: Boolean(isPublic), ...(bot.name && !botRow.displayName ? { displayName: bot.name } : {}) });
	}
	clearPublicCache();
	return { categoryId: key, isPublic: Boolean(isPublic), bots: botsInCategory.length };
}

/** New bots in a category with a saved choice inherit it (creates their rows). */
export async function inheritCategoryChoice(userId, bots, categoryChoices) {
	let changed = false;
	for (const bot of bots) {
		const choice = categoryChoices.get(bot.categoryId);
		if (choice === undefined) continue;
		const [, created] = await BotListing.findOrCreate({
			where: { userId, engine: 'fnlb', botKey: bot.id },
			defaults: { isPublic: choice, displayName: bot.name || null }
		});
		if (created) changed = true;
	}
	if (changed) clearPublicCache();
	return changed;
}

export async function removeListingsForUser(userId) {
	await BotListing.destroy({ where: { userId } });
	clearPublicCache();
}

/**
 * FNLB's own account state for a user's FNLB bots (matchmaking ban, invalid
 * login, disabled), cached per owner so the public page doesn't hit FNLB's
 * API on every visit.
 */
const FNLB_INFO_MS = 120000;
const fnlbInfoCache = new Map();

export async function fnlbBotInfo(userId, { fetchBots = fetchFnlbBots, now = Date.now() } = {}) {
	const cached = fnlbInfoCache.get(userId);
	if (cached && now - cached.at < FNLB_INFO_MS) return cached.map;
	const map = new Map();
	try {
		const config = await getPlainConfig(userId);
		if (config.apiToken) {
			for (const bot of await fetchBots(config.apiToken)) {
				map.set(bot.id, {
					mmsBannedUntil: bot.mmsBannedUntil || null,
					hasInvalidAuth: Boolean(bot.hasInvalidAuth),
					isDisabled: Boolean(bot.isDisabled)
				});
			}
		}
	} catch {
		// FNLB unreachable: keep the last known answer rather than listing blindly.
		if (cached) return cached.map;
	}
	fnlbInfoCache.set(userId, { at: now, map });
	return map;
}

/**
 * Whether a bot can be offered to the community right now. Only "available"
 * bots are listed: running, not banned or disabled, and not already in use
 * (someone in its party, matchmaking or in a match).
 */
export function availability(live, account = null, { now = Date.now() } = {}) {
	if (account?.isDisabled) return { state: 'disabled', reason: 'Disabled in FNLB.' };
	if (account?.hasInvalidAuth) return { state: 'banned', reason: "FNLB says the bot's login is invalid (banned or signed out)." };
	if (account?.mmsBannedUntil && new Date(account.mmsBannedUntil).getTime() > now) {
		return { state: 'banned', reason: 'Matchmaking ban.', until: account.mmsBannedUntil };
	}
	if (!live) return { state: 'offline', reason: 'Not running.' };
	if (live.banned) return { state: 'banned', reason: live.banReason || 'Banned.' };
	if (live.status === 'busy') return { state: 'busy', reason: live.busyReason || 'Someone is already using it.' };
	return { state: 'available', reason: null };
}


/**
 * Public, read-only rows: ONLY bots that are available right now. Busy,
 * offline and banned bots are left out (they come back once free) and only
 * counted. `statusOf(userId, engine, botKey)` is the runtime's live status.
 */
export async function publicBots(statusOf, { now = Date.now(), fnlbInfo = fnlbBotInfo, maxAgeMs = CACHE_MS } = {}) {
	if (publicCache.rows && now - publicCache.at < maxAgeMs) return publicCache.rows;
	const rows = (await BotListing.findAll({ where: { isPublic: true } })).filter((row) => ENGINES.includes(row.engine));
	const owners = await User.findAll({ where: { id: [...new Set(rows.map((row) => row.userId))] }, attributes: ['id', 'status'] });
	const active = new Set(owners.filter((user) => user.status !== 'suspended').map((user) => user.id));
	const bots = [];
	const counts = { available: 0, busy: 0 };
	for (const row of rows) {
		if (!active.has(row.userId)) continue;
		let live = null;
		try {
			live = await statusOf(row.userId, row.engine, row.botKey);
		} catch {
			live = null;
		}
		const account = row.engine === 'fnlb' ? (await fnlbInfo(row.userId)).get(row.botKey) : null;
		const { state } = availability(live, account, { now });
		if (live?.displayName && (live.displayName !== row.displayName || !row.lastSeenAt || now - new Date(row.lastSeenAt).getTime() > 600000)) {
			await row.update({ displayName: live.displayName, lastSeenAt: new Date(now) }).catch(() => {});
		}
		if (state === 'busy') counts.busy += 1;
		if (state !== 'available') continue;
		const name = live?.displayName || row.displayName;
		if (!name) continue;
		counts.available += 1;
		bots.push({
			id: row.id,
			displayName: name,
			engine: row.engine,
			engineLabel: row.engine === 'fnlb' ? 'FNLB bot lobby bot' : 'Lobby bot',
			botLobbies: row.engine === 'fnlb',
			status: 'available',
			partySize: live?.partySize ?? null,
			partyMax: live?.partyMax ?? null,
			platform: live?.platform || null,
			description: row.description || ''
		});
	}
	bots.sort((a, b) => a.displayName.localeCompare(b.displayName));
	publicCache = { at: now, rows: { bots, counts } };
	return publicCache.rows;
}
