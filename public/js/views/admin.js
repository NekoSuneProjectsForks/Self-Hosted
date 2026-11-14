import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon, statusBadge, tomorrowLocalInput } from '../core/ui.js';
import { runtimeOnlineFor } from '../core/selectors.js';
import { platformOptions } from '../core/platforms.js';

const TABS = [
	['overview', 'layout-dashboard', 'Overview'],
	['members', 'users', 'Members'],
	['bots', 'bot', 'Running bots'],
	['tracker', 'radar', 'Tracker'],
	['server', 'settings', 'Server']
];

function formatUptime(seconds) {
	const total = Number(seconds) || 0;
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

function stat(label, value, sub = '') {
	const text = String(value ?? 0);
	return `
		<div class="card min-w-0">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-2 truncate font-bold ${text.length > 8 ? 'text-base' : 'text-2xl'}" title="${escapeHtml(text)}">${escapeHtml(text)}</p>
			${sub ? `<p class="mt-1 text-xs text-zinc-500">${sub}</p>` : ''}
		</div>`;
}

function trackerBadge(tracker) {
	const status = tracker?.status || 'offline';
	return statusBadge(status === 'online' ? 'online' : status === 'starting' ? 'starting' : status === 'offline' ? 'offline' : 'error', status.replace('_', ' '));
}

function renderOverview() {
	const o = state.adminOverview || {};
	const server = o.server || {};
	const tracker = o.tracker || {};
	return `
		<div class="grid gap-4">
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				${stat('Members', o.users, `${o.admins ?? 0} admin · ${o.suspended ?? 0} suspended · ${o.newUsersWeek ?? 0} new this week`)}
				${stat('Bots online', o.bots?.online, `${o.bots?.main ?? 0} main · ${o.bots?.extra ?? 0} extra · ${o.botAccounts ?? 0} extra accounts saved`)}
				${stat('Tracked players', o.trackedPlayers, `${o.matchesToday ?? 0} match${o.matchesToday === 1 ? '' : 'es'} recorded today`)}
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Server tracker</p>
					<div class="mt-2 flex items-center gap-2">${trackerBadge(tracker)}<span class="truncate text-sm">${escapeHtml(tracker.displayName || '')}</span></div>
					<p class="mt-1 text-xs text-zinc-500">${tracker.lastPollAt ? `Last check ${escapeHtml(formatDate(tracker.lastPollAt))}` : 'No checks yet'}</p>
				</div>
			</div>
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="flex items-center gap-2 font-semibold">${icon('server')} Server</h2>
					<button class="btn-secondary" data-action="admin-refresh">${icon('refresh-cw')} Refresh</button>
				</div>
				<dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Dashboard</dt><dd class="mt-1 font-semibold">${escapeHtml(server.version || '-')} <span class="font-mono text-xs text-zinc-500">@ ${escapeHtml(server.commit || 'unknown')}</span></dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Uptime</dt><dd class="mt-1 font-semibold">${escapeHtml(formatUptime(server.uptimeSeconds))}</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Node</dt><dd class="mt-1 font-semibold">${escapeHtml(server.node || '-')} <span class="text-xs text-zinc-500">${escapeHtml(server.platform || '')}</span></dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Memory</dt><dd class="mt-1 font-semibold">${escapeHtml(server.memoryMb ?? '-')} MB</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Database</dt><dd class="mt-1 font-semibold">${server.dbSizeMb === null || server.dbSizeMb === undefined ? '-' : `${escapeHtml(server.dbSizeMb)} MB`}</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Registration</dt><dd class="mt-1 font-semibold">${state.adminServer?.registrationOpen === false ? 'Closed' : 'Open'}</dd></div>
				</dl>
			</section>
		</div>`;
}

function renderMembers() {
	const query = String(state.adminSearch || '').toLowerCase();
	const users = (state.adminUsers || []).filter(
		(user) => !query || user.username.toLowerCase().includes(query) || String(user.email || '').toLowerCase().includes(query)
	);
	const temp = state.adminTempPassword;
	return `
		<div class="grid gap-4">
			${
				temp
					? `<div class="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm">
						<p class="font-semibold text-amber-100">New password for ${escapeHtml(temp.username)}</p>
						<p class="mt-2 font-mono text-lg text-zinc-50" data-temp-password>${escapeHtml(temp.password)}</p>
						<p class="mt-1 text-xs text-zinc-400">Shown once. Give it to them privately; they can change it under Account.</p>
						<button class="btn-secondary mt-2" data-action="admin-temp-dismiss">${icon('check')} Done</button>
					</div>`
					: ''
			}
			<section class="shell-panel overflow-hidden rounded-lg">
				<div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
					<div class="flex items-center gap-2 font-semibold">${icon('users')} Members (${users.length})</div>
					<div class="flex gap-2">
						<input class="input py-1.5 text-sm" data-admin-search placeholder="Search name or email" value="${escapeHtml(state.adminSearch || '')}" />
						<button class="btn-secondary" data-action="admin-refresh">${icon('refresh-cw')}</button>
					</div>
				</div>
				<div class="overflow-x-auto">
					<table class="min-w-full text-left text-sm">
						<thead class="bg-black/30 text-xs uppercase text-zinc-500">
							<tr>
								<th class="px-4 py-3">Member</th>
								<th class="px-4 py-3">Role</th>
								<th class="px-4 py-3">Status</th>
								<th class="px-4 py-3">Bots</th>
								<th class="px-4 py-3">Suspend</th>
								<th class="px-4 py-3">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-white/10">
							${users.map(renderAdminUser).join('') || '<tr><td class="px-4 py-4 text-zinc-500" colspan="6">No members match.</td></tr>'}
						</tbody>
					</table>
				</div>
			</section>
		</div>`;
}

function renderAdminUser(user) {
	const suspended = user.status === 'suspended';
	const self = user.id === state.user?.id;
	return `
		<tr>
			<td class="px-4 py-4">
				<p class="font-semibold">${escapeHtml(user.username)}${self ? ' <span class="text-xs text-zinc-500">(you)</span>' : ''}</p>
				<p class="text-xs text-zinc-500">${escapeHtml(user.email)}</p>
				<p class="text-xs text-zinc-600">Joined ${escapeHtml(formatDate(user.createdAt))}</p>
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
				<p class="mt-2 text-xs text-zinc-500">${escapeHtml(user.runtimeMode || 'fnbr')} · ${user.extraOnline ?? 0}/${user.extraBots ?? 0} extra online</p>
				<p class="text-xs text-zinc-500">${user.trackedPlayers ?? 0} tracked · ${user.matches ?? 0} matches</p>
			</td>
			<td class="min-w-[260px] px-4 py-4">
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
				<div class="flex flex-wrap gap-2">
					<button class="btn-primary px-2 py-1 text-xs" title="Start main bot" data-admin-action="start" data-user-id="${user.id}" ${runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('power', 'h-3.5 w-3.5')}</button>
					<button class="btn-danger px-2 py-1 text-xs" title="Stop main bot" data-admin-action="stop" data-user-id="${user.id}" ${!runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('square', 'h-3.5 w-3.5')}</button>
					<button class="btn-secondary px-2 py-1 text-xs" title="Set a new password" data-admin-action="reset-password" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">${icon('key-round', 'h-3.5 w-3.5')}</button>
					<button class="btn-danger px-2 py-1 text-xs" title="Delete member" data-admin-action="delete" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}" ${self ? 'disabled' : ''}>${icon('trash-2', 'h-3.5 w-3.5')}</button>
				</div>
			</td>
		</tr>`;
}

function renderBots() {
	const bots = state.adminBots || [];
	return `
		<section class="shell-panel overflow-hidden rounded-lg">
			<div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
				<div class="flex items-center gap-2 font-semibold">${icon('bot')} Running bots (${bots.length})</div>
				<div class="flex gap-2">
					<button class="btn-secondary" data-action="admin-refresh">${icon('refresh-cw')} Refresh</button>
					<button class="btn-danger" data-action="admin-stop-all" ${bots.length ? '' : 'disabled'}>${icon('octagon-x')} Stop all</button>
				</div>
			</div>
			<div class="overflow-x-auto">
				<table class="min-w-full text-left text-sm">
					<thead class="bg-black/30 text-xs uppercase text-zinc-500">
						<tr><th class="px-4 py-3">Bot</th><th class="px-4 py-3">Owner</th><th class="px-4 py-3">Engine</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Party</th><th class="px-4 py-3">Since</th><th class="px-4 py-3"></th></tr>
					</thead>
					<tbody class="divide-y divide-white/10">
						${
							bots
								.map(
									(bot) => `
						<tr>
							<td class="px-4 py-3"><p class="font-semibold">${escapeHtml(bot.displayName || bot.label)}</p><p class="text-xs text-zinc-500">${escapeHtml(bot.label)}${bot.tracker ? ' · tracker' : ''}</p></td>
							<td class="px-4 py-3">${escapeHtml(bot.owner)}</td>
							<td class="px-4 py-3">${escapeHtml(bot.engine === 'fnlb' ? 'Legacy FNLB' : 'Local fnbr')}</td>
							<td class="px-4 py-3">${statusBadge(bot.status)}</td>
							<td class="px-4 py-3">${bot.partySize ?? '-'}</td>
							<td class="px-4 py-3 text-xs text-zinc-500">${bot.startedAt ? escapeHtml(formatDate(bot.startedAt)) : '-'}</td>
							<td class="px-4 py-3">${
								bot.kind === 'main'
									? `<button class="btn-danger px-2 py-1 text-xs" data-admin-action="stop" data-user-id="${bot.userId}">${icon('square', 'h-3.5 w-3.5')} Stop</button>`
									: `<button class="btn-danger px-2 py-1 text-xs" data-admin-action="stop-helper" data-user-id="${bot.userId}" data-row-id="${escapeHtml(bot.accountRowId)}">${icon('square', 'h-3.5 w-3.5')} Stop</button>`
							}</td>
						</tr>`
								)
								.join('') || '<tr><td class="px-4 py-4 text-zinc-500" colspan="7">No bots are running.</td></tr>'
						}
					</tbody>
				</table>
			</div>
		</section>`;
}

function renderTracker() {
	const data = state.adminTracker;
	if (!data) return '<p class="text-sm text-zinc-500">Loading…</p>';
	const settings = data.settings || {};
	const run = data.runtime || {};
	const online = run.status === 'online';
	const busy = run.status === 'starting';
	return `
		<div class="grid gap-4 xl:grid-cols-[1fr_380px]">
			<section class="shell-panel rounded-lg p-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="flex items-center gap-2 font-semibold">${icon('radar')} Server tracker bot</h2>
						<p class="mt-1 max-w-2xl text-sm text-zinc-400">One Epic account that reads public stats for <b>every member's</b> Player tracking (Matches page). It never accepts invites, never joins a party and never readies, so it can't disturb anyone's lobby or an FNLB bot lobby. Use a <b>dummy</b> account.</p>
					</div>
					<div class="flex items-center gap-2">${trackerBadge(run)}</div>
				</div>
				<div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					${stat('Signed in as', settings.displayName || (settings.configured ? settings.accountMasked || 'code saved' : 'Not signed in'))}
					${stat('Members tracking', data.usersTracking, `${data.trackedPlayers ?? 0} player${data.trackedPlayers === 1 ? '' : 's'}`)}
					${stat('Last check', run.lastPollAt ? formatDate(run.lastPollAt) : '-', `every ${settings.intervalMinutes ?? 2} min`)}
					${stat('Matches recorded', run.lastPollRecorded ?? 0, 'since it started')}
				</div>
				${run.lastError ? `<p class="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">${escapeHtml(run.lastError)}</p>` : ''}
				<div class="mt-4 flex flex-wrap gap-2">
					<button class="btn-primary" data-action="admin-tracker-start" ${online || busy || !settings.configured ? 'disabled' : ''}>${icon('power')} Start</button>
					<button class="btn-danger" data-action="admin-tracker-stop" ${online || busy ? '' : 'disabled'}>${icon('square')} Stop</button>
					<button class="btn-secondary" data-action="admin-tracker-poll" ${online ? '' : 'disabled'}>${icon('refresh-cw')} Check everyone now</button>
					<button class="btn-secondary" data-action="epic-code-prompt" data-epic-target="server-tracker">${icon('log-in')} ${settings.configured ? 'Sign in again' : 'Sign in with Epic'}</button>
					${settings.configured ? `<button class="btn-secondary" data-action="admin-tracker-clear">${icon('log-out')} Sign out</button>` : ''}
				</div>
				<h3 class="mt-5 text-xs font-semibold uppercase text-zinc-500">Tracker log</h3>
				<div class="mt-2 max-h-64 overflow-y-auto rounded-lg bg-black/40 p-3 font-mono text-xs">
					${(run.logs || []).slice().reverse().map((row) => `<p class="${row.format === 4 ? 'text-red-300' : 'text-zinc-400'}"><span class="text-zinc-600">${escapeHtml(new Date(row.at).toLocaleTimeString())}</span> ${escapeHtml(row.content)}</p>`).join('') || '<p class="text-zinc-600">Nothing yet.</p>'}
				</div>
			</section>
			<section class="shell-panel rounded-lg p-4">
				<h2 class="flex items-center gap-2 font-semibold">${icon('sliders-horizontal')} Settings</h2>
				<form data-form="admin-tracker" class="mt-3 grid gap-3">
					<label class="grid gap-1 text-sm">Check every
						<select class="input" name="intervalMinutes">${(data.intervals || [1, 2, 5, 10, 15]).map((m) => `<option value="${m}" ${m === settings.intervalMinutes ? 'selected' : ''}>${m} minute${m === 1 ? '' : 's'}</option>`).join('')}</select>
					</label>
					<label class="grid gap-1 text-sm">Platform
						<select class="input" name="platform">${platformOptions(settings.platform || 'WIN')}</select>
					</label>
					<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="autoStart" class="h-4 w-4 accent-fnlb-500" ${settings.autoStart ? 'checked' : ''} /> Start with the server</label>
					<details class="text-sm">
						<summary class="cursor-pointer text-zinc-400">Sign in with a code or device auth instead</summary>
						<div class="mt-2 grid gap-2">
							<input class="input font-mono text-xs" name="authorizationCode" placeholder="One-time authorization code" autocomplete="off" />
							<textarea class="input font-mono text-xs" name="deviceAuthJson" rows="3" placeholder='{"accountId":"…","deviceId":"…","secret":"…"}'></textarea>
						</div>
					</details>
					<button class="btn-primary" type="submit">${icon('save')} Save</button>
					<p class="text-xs text-zinc-500">A new platform or login applies the next time the tracker starts.</p>
				</form>
			</section>
		</div>`;
}

function renderServer() {
	const options = state.adminServer || {};
	return `
		<div class="grid gap-4 lg:grid-cols-2">
			<section class="shell-panel rounded-lg p-4">
				<h2 class="flex items-center gap-2 font-semibold">${icon('user-plus')} Registration</h2>
				<p class="mt-1 text-sm text-zinc-400">When closed, nobody can create an account; create accounts for people by opening it briefly, or reset a member's password from Members.</p>
				<div class="mt-3 flex items-center gap-3">
					${statusBadge(options.registrationOpen === false ? 'offline' : 'online', options.registrationOpen === false ? 'Closed' : 'Open')}
					<button class="btn-secondary" data-action="admin-registration" data-open="${options.registrationOpen === false ? 'true' : 'false'}">${icon(options.registrationOpen === false ? 'lock-open' : 'lock')} ${options.registrationOpen === false ? 'Open registration' : 'Close registration'}</button>
				</div>
			</section>
			<section class="shell-panel rounded-lg p-4">
				<h2 class="flex items-center gap-2 font-semibold">${icon('megaphone')} Announcement</h2>
				<p class="mt-1 text-sm text-zinc-400">Shown as a banner to every member (e.g. maintenance or an Epic outage). Leave empty to hide it.</p>
				<form data-form="admin-server" class="mt-3 grid gap-2">
					<textarea class="input text-sm" name="announcement" rows="3" maxlength="500" placeholder="Fortnite is down for maintenance until 10:00.">${escapeHtml(options.announcement || '')}</textarea>
					<div class="flex gap-2">
						<button class="btn-primary" type="submit">${icon('save')} Save</button>
						${options.announcement ? `<button class="btn-secondary" type="button" data-action="admin-announcement-clear">${icon('x')} Clear</button>` : ''}
					</div>
				</form>
			</section>
			<section class="shell-panel rounded-lg p-4 lg:col-span-2">
				<h2 class="flex items-center gap-2 font-semibold">${icon('octagon-x')} Emergency</h2>
				<p class="mt-1 text-sm text-zinc-400">Stops every member's main and extra bots right away (the server tracker keeps running).</p>
				<button class="btn-danger mt-3" data-action="admin-stop-all">${icon('octagon-x')} Stop all bots</button>
			</section>
		</div>`;
}

export function renderAdmin() {
	const tab = TABS.some(([id]) => id === state.adminTab) ? state.adminTab : 'overview';
	const views = { overview: renderOverview, members: renderMembers, bots: renderBots, tracker: renderTracker, server: renderServer };
	return `
		<div class="grid gap-4">
			<nav class="flex flex-wrap gap-2" role="tablist">
				${TABS.map(
					([id, iconName, label]) =>
						`<button class="tab ${tab === id ? 'active' : ''}" role="tab" aria-selected="${tab === id}" data-action="admin-tab" data-tab="${id}">${icon(iconName, 'h-4 w-4')} ${label}</button>`
				).join('')}
			</nav>
			${views[tab]()}
		</div>`;
}
