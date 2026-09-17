import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon, statusBadge, valueOrDash } from '../core/ui.js';

function can(capability) {
	return state.runtime?.capabilities?.capabilities?.[capability] === true;
}

function botId() {
	return state.bots?.[0]?.id || state.selectedBotId || '';
}

/**
 * Presence fields are only shown when Epic actually supplied them — nothing is
 * invented to fill a gap.
 */
function presenceLine(friend) {
	const presence = friend.presence || {};
	const parts = [];
	if (presence.status) parts.push(escapeHtml(presence.status));
	if (presence.playlist) parts.push(escapeHtml(presence.playlist));
	if (presence.partySize) {
		parts.push(`${escapeHtml(String(presence.partySize))}/${escapeHtml(String(presence.partyMaxSize ?? '?'))}`);
	}
	if (presence.platform) parts.push(escapeHtml(presence.platform));
	return parts.join(' · ');
}

function friendRow(friend, kind) {
	const selected = state.selectedFriendId === friend.id;
	return `
		<button class="w-full rounded-lg border p-3 text-left transition ${
			selected ? 'border-fnlb-400/50 bg-fnlb-500/10' : 'border-white/5 bg-black/20 hover:border-white/20'
		}" data-friend-id="${escapeHtml(friend.id)}" data-friend-kind="${kind}">
			<div class="flex items-center justify-between gap-2">
				<span class="min-w-0 truncate font-medium">${escapeHtml(friend.displayName || friend.id)}</span>
				${
					kind === 'online'
						? statusBadge('online', friend.isJoinable ? 'Joinable' : 'Online')
						: kind === 'offline'
							? statusBadge('offline', 'Offline')
							: ''
				}
			</div>
			${presenceLine(friend) ? `<p class="mt-1 truncate text-xs text-zinc-500">${presenceLine(friend)}</p>` : ''}
		</button>
	`;
}

function section(title, rows, kind, emptyText) {
	return `
		<details class="shell-panel rounded-lg p-3" ${rows.length ? 'open' : ''}>
			<summary class="cursor-pointer list-none text-sm font-semibold">
				${escapeHtml(title)} <span class="text-zinc-500">(${rows.length})</span>
			</summary>
			<div class="mt-3 grid gap-2">
				${rows.length ? rows.map((row) => friendRow(row, kind)).join('') : `<p class="text-xs text-zinc-500">${escapeHtml(emptyText)}</p>`}
			</div>
		</details>
	`;
}

function selectedFriend() {
	const id = state.selectedFriendId;
	if (!id) return null;
	const pools = [
		...(state.friends?.onlineFriends || []),
		...(state.friends?.offlineFriends || []),
		...(state.pendingFriends?.incomingFriends || []),
		...(state.pendingFriends?.outgoingFriends || []),
		...(state.blockedUsers || [])
	];
	return pools.find((row) => row.id === id) || null;
}

function friendKind(friend) {
	if ((state.pendingFriends?.incomingFriends || []).some((f) => f.id === friend.id)) return 'incoming';
	if ((state.pendingFriends?.outgoingFriends || []).some((f) => f.id === friend.id)) return 'outgoing';
	if ((state.blockedUsers || []).some((f) => f.id === friend.id)) return 'blocked';
	if ((state.friends?.onlineFriends || []).some((f) => f.id === friend.id)) return 'online';
	return 'offline';
}

