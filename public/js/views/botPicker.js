import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';
import { controlBotId, usingLocalFnbr } from '../core/selectors.js';

/**
 * Which bot the Lobby / Friends / Messages / Matches / Locker pages act on.
 * Legacy FNLB: every FNLB bot on your token. Local engine: the main bot plus
 * online extra bots. `always` shows it even with a single bot (page headers).
 */
export function botPicker({ always = false, label = '' } = {}) {
	let options = [];
	if (usingLocalFnbr()) {
		const helpers = (state.botAccounts || []).filter((account) => account.status === 'online' && account.accountId);
		const mainName = state.bots?.[0]?.nickname || 'Main bot';
		options = [
			{ value: '', name: `${mainName} (main)`, selected: !state.controlBotId },
			...helpers.map((account) => ({
				value: account.accountId,
				name: `${account.label}${account.displayName ? ` (${account.displayName})` : ''}`,
				selected: state.controlBotId === account.accountId
			}))
		];
	} else {
		const current = controlBotId();
		options = (state.bots || []).map((bot) => ({
			value: bot.id,
			name: `${bot.nickname || bot.id}${bot.hasInvalidAuth ? ' (login problem)' : bot.isDisabled ? ' (disabled)' : ''}`,
			selected: bot.id === current
		}));
	}
	if (!options.length || (!always && options.length < 2)) return '';
	const unread = state.botUnread || {};
	options = options.map((option) => (unread[option.value] ? { ...option, name: `${option.name} (${unread[option.value]} new)` } : option));
	return `
		<label class="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-zinc-400" title="Which bot these pages control">
			${icon('gamepad-2')}${label ? `<span class="hidden sm:inline">${escapeHtml(label)}</span>` : ''}
			<select class="bg-transparent py-1 text-sm text-zinc-100 outline-none" data-action="control-bot" aria-label="Bot">
				${options.map((option) => `<option class="bg-zinc-900" value="${escapeHtml(option.value)}" ${option.selected ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}
			</select>
		</label>`;
}
