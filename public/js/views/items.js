import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';
import { controlBot, controlOnline, controlledHelper, usingLocalFnbr } from '../core/selectors.js';

/** Bot slots fnbr can equip, in the order the loadout is applied. */
export const LOADOUT_SLOTS = [
	['outfit', 'Outfit'],
	['backpack', 'Back Bling'],
	['pickaxe', 'Pickaxe'],
	['shoes', 'Kicks'],
	['emote', 'Emote']
];

const TYPE_TO_SLOT = { outfit: 'outfit', backpack: 'backpack', pickaxe: 'pickaxe', emote: 'emote', shoes: 'shoes' };

/** Which bot slot an item goes in, from its type (falls back to the ID prefix). */
export function slotForItem(item) {
	const type = String(item?.type || '').toLowerCase();
	if (TYPE_TO_SLOT[type]) return TYPE_TO_SLOT[type];
	const id = String(item?.id || '').toUpperCase();
	if (id.startsWith('CID_') || id.startsWith('CHARACTER_')) return 'outfit';
	if (id.startsWith('BID_') || id.startsWith('BACKPACK_')) return 'backpack';
	if (id.startsWith('PICKAXE_')) return 'pickaxe';
	if (id.startsWith('EID_')) return 'emote';
	return null;
}

function slotLabel(slot) {
	return LOADOUT_SLOTS.find(([key]) => key === slot)?.[1] || slot;
}

function targetName() {
	const helper = controlledHelper();
	return helper ? helper.label : state.bots?.[0]?.nickname || 'the bot';
}

function renderTray() {
	const tray = state.loadoutTray || {};
	const chosen = LOADOUT_SLOTS.filter(([slot]) => tray[slot]);
	const online = controlOnline();
	const wearing = controlBot()?.cosmetics || {};
	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p class="font-semibold">Loadout for ${escapeHtml(targetName())}</p>
					<p class="mt-1 text-sm text-zinc-500">Add items from the search below. Each one goes in its own slot, so adding Back Bling never replaces the Outfit. Then equip them all at once. <strong>Equip now</strong> on a single item also changes only that slot.</p>
				</div>
				<label class="flex items-center gap-2 text-sm text-zinc-300">
					<input class="h-4 w-4 accent-fnlb-500" type="checkbox" data-action="items-keep" ${state.itemsKeep !== false ? 'checked' : ''} />
					Keep after restart
				</label>
			</div>
			<div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
				${LOADOUT_SLOTS.map(([slot, label]) => {
					const item = tray[slot];
					const current = wearing[slot];
					return `
						<div class="flex items-center gap-3 rounded-lg border ${item ? 'border-fnlb-400/40 bg-fnlb-500/10' : 'border-white/10 bg-black/25'} p-2">
							<div class="h-12 w-12 shrink-0 rounded border border-white/10 bg-white/[0.04]">
								${item?.image ? `<img class="h-full w-full object-contain" src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : ''}
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-xs uppercase text-zinc-500">${label}</p>
								<p class="truncate text-sm ${item ? 'text-zinc-100' : 'text-zinc-500'}">${item ? escapeHtml(item.name || item.id) : 'No change'}</p>
								${current ? `<p class="truncate text-[11px] text-zinc-600" title="${escapeHtml(current)}">Wearing: ${escapeHtml(current)}</p>` : ''}
							</div>
							${item ? `<button class="btn-secondary px-2" type="button" data-action="tray-remove" data-slot="${slot}" title="Remove">${icon('x')}</button>` : ''}
						</div>`;
				}).join('')}
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				<button class="btn-primary" type="button" data-action="tray-equip" ${chosen.length && online ? '' : 'disabled'}>${icon('shirt')} Equip loadout (${chosen.length})</button>
				<button class="btn-secondary" type="button" data-action="tray-clear" ${chosen.length ? '' : 'disabled'}>${icon('trash-2')} Clear</button>
				<button class="btn-secondary" type="button" data-action="emote-stop" ${online ? '' : 'disabled'}>${icon('square')} Stop emote</button>
				${online ? '' : '<span class="self-center text-xs text-amber-300">Start the bot to equip.</span>'}
			</div>
		</section>`;
}

/** FNLB keeps loadouts per category, so it still needs the category/slot pickers. */
function renderFnlbControls() {
	const categoryOptions = state.categories
		.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name || category.id)}</option>`)
		.join('');
	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p class="font-semibold">Equip To FNLB Category</p>
					<p class="mt-1 text-sm text-zinc-500">Pick a category and mode, then click Equip on an item. The slot follows the item's type.</p>
				</div>
				<button class="btn-secondary" data-action="refresh-dashboard" type="button">${icon('refresh-cw')} Refresh Loadouts</button>
			</div>
			<div class="grid gap-3 md:grid-cols-[1fr_160px]">
				<select class="input" id="item-equip-category" ${categoryOptions ? '' : 'disabled'}>
					${categoryOptions || '<option>No loadouts loaded</option>'}
				</select>
				<select class="input" id="item-equip-mode">
					<option value="replace">Replace slot</option>
					<option value="append">Add to rotation</option>
				</select>
			</div>
		</section>`;
}

