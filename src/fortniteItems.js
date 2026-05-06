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
				type: item.type?.displayValue || item.type?.value,
				rarity: item.rarity?.displayValue || item.rarity?.value,
				image: item.images?.smallIcon || item.images?.icon,
				variants: item.variants || []
			}))
		: [];
}
