import { state } from '../core/state.js';
import { count, detailRow, escapeHtml, formatDate, icon, renderList, smallCount, statCard, statusBadge, valueOrDash } from '../core/ui.js';
import { usingLocalFnbr } from '../core/selectors.js';

export function renderMetricCards() {
	const config = state.config || {};
	return `
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">${usingLocalFnbr() ? 'Engine' : 'Local Shards'}</p>
				<p class="mt-2 text-2xl font-bold">${usingLocalFnbr() ? 'fnbr' : escapeHtml(config.numberOfShards ?? 2)}</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">${usingLocalFnbr() ? 'Platform' : 'Bots per Shard'}</p>
				<p class="mt-2 text-2xl font-bold">${usingLocalFnbr() ? escapeHtml(config.platform || 'WIN') : escapeHtml(config.botsPerShard ?? 32)}</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">Restart Interval</p>
				<p class="mt-2 text-2xl font-bold">${escapeHtml(config.restartInterval ?? 3600)}s</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">Restart Update</p>
				<p class="mt-2 text-lg font-bold">${config.autoUpdateOnRestart ? 'Forced' : 'Standard'}</p>
			</div>
		</div>
	`;
}

export function renderFnlbStats() {
	const stats = state.stats || {};
	if (usingLocalFnbr()) {
		const localStats = stats.local || {};
		return `
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
				${statCard('Local Bots', localStats.total)}
				${statCard('Connected', localStats.connected)}
				${statCard('Friends', localStats.friends)}
				${statCard('Party Members', localStats.partyMembers)}
				${statCard('In Match', localStats.matches)}
			</div>
		`;
	}
	const publicStats = stats.public || {};
	const vipStats = stats.vip || {};
	return `
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
			${statCard('Public Total', publicStats.total)}
			${statCard('Public Online', publicStats.connected)}
			${statCard('Public Matches', publicStats.matches)}
			${statCard('VIP Total', vipStats.total)}
			${statCard('VIP Online', vipStats.connected)}
			${statCard('VIP Matches', vipStats.matches)}
		</div>
	`;
}

export function renderStatus() {
	return `
		<div class="grid gap-4">
			${renderMetricCards()}
			${renderFnlbStats()}
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-semibold">${usingLocalFnbr() ? 'Local fnbr Bot Status' : 'FNLB API Bot Status'}</p>
						<p class="mt-1 text-sm text-zinc-500">${usingLocalFnbr() ? 'Click a bot for live party, friends, pending requests, blocked users, command tools, chat, and cosmetics.' : 'Click a bot for friends, pending requests, blocked users, command tools, chat, and any lobby fields FNLB returns.'}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<label class="btn-secondary cursor-pointer">
							<input class="h-4 w-4 accent-fnlb-500" type="checkbox" data-action="toggle-auto-refresh" ${state.autoRefresh ? 'checked' : ''} />
							Auto refresh
						</label>
						<button class="btn-secondary" data-action="refresh-dashboard">${icon('refresh-cw')} Refresh</button>
					</div>
				</div>
				<div class="grid gap-4 xl:grid-cols-[1fr_440px]">
					${renderBots()}
					${renderBotDetails()}
				</div>
			</section>
		</div>
	`;
}

export function renderBots() {
	if (!dashboardAvailable()) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">${usingLocalFnbr() ? 'Save Epic device auth or a one-time authorization code in Config to load your local fnbr bot.' : 'Save your FNLB API token in Config to load bots.'}</div>`;
	}
	if (!state.dashboard) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Loading ${usingLocalFnbr() ? 'local fnbr' : 'FNLB'} dashboard data...</div>`;
	}
	if (!state.bots.length) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No bots returned by the ${usingLocalFnbr() ? 'local fnbr runtime' : 'FNLB API'}.</div>`;
	}
	return `
		<div class="grid content-start gap-3 lg:grid-cols-2">
			${state.bots.map((bot) => renderBotCard(bot)).join('')}
		</div>
	`;
}