function itemButtons(item) {
	const slot = slotForItem(item);
	const data = `data-item-id="${escapeHtml(item.id)}" data-slot="${slot || ''}"`;
	if (!slot) {
		return `<p class="mt-3 text-xs text-zinc-500">${escapeHtml(item.typeLabel || 'This type')} can't be equipped on a bot.</p>`;
	}
	if (!usingLocalFnbr() && !controlledHelper()) {
		return `<button class="btn-primary mt-3 w-full" data-action="equip-item" ${data} type="button">${icon('shirt')} Equip ${escapeHtml(slotLabel(slot))}</button>`;
	}
	const online = controlOnline();
	const inTray = state.loadoutTray?.[slot]?.id === item.id;
	return `
		<div class="mt-3 grid gap-2">
			${slot === 'emote'
				? `<button class="btn-primary w-full" data-action="emote-play" ${data} type="button" ${online ? '' : 'disabled'}>${icon('play')} Play emote</button>`
				: `<button class="btn-primary w-full" data-action="equip-item" ${data} type="button" ${online ? '' : 'disabled'}>${icon('shirt')} Equip now</button>`}
			<button class="btn-secondary w-full" data-action="tray-add" ${data} type="button">${icon(inTray ? 'check' : 'plus')} ${inTray ? 'In loadout' : `Add to loadout (${escapeHtml(slotLabel(slot))})`}</button>
		</div>`;
}

export function renderItems() {
	const local = usingLocalFnbr() || Boolean(controlledHelper());
	return `
		<div class="grid gap-4">
			${local ? renderTray() : renderFnlbControls()}
			<form class="shell-panel rounded-lg p-4" data-form="item-search">
				<div class="grid gap-3 md:grid-cols-[1fr_180px_120px]">
					<input class="input" name="q" placeholder="Search cosmetics, e.g. Renegade Raider, Star Wand" value="${escapeHtml(state.itemSearchQuery || '')}" required />
					<select class="input" name="type">
						${[
							['', 'Any type'],
							['outfit', 'Outfit'],
							['backpack', 'Back Bling'],
							['pickaxe', 'Pickaxe'],
							['emote', 'Emote'],
							['shoes', 'Kicks']
						]
							.map(([value, label]) => `<option value="${value}" ${(state.itemSearchType || '') === value ? 'selected' : ''}>${label}</option>`)
							.join('')}
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
						<p class="mt-1 text-xs text-zinc-500">${escapeHtml(item.typeLabel || item.type || 'Item')} / ${escapeHtml(item.rarity || 'Unknown')}</p>
						<p class="mt-2 break-all rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-xs text-fnlb-200">${escapeHtml(item.id)}</p>
						${itemButtons(item)}
					</div>
				`).join('') : `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Search Fortnite cosmetics to equip them, build a loadout, or play emotes.</div>`}
			</div>
		</div>
	`;
}
