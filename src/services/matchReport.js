import { TrackedPlayer } from '../models/index.js';
import { allTrackedMatches, summarize, trackedMatchById } from './playerTracker.js';
import { fnlbQueues, queueForMatch } from './fnlbQueues.js';

/**
 * Match details (owner view) and the shareable HTML report.
 *
 * The report is meant to be passed around, so it never contains account IDs,
 * emails or who runs the stats tracker, and every name is shortened to its
 * first 4 letters + "****" (e.g. "NekoSuneVR" -> "Neko****").
 */

export function maskName(name) {
	const text = String(name ?? '').trim();
	if (!text) return 'Unknown';
	if (text.length <= 4) return `${text[0]}***`;
	return `${text.slice(0, 4)}****`;
}

const INPUTS = { keyboardmouse: 'Keyboard & mouse', gamepad: 'Controller', touch: 'Touch' };

function topsList(tops = {}) {
	return Object.entries(tops)
		.map(([key, count]) => ({ bucket: Number(key.replace('top', '')), count }))
		.filter((row) => Number.isFinite(row.bucket))
		.sort((a, b) => a.bucket - b.bucket);
}

/** Everything about one match, plus the FNLB queue (and party) that led to it. */
export async function matchDetails(userId, matchId) {
	const match = await trackedMatchById(userId, matchId);
	if (!match) return null;
	const tracked = await TrackedPlayer.findOne({ where: { userId, accountId: match.accountId } });
	const name = tracked?.displayName || match.player || null;
	const queue = await queueForMatch(userId, name, match.startedAt).catch(() => null);
	const meta = match.meta || {};
	const deaths = Math.max(0, (match.matches || 1) - (match.wins || 0));
	return {
		id: match.id,
		who: { name, kind: tracked?.kind || 'player' },
		mode: { label: match.playlistLabel, playlistId: match.playlistId, input: INPUTS[meta.input] || meta.input || null },
		time: { startedAt: match.startedAt, endedAt: match.endedAt, minutes: match.minutes },
		result: {
			win: Boolean(match.win),
			wins: match.wins || 0,
			placement: match.placement,
			placements: topsList(meta.tops),
			matches: match.matches || 1
		},
		combat: {
			kills: match.kills ?? 0,
			deaths,
			kd: Math.round(((match.kills ?? 0) / Math.max(1, deaths)) * 100) / 100,
			playersOutlived: match.playersOutlived,
			score: match.score
		},
		queue
	};
}

