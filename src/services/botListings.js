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
const CACHE_MS = 20000;
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

export async function removeListingsForUser(userId) {
	await BotListing.destroy({ where: { userId } });
	clearPublicCache();
}

const ORDER = { available: 0, busy: 1, offline: 2 };

/**
 * Public, read-only rows. `statusOf(userId, engine, botKey)` comes from the
 * runtime manager and returns live status or null when the bot isn't running.
 */
export async function publicBots(statusOf, { now = Date.now() } = {}) {
	if (publicCache.rows && now - publicCache.at < CACHE_MS) return publicCache.rows;
	const rows = await BotListing.findAll({ where: { isPublic: true } });
	const owners = await User.findAll({ where: { id: [...new Set(rows.map((row) => row.userId))] }, attributes: ['id', 'status'] });
	const active = new Set(owners.filter((user) => user.status !== 'suspended').map((user) => user.id));
	const result = [];
	for (const row of rows) {
		if (!active.has(row.userId)) continue;
		let live = null;
		try {
			live = statusOf(row.userId, row.engine, row.botKey);
		} catch {
			live = null;
		}
		if (live?.displayName && (live.displayName !== row.displayName || !row.lastSeenAt || now - new Date(row.lastSeenAt).getTime() > 600000)) {
			await row.update({ displayName: live.displayName, lastSeenAt: new Date(now) }).catch(() => {});
		}
		const name = live?.displayName || row.displayName;
		if (!name) continue; // never published a name yet: nothing useful to show
		result.push({
			id: row.id,
			displayName: name,
			engine: row.engine,
			engineLabel: row.engine === 'fnlb' ? 'FNLB bot lobby bot' : 'Lobby bot',
			botLobbies: row.engine === 'fnlb',
			status: live?.status || 'offline',
			partySize: live?.partySize ?? null,
			partyMax: live?.partyMax ?? null,
			platform: live?.platform || null,
			description: row.description || '',
			lastSeenAt: live ? new Date(now).toISOString() : row.lastSeenAt
		});
	}
	result.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.displayName.localeCompare(b.displayName));
	publicCache = { at: now, rows: result };
	return result;
}
