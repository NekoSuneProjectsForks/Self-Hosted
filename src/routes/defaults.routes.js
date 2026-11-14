import { asyncRoute, equipCosmetic, httpError } from '../http/helpers.js';
import { getPlainConfig, updateLocalCategoryConfig } from '../services/configStore.js';
import { normalizeProfile } from '../runtime/LocalFnbrRuntime.js';

/**
 * Join defaults: the look every local bot goes back to whenever it lands in a
 * party (its own or someone else's): outfit/backpack/pickaxe/shoes/emote plus
 * battle pass level, banner and crowns. Live edits from the dashboard or DM
 * commands are temporary and last only for the current party.
 */
const LOADOUT_KEYS = {
	outfit: 'startOutfit',
	backpack: 'startBackpack',
	pickaxe: 'startPickaxe',
	shoes: 'startShoes',
	emote: 'joinEmote'
};
const PROFILE_KEYS = ['battlePassLevel', 'battlePassPurchased', 'bannerId', 'bannerColor', 'crowns'];

function defaultsFrom(config = {}) {
	const first = (key) => (Array.isArray(config[key]) && config[key][0]?.id) || null;
	return {
		loadout: Object.fromEntries(Object.entries(LOADOUT_KEYS).map(([slot, key]) => [slot, first(key)])),
		profile: Object.fromEntries(PROFILE_KEYS.map((key) => [key, config[key] ?? null]))
	};
}

export function registerDefaultsRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive } = ctx;
	const guard = [requireAuth, requireActive];

	app.get(
		'/api/bot-defaults',
		...guard,
		asyncRoute(async (req, res) => {
			const config = (await getPlainConfig(req.user.id)).localCategory?.config || {};
			return res.json(defaultsFrom(config));
		})
	);

	// Saves join defaults. Loadout: an item ID sets the slot, '' clears it,
	// omitted leaves it. Profile: a value sets it, '' or null clears it.
	app.put(
		'/api/bot-defaults',
		...guard,
		asyncRoute(async (req, res) => {
			const { loadout = {}, profile = {}, applyNow = false } = req.body || {};
			const cleanProfile = normalizeProfile(profile);
			const localCategory = await updateLocalCategoryConfig(req.user.id, async (next) => {
				for (const [slot, key] of Object.entries(LOADOUT_KEYS)) {
					if (loadout[slot] === undefined) continue;
					const itemId = String(loadout[slot] || '').trim();
					if (itemId) equipCosmetic(next, key, itemId, 'replace');
					else next[key] = [];
				}
				for (const key of PROFILE_KEYS) {
					if (profile[key] === undefined) continue;
					if (cleanProfile[key] === undefined) delete next[key];
					else next[key] = cleanProfile[key];
				}
			});
			runtime.applyLocalCategoryLive(req.user.id, localCategory);
			const results = applyNow ? await runtime.reapplyDefaults(req.user.id, localCategory) : [];
			return res.json({
				...defaultsFrom(localCategory.config),
				results,
				content: applyNow
					? `Join defaults saved and applied to ${results.filter((row) => row.ok).length} running bot(s).`
					: 'Join defaults saved. Bots use them the next time they join or make a party.'
			});
		})
	);

	app.post(
		'/api/bot-defaults/apply',
		...guard,
		asyncRoute(async (req, res) => {
			const localCategory = (await getPlainConfig(req.user.id)).localCategory;
			const results = await runtime.reapplyDefaults(req.user.id, localCategory);
			if (!results.length) throw httpError(409, 'No local bot is online.');
			return res.json({ results, content: `Reset ${results.filter((row) => row.ok).length} bot(s) to the join defaults.` });
		})
	);

	// Live profile edit for one bot; temporary, like every live change.
	app.patch(
		'/api/bots/:botId/profile',
		...guard,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id, req.params.botId);
			return res.json(await adapter.setProfile(req.body?.profile || {}));
		})
	);
}