function renderBotCard(bot) {
	const selected = bot.id === state.selectedBotId;
	const status =
		bot.source === 'fnbr' && state.runtime?.status !== 'online'
			? '<span class="badge border-zinc-500/40 bg-zinc-500/10 text-zinc-300">offline</span>'
			: bot.mmsBannedUntil
			? '<span class="badge border-amber-400/40 bg-amber-500/10 text-amber-200">Temp MMS ban</span>'
			: bot.hasInvalidAuth
				? '<span class="badge border-red-400/40 bg-red-500/10 text-red-200">Invalid auth</span>'
				: bot.isDisabled
					? '<span class="badge border-zinc-500/40 bg-zinc-500/10 text-zinc-300">Disabled</span>'
					: '<span class="badge border-fnlb-400/40 bg-fnlb-500/10 text-fnlb-200">OK</span>';

	return `
		<button class="rounded-lg border ${selected ? 'border-fnlb-400/50 bg-fnlb-500/10' : 'border-white/10 bg-black/25 hover:bg-white/[0.06]'} p-4 text-left transition" data-bot-id="${escapeHtml(bot.id)}">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
				<p class="font-semibold">${escapeHtml(bot.nickname || bot.id)}</p>
					<p class="mt-1 break-all text-xs text-zinc-500">${escapeHtml(bot.email || bot.id)}</p>
				</div>
				${status}
			</div>
			<div class="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
				<p>Engine: <span class="text-zinc-200">${escapeHtml(bot.source || 'fnlb')}</span></p>
				<p>Flags: <span class="text-zinc-200">${escapeHtml(bot.flagsList?.join(', ') || 'None')}</span></p>
				<p>MMS ban: <span class="text-zinc-200">${escapeHtml(bot.mmsBannedUntil ? formatDate(bot.mmsBannedUntil) : 'No')}</span></p>
				<p>Friends: <span class="text-zinc-200">${valueOrDash(bot.friendsCount)}</span></p>
				<p>Matches: <span class="text-zinc-200">${valueOrDash(bot.matches)}</span></p>
			</div>
		</button>
	`;
}

function renderBotDetails() {
	if (!state.selectedBotId) {
		return `
			<aside class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">
				Select a bot to inspect live details and tools.
			</aside>
		`;
	}
	if (!state.selectedBotDetails) {
		return `<aside class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Loading bot details...</aside>`;
	}

	const { bot, friends, pendingFriends, blockedUsers } = state.selectedBotDetails;
	const onlineFriends = friends?.onlineFriends || [];
	const offlineFriends = friends?.offlineFriends || [];
	const incoming = pendingFriends?.incomingFriends || [];
	const outgoing = pendingFriends?.outgoingFriends || [];
	const party = bot.party || {};
	const partyMembers = Array.isArray(party.members) ? party.members : [];
	const match = bot.match || partyMembers.find((member) => member.id === bot.id)?.matchInfo || {};
	const cosmetics = bot.cosmetics || {};

	return `
		<aside class="grid max-h-[calc(100vh-180px)] gap-4 overflow-auto rounded-lg border border-white/10 bg-black/25 p-4">
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="text-lg font-bold">${escapeHtml(bot.nickname || bot.id)}</p>
					<p class="break-all text-xs text-zinc-500">${escapeHtml(bot.id)}</p>
				</div>
				<button class="btn-secondary px-2 py-2" data-action="close-bot-detail" title="Close">${icon('x')}</button>
			</div>

			<div class="grid gap-2 text-sm">
				${detailRow('Engine', bot.source || 'fnlb')}
				${detailRow('Email', bot.email)}
				${detailRow('Parent', bot.parent)}
				${detailRow('Flags', bot.flagsList?.join(', ') || 'None')}
				${detailRow('Presence', bot.presenceStatus || bot.status)}
				${detailRow('Friends Count', bot.friendsCount)}
				${detailRow('Matches', bot.matches)}
				${detailRow('Match State', match.location)}
				${detailRow('Match Players', match.playerCount)}
				${detailRow('Playlist', party.playlistId || match.playlist)}
				${detailRow('Party ID', party.id)}
				${detailRow('Party Players', partyMembers.length || bot.partyMembers)}
				${detailRow('Outfit', cosmetics.outfit)}
				${detailRow('Backpack', cosmetics.backpack)}
				${detailRow('Pickaxe', cosmetics.pickaxe)}
				${detailRow('Emote', cosmetics.emote)}
				${detailRow('MMS Banned Until', bot.mmsBannedUntil ? formatDate(bot.mmsBannedUntil) : 'No')}
			</div>

			${!party.id && !partyMembers.length && (bot.matches === undefined || (usingLocalFnbr() && state.runtime?.status !== 'online')) ? `
				<div class="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
					${usingLocalFnbr() ? 'The local bot is offline, so live party and friend data is unavailable until it starts.' : 'The current FNLB bot detail response does not expose lobby, playlist, party member, or match fields for this bot. If FNLB returns those fields later, this panel will display them automatically.'}
				</div>
			` : ''}

			<div class="grid grid-cols-2 gap-2">
				<button class="btn-secondary" data-action="toggle-bot-disabled" data-disabled="${bot.isDisabled ? 'false' : 'true'}">
					${icon(bot.isDisabled ? 'play' : 'pause')} ${bot.isDisabled ? 'Enable' : 'Disable'}
				</button>
				<button class="btn-secondary" data-action="refresh-selected-bot">${icon('refresh-cw')} Refresh</button>
			</div>

			${renderFriendPanels(onlineFriends, offlineFriends, incoming, outgoing, blockedUsers)}
			${renderSessionHistory(state.selectedBotDetails.sessions || [])}
			${renderBotTools()}
		</aside>
	`;
}

