import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon, statusBadge, tomorrowLocalInput } from '../core/ui.js';
import { runtimeOnlineFor } from '../core/selectors.js';

export function renderAdmin() {
	return `
		<div class="grid gap-4">
			<div class="grid gap-3 md:grid-cols-3">
				<div class="card"><p class="text-xs uppercase text-zinc-500">Users</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.users ?? 0)}</p></div>
				<div class="card"><p class="text-xs uppercase text-zinc-500">Admins</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.admins ?? 0)}</p></div>
				<div class="card"><p class="text-xs uppercase text-zinc-500">Suspended</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.suspended ?? 0)}</p></div>
			</div>
			<section class="shell-panel overflow-hidden rounded-lg">
				<div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div class="flex items-center gap-2 font-semibold">${icon('users')} Users</div>
					<button class="btn-secondary" data-action="admin-refresh">${icon('refresh-cw')} Refresh</button>
				</div>
				<div class="overflow-x-auto">
					<table class="min-w-full text-left text-sm">
						<thead class="bg-black/30 text-xs uppercase text-zinc-500">
							<tr>
								<th class="px-4 py-3">User</th>
								<th class="px-4 py-3">Role</th>
								<th class="px-4 py-3">Status</th>
								<th class="px-4 py-3">Cluster</th>
								<th class="px-4 py-3">Suspend</th>
								<th class="px-4 py-3">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-white/10">
							${state.adminUsers.map(renderAdminUser).join('') || '<tr><td class="px-4 py-4 text-zinc-500" colspan="6">No users.</td></tr>'}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	`;
}

function renderAdminUser(user) {
	const suspended = user.status === 'suspended';
	return `
		<tr>
			<td class="px-4 py-4">
				<p class="font-semibold">${escapeHtml(user.username)}</p>
				<p class="text-xs text-zinc-500">${escapeHtml(user.email)}</p>
			</td>
			<td class="px-4 py-4">
				<div class="flex gap-2">
					<button class="btn-secondary px-2 py-1 text-xs ${user.role === 'admin' ? 'ring-1 ring-fnlb-400/30' : ''}" data-admin-action="role-admin" data-user-id="${user.id}">Admin</button>
					<button class="btn-secondary px-2 py-1 text-xs ${user.role === 'user' ? 'ring-1 ring-fnlb-400/30' : ''}" data-admin-action="role-user" data-user-id="${user.id}">User</button>
				</div>
			</td>
			<td class="px-4 py-4">
				${statusBadge(suspended ? 'suspended' : 'active', suspended ? 'suspended' : 'active')}
				<p class="mt-2 text-xs text-zinc-500">${suspended ? `${user.suspendedUntil ? `Until ${escapeHtml(formatDate(user.suspendedUntil))}` : 'Permanent'}${user.suspendedReason ? ` / ${escapeHtml(user.suspendedReason)}` : ''}` : 'Clear'}</p>
			</td>
			<td class="px-4 py-4">
				${statusBadge(user.runtime?.status || 'offline')}
				<p class="mt-2 text-xs text-zinc-500">${escapeHtml(user.runtimeMode || 'fnbr')} / Device auth ${user.deviceAuthConfigured ? 'saved' : 'missing'} / FNLB token ${user.apiTokenConfigured ? 'saved' : 'missing'}</p>
			</td>
			<td class="min-w-[280px] px-4 py-4">
				<div class="grid gap-2">
					<input class="input py-1 text-xs" data-suspend-until="${user.id}" type="datetime-local" value="${tomorrowLocalInput()}" />
					<input class="input py-1 text-xs" data-suspend-reason="${user.id}" placeholder="Reason" />
					<div class="flex flex-wrap gap-2">
						<button class="btn-secondary px-2 py-1 text-xs" data-admin-action="suspend-temp" data-user-id="${user.id}">${icon('clock', 'h-3.5 w-3.5')} Temp</button>
						<button class="btn-danger px-2 py-1 text-xs" data-admin-action="suspend-perm" data-user-id="${user.id}">${icon('ban', 'h-3.5 w-3.5')} Permanent</button>
						<button class="btn-secondary px-2 py-1 text-xs" data-admin-action="activate" data-user-id="${user.id}">${icon('check', 'h-3.5 w-3.5')} Activate</button>
					</div>
				</div>
			</td>
			<td class="px-4 py-4">
				<div class="flex gap-2">
					<button class="btn-primary px-2 py-1 text-xs" data-admin-action="start" data-user-id="${user.id}" ${runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('power', 'h-3.5 w-3.5')}</button>
					<button class="btn-danger px-2 py-1 text-xs" data-admin-action="stop" data-user-id="${user.id}" ${!runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('square', 'h-3.5 w-3.5')}</button>
				</div>
			</td>
		</tr>
	`;
}
