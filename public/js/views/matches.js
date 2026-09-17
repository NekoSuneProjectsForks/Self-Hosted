import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon, statusBadge, valueOrDash } from '../core/ui.js';

function can(capability) {
	return state.runtime?.capabilities?.capabilities?.[capability] === true;
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

export function renderMatches() {
	if (!can('matchTracking')) {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">Not supported by this engine</p>
				<p class="mt-1 text-sm text-zinc-500">The ${escapeHtml(state.runtime?.capabilities?.engine || 'active')} engine does not report match state to this dashboard.</p>
			</div>
		`;
	}

	const matches = state.matches || [];
	return `
		<div class="grid gap-4">
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
