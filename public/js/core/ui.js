import { state, statusStyles } from './state.js';
import { render } from './render.js';

export function icon(name, classes = 'h-4 w-4') {
	return `<i data-lucide="${name}" class="${classes}"></i>`;
}

export function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

export function statusBadge(status, label = status) {
	return `<span class="badge ${statusStyles[status] || statusStyles.offline}">${escapeHtml(label || 'offline')}</span>`;
}

export function formatDate(value) {
	if (!value) return 'Never';
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return 'Unknown';
	return date.toLocaleString();
}

export function valueOrDash(value) {
	if (value === undefined || value === null || value === '') return '-';
	return escapeHtml(value);
}

export function count(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
}

export function tomorrowLocalInput() {
	const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
	date.setSeconds(0, 0);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function renderToast() {
	if (!state.toast) return '';
	const classes =
		state.toast.type === 'error'
			? 'border-red-400/30 bg-red-500/15 text-red-100'
			: 'border-fnlb-400/30 bg-fnlb-500/15 text-fnlb-100';
	return `<div class="fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-xl ${classes}">${escapeHtml(state.toast.message)}</div>`;
}

export function statCard(label, value) {
	return `
		<div class="card">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-2 text-2xl font-bold">${count(value)}</p>
		</div>
	`;
}

export function detailRow(label, value) {
	return `
		<div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
			<span class="text-zinc-500">${escapeHtml(label)}</span>
			<span class="break-all text-right text-zinc-200">${valueOrDash(value)}</span>
		</div>
	`;
}

export function smallCount(label, value) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-1 text-xl font-bold">${escapeHtml(value)}</p>
		</div>
	`;
}

export function renderList(title, rows, getLabel) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<p class="mb-2 text-sm font-semibold">${escapeHtml(title)}</p>
			${rows.length ? `<div class="grid gap-1 text-xs text-zinc-400">${rows.map((row) => `<p class="break-all">${escapeHtml(getLabel(row))}</p>`).join('')}</div>` : '<p class="text-xs text-zinc-500">None</p>'}
		</div>
	`;
}

export function setToast(message, type = 'info') {
	state.toast = { message, type };
	render();
	if (message) {
		setTimeout(() => {
			if (state.toast?.message === message) {
				state.toast = null;
				render();
			}
		}, 4200);
	}
}
