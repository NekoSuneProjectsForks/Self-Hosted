import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';

/** Your dashboard account. Bot settings live on the Bots page. */
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
			<section class="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p class="text-sm text-zinc-400">Bot settings (battle pass level, platform, sign-in, extra bots) are on the <strong class="text-zinc-200">Bots</strong> page. Runtime output is in <strong class="text-zinc-200">Console</strong>.</p>
				<div class="flex gap-2">
					<button class="btn-secondary" data-view="bots">${icon('bot')} Bots</button>
					<button class="btn-secondary" data-view="console">${icon('terminal')} Console</button>
				</div>
			</section>
		</div>
	`;
}
