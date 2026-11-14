import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { bannerColorCss, getFortniteBanners } from '../src/services/fortniteItems.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('banner colours', () => {
	it('turns Fortnite-API colour names into CSS', () => {
		assert.equal(bannerColorCss('Gray666666FF'), '#666666');
		assert.equal(bannerColorCss('GreenH120'), 'hsl(120 70% 45%)');
		assert.equal(bannerColorCss('nonsense'), '#666666');
	});
});

describe('banner list', () => {
	it('maps banners and colours from fortnite-api.com and caches them', async () => {
		let calls = 0;
		globalThis.fetch = async (url) => {
			calls += 1;
			const body = String(url).includes('/colors')
				? { data: [{ id: 'DefaultColor15', color: 'RedH0', category: 'DefaultColorSet1' }] }
				: { data: [{ id: 'BRSeason01', name: 'Season 1', category: 'Special', images: { smallIcon: 'https://x/s.png' } }] };
			return { ok: true, status: 200, json: async () => body };
		};
		const first = await getFortniteBanners();
		assert.deepEqual(first.banners[0], { id: 'BRSeason01', name: 'Season 1', category: 'Special', icon: 'https://x/s.png' });
		assert.deepEqual(first.colors[0], { id: 'DefaultColor15', css: 'hsl(0 70% 45%)', category: 'DefaultColorSet1' });
		assert.ok(String(calls) === '2');
		await getFortniteBanners();
		assert.equal(calls, 2, 'second call is served from cache');
	});
});
