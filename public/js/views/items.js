import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';
import { usingLocalFnbr } from '../core/selectors.js';

export function renderItems() {
	const categoryOptions = state.categories
		.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name || category.id)}</option>`)
		.join('');
	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-semibold">Realtime Equip To ${usingLocalFnbr() ? 'Local Bot' : 'FNLB Category'}</p>
						<p class="mt-1 text-sm text-zinc-500">${usingLocalFnbr() ? 'Pick the local loadout slot, then click Equip. If the bot is online, fnbr applies the cosmetic immediately without restart.' : 'Pick a category and slot, then click Equip on an item. This patches FNLB category config immediately without restarting your local bot cluster.'}</p>
					</div>
					<button class="btn-secondary" data-action="refresh-dashboard" type="button">${icon('refresh-cw')} Refresh Loadouts</button>
				</div>
				<div class="grid gap-3 md:grid-cols-[1fr_180px_160px]">
					<select class="input" id="item-equip-category" ${categoryOptions ? '' : 'disabled'}>
						${categoryOptions || '<option>No loadouts loaded</option>'}
					</select>
					<select class="input" id="item-equip-slot">
						<option value="startOutfit">Start outfit</option>
						<option value="startBackpack">Start backpack</option>
						<option value="startPickaxe">Start pickaxe</option>
						<option value="startShoes">Start shoes</option>
						<option value="joinEmote">Join emote</option>
						<option value="memberJoinEmote">Member join emote</option>
					</select>
					<select class="input" id="item-equip-mode">
						<option value="replace">Replace slot</option>
						<option value="append">Add to rotation</option>
					</select>
				</div>
			</section>
			<form class="shell-panel rounded-lg p-4" data-form="item-search">
				<div class="grid gap-3 md:grid-cols-[1fr_180px_120px]">
					<input class="input" name="q" placeholder="Search cosmetics, e.g. Renegade Raider, Star Wand" required />
					<select class="input" name="type">
						<option value="">Any type</option>
						<option value="outfit">Outfit</option>
						<option value="backpack">Backpack</option>
						<option value="pickaxe">Pickaxe</option>
						<option value="emote">Emote</option>
						<option value="shoes">Shoes</option>
					</select>
					<button class="btn-primary" type="submit">${icon('search')} Search</button>
				</div>
			</form>
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				${state.itemSearchResults.length ? state.itemSearchResults.map((item) => `
					<div class="rounded-lg border border-white/10 bg-black/25 p-4">
						<div class="aspect-square rounded-lg border border-white/10 bg-white/[0.04] p-3">
							${item.image ? `<img class="h-full w-full object-contain" src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : ''}
						</div>
						<p class="mt-3 font-semibold">${escapeHtml(item.name)}</p>
						<p class="mt-1 text-xs text-zinc-500">${escapeHtml(item.type || 'Item')} / ${escapeHtml(item.rarity || 'Unknown')}</p>
						<p class="mt-2 break-all rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-xs text-fnlb-200">${escapeHtml(item.id)}</p>
						<button class="btn-primary mt-3 w-full" data-action="equip-item" data-item-id="${escapeHtml(item.id)}" type="button" ${categoryOptions ? '' : 'disabled'}>${icon('shirt')} Equip</button>
					</div>
				`).join('') : `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Search Fortnite cosmetics to get item IDs for ${usingLocalFnbr() ? 'local fnbr cosmetics and commands' : 'FNLB category cosmetics and commands'}.</div>`}
			</div>
		</div>
	`;
}