function renderFriendPanels(onlineFriends, offlineFriends, incoming, outgoing, blockedUsers) {
	return `
		<div class="grid gap-3">
			<div class="grid grid-cols-2 gap-2">
				${smallCount('Online Friends', onlineFriends.length)}
				${smallCount('Offline Friends', offlineFriends.length)}
				${smallCount('Incoming Requests', incoming.length)}
				${smallCount('Blocked Users', blockedUsers.length)}
			</div>
			${renderList('Online Friends', onlineFriends.slice(0, 8), (friend) => `${friend.displayName || friend.id}${friend.status ? ` - ${friend.status}` : ''}${friend.isJoinable ? ' - joinable' : ''}`)}
			${renderList('Pending Incoming', incoming.slice(0, 8), (friend) => friend.displayName || friend.id)}
			${renderList('Blocked Users', blockedUsers.slice(0, 8), (user) => user.displayName || user.id)}
		</div>
	`;
}

function renderBotTools() {
	return `
		<div class="grid gap-3">
			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="bot-action">
				<p class="mb-3 font-semibold">Friend, Block, Lobby Actions</p>
				<div class="grid gap-2">
					<select class="input py-2" name="action">
						<option value="add_friend">Add friend</option>
						<option value="remove_friend">Remove friend</option>
						<option value="block_user">Block user</option>
						<option value="unblock_user">Unblock user</option>
						<option value="invite">Invite friend</option>
						<option value="join_party">Join party by ID</option>
						<option value="kick">Kick user from lobby</option>
						<option value="kick_all">Kick all party members</option>
						<option value="hide_all">Hide all cosmetics</option>
						<option value="unhide_all">Unhide all cosmetics</option>
						<option value="set_playlist">Set playlist/island</option>
						<option value="ready">Ready up</option>
						<option value="unready">Unready</option>
						<option value="set_status">Set status text</option>
						<option value="say">Say command</option>
						<option value="leave_lobby">Leave lobby command</option>
					</select>
					<input class="input py-2" name="target" placeholder="Epic user ID / display name / value" />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('wand-2')} Run Action</button>
				</div>
				<p class="mt-2 text-xs text-zinc-500">${usingLocalFnbr() ? 'Local mode runs these directly through fnbr.js/Epic party and friends APIs.' : 'FNLB does not expose direct REST mutations for these actions, so this uses its documented command runner.'}</p>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="command-run">
				<p class="mb-3 font-semibold">Run Command</p>
				<div class="grid gap-2">
					<input class="input py-2" name="command" placeholder="command" required />
					<input class="input py-2" name="args" placeholder="args" />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('send')} Run</button>
				</div>
				<p class="mt-2 text-xs text-zinc-500">${usingLocalFnbr() ? 'Supported local commands include outfit, backpack, pickaxe, shoes, emote, ready, unready, set_status, set_playlist, invite, leave, and clear_emote.' : 'Runs the FNLB command runner for this bot.'}</p>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="chat-send">
				<p class="mb-3 font-semibold">Send Chat Message</p>
				<div class="grid gap-2">
					<input class="input py-2" name="content" placeholder="message" required />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('message-square')} Send</button>
				</div>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="quick-command-create">
				<p class="mb-3 font-semibold">Custom Quick Commands</p>
				<div class="grid gap-2">
					<input class="input py-2" name="name" placeholder="Button name" required maxlength="60" />
					<input class="input py-2" name="command" placeholder="command" required maxlength="255" />
					<input class="input py-2" name="args" placeholder="args" maxlength="255" />
					<button class="btn-secondary" type="submit">${icon('plus')} Save Command</button>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					${state.quickCommands.map((command) => `
						<span class="inline-flex overflow-hidden rounded-lg border border-white/10 bg-black/30">
							<button class="px-3 py-2 text-xs font-semibold text-fnlb-200 hover:bg-fnlb-500/10" data-action="run-quick-command" data-command-id="${command.id}">${escapeHtml(command.name)}</button>
							<button class="border-l border-white/10 px-2 py-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-200" data-action="delete-quick-command" data-command-id="${command.id}" title="Delete">${icon('x', 'h-3.5 w-3.5')}</button>
						</span>
					`).join('') || '<p class="text-xs text-zinc-500">No saved commands.</p>'}
				</div>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="user-search">
				<p class="mb-3 font-semibold">Search Epic Users</p>
				<div class="grid gap-2">
					<input class="input py-2" name="prefix" placeholder="display name prefix" required />
					<button class="btn-secondary" type="submit">${icon('search')} Search</button>
				</div>
				${state.userSearchResults.length ? `<div class="mt-3 grid gap-1 text-xs text-zinc-400">${state.userSearchResults.slice(0, 10).map((user) => `<p class="break-all">${escapeHtml(user.displayName || user.id)}</p>`).join('')}</div>` : ''}
			</form>

			${renderCommandResponses()}
		</div>
	`;
}