function esc(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function when(value) {
	if (!value) return '-';
	return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function duration(seconds) {
	if (!Number.isFinite(Number(seconds))) return '-';
	const total = Math.max(0, Math.round(Number(seconds)));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function result(match) {
	if (match.win) return match.wins > 1 ? `${match.wins} wins` : 'Victory Royale';
	return match.placement ? `Top ${match.placement}` : 'Played';
}

function partyText(party) {
	if (!Array.isArray(party) || !party.length) return '-';
	return party.map((member) => `${maskName(member.name)}${member.isBot ? ' (bot)' : ''}`).join(', ');
}

/**
 * Standalone HTML report (no scripts, no external files) for one tracked
 * account or all of them. Safe to share: names masked, no IDs.
 */
export async function matchReportHtml(userId, { accountId = null, title = 'Match report' } = {}) {
	const tracked = await TrackedPlayer.findAll({ where: { userId } });
	const names = new Map(tracked.map((row) => [row.accountId, row.displayName]));
	const selected = accountId ? tracked.find((row) => row.accountId === accountId) : null;
	const matches = await allTrackedMatches(userId, selected?.accountId || null);
	const totals = summarize(matches);
	const queues = (await fnlbQueues(userId, { bot: selected?.displayName || null, page: 1, pageSize: 50 })).queues;

	const rows = [];
	for (const match of matches.slice(0, 500)) {
		const name = names.get(match.accountId) || match.player;
		const queue = await queueForMatch(userId, name, match.startedAt).catch(() => null);
		rows.push(`<tr>
			<td>${esc(when(match.endedAt))}</td>
			${selected ? '' : `<td>${esc(maskName(name))}</td>`}
			<td>${esc(match.playlistLabel || match.playlistId || '-')}${match.matches > 1 ? ` <small>(${match.matches} combined)</small>` : ''}</td>
			<td>${esc(match.inputLabel || '-')}</td>
			<td class="${match.win ? 'win' : ''}">${esc(result(match))}</td>
			<td>${esc(match.kills ?? 0)}</td>
			<td>${esc(match.playersOutlived ?? '-')}</td>
			<td>${match.minutes ? `${esc(match.minutes)} min` : '-'}</td>
			<td>${esc(match.score ?? '-')}</td>
			<td>${queue ? esc(duration(queue.queueSeconds)) : '-'}</td>
			<td>${queue?.realPlayers ?? '-'}</td>
			<td>${esc(partyText(queue?.party))}</td>
		</tr>`);
	}
	const queueRows = queues.map(
		(queue) => `<tr>
			<td>${esc(when(queue.startedAt))}</td>
			<td>${esc(maskName(queue.bot))}</td>
			<td>${esc(queue.playlistLabel || queue.playlistId || '-')}</td>
			<td>${esc(queue.region || '-')}</td>
			<td>${esc(duration(queue.queueSeconds))}</td>
			<td class="${queue.outcome === 'matched' && queue.realPlayers === 1 ? 'win' : queue.outcome === 'failed' ? 'bad' : ''}">${esc(queue.outcome === 'matched' ? (queue.realPlayers === 1 ? 'Bot lobby' : `Matched${queue.realPlayers ? ` (${queue.realPlayers} real players)` : ''}`) : queue.outcome === 'failed' ? `Failed${queue.reason ? `: ${queue.reason}` : ''}` : queue.outcome || '-')}</td>
			<td>${esc(partyText(queue.party))}</td>
		</tr>`
	);
	const card = (label, value) => `<div class="card"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
	const subject = selected ? maskName(selected.displayName) : 'All bots and players';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · ${esc(subject)}</title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; background: #0b1210; color: #e4e4e7; }
	main { max-width: 1200px; margin: 0 auto; padding: 32px 20px; }
	h1 { margin: 0; font-size: 26px; } h2 { margin: 32px 0 10px; font-size: 18px; }
	.sub { color: #a1a1aa; margin: 4px 0 20px; }
	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
	.card { background: #141d1a; border: 1px solid #23302b; border-radius: 10px; padding: 12px; }
	.card span { display: block; color: #a1a1aa; font-size: 12px; text-transform: uppercase; }
	.card b { font-size: 20px; }
	.table { overflow-x: auto; border: 1px solid #23302b; border-radius: 10px; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #1c2723; white-space: nowrap; }
	th { background: #111917; color: #a1a1aa; font-size: 12px; text-transform: uppercase; font-weight: 600; }
	tr:last-child td { border-bottom: 0; }
	td small { color: #a1a1aa; }
	.win { color: #4ade80; font-weight: 600; } .bad { color: #fca5a5; }
	footer { margin-top: 32px; color: #71717a; font-size: 12px; }
</style>
</head>
<body>
<main>
	<h1>${esc(title)}</h1>
	<p class="sub">${esc(subject)} · generated ${esc(when(new Date()))} · ${matches.length} recorded match entr${matches.length === 1 ? 'y' : 'ies'}</p>
	<div class="cards">
		${card('Matches', totals.matches)}${card('Wins', `${totals.wins} (${totals.winRate}%)`)}${card('K/D', totals.kd)}${card('Kills', totals.kills)}
		${card('Kills / match', totals.killsPerMatch)}${card('Top 10', `${totals.top10Rate}%`)}${card('Avg match', `${totals.avgMinutes} min`)}${card('Time played', `${Math.round(totals.minutes / 60)} h`)}
	</div>
	<h2>Matches</h2>
	<div class="table"><table>
		<thead><tr><th>Ended</th>${selected ? '' : '<th>Player</th>'}<th>Mode</th><th>Input</th><th>Result</th><th>Kills</th><th>Outlived</th><th>Time</th><th>Score</th><th>Queue</th><th>Real players</th><th>Party</th></tr></thead>
		<tbody>${rows.join('') || `<tr><td colspan="12">No matches recorded.</td></tr>`}</tbody>
	</table></div>
	${
		queueRows.length
			? `<h2>Bot lobby queues</h2>
	<div class="table"><table>
		<thead><tr><th>Queued</th><th>Bot</th><th>Mode</th><th>Region</th><th>Queue time</th><th>Result</th><th>Party</th></tr></thead>
		<tbody>${queueRows.join('')}</tbody>
	</table></div>`
			: ''
	}
	<footer>Names are shortened for privacy (first 4 letters). Stats come from Epic's public Fortnite stats; "Real players" and "Party" come from the bot lobby queue. Not affiliated with Epic Games.</footer>
</main>
</body>
</html>
`;
}
