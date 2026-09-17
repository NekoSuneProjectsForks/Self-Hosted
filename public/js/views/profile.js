import { state, logStyles } from '../core/state.js';
import { escapeHtml, formatDate, icon } from '../core/ui.js';

export function renderProfile() {
	return `
		<div class="grid gap-4">
			<section class="grid gap-3 md:grid-cols-3">
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Username</p>
					<p class="mt-2 text-xl font-bold">${escapeHtml(state.user.username)}</p>
				</div>
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Email</p>
					<p class="mt-2 break-all text-lg font-bold">${escapeHtml(state.user.email)}</p>
				</div>
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Role</p>
					<p class="mt-2 text-xl font-bold">${escapeHtml(state.user.role)}</p>
				</div>
			</section>

			<section class="shell-panel overflow-hidden rounded-lg">
				<div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div class="flex items-center gap-2 font-semibold">${icon('terminal')} Your Runtime Logs</div>
					<button class="btn-secondary" data-action="clear-logs">${icon('trash-2')} Clear</button>
				</div>
				<div id="profile-log" class="h-[520px] overflow-auto bg-black/35 p-4 font-mono text-xs leading-5">
					${state.logs.length ? state.logs.map((log) => `
						<div class="${logStyles[log.format] || logStyles[0]}">
							<span class="text-zinc-600">${escapeHtml(formatDate(log.createdAt))}</span>
							<span>${escapeHtml(log.content)}</span>
						</div>
					`).join('') : '<div class="text-zinc-500">No runtime output yet.</div>'}
				</div>
			</section>
		</div>
	`;
}
