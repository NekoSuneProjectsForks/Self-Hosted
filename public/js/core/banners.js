import { state } from './state.js';
import { escapeHtml, icon } from './ui.js';

/**
 * Banner icon / colour pickers for the profile forms. Data comes from
 * fortnite-api.com via /api/fortnite/banners and is cached for the session.
 * The text boxes stay, so an ID can still be typed by hand.
 */

const MAX_SHOWN = 160;

function findBanner(id) {
	return (state.bannerData?.banners || []).find((banner) => banner.id.toLowerCase() === String(id || '').toLowerCase());
}

function findColor(id) {
	return (state.bannerData?.colors || []).find((color) => color.id.toLowerCase() === String(id || '').toLowerCase());
}

/** The two banner fields for a profile form. `formKey` ties picks back to this form. */
export function bannerFields(formKey, { bannerId = '', bannerColor = '' } = {}) {
	const chosen = state.bannerChoice?.[formKey] || {};
	const banner = findBanner(chosen.bannerId);
	const color = findColor(chosen.bannerColor);
	const key = escapeHtml(formKey);
	return `
		<label><span class="label">Banner</span>
			<div class="flex gap-2">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30" style="${color ? `background:${escapeHtml(color.css)}` : ''}">
					${banner?.icon ? `<img class="h-full w-full object-contain" src="${escapeHtml(banner.icon)}" alt="" />` : icon('flag', 'h-4 w-4 text-zinc-600')}
				</div>
				<input class="input" name="bannerId" value="${escapeHtml(chosen.bannerId || '')}" placeholder="${escapeHtml(bannerId || 'e.g. BRSeason01')}" />
				<button class="btn-secondary shrink-0" type="button" data-action="banner-picker" data-kind="banner" data-form-key="${key}">${icon('layout-grid')} Browse</button>
			</div>
			${banner ? `<span class="mt-1 block text-xs text-zinc-500">${escapeHtml(banner.name)}</span>` : ''}
		</label>
		<label><span class="label">Banner colour</span>
			<div class="flex gap-2">
				<div class="h-10 w-10 shrink-0 rounded-lg border border-white/10" style="background:${escapeHtml(color?.css || 'transparent')}"></div>
				<input class="input" name="bannerColor" value="${escapeHtml(chosen.bannerColor || '')}" placeholder="${escapeHtml(bannerColor || 'e.g. DefaultColor15')}" />
				<button class="btn-secondary shrink-0" type="button" data-action="banner-picker" data-kind="color" data-form-key="${key}">${icon('palette')} Browse</button>
			</div>
		</label>`;
}

export function renderBannerPicker() {
	const picker = state.bannerPicker;
	if (!picker) return '';
	const data = state.bannerData;
	const isColor = picker.kind === 'color';
	const query = String(state.bannerQuery || '').toLowerCase();
	let body;
	if (!data) {
		body = `<p class="p-6 text-center text-sm text-zinc-500">${state.bannerError ? escapeHtml(state.bannerError) : 'Loading from fortnite-api.com...'}</p>`;
	} else if (isColor) {
		const colors = data.colors.filter((color) => !query || color.id.toLowerCase().includes(query) || String(color.category || '').toLowerCase().includes(query));
		body = `
			<div class="grid grid-cols-6 gap-2 p-4 sm:grid-cols-8 md:grid-cols-10">
				${colors
					.map(
						(color) => `
					<button class="group flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-white/[0.06]" type="button" data-action="banner-choose" data-value="${escapeHtml(color.id)}" title="${escapeHtml(color.id)}">
						<span class="h-10 w-10 rounded-lg border border-white/15 group-hover:ring-2 group-hover:ring-fnlb-400" style="background:${escapeHtml(color.css)}"></span>
						<span class="w-full truncate text-center text-[10px] text-zinc-500">${escapeHtml(color.id.replace(/^DefaultColor/i, ''))}</span>
					</button>`
					)
					.join('')}
			</div>`;
	} else {
		const all = data.banners.filter((banner) => !query || banner.name.toLowerCase().includes(query) || banner.id.toLowerCase().includes(query));
		const shown = all.slice(0, MAX_SHOWN);
		body = `
			<div class="grid grid-cols-4 gap-2 p-4 sm:grid-cols-6 md:grid-cols-8">
				${shown
					.map(
						(banner) => `
					<button class="group flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-white/[0.06]" type="button" data-action="banner-choose" data-value="${escapeHtml(banner.id)}" title="${escapeHtml(`${banner.name} (${banner.id})`)}">
						<span class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30 group-hover:ring-2 group-hover:ring-fnlb-400">
							${banner.icon ? `<img class="h-full w-full object-contain" src="${escapeHtml(banner.icon)}" alt="" loading="lazy" />` : icon('flag', 'h-5 w-5 text-zinc-600')}
						</span>
						<span class="w-full truncate text-center text-[10px] text-zinc-400">${escapeHtml(banner.name)}</span>
					</button>`
					)
					.join('')}
			</div>
			${all.length > shown.length ? `<p class="px-4 pb-4 text-center text-xs text-zinc-500">Showing ${shown.length} of ${all.length}. Search to narrow it down.</p>` : ''}
			${!all.length ? '<p class="p-6 text-center text-sm text-zinc-500">No banners match.</p>' : ''}`;
	}
	return `
		<div class="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Choose a banner ${isColor ? 'colour' : ''}">
			<div class="modal-panel flex max-h-[85vh] w-full max-w-3xl flex-col">
				<div class="flex items-center gap-3 border-b border-white/10 p-4">
					<p class="font-semibold">${isColor ? 'Banner colour' : 'Banner'}</p>
					<input class="input flex-1 py-1.5" placeholder="${isColor ? 'Filter colours' : 'Search banners by name'}" value="${escapeHtml(state.bannerQuery || '')}" data-action="banner-query" />
					<button class="btn-secondary px-2" type="button" data-action="banner-picker-close" title="Close">${icon('x')}</button>
				</div>
				<div class="overflow-y-auto">${body}</div>
				<p class="border-t border-white/10 px-4 py-2 text-[11px] text-zinc-600">From fortnite-api.com</p>
			</div>
		</div>`;
}
