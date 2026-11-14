const FORTNITE_API_BASE = 'https://fortnite-api.com/v2';

export async function searchFortniteCosmetics(query, type = '') {
	const name = String(query || '').trim();
	if (!name) return [];

	const params = new URLSearchParams({
		name,
		matchMethod: 'contains',
		language: 'en',
		searchLanguage: 'en'
	});
	if (type) params.set('type', type);

	const response = await fetch(`${FORTNITE_API_BASE}/cosmetics/br/search/all?${params}`);
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`Fortnite-API returned ${response.status}.`);
	const body = await response.json();

	return Array.isArray(body.data)
		? body.data.slice(0, 24).map((item) => ({
				id: item.id,
				name: item.name,
				description: item.description,
				// `type` is the stable id (outfit, backpack, pickaxe, emote, shoes...),
				// used to pick the slot; `typeLabel` is what to show.
				type: item.type?.value || null,
				typeLabel: item.type?.displayValue || item.type?.value || null,
				rarity: item.rarity?.displayValue || item.rarity?.value,
				image: item.images?.smallIcon || item.images?.icon,
				variants: item.variants || []
			}))
		: [];
}

// ---- Banners (icons + colours) for the profile pickers -------------------

const BANNER_CACHE_MS = 12 * 60 * 60 * 1000;
let bannerCache = null;

/**
 * Fortnite-API reports colours as e.g. "Gray666666FF" (hex with alpha) or
 * "GreenH120" (a hue). Turn either into something CSS can draw.
 */
export function bannerColorCss(value) {
	const text = String(value || '');
	const hex = text.match(/([0-9A-F]{6})([0-9A-F]{2})?$/i);
	if (hex) return `#${hex[1]}`;
	const hue = text.match(/H(\d{1,3})$/i);
	if (hue) return `hsl(${Number(hue[1]) % 360} 70% 45%)`;
	return '#666666';
}

export async function getFortniteBanners() {
	if (bannerCache && Date.now() - bannerCache.at < BANNER_CACHE_MS) return bannerCache.data;
	const [bannersResponse, colorsResponse] = await Promise.all([
		fetch(`${FORTNITE_API_BASE.replace('/v2', '/v1')}/banners?language=en`),
		fetch(`${FORTNITE_API_BASE.replace('/v2', '/v1')}/banners/colors`)
	]);
	if (!bannersResponse.ok || !colorsResponse.ok) {
		throw new Error(`Fortnite-API returned ${bannersResponse.status}/${colorsResponse.status} for banners.`);
	}
	const banners = (await bannersResponse.json()).data || [];
	const colors = (await colorsResponse.json()).data || [];
	const data = {
		banners: banners
			.filter((banner) => banner?.id)
			.map((banner) => ({
				id: banner.id,
				name: banner.name || banner.devName || banner.id,
				category: banner.category || null,
				icon: banner.images?.smallIcon || banner.images?.icon || null
			})),
		colors: colors
			.filter((color) => color?.id)
			.map((color) => ({ id: color.id, css: bannerColorCss(color.color), category: color.category || null }))
	};
	bannerCache = { at: Date.now(), data };
	return data;
}