function renderSessionHistory(sessions) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<div class="mb-3 flex items-center justify-between gap-3">
				<p class="font-semibold">Session History</p>
				<button class="btn-secondary px-2 py-1 text-xs" data-action="refresh-sessions">${icon('refresh-cw', 'h-3.5 w-3.5')} Refresh</button>
			</div>
			${sessions.length ? `
				<div class="grid gap-2">
					${sessions.slice(0, 8).map((session) => `
						<div class="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-400">
							<div class="flex flex-wrap justify-between gap-2">
								<span>${escapeHtml(formatDate(session.startedAt))}</span>
								${session.isActive ? statusBadge('active', 'active') : statusBadge('offline', 'ended')}
							</div>
							<div class="mt-2 grid grid-cols-2 gap-2">
								<span>Matches: <b class="text-zinc-200">${valueOrDash(session.matches)}</b></span>
								<span>Players: <b class="text-zinc-200">${valueOrDash(session.partyMembers)}</b></span>
								<span>Kills: <b class="text-zinc-200">${valueOrDash(session.kills)}</b></span>
								<span>Deaths: <b class="text-zinc-200">${valueOrDash(session.deaths)}</b></span>
							</div>
							<p class="mt-2 break-all text-zinc-500">Session: ${escapeHtml(session.id)}</p>
							${session.ReplayUploads?.length ? `<p class="mt-1 text-fnlb-300">${session.ReplayUploads.length} replay upload(s)</p>` : ''}
							${session.SessionStats?.length ? `<p class="mt-1 text-sky-300">${session.SessionStats.length} manual console stat entry(s)</p>` : ''}
							${session.SessionMedia?.length ? `<p class="mt-1 text-amber-200">${session.SessionMedia.length} screenshot/video evidence upload(s)</p>` : ''}
						</div>
					`).join('')}
				</div>
			` : '<p class="text-xs text-zinc-500">No saved sessions yet. Refreshing bot status creates history snapshots.</p>'}

			<form class="mt-3 grid gap-2" data-form="replay-upload" enctype="multipart/form-data">
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<input class="input py-2" name="replay" type="file" accept=".replay" required />
				<button class="btn-secondary" type="submit">${icon('upload')} Upload Replay</button>
				<p class="text-xs text-zinc-500">Upload after a match and pick the matching session. The server attempts to parse eliminations/stats and keeps the file linked even if parsing fails.</p>
			</form>

			<form class="mt-3 grid gap-2 rounded-lg border border-fnlb-400/20 bg-fnlb-500/10 p-3" data-form="manual-session-stats">
				<p class="font-semibold text-fnlb-100">Console Stats Entry</p>
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<div class="grid grid-cols-2 gap-2">
					<input class="input py-2" name="kills" type="number" min="0" placeholder="Kills" />
					<input class="input py-2" name="deaths" type="number" min="0" placeholder="Deaths" />
					<input class="input py-2" name="assists" type="number" min="0" placeholder="Assists" />
					<input class="input py-2" name="placement" type="number" min="1" placeholder="Placement" />
					<input class="input py-2" name="matches" type="number" min="0" placeholder="Matches" />
					<input class="input py-2" name="wins" type="number" min="0" placeholder="Wins" />
				</div>
				<input class="input py-2" name="notes" placeholder="Notes / proof link" />
				<button class="btn-primary" type="submit">${icon('save')} Save Console Stats</button>
			</form>

			<form class="mt-3 grid gap-2" data-form="session-media" enctype="multipart/form-data">
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<input class="input py-2" name="media" type="file" accept="image/*,video/*" required />
				<input class="input py-2" name="notes" placeholder="Capture notes" />
				<button class="btn-secondary" type="submit">${icon('image-plus')} Upload Console Capture</button>
				<p class="text-xs text-zinc-500">For PS5/Xbox users: save a screenshot or short clip to your phone with the console app, then upload it here as evidence for this session.</p>
			</form>
		</div>
	`;
}

function renderCommandResponses() {
	if (!state.commandResponses.length) return '';
	return `
		<div class="rounded-lg border border-white/10 bg-black/30 p-3">
			<p class="mb-2 text-sm font-semibold">Recent API Responses</p>
			<div class="grid gap-2 text-xs">
				${state.commandResponses.slice(-6).reverse().map((response) => `
					<div class="${logStyles[response.format] || 'text-zinc-300'}">
						<span class="text-zinc-600">${escapeHtml(formatDate(response.createdAt))}</span>
						<span>${escapeHtml(response.content || response.nonce || 'OK')}</span>
					</div>
				`).join('')}
			</div>
		</div>
	`;
}