function detailPanel() {
	const friend = selectedFriend();
	if (!friend) {
		return `
			<div class="shell-panel rounded-lg p-6 text-center text-sm text-zinc-500">
				Select someone to see their details and available actions.
			</div>
		`;
	}

	const kind = friendKind(friend);
	const presence = friend.presence || {};
	const id = escapeHtml(friend.id);

	const actions = [];
	if (kind === 'incoming') {
		if (can('friendRequests')) {
			actions.push(`<button class="btn-primary" data-action="friend-accept" data-friend-id="${id}">${icon('check')} Accept</button>`);
			actions.push(`<button class="btn-secondary" data-action="friend-decline" data-friend-id="${id}">${icon('x')} Decline</button>`);
		} else {
			actions.push(`<p class="text-xs text-zinc-500">This engine cannot accept or decline requests from the dashboard.</p>`);
		}
	}
	if (kind === 'outgoing' && can('friendRequests')) {
		actions.push(`<button class="btn-secondary" data-action="friend-decline" data-friend-id="${id}">${icon('x')} Cancel Request</button>`);
	}
	if (kind === 'online' || kind === 'offline') {
		if (can('friendMessages')) {
			actions.push(`<button class="btn-primary" data-action="friend-open-messages" data-friend-id="${id}">${icon('message-square')} Message</button>`);
		}
		actions.push(`<button class="btn-secondary" data-action="friend-invite" data-friend-id="${id}">${icon('user-plus')} Invite</button>`);
		if (friend.isJoinable && friend.party?.id) {
			actions.push(`<button class="btn-secondary" data-action="friend-join" data-party-id="${escapeHtml(friend.party.id)}">${icon('log-in')} Join Party</button>`);
		}
		actions.push(`<button class="btn-secondary" data-action="friend-remove" data-friend-id="${id}">${icon('user-minus')} Remove</button>`);
		actions.push(`<button class="btn-danger" data-action="friend-block" data-friend-id="${id}">${icon('ban')} Block</button>`);
	}
	if (kind === 'blocked') {
		actions.push(`<button class="btn-secondary" data-action="friend-unblock" data-friend-id="${id}">${icon('circle-check')} Unblock</button>`);
	}

	return `
		<div class="shell-panel rounded-lg p-4">
			<div class="mb-4">
				<p class="text-lg font-semibold">${escapeHtml(friend.displayName || friend.id)}</p>
				<p class="truncate text-xs text-zinc-500">${id}</p>
			</div>

			<dl class="mb-4 grid gap-2 text-sm">
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Status</dt><dd>${valueOrDash(presence.status)}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Online</dt><dd>${friend.isOnline === undefined ? '-' : friend.isOnline ? 'Yes' : 'No'}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Joinable</dt><dd>${friend.isJoinable === undefined ? '-' : friend.isJoinable ? 'Yes' : 'No'}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Platform</dt><dd>${valueOrDash(presence.platform)}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Playlist</dt><dd>${valueOrDash(presence.playlist)}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Party size</dt><dd>${presence.partySize ? `${escapeHtml(String(presence.partySize))} / ${escapeHtml(String(presence.partyMaxSize ?? '?'))}` : '-'}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">In match</dt><dd>${presence.isPlaying === undefined ? '-' : presence.isPlaying ? 'Yes' : 'No'}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Last presence</dt><dd>${presence.receivedAt ? formatDate(presence.receivedAt) : '-'}</dd></div>
				<div class="flex justify-between gap-2"><dt class="text-zinc-500">Friends since</dt><dd>${friend.createdAt ? formatDate(friend.createdAt) : '-'}</dd></div>
			</dl>

			<div class="flex flex-wrap gap-2">${actions.join('')}</div>
		</div>
	`;
}

export function renderFriends() {
	if (state.runtime?.status !== 'online') {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">The bot is offline</p>
				<p class="mt-1 text-sm text-zinc-500">Friends load from the running bot. Start it to manage them live.</p>
			</div>
		`;
	}
	if (!can('friends')) {
		return `<div class="shell-panel rounded-lg p-6 text-center text-sm text-zinc-500">The ${escapeHtml(state.runtime?.capabilities?.engine || 'active')} engine does not expose friend management.</div>`;
	}

	const online = state.friends?.onlineFriends || [];
	const offline = state.friends?.offlineFriends || [];
	const incoming = state.pendingFriends?.incomingFriends || [];
	const outgoing = state.pendingFriends?.outgoingFriends || [];
	const blocked = state.blockedUsers || [];

	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-lg p-4">
				<div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
					<form class="grid flex-1 gap-2 sm:grid-cols-[1fr_auto]" data-form="friend-add">
						<input class="input" name="target" placeholder="Add a friend by display name or account ID" autocomplete="off" />
						<button class="btn-primary" type="submit">${icon('user-plus')} Add Friend</button>
					</form>
					<button class="btn-secondary" data-action="refresh-friends">${icon('refresh-cw')} Refresh</button>
				</div>
				${
					incoming.length
						? `<p class="mt-3 text-xs text-amber-300">${icon('bell', 'mr-1 inline h-3 w-3')} ${incoming.length} incoming friend request${incoming.length === 1 ? '' : 's'} waiting.</p>`
						: ''
				}
			</section>

			<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
				<div class="grid gap-3">
					${section('Online', online, 'online', 'No friends online.')}
					${section('Incoming requests', incoming, 'incoming', 'No incoming requests.')}
					${section('Outgoing requests', outgoing, 'outgoing', 'No outgoing requests.')}
					${section('Offline', offline, 'offline', 'No offline friends.')}
					${section('Blocked', blocked, 'blocked', 'Nobody is blocked.')}
				</div>
				${detailPanel()}
			</div>

			<p class="text-xs text-zinc-500">Bot: ${escapeHtml(botId() || 'unknown')}</p>
		</div>
	`;
}
