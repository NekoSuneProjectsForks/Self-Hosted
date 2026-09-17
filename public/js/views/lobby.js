import { state } from '../core/state.js';
import { escapeHtml, icon, statusBadge, valueOrDash } from '../core/ui.js';
import { usingLocalFnbr } from '../core/selectors.js';

const MATCH_STATE_LABELS = {
	lobby: 'IN LOBBY',
	matchmaking: 'MATCHMAKING',
	in_match: 'IN MATCH',
	returning: 'RETURNING TO LOBBY',
	offline: 'OFFLINE'
};

const PRIVACY_OPTIONS = [
	['public', 'Public'],
	['friends', 'Friends'],
	['friends_of_friends', 'Friends of Friends'],
	['private', 'Private']
];

/** Only render a control the active engine actually supports. */
function can(capability) {
	return state.runtime?.capabilities?.capabilities?.[capability] === true;
}

function activeBot() {
	return state.bots?.[0] || null;
}

export function currentMatchState() {
	if (state.runtime?.status !== 'online') return 'offline';
	return activeBot()?.matchState || 'lobby';
}

function memberCard(member, leaderId) {
	const isLeader = member.isLeader || member.id === leaderId;
	const cosmetics = [
		['Outfit', member.outfit],
		['Backpack', member.backpack],
		['Pickaxe', member.pickaxe],
		['Shoes', member.shoes],
		['Emote', member.emote]
	].filter(([, value]) => value);

	return `
		<div class="card">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate font-semibold">${escapeHtml(member.displayName || member.id)}</p>
					<p class="truncate text-xs text-zinc-500">${escapeHtml(member.id)}</p>
				</div>
				<div class="flex shrink-0 flex-col items-end gap-1">
					${isLeader ? statusBadge('active', 'Leader') : ''}
					${member.isReady ? statusBadge('online', 'Ready') : statusBadge('offline', 'Not Ready')}
					${member.isSittingOut ? statusBadge('restarting', 'Sitting Out') : ''}
				</div>
			</div>
			<dl class="mt-3 grid gap-1 text-xs text-zinc-400">
				<div class="flex justify-between gap-2"><dt>Platform</dt><dd>${valueOrDash(member.platform)}</dd></div>
				${member.matchInfo?.location ? `<div class="flex justify-between gap-2"><dt>Match</dt><dd>${escapeHtml(member.matchInfo.location)}</dd></div>` : ''}
				${cosmetics
					.map(
						([label, value]) =>
							`<div class="flex justify-between gap-2"><dt>${label}</dt><dd class="truncate">${escapeHtml(value)}</dd></div>`
					)
					.join('')}
			</dl>
			${
				can('party') && !isLeader
					? `<div class="mt-3 flex flex-wrap gap-2">
							<button class="btn-secondary" data-action="party-kick" data-member-id="${escapeHtml(member.id)}">${icon('user-minus')} Kick</button>
							${can('promoteMember') ? `<button class="btn-secondary" data-action="party-promote" data-member-id="${escapeHtml(member.id)}">${icon('crown')} Promote</button>` : ''}
						</div>`
					: ''
			}
		</div>
	`;
}

