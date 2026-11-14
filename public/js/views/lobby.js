import { state } from '../core/state.js';
import { platformLabel } from '../core/platforms.js';
import { escapeHtml, icon, statusBadge, valueOrDash } from '../core/ui.js';
import { usingLocalFnbr, controlBot, controlBotId, controlCan, controlCapabilities, controlOnline } from '../core/selectors.js';

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
	return controlCan(capability);
}

function activeBot() {
	return controlBot();
}

export function currentMatchState() {
	if (!controlOnline()) return 'offline';
	return activeBot()?.matchState || 'lobby';
}

function memberCard(member, leaderId, botIsLeader) {
	const isLeader = member.isLeader || member.id === leaderId;
	const botId = controlBotId();
	const isThisBot = member.id === botId;
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
				${member.battlePassLevel ? `<div class="flex justify-between gap-2"><dt>Level</dt><dd>${escapeHtml(String(member.battlePassLevel))}</dd></div>` : ''}
				<div class="flex justify-between gap-2"><dt>Platform</dt><dd>${member.platform ? escapeHtml(platformLabel(member.platform)) : '-'}</dd></div>
				${member.matchInfo?.location ? `<div class="flex justify-between gap-2"><dt>Match</dt><dd>${escapeHtml(member.matchInfo.location)}</dd></div>` : ''}
				${cosmetics
					.map(
						([label, value]) =>
							`<div class="flex justify-between gap-2"><dt>${label}</dt><dd class="truncate">${escapeHtml(value)}</dd></div>`
					)
					.join('')}
			</dl>
			${isThisBot && can('cosmetics')
				? `<form class="mt-3 flex gap-2" data-form="quick-level" data-bot-id="${escapeHtml(botId)}">
						<input class="input py-1.5" name="battlePassLevel" type="number" min="1" max="10000" placeholder="Battle pass level" />
						<button class="btn-secondary shrink-0 py-1.5" type="submit">${icon('star')} Set</button>
					</form>`
				: ''}
			${!isThisBot && can('cosmetics') && (member.outfit || member.backpack || member.pickaxe)
				? `<button class="btn-secondary mt-3 w-full" data-action="copy-look" data-bot-id="${escapeHtml(botId)}" data-member-id="${escapeHtml(member.id)}" title="Bot copies this player's outfit, back bling, pickaxe, kicks, level and banner">${icon('copy')} Copy look to bot</button>`
				: ''}
			${memberStats(member)}
			${
				// Only the leader can kick or promote. Show these only when the bot
				// leads, and never on the bot's own card.
				can('party') && botIsLeader && !isThisBot && !isLeader
					? `<div class="mt-3 flex flex-wrap gap-2">
							<button class="btn-secondary" data-action="party-kick" data-member-id="${escapeHtml(member.id)}">${icon('user-minus')} Kick</button>
							${can('promoteMember') ? `<button class="btn-secondary" data-action="party-promote" data-member-id="${escapeHtml(member.id)}">${icon('crown')} Promote</button>` : ''}
						</div>`
					: ''
			}
		</div>
	`;
}

/** Epic BR stats for a member, loaded on demand. Nothing is shown until loaded. */
function memberStats(member) {
	if (!can('playerStats')) return '';
	const entry = state.memberStats?.[member.id];
	const button = `<button class="btn-secondary mt-3" data-action="member-stats" data-member-id="${escapeHtml(member.id)}">${icon('bar-chart-3')} ${entry ? 'Refresh stats' : 'Stats'}</button>`;
	if (!entry) return button;
	if (entry.loading) return `<p class="mt-3 text-xs text-zinc-500">Loading stats...</p>`;
	if (entry.error) return `<p class="mt-3 text-xs text-amber-300">${escapeHtml(entry.error)}</p>${button}`;
	const rows = [
		['Overall', entry.overall],
		['Solo', entry.solo],
		['Duo', entry.duo],
		['Squad', entry.squad]
	].filter(([, row]) => row && row.matches);
	if (!rows.length) return `<p class="mt-3 text-xs text-zinc-500">No battle royale matches on record.</p>${button}`;
	const kd = (value) => (value == null ? '-' : Number(value).toFixed(2));
	return `
		<table class="mt-3 w-full text-xs text-zinc-300">
			<thead class="text-zinc-500"><tr><th class="text-left font-normal"></th><th class="font-normal">Wins</th><th class="font-normal">Kills</th><th class="font-normal">K/D</th><th class="font-normal">Matches</th></tr></thead>
			<tbody>
				${rows
					.map(
						([label, row]) =>
							`<tr><td>${label}</td><td class="text-center">${row.wins}</td><td class="text-center">${row.kills}</td><td class="text-center">${kd(row.kd)}</td><td class="text-center">${row.matches}</td></tr>`
					)
					.join('')}
			</tbody>
		</table>
		<p class="mt-1 text-[11px] text-zinc-600">From Epic's stats service.</p>
		${button}`;
}

export function renderLobby() {
	if (!controlOnline()) {
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

	const ownBots = new Set([bot?.id, ...(state.botAccounts || []).map((account) => account.accountId)].filter(Boolean));
	const botsInParty = members.filter((member) => ownBots.has(member.id)).length;
	const soloWithBot = /solo/i.test(party.playlistId || '') && members.length > 1;
	const warnings = [
		soloWithBot ? 'This party is on a <strong>Solo</strong> playlist, which can\'t queue with more than one person. Pick Duos, Trios or Squads (No Fill). If the bot leads, it switches for you.' : '',
		botsInParty > 1 ? `There are ${botsInParty} of your bots in this party. Only one bot can go into a match; the others leave when everyone is ready.` : ''
	].filter(Boolean);

	return `
		<div class="grid gap-4">
			${warnings.map((text) => `<div class="flex gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">${icon('triangle-alert', 'mt-0.5 h-4 w-4 shrink-0')}<p>${text}</p></div>`).join('')}
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
			${renderMatchmakingCheck()}

			<section>
				<h2 class="mb-3 text-sm font-semibold uppercase text-zinc-500">Party members (${members.length})</h2>
				<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					${members.map((member) => memberCard(member, party.leader?.id, isLeader)).join('') || '<p class="text-sm text-zinc-500">No members.</p>'}
				</div>
			</section>

			${renderLobbyChat()}
		</div>
	`;
}

/** "No match found" diagnostics for the controlled bot. */
function renderMatchmakingCheck() {
	if (!can('matchmakingCheck')) return '';
	const check = state.matchmakingCheck;
	const problems = check?.problems || [];
	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p class="font-semibold">Matchmaking check</p>
					<p class="mt-1 text-sm text-zinc-500">Can't find a match? Ready up, start matchmaking, then run this to see what the bot is telling Fortnite.</p>
				</div>
				<button class="btn-secondary shrink-0" data-action="matchmaking-check">${icon('stethoscope')} Run check</button>
			</div>
			${check
				? `<div class="mt-3 grid gap-2 text-sm">
						${problems.length
							? problems.map((text) => `<p class="flex gap-2 text-amber-200">${icon('triangle-alert', 'mt-0.5 h-4 w-4 shrink-0')} ${escapeHtml(text)}</p>`).join('')
							: `<p class="flex gap-2 text-fnlb-200">${icon('circle-check', 'mt-0.5 h-4 w-4 shrink-0')} No problems found on the bot's side.</p>`}
						<p class="text-xs text-zinc-500">Dashboard <span class="font-mono">${escapeHtml(check.dashboard?.version || '?')}${check.dashboard?.commit ? ` @ ${escapeHtml(check.dashboard.commit)}` : ''}</span> · Bot build: <span class="font-mono">${escapeHtml(check.botBuild || 'unknown')}</span> · party build: <span class="font-mono">${escapeHtml(check.partyBuild || '-')}</span> · playlist: <span class="font-mono">${escapeHtml(check.playlistId || '-')}</span></p>
						<div class="overflow-x-auto"><table class="w-full text-left text-xs">
							<thead class="text-zinc-500"><tr><th class="py-1 pr-3 font-semibold">Member</th><th class="py-1 pr-3 font-semibold">Ready</th><th class="py-1 pr-3 font-semibold">Mode</th><th class="py-1 pr-3 font-semibold">Team</th><th class="py-1 pr-3 font-semibold">Fill</th><th class="py-1 pr-3 font-semibold">Region</th><th class="py-1 pr-3 font-semibold">Download</th></tr></thead>
							<tbody>${(check.members || [])
								.map(
									(m) => `<tr class="border-t border-white/5"><td class="py-1 pr-3">${escapeHtml(m.displayName || m.id)}${m.isLeader ? ' <span class="text-fnlb-300">(leader)</span>' : ''}${m.isBot ? ' <span class="text-zinc-500">(bot)</span>' : ''}</td><td class="py-1 pr-3">${escapeHtml(m.ready || '-')}</td><td class="py-1 pr-3">${escapeHtml(m.mode?.buildMode || m.mode?.linkId || '-')}</td><td class="py-1 pr-3">${escapeHtml(m.mode?.teamSize || '-')}</td><td class="py-1 pr-3">${escapeHtml(m.mode?.squadFill || '-')}</td><td class="py-1 pr-3">${escapeHtml(m.mode?.region || '-')}</td><td class="py-1 pr-3">${escapeHtml(m.downloadProgress || '-')}</td></tr>`
								)
								.join('')}</tbody>
						</table></div>
						${(check.differences || []).length ? `<p class="text-xs text-zinc-500">${check.differences.length} other field(s) differ between the bot and the leader (in the raw details).</p>` : ''}
						<p class="text-xs ${(check.matchmakingTimeline || []).length ? 'text-zinc-400' : 'text-amber-300'}">${(check.matchmakingTimeline || []).length
							? `Captured ${check.matchmakingTimeline.length} matchmaking update(s) from the leader; they're in the raw details.`
							: 'No matchmaking attempt captured yet: press Play in Fortnite, wait until it fails, then run the check again.'}</p>
						<details class="text-xs text-zinc-400"><summary class="cursor-pointer">Raw details (copy this when asking for help)</summary><pre class="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono">${escapeHtml(JSON.stringify(check, null, 2))}</pre></details>
					</div>`
				: ''}
		</section>`;
}

function renderLobbyControls(isLeader) {
	if (!can('party')) return '';
	// Leader-only controls are shown but clearly labelled, rather than failing
	// with a cryptic Epic error when clicked.
	const leaderNote = isLeader
		? ''
		: `<p class="mb-3 text-xs text-amber-300">${icon('triangle-alert', 'mr-1 inline h-3.5 w-3.5 align-[-2px]')} Requires Party Leader — the bot is not the leader, so the controls below are unavailable.</p>`;

	return `
		<section class="shell-panel rounded-lg p-4">
			<p class="mb-3 font-semibold">Lobby controls</p>
			${leaderNote}
			${can('autoReady') ? `<p class="mb-3 text-xs text-zinc-500">${icon('check-check', 'mr-1 inline h-3.5 w-3.5 align-[-2px]')} ${state.lobbySettings?.botsSitOut === true
					? 'Bots sit out: they stay in the lobby and don\'t go into the match.'
					: state.lobbySettings?.autoReady === false
						? 'Auto-ready is off: set the bot\'s readiness yourself.'
						: 'Auto-ready is on: the bot readies after every player, then leaves once the match loads and rejoins you after. Use Duos, Trios or Squads with No Fill, and one bot per party.'}</p>` : ''}
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
