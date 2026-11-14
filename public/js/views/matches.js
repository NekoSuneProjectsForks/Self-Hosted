import { state } from '../core/state.js';
import { controlBot, controlBotId, controlCan, controlCapabilities, controlOnline } from '../core/selectors.js';
import { escapeHtml, formatDate, icon, statusBadge, valueOrDash } from '../core/ui.js';

function can(capability) {
	return controlCan(capability);
}

function formatDuration(seconds) {
	const total = Number(seconds);
	if (!Number.isFinite(total) || total < 0) return '-';
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function liveDuration(startedAt) {
	if (!startedAt) return '-';
	return formatDuration(Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
}

/**
 * Stats are only rendered when a source actually provided them. Epic presence
 * gives location only, so kills/placement stay blank unless a replay upload or
 * a manual entry filled them in.
 */
function statCells(match) {
	const cells = [
		['Placement', match.placement],
		['Kills', match.kills],
		['Deaths', match.deaths],
		['Assists', match.assists]
	].filter(([, value]) => value !== null && value !== undefined);

	if (!cells.length) {
		return `<p class="mt-2 text-xs text-zinc-600">No stats recorded. Presence only reports where the bot is — upload a replay or add stats manually to fill these in.</p>`;
	}

	return `
		<div class="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
			${cells.map(([label, value]) => `<span><span class="text-zinc-500">${label}:</span> ${escapeHtml(String(value))}</span>`).join('')}
			${match.win ? statusBadge('online', 'Win') : ''}
		</div>
	`;
}

function currentMatchPanel() {
	const current = state.currentMatch;
	if (!current) {
		return `
			<section class="shell-panel rounded-lg p-4">
				<p class="font-semibold">No match in progress</p>
				<p class="mt-1 text-sm text-zinc-500">A match round is opened automatically when the bot enters a game, and closed when it returns to the lobby.</p>
			</section>
		`;
	}

	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3 flex flex-wrap items-center gap-2">
				${statusBadge('online', 'IN MATCH')}
				<span class="text-sm text-zinc-400">Started ${formatDate(current.startedAt)}</span>
			</div>
			<dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div class="card"><dt class="text-xs uppercase text-zinc-500">Playlist</dt><dd class="mt-1 truncate font-semibold">${valueOrDash(current.playlistId)}</dd></div>
				<div class="card"><dt class="text-xs uppercase text-zinc-500">Elapsed</dt><dd class="mt-1 font-semibold">${liveDuration(current.startedAt)}</dd></div>
				<div class="card"><dt class="text-xs uppercase text-zinc-500">Party</dt><dd class="mt-1 font-semibold">${valueOrDash(current.partyMembers)}</dd></div>
				<div class="card"><dt class="text-xs uppercase text-zinc-500">Source</dt><dd class="mt-1 font-semibold">${escapeHtml(current.source || 'presence')}</dd></div>
			</dl>
			${statCells(current)}
		</section>
	`;
}

function matchRow(match, index, total) {
	return `
		<div class="card">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="min-w-0">
					<p class="font-semibold">#${total - index} ${escapeHtml(match.playlistId || 'Unknown playlist')}</p>
					<p class="mt-1 text-xs text-zinc-500">
						${formatDate(match.startedAt)}${match.endedAt ? ` → ${formatDate(match.endedAt)}` : ''}
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<span class="text-sm text-zinc-400">${formatDuration(match.duration)}</span>
					${match.status === 'in_match' ? statusBadge('online', 'Live') : statusBadge('offline', 'Ended')}
				</div>
			</div>
			${statCells(match)}
		</div>
	`;
}

function placementText(match) {
	if (match.win || match.placement === 1) return 'Victory Royale';
	if (match.placement) return `Top ${match.placement}`;
	return 'Played';
}

function pager(paging, action) {
	if (!paging || paging.pages <= 1) return '';
	return `
		<div class="mt-3 flex items-center justify-between gap-2 text-sm">
			<button class="btn-secondary" data-action="${action}" data-page="${paging.page - 1}" ${paging.page <= 1 ? 'disabled' : ''}>${icon('chevron-left')} Newer</button>
			<span class="text-zinc-500">Page ${paging.page} of ${paging.pages} · ${paging.total} total</span>
			<button class="btn-secondary" data-action="${action}" data-page="${paging.page + 1}" ${paging.page >= paging.pages ? 'disabled' : ''}>Older ${icon('chevron-right')}</button>
		</div>`;
}

function stat(label, value, sub = '') {
	return `
		<div class="card min-w-0">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-1 truncate text-xl font-bold">${escapeHtml(value)}</p>
			${sub ? `<p class="mt-0.5 truncate text-xs text-zinc-500">${sub}</p>` : ''}
		</div>`;
}

function statsGrid(t, today) {
	return `
		<div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
			${stat('Matches', t.matches, `${today.matches} today`)}
			${stat('Wins', t.wins, `${t.winRate}% win rate`)}
			${stat('K/D', t.kd, `${t.kills} kills · ${t.deaths} deaths`)}
			${stat('Kills / match', t.killsPerMatch, `${today.kills} kills today`)}
			${stat('Top 10', `${t.top10Rate}%`, 'of matches')}
			${stat('Avg match', `${t.avgMinutes} min`, `${Math.round(t.minutes / 60)} h played`)}
		</div>`;
}

function careerPanel(selected) {
	if (!selected) return '';
	const career = state.career?.accountId === selected.accountId ? state.career : null;
	const row = (label, s) =>
		s && s.matches
			? `<tr><td class="py-1.5 pr-4 text-zinc-400">${label}</td><td class="py-1.5 pr-4">${s.matches}</td><td class="py-1.5 pr-4">${s.wins}</td><td class="py-1.5 pr-4">${s.winRate === null || s.winRate === undefined ? '-' : `${Math.round(s.winRate * 1000) / 10}%`}</td><td class="py-1.5 pr-4">${s.kills}</td><td class="py-1.5">${s.kd === null || s.kd === undefined ? '-' : Math.round(s.kd * 100) / 100}</td></tr>`
			: '';
	return `
		<div class="mt-3 rounded-lg border border-white/10 p-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="text-sm font-semibold">Career (all time, from Epic)</p>
				${career?.data ? '' : `<button class="btn-secondary py-1 text-xs" data-action="career-load" data-account-id="${escapeHtml(selected.accountId)}" ${career?.loading ? 'disabled' : ''}>${icon('download', 'h-3.5 w-3.5')} ${career?.loading ? 'Loading…' : 'Load career stats'}</button>`}
			</div>
			${career?.error ? `<p class="mt-2 text-xs text-amber-200">${escapeHtml(career.error)}</p>` : ''}
			${
				career?.data
					? `<div class="mt-2 overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="text-xs uppercase text-zinc-500"><tr><th class="pr-4 font-normal">Mode</th><th class="pr-4 font-normal">Matches</th><th class="pr-4 font-normal">Wins</th><th class="pr-4 font-normal">Win %</th><th class="pr-4 font-normal">Kills</th><th class="font-normal">K/D</th></tr></thead><tbody>
						${row('Overall', career.data.overall)}${row('Solo', career.data.solo)}${row('Duo', career.data.duo)}${row('Trio', career.data.trio)}${row('Squad', career.data.squad)}${row('LTM', career.data.ltm)}
					</tbody></table></div>`
					: ''
			}
		</div>`;
}

/**
 * Match stats: your bots are tracked automatically (their own Epic stats);
 * pick a bot to see its matches, K/D and more. Players can be added too.
 */
function trackingPanel() {
	const tracked = state.tracked;
	if (!tracked) {
		return '<section class="shell-panel rounded-lg p-4"><p class="text-sm text-zinc-500">Loading match stats…</p></section>';
	}
	const bots = tracked.bots || [];
	const players = tracked.players || [];
	const matches = tracked.matches || [];
	const totals = tracked.totals || {};
	const empty = { matches: 0, wins: 0, kills: 0, deaths: 0, kd: 0, winRate: 0, killsPerMatch: 0, avgMinutes: 0, minutes: 0, top10Rate: 0 };
	const t = { ...empty, ...(totals.recorded || {}) };
	const today = { ...empty, ...(totals.today || {}) };
	const selected = tracked.selected;
	const sourceLine = tracked.source
		? 'Stats come from Epic and are read by the server tracker, which never joins your party.'
		: `<span class="text-amber-200">The server tracker is off, so new matches aren't being recorded.</span> ${state.user?.role === 'admin' ? 'Start it in <b>Admin → Tracker</b>.' : 'Ask an admin to start it.'}`;
	const errors = bots.filter((bot) => bot.lastError && (!selected || bot.accountId === selected.accountId));

	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3 flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="font-semibold">Match stats</h2>
					<p class="mt-1 text-xs text-zinc-500">Your bots are tracked automatically from their own Epic stats. ${sourceLine}</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<select class="input w-auto py-1.5 text-sm" data-action="matches-bot" aria-label="Bot">
						<option value="" ${!selected ? 'selected' : ''}>All bots and players</option>
						${bots.map((bot) => `<option value="${escapeHtml(bot.accountId)}" ${selected?.accountId === bot.accountId ? 'selected' : ''}>${escapeHtml(bot.name)}${bot.kind === 'bot' ? '' : ' (player)'}</option>`).join('')}
					</select>
					<button class="btn-secondary" data-action="tracked-poll">${icon('refresh-cw')} Check now</button>
				</div>
			</div>

			${errors.map((bot) => `<p class="mb-2 text-xs text-amber-200">${escapeHtml(bot.name)}: ${escapeHtml(bot.lastError)}</p>`).join('')}
			${!bots.length ? '<p class="mb-3 text-sm text-zinc-500">No bots found yet. Start your bots: each one is picked up automatically once it\'s logged in.</p>' : ''}

			${statsGrid(t, today)}
			${careerPanel(selected)}

			<div class="mt-4 overflow-x-auto">
				<table class="min-w-full text-left text-sm">
					<thead class="text-xs uppercase text-zinc-500">
						<tr>
							<th class="px-2 py-2 font-normal">When</th>
							${selected ? '' : '<th class="px-2 py-2 font-normal">Bot</th>'}
							<th class="px-2 py-2 font-normal">Mode</th>
							<th class="px-2 py-2 font-normal">Result</th>
							<th class="px-2 py-2 font-normal">Kills</th>
							<th class="px-2 py-2 font-normal">Outlived</th>
							<th class="px-2 py-2 font-normal">Time</th>
							<th class="px-2 py-2 font-normal">Score</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-white/5">
						${
							matches.length
								? matches
										.map(
											(match) => `
						<tr>
							<td class="whitespace-nowrap px-2 py-2 text-zinc-400">${formatDate(match.endedAt)}</td>
							${selected ? '' : `<td class="px-2 py-2">${escapeHtml(match.player || '-')}</td>`}
							<td class="px-2 py-2"><span class="font-medium">${escapeHtml(match.playlistLabel || match.playlistId || 'Match')}</span>${match.matches > 1 ? ` <span class="text-xs text-zinc-500">(${match.matches} combined)</span>` : ''}${match.inputLabel ? `<span class="block text-xs text-zinc-500">${escapeHtml(match.inputLabel)}</span>` : ''}</td>
							<td class="px-2 py-2">${match.win ? statusBadge('online', match.wins > 1 ? `${match.wins} wins` : 'Win') : `<span class="text-zinc-400">${escapeHtml(placementText(match))}</span>`}</td>
							<td class="px-2 py-2">${match.kills ?? 0}</td>
							<td class="px-2 py-2 text-zinc-400">${match.playersOutlived ?? '-'}</td>
							<td class="whitespace-nowrap px-2 py-2 text-zinc-400">${match.minutes ? `${match.minutes} min` : '-'}</td>
							<td class="px-2 py-2 text-zinc-400">${match.score ?? '-'}</td>
						</tr>`
										)
										.join('')
								: `<tr><td class="px-2 py-4 text-sm text-zinc-500" colspan="8">No matches recorded${selected ? ' for this bot' : ''} yet. Epic updates stats a few minutes after a match ends.</td></tr>`
						}
					</tbody>
				</table>
			</div>
			${pager(tracked.paging, 'matches-page')}

			<details class="mt-4 text-sm">
				<summary class="cursor-pointer text-zinc-400">Also track a player (optional)</summary>
				<form data-form="tracked-add" class="mt-2 flex flex-wrap gap-2">
					<input class="input min-w-0 flex-1" name="player" placeholder="Epic display name" autocomplete="off" />
					<button class="btn-primary" type="submit">${icon('user-plus')} Track</button>
				</form>
				${
					players.length
						? `<div class="mt-2 flex flex-wrap gap-2">${players
								.map(
									(player) => `
					<span class="chip ${player.lastError ? 'border-amber-400/30 text-amber-200' : ''}" title="${escapeHtml(player.lastError || '')}">
						${escapeHtml(player.displayName || player.accountId)}${player.enabled ? '' : ' (paused)'}
						<button type="button" class="ml-1 text-zinc-500 hover:text-zinc-200" data-action="tracked-toggle" data-tracked-id="${escapeHtml(player.id)}" data-enabled="${player.enabled ? 'false' : 'true'}" title="${player.enabled ? 'Pause' : 'Resume'}">${icon(player.enabled ? 'pause' : 'play', 'h-3 w-3')}</button>
						<button type="button" class="text-zinc-500 hover:text-red-300" data-action="tracked-remove" data-tracked-id="${escapeHtml(player.id)}" title="Stop tracking">${icon('x', 'h-3 w-3')}</button>
					</span>`
								)
								.join('')}</div>`
						: ''
				}
				<p class="mt-2 text-xs text-zinc-500">Stats must be public (Fortnite → Settings → Account and Privacy → Show on career leaderboard).</p>
			</details>
		</section>
	`;
}

function queueOutcome(queue) {
	if (queue.status === 'matchmaking') return statusBadge('starting', 'In queue');
	if (queue.outcome === 'matched') {
		if (queue.realPlayers === 1) return statusBadge('online', 'Bot lobby');
		if (queue.realPlayers) return statusBadge('restarting', `${queue.realPlayers} real players`);
		return statusBadge('online', 'Matched');
	}
	if (queue.outcome === 'failed') return statusBadge('error', 'Failed');
	return statusBadge('offline', queue.outcome || 'Ended');
}

/** Legacy FNLB engine: each queue FNLB's bot reported (read from its log). */
function fnlbQueuePanel() {
	const fnlb = state.tracked?.fnlb;
	const queues = fnlb?.queues || [];
	if (!fnlb?.paging?.total && controlCapabilities()?.engine !== 'fnlb') return '';
	const sum = fnlb?.summary || {};
	const lobbyRate = sum.matched ? Math.round((sum.botLobbies / sum.matched) * 100) : null;
	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3">
				<h2 class="font-semibold">FNLB bot lobby queues${state.tracked?.selected ? ` · ${escapeHtml(state.tracked.selected.name || '')}` : ''}</h2>
				<p class="mt-1 text-xs text-zinc-500">From the Legacy FNLB engine's log. "Bot lobby" means you were the only real player in the match.</p>
			</div>
			<div class="mb-3 grid gap-3 sm:grid-cols-4">
				${stat('Queues', sum.queues ?? 0, `${sum.matched ?? 0} matched`)}
				${stat('Bot lobbies', lobbyRate === null ? '-' : `${lobbyRate}%`, `${sum.botLobbies ?? 0} of ${sum.matched ?? 0} matches`)}
				${stat('Avg queue', sum.avgQueueSeconds === null || sum.avgQueueSeconds === undefined ? '-' : formatDuration(sum.avgQueueSeconds), 'until matched')}
				${stat('Failed', sum.failed ?? 0, 'queues')}
			</div>
			<div class="grid gap-2">
				${
					queues.length
						? queues
								.map(
									(queue) => `
					<div class="card flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="font-semibold">${escapeHtml(queue.playlistLabel || queue.playlistId || 'Queue')}</p>
							<p class="mt-1 text-xs text-zinc-500">${escapeHtml(queue.bot)} · ${formatDate(queue.startedAt)}${queue.region ? ` · ${escapeHtml(queue.region)}` : ''}</p>
							${queue.reason ? `<p class="mt-1 text-xs text-red-300">${escapeHtml(queue.reason)}</p>` : ''}
						</div>
						<div class="flex shrink-0 items-center gap-3 text-sm">
							${queue.queueSeconds !== null && queue.queueSeconds !== undefined ? `<span class="text-zinc-500">${formatDuration(queue.queueSeconds)} queue</span>` : ''}
							${queueOutcome(queue)}
						</div>
					</div>`
								)
								.join('')
						: '<p class="text-sm text-zinc-500">No queues yet. Ready up with your FNLB bot in the party.</p>'
				}
			</div>
			${pager(fnlb?.paging, 'queues-page')}
		</section>`;
}

export function renderMatches() {
	if (!can('matchTracking')) {
		return `
			<div class="grid gap-4">
				${trackingPanel()}
				${fnlbQueuePanel()}
			</div>
		`;
	}

	const matches = state.matches || [];
	return `
		<div class="grid gap-4">
			${trackingPanel()}
			${fnlbQueuePanel()}
			${currentMatchPanel()}

			<section>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold uppercase text-zinc-500">Match history (${matches.length})</h2>
					<button class="btn-secondary" data-action="refresh-matches">${icon('refresh-cw')} Refresh</button>
				</div>
				<div class="grid gap-3">
					${
						matches.length
							? matches.map((match, index) => matchRow(match, index, matches.length)).join('')
							: '<p class="text-sm text-zinc-500">No match rounds recorded yet.</p>'
					}
				</div>
			</section>
		</div>
	`;
}