export function renderLobby() {
	if (state.runtime?.status !== 'online') {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">The bot is offline</p>
				<p class="mt-1 text-sm text-zinc-500">Start the bot to see and control its Fortnite party in real time.</p>
			</div>
		`;
	}

	const bot = activeBot();
	const party = state.party || bot?.party || null;
	const members = party?.members || [];
	const matchState = currentMatchState();
	const isLeader = members.find((m) => m.id === bot?.id)?.isLeader ?? false;

	if (!party) {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">No party yet</p>
				<p class="mt-1 text-sm text-zinc-500">The bot has not created or joined a Fortnite party yet.</p>
				<button class="btn-secondary mt-4" data-action="refresh-lobby">${icon('refresh-cw')} Refresh</button>
			</div>
		`;
	}

	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div class="mb-1 flex flex-wrap items-center gap-2">
							${statusBadge(matchState === 'in_match' ? 'online' : matchState === 'matchmaking' ? 'starting' : 'active', MATCH_STATE_LABELS[matchState] || matchState)}
							<span class="text-sm text-zinc-400">Party ${escapeHtml(String(party.size ?? members.length))} / ${escapeHtml(String(party.maxSize ?? '?'))}</span>
						</div>
						<p class="text-xs text-zinc-500">Party ID ${escapeHtml(party.id || 'unknown')}</p>
					</div>
					<button class="btn-secondary" data-action="refresh-lobby">${icon('refresh-cw')} Refresh</button>
				</div>

				<dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Leader</dt><dd class="mt-1 truncate font-semibold">${valueOrDash(party.leader?.displayName || party.leader?.id)}</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Privacy</dt><dd class="mt-1 font-semibold">${party.isPrivate ? 'Private' : 'Open'}</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Playlist</dt><dd class="mt-1 truncate font-semibold">${valueOrDash(party.playlistId)}</dd></div>
					<div class="card"><dt class="text-xs uppercase text-zinc-500">Squad Fill</dt><dd class="mt-1 font-semibold">${party.squadFill === null || party.squadFill === undefined ? '-' : party.squadFill ? 'Fill' : 'No Fill'}</dd></div>
				</dl>
				${party.customMatchmakingKey ? `<p class="mt-3 text-xs text-zinc-500">Custom matchmaking key set.</p>` : ''}
			</section>

			${renderLobbyControls(isLeader)}

			<section>
				<h2 class="mb-3 text-sm font-semibold uppercase text-zinc-500">Party members (${members.length})</h2>
				<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					${members.map((member) => memberCard(member, party.leader?.id)).join('') || '<p class="text-sm text-zinc-500">No members.</p>'}
				</div>
			</section>

			${renderLobbyChat()}
		</div>
	`;
}

function renderLobbyControls(isLeader) {
	if (!can('party')) return '';
	// Leader-only controls are shown but clearly labelled, rather than failing
	// with a cryptic Epic error when clicked.
	const leaderNote = isLeader
		? ''
		: `<p class="mb-3 text-xs text-amber-300">${icon('triangle-alert', 'mr-1 inline h-3 w-3')} Requires Party Leader — the bot is not the leader, so the controls below are unavailable.</p>`;

	return `
		<section class="shell-panel rounded-lg p-4">
			<p class="mb-3 font-semibold">Lobby controls</p>
			${leaderNote}
			<div class="flex flex-wrap gap-2">
				${can('readiness') ? `
					<button class="btn-secondary" data-action="party-ready">${icon('check')} Ready</button>
					<button class="btn-secondary" data-action="party-unready">${icon('x')} Unready</button>
				` : ''}
				${can('sittingOut') ? `
					<button class="btn-secondary" data-action="party-sit-out">${icon('armchair')} Sit Out</button>
					<button class="btn-secondary" data-action="party-stop-sitting-out">${icon('play')} Stop Sitting Out</button>
				` : ''}
				<button class="btn-secondary" data-action="party-hide" ${isLeader ? '' : 'disabled'}>${icon('eye-off')} Hide Members</button>
				<button class="btn-secondary" data-action="party-unhide" ${isLeader ? '' : 'disabled'}>${icon('eye')} Unhide</button>
				${can('squadFill') ? `
					<button class="btn-secondary" data-action="party-fill" ${isLeader ? '' : 'disabled'}>${icon('users')} Fill</button>
					<button class="btn-secondary" data-action="party-no-fill" ${isLeader ? '' : 'disabled'}>${icon('user-x')} No Fill</button>
				` : ''}
				<button class="btn-danger" data-action="party-leave">${icon('log-out')} Leave Party</button>
			</div>

			<div class="mt-4 grid gap-3 md:grid-cols-3">
				${can('privacy') ? `
					<form class="grid gap-2" data-form="party-privacy">
						<label class="label">Party privacy</label>
						<select class="input" name="privacy" ${isLeader ? '' : 'disabled'}>
							${PRIVACY_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
						</select>
						<button class="btn-secondary" type="submit" ${isLeader ? '' : 'disabled'}>Apply privacy</button>
					</form>
				` : ''}
				${can('playlist') ? `
					<form class="grid gap-2" data-form="party-playlist">
						<label class="label">Playlist mnemonic</label>
						<input class="input" name="playlist" placeholder="Playlist_DefaultSolo" ${isLeader ? '' : 'disabled'} />
						<button class="btn-secondary" type="submit" ${isLeader ? '' : 'disabled'}>Set playlist</button>
					</form>
				` : ''}
				${can('presence') ? `
					<form class="grid gap-2" data-form="party-status">
						<label class="label">Presence status</label>
						<input class="input" name="status" placeholder="Battle Royale Lobby" />
						<button class="btn-secondary" type="submit">Set status</button>
					</form>
				` : ''}
			</div>
		</section>
	`;
}

function renderLobbyChat() {
	if (!can('partyChat')) return '';
	const messages = state.partyMessages || [];
	return `
		<section class="shell-panel rounded-lg p-4">
			<p class="mb-3 font-semibold">Lobby chat</p>
			<div class="mb-3 max-h-64 overflow-y-auto rounded-lg bg-black/30 p-3 text-sm" id="party-chat-log">
				${
					messages.length
						? messages
								.map(
									(message) => `
						<p class="mb-1">
							<span class="text-fnlb-300">${escapeHtml(message.authorName || message.authorId || 'unknown')}</span>
							<span class="text-zinc-500">:</span>
							<span class="text-zinc-200">${escapeHtml(message.content)}</span>
						</p>`
								)
								.join('')
						: '<p class="text-zinc-500">No lobby messages yet.</p>'
				}
			</div>
			<form class="flex gap-2" data-form="party-message">
				<input class="input flex-1" name="content" placeholder="Send a message to the lobby" autocomplete="off" />
				<button class="btn-primary" type="submit">${icon('send')} Send</button>
			</form>
			${usingLocalFnbr() ? '<p class="mt-2 text-xs text-zinc-500">Party chat needs at least one other member in the party.</p>' : ''}
		</section>
	`;
}
