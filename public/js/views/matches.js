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

function totalCard(label, totals) {
	return `
		<div class="card">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-1 font-semibold">${totals.matches} match${totals.matches === 1 ? '' : 'es'} · ${totals.wins} win${totals.wins === 1 ? '' : 's'} · ${totals.kills} kill${totals.kills === 1 ? '' : 's'}</p>
		</div>
	`;
}

/**
 * Player tracking works with every engine (including Legacy FNLB bot lobbies):
 * a tracker bot reads the players' public stats from outside the party.
 */
function trackingPanel() {
	const tracked = state.tracked;
	if (!tracked) {
		return '<section class="shell-panel rounded-lg p-4"><p class="text-sm text-zinc-500">Loading player tracking…</p></section>';
	}
	const players = tracked.players || [];
	const matches = tracked.matches || [];
	const totals = tracked.totals || { today: { matches: 0, wins: 0, kills: 0 }, recorded: { matches: 0, wins: 0, kills: 0 } };
	const source = tracked.source;
	const sourceLine = source
		? `Stats read by <span class="text-zinc-300">${escapeHtml(source.displayName || source.botId)}</span>${source.server ? ' (server tracker)' : source.tracker ? ' (tracker)' : ''}.`
		: state.user?.role === 'admin'
			? '<span class="text-amber-200">The server tracker is off.</span> Start it in <b>Admin → Tracker</b>.'
			: '<span class="text-amber-200">The server tracker is off.</span> Ask an admin to start it.';

	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="font-semibold">Player tracking</h2>
					<p class="mt-1 text-xs text-zinc-500">Records every match from Epic's stats, with any engine. The server tracker never joins your party, so it can't disturb an FNLB bot lobby. ${sourceLine}</p>
				</div>
				<button class="btn-secondary" data-action="tracked-poll">${icon('refresh-cw')} Check now</button>
			</div>

			<form data-form="tracked-add" class="mb-3 flex flex-wrap gap-2">
				<input class="input min-w-0 flex-1" name="player" placeholder="Epic display name to track (e.g. your own)" autocomplete="off" />
				<button class="btn-primary" type="submit">${icon('user-plus')} Track</button>
			</form>

			${
				players.length
					? `<div class="mb-3 flex flex-wrap gap-2">${players
							.map(
								(player) => `
						<span class="chip ${player.lastError ? 'border-amber-400/30 text-amber-200' : ''}" title="${escapeHtml(player.lastError || (player.lastPolledAt ? `Last checked ${formatDate(player.lastPolledAt)}` : 'Not checked yet'))}">
							${escapeHtml(player.displayName || player.accountId)}${player.enabled ? '' : ' (paused)'}
							<button type="button" class="ml-1 text-zinc-500 hover:text-zinc-200" data-action="tracked-toggle" data-tracked-id="${escapeHtml(player.id)}" data-enabled="${player.enabled ? 'false' : 'true'}" title="${player.enabled ? 'Pause' : 'Resume'}">${icon(player.enabled ? 'pause' : 'play', 'h-3 w-3')}</button>
							<button type="button" class="text-zinc-500 hover:text-red-300" data-action="tracked-remove" data-tracked-id="${escapeHtml(player.id)}" title="Stop tracking">${icon('x', 'h-3 w-3')}</button>
						</span>`
							)
							.join('')}</div>
						${players
							.filter((player) => player.lastError)
							.map((player) => `<p class="mb-2 text-xs text-amber-200">${escapeHtml(player.displayName || player.accountId)}: ${escapeHtml(player.lastError)}</p>`)
							.join('')}`
					: '<p class="mb-3 text-sm text-zinc-500">Add your Epic name to start. Your stats must be public (Fortnite → Settings → Account and Privacy → Show on career leaderboard).</p>'
			}

			<div class="mb-3 grid gap-3 sm:grid-cols-2">
				${totalCard('Today', totals.today)}
				${totalCard(`Last ${matches.length} recorded`, totals.recorded)}
			</div>

			<div class="grid gap-2">
				${
					matches.length
						? matches
								.map(
									(match) => `
					<div class="card flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="font-semibold">${escapeHtml(match.playlistLabel || match.playlistId || 'Match')}${match.matches > 1 ? ` <span class="text-xs text-zinc-500">(${match.matches} matches combined)</span>` : ''}</p>
							<p class="mt-1 text-xs text-zinc-500">${escapeHtml(match.player || '')} · ${formatDate(match.endedAt)}${match.inputLabel ? ` · ${escapeHtml(match.inputLabel)}` : ''}</p>
						</div>
						<div class="flex shrink-0 flex-wrap items-center gap-3 text-sm">
							${match.win ? statusBadge('online', 'Win') : `<span class="text-zinc-400">${escapeHtml(placementText(match))}</span>`}
							<span><span class="text-zinc-500">Kills</span> ${match.kills ?? 0}</span>
							${match.minutes ? `<span class="text-zinc-500">${match.minutes} min</span>` : ''}
						</div>
					</div>`
								)
								.join('')
						: '<p class="text-sm text-zinc-500">No tracked matches yet. Epic updates stats a few minutes after each match ends.</p>'
				}
			</div>
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
	const queues = state.tracked?.fnlbQueues || [];
	if (!queues.length && controlCapabilities()?.engine !== 'fnlb') return '';
	const matched = queues.filter((q) => q.outcome === 'matched');
	const botLobbies = matched.filter((q) => q.realPlayers === 1).length;
	return `
		<section class="shell-panel rounded-lg p-4">
			<div class="mb-3">
				<h2 class="font-semibold">FNLB bot lobby queues</h2>
				<p class="mt-1 text-xs text-zinc-500">From the Legacy FNLB engine's log. "Bot lobby" means you were the only real player in the match. ${matched.length ? `${botLobbies}/${matched.length} recent matches were bot lobbies.` : ''}</p>
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
							<p class="mt-1 text-xs text-zinc-500">${escapeHtml(queue.bot)} · ${formatDate(queue.startedAt)}${queue.region ? ` · ${escapeHtml(queue.region)}` : ''}${queue.reason ? ` · ${escapeHtml(queue.reason)}` : ''}</p>
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
		</section>`;
}

export function renderMatches() {
	if (!can('matchTracking')) {
		return `
			<div class="grid gap-4">
				${fnlbQueuePanel()}
				${trackingPanel()}
				<div class="shell-panel rounded-lg p-4">
					<p class="text-sm text-zinc-500">Live bot match rounds aren't reported by the ${escapeHtml(controlCapabilities()?.engine || 'active')} engine; player tracking above still works.</p>
				</div>
			</div>
		`;
	}

	const matches = state.matches || [];
	return `
		<div class="grid gap-4">
			${fnlbQueuePanel()}
			${trackingPanel()}
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
