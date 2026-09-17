import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';
import { dashboardAvailable, usingLocalFnbr } from '../core/selectors.js';

export function renderCategories() {
	if (!dashboardAvailable()) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">${usingLocalFnbr() ? 'Save Epic device auth or a one-time authorization code in Config to load your local loadout category.' : 'Save your FNLB API token in Config to load categories.'}</div>`;
	}
	return `
		<div class="grid gap-4">
			<div class="flex justify-end">
				<button class="btn-secondary" data-action="refresh-dashboard">${icon('refresh-cw')} Refresh</button>
			</div>
			<div class="grid gap-3 xl:grid-cols-2">
				${state.categories.length ? state.categories.map(renderCategoryCard).join('') : `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No categories returned by ${usingLocalFnbr() ? 'the local runtime' : 'FNLB'}.</div>`}
			</div>
		</div>
	`;
}

function renderCategoryCard(category) {
	const config = category.config || {};
	const ids = (rows) => (Array.isArray(rows) ? rows.map((item) => item.id).filter(Boolean).join(',') : '');
	return `
		<div class="rounded-lg border border-white/10 bg-black/25 p-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="font-semibold">${escapeHtml(category.name || category.id)}</p>
					<p class="mt-1 break-all text-xs text-zinc-500">${escapeHtml(category.id)}</p>
				</div>
				${category.isDisabled ? statusBadge('error', 'disabled') : statusBadge('active', 'active')}
			</div>
			<div class="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
				<p>Flags: <span class="text-zinc-200">${escapeHtml(category.flagsList?.join(', ') || 'None')}</span></p>
				<p>Managed: <span class="text-zinc-200">${category.isManaged ? 'Yes' : 'No'}</span></p>
				<p>Privacy: <span class="text-zinc-200">${valueOrDash(config.privacy)}</span></p>
				<p>Status lines: <span class="text-zinc-200">${count(config.statusText?.length)}</span></p>
				<p>Admins: <span class="text-zinc-200">${count(config.admins?.length)}</span></p>
				<p>Whitelist: <span class="text-zinc-200">${count(config.whitelistUsers?.length)}</span></p>
				<p>Blacklist: <span class="text-zinc-200">${count(config.blacklistUsers?.length)}</span></p>
				<p>Start banned bots: <span class="text-zinc-200">${config.startBannedBots ? 'Yes' : 'No'}</span></p>
				<p>Accept invites: <span class="text-zinc-200">${config.acceptInvites ? 'Yes' : 'No'}</span></p>
				<p>Accept friend requests: <span class="text-zinc-200">${config.acceptFriendRequests ? 'Yes' : 'No'}</span></p>
			</div>
			<form class="mt-4 grid gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="category-cosmetics" data-category-id="${escapeHtml(category.id)}">
				<p class="font-semibold">Start / Join Cosmetics</p>
				<input class="input py-2" name="startOutfit" placeholder="Start outfit IDs" value="${escapeHtml(ids(config.startOutfit))}" />
				<input class="input py-2" name="startBackpack" placeholder="Start backpack IDs" value="${escapeHtml(ids(config.startBackpack))}" />
				<input class="input py-2" name="startPickaxe" placeholder="Start pickaxe IDs" value="${escapeHtml(ids(config.startPickaxe))}" />
				<input class="input py-2" name="startShoes" placeholder="Start shoes IDs" value="${escapeHtml(ids(config.startShoes))}" />
				<input class="input py-2" name="joinEmote" placeholder="Join emote IDs" value="${escapeHtml(ids(config.joinEmote))}" />
				<button class="btn-secondary" type="submit">${icon('save')} Save Cosmetics</button>
				<p class="text-xs text-zinc-500">Use the Items page to find exact Fortnite cosmetic IDs. ${usingLocalFnbr() ? 'Changes save to SQLite and apply live through fnbr when the bot is online.' : 'Changes apply through FNLB category config.'}</p>
			</form>
		</div>
	`;
}
