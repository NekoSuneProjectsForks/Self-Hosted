import { state, logStyles } from '../core/state.js';
import { escapeHtml, formatDate, icon } from '../core/ui.js';

const FILTERS = [
	['all', 'All'],
	['info', 'Info'],
	['errors', 'Errors']
];

function visibleLogs() {
	const filter = state.consoleFilter || 'all';
	const query = String(state.consoleQuery || '').toLowerCase();
	return state.logs.filter((log) => {
		if (filter === 'errors' && Number(log.format) !== 4) return false;
		if (filter === 'info' && Number(log.format) === 4) return false;
		return !query || String(log.content).toLowerCase().includes(query);
	});
}

/** Live runtime output for every bot of this user (main + extra bots). */
export function renderConsole() {
	const logs = visibleLogs();
	return `
		<section class="shell-panel flex flex-col overflow-hidden rounded-xl">
			<div class="flex flex-col gap-3 border-b border-white/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
				<div class="flex items-center gap-2 font-semibold">${icon('terminal')} Runtime console <span class="text-xs font-normal text-zinc-500">${logs.length}/${state.logs.length} lines · live</span></div>
				<div class="flex flex-wrap items-center gap-2">
					<div class="flex overflow-hidden rounded-lg border border-white/10">
						${FILTERS.map(([key, label]) => `<button class="px-3 py-1.5 text-xs font-semibold ${(state.consoleFilter || 'all') === key ? 'bg-fnlb-500/20 text-fnlb-200' : 'text-zinc-400 hover:bg-white/[0.06]'}" data-action="console-filter" data-filter="${key}">${label}</button>`).join('')}
					</div>
					<input class="input w-48 py-1.5" placeholder="Filter text" value="${escapeHtml(state.consoleQuery || '')}" data-action="console-query" />
					<button class="btn-secondary py-1.5" data-action="clear-logs">${icon('trash-2')} Clear</button>
				</div>
			</div>
			<div id="console-log" class="h-[calc(100vh-15rem)] min-h-[420px] overflow-auto bg-black/40 p-4 font-mono text-xs leading-5">
				${logs.length
					? logs
							.map(
								(log) => `
					<div class="${logStyles[log.format] || logStyles[0]}">
						<span class="text-zinc-600">${escapeHtml(formatDate(log.createdAt))}</span>
						<span>${escapeHtml(log.content)}</span>
					</div>`
							)
							.join('')
					: '<div class="text-zinc-500">No runtime output yet.</div>'}
			</div>
		</section>
	`;
}
