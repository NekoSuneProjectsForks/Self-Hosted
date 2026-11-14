import { state } from '../core/state.js';
import { escapeHtml, icon, statusBadge } from '../core/ui.js';
import { runtimeOnline, usingLocalFnbr } from '../core/selectors.js';
import { epicCodeButton, platformLabel, platformOptions } from '../core/platforms.js';
import { effectivePlatform, inMainLobby, mainPlatform } from './botlobby.js';
import { renderConfigForm } from './config.js';

const TABS = [
	['overview', 'gauge', 'Overview'],
	['look', 'sparkles', 'Look & level'],
	['account', 'key-round', 'Account']
];

/** Everything the pop-up needs about the selected bot, main or extra. */
function target() {
	const key = state.botModal?.key;
	if (!key) return null;
	if (key === 'main') {
		const online = runtimeOnline() && usingLocalFnbr();
		if (!usingLocalFnbr()) {
			// FNLB mode has no single main bot; only the server settings apply.
			return { key, isMain: true, fnlb: true, name: 'Server settings', status: state.runtime?.status || 'offline', online: false, botId: null, platform: mainPlatform(), bot: null };
		}
		const bot = online ? state.bots?.[0] || null : null;
		return {
			key,
			isMain: true,
			name: bot?.nickname || 'Main bot',
			status: state.runtime?.status || 'offline',
			online: state.runtime?.status === 'online',
			botId: state.bots?.[0]?.id || null,
			platform: mainPlatform(),
			bot
		};
	}
	const account = (state.botAccounts || []).find((row) => row.id === key);
	if (!account) return null;
	return {
		key,
		isMain: false,
		account,
		name: account.label,
		status: account.status,
		online: account.status === 'online',
		botId: account.accountId,
		platform: account.activePlatform || effectivePlatform(account),
		bot: account.status === 'online' ? account.bot : null
	};
}

function row(label, value) {
	return `<div class="flex justify-between gap-3 py-1.5"><dt class="text-zinc-500">${label}</dt><dd class="truncate text-right text-zinc-200">${value}</dd></div>`;
}

function overviewTab(t) {
	const bot = t.bot;
	const party = bot?.party;
	const profile = bot?.profile || {};
	const cosmetics = bot?.cosmetics || {};
	const id = escapeHtml(t.key);
	const startStop = t.isMain
		? t.online
			? `<button class="btn-danger" data-action="stop">${icon('square')} Stop</button>`
			: `<button class="btn-primary" data-action="start">${icon('power')} Start</button>`
		: ['starting', 'online', 'stopping'].includes(t.status)
			? `<button class="btn-danger" data-action="botacc-stop" data-account-id="${id}" ${t.online ? '' : 'disabled'}>${icon('square')} Stop</button>`
			: `<button class="btn-primary" data-action="botacc-start" data-account-id="${id}">${icon('power')} Start</button>`;
	return `
		<dl class="divide-y divide-white/5 text-sm">
			${row('Status', statusBadge(t.status))}
			${row('Epic account', escapeHtml(bot?.nickname || t.account?.displayName || t.account?.accountId || (t.isMain ? (state.config?.deviceAuthConfigured ? 'Signed in' : 'Not signed in') : 'Not signed in yet')))}
			${row('Platform', escapeHtml(platformLabel(t.platform)))}
			${row('Battle pass', profile.battlePassLevel ? `Level ${escapeHtml(String(profile.battlePassLevel))}${profile.battlePassPurchased ? ' · owned' : ''}` : '-')}
			${row('Party', party ? `${escapeHtml(String(party.size ?? party.members?.length ?? 1))}/${escapeHtml(String(party.maxSize ?? 16))}${!t.isMain && t.account && inMainLobby(t.account) ? ' · in main lobby' : ''}` : '-')}
			${row('Outfit', cosmetics.outfit ? `<span class="font-mono text-xs">${escapeHtml(cosmetics.outfit)}</span>` : '-')}
			${t.account?.lastError ? row('Last error', `<span class="text-red-300">${escapeHtml(t.account.lastError)}</span>`) : ''}
		</dl>
		<div class="mt-4 flex flex-wrap gap-2">
			${startStop}
			${t.online ? `<button class="btn-secondary" data-action="botmodal-control" data-bot-id="${escapeHtml(t.isMain ? '' : t.botId)}">${icon('gamepad-2')} Control in Lobby</button>` : ''}
			${!t.isMain && t.online && runtimeOnline() && !inMainLobby(t.account) ? `<button class="btn-secondary" data-action="botacc-join-main" data-account-id="${id}">${icon('log-in')} Join main lobby</button>` : ''}
			${t.online ? `<button class="btn-secondary" data-action="botmodal-leave" data-bot-id="${escapeHtml(t.botId)}">${icon('log-out')} Leave party</button>` : ''}
			${t.online ? `<button class="btn-secondary" data-action="defaults-apply">${icon('rotate-ccw')} Reset all bots to defaults</button>` : ''}
		</div>`;
}

function lookTab(t) {
	const profile = t.bot?.profile || {};
	const defaults = state.botDefaults?.profile || {};
	const members = (t.bot?.party?.members || []).filter((member) => member.id !== t.botId);
	const disabled = t.online ? '' : 'disabled';
	return `
		${t.online ? '' : '<p class="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-xs text-amber-200">Start this bot to change it live. You can still save join defaults (all bots).</p>'}
		<form class="grid gap-3" data-form="botmodal-profile" data-bot-id="${escapeHtml(t.botId || '')}">
			<div>
				<span class="label">Battle pass level</span>
				<div class="flex flex-wrap gap-2">
					<input class="input w-32" name="battlePassLevel" type="number" min="1" max="10000" placeholder="${escapeHtml(String(profile.battlePassLevel ?? defaults.battlePassLevel ?? 'e.g. 100'))}" />
					${[1, 50, 100, 200].map((n) => `<button class="btn-secondary px-3" type="button" data-action="botmodal-level" data-level="${n}" data-bot-id="${escapeHtml(t.botId || '')}" ${disabled}>${n}</button>`).join('')}
				</div>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<label><span class="label">Battle pass</span>
					<select class="input" name="battlePassPurchased">
						<option value="">No change</option>
						<option value="true">Owned</option>
						<option value="false">Not owned</option>
					</select>
				</label>
				<label><span class="label">Crowns</span><input class="input" name="crowns" type="number" min="0" max="100000" placeholder="${escapeHtml(String(defaults.crowns ?? 'e.g. 50'))}" /></label>
				<label><span class="label">Banner ID</span><input class="input" name="bannerId" placeholder="${escapeHtml(profile.bannerId || defaults.bannerId || 'e.g. BRSeason01')}" /></label>
				<label><span class="label">Banner colour</span><input class="input" name="bannerColor" placeholder="${escapeHtml(profile.bannerColor || defaults.bannerColor || 'e.g. defaultcolor15')}" /></label>
			</div>
			<div class="flex flex-wrap gap-2">
				<button class="btn-primary" type="submit" name="mode" value="live" ${disabled}>${icon('zap')} Apply to this bot now</button>
				<button class="btn-secondary" type="submit" name="mode" value="default">${icon('save')} Save as join default (all bots)</button>
			</div>
			<p class="text-xs text-zinc-500">Live changes last until the bot joins or makes another party, then it goes back to the join defaults. Outfit and emote defaults are in the Locker.</p>
		</form>

		<div class="mt-5 border-t border-white/10 pt-4">
			<p class="font-semibold">Copy a player's look</p>
			<p class="mt-1 text-xs text-zinc-500">Outfit, back bling, pickaxe, kicks, battle pass level and banner. Styles can't be copied. Players can also type <code>!copy</code> in lobby chat.</p>
			<div class="mt-2 grid gap-2">
				${members.length
					? members
							.map(
								(member) => `
					<div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm">
						<div class="min-w-0"><p class="truncate font-medium">${escapeHtml(member.displayName || member.id)}</p><p class="truncate font-mono text-[11px] text-zinc-500">${escapeHtml(member.outfit || 'no outfit')}</p></div>
						<button class="btn-secondary shrink-0 py-1.5" data-action="copy-look" data-bot-id="${escapeHtml(t.botId || '')}" data-member-id="${escapeHtml(member.id)}" ${disabled}>${icon('copy')} Copy</button>
					</div>`
							)
							.join('')
					: `<p class="text-sm text-zinc-500">${t.online ? 'Nobody else is in this bot\'s party.' : 'Start the bot first.'}</p>`}
			</div>
		</div>`;
}

function accountTab(t) {
	if (t.isMain) {
		return `
			<div class="grid gap-4">
				<div class="flex flex-wrap items-center gap-2">
					${epicCodeButton(state.config?.deviceAuthConfigured ? 'Sign in with a different account' : 'Sign in with Epic / get code', 'main')}
					${state.config?.deviceAuthConfigured ? `<button class="btn-secondary" data-action="clear-device-auth">${icon('key-round')} Clear device auth</button>` : ''}
				</div>
				<form class="grid gap-3" data-form="botmodal-main">
					<label><span class="label">Platform the bot shows as</span>
						<select class="input" name="platform">${platformOptions(mainPlatform())}</select>
					</label>
					<label><span class="label">Presence status</span>
						<input class="input" name="defaultStatus" maxlength="120" value="${escapeHtml(state.config?.defaultStatus || '')}" placeholder="Battle Royale Lobby" />
					</label>
					<div><button class="btn-primary" type="submit">${icon('save')} Save</button></div>
					<p class="text-xs text-zinc-500">The status changes straight away; a new platform applies on the next restart. Engine, restart schedule and other server options are in the Advanced tab.</p>
				</form>
			</div>`;
	}
	const account = t.account;
	const id = escapeHtml(account.id);
	return `
		<div class="grid gap-4">
			<div class="flex flex-wrap items-center gap-2">
				${epicCodeButton('Sign in again', account.id)}
				<button class="btn-secondary" type="button" data-action="botacc-clear-auth" data-account-id="${id}">${icon('key-round')} Clear login</button>
				<button class="btn-secondary" type="button" data-action="botacc-toggle-autostart" data-account-id="${id}" data-auto-start="${account.autoStart ? 'false' : 'true'}">${icon(account.autoStart ? 'toggle-right' : 'toggle-left')} Auto-start ${account.autoStart ? 'on' : 'off'}</button>
			</div>
			<form class="grid gap-3" data-form="botacc-update" data-account-id="${id}">
				<label><span class="label">Label</span><input class="input" name="label" value="${escapeHtml(account.label)}" maxlength="64" /></label>
				<label><span class="label">Platform the bot shows as</span>
					<select class="input" name="platform">${platformOptions(account.platform, { includeMain: true, mainPlatform: mainPlatform() })}</select>
				</label>
				<label><span class="label">New one-time code (optional)</span><input class="input" name="authorizationCode" type="password" autocomplete="new-password" placeholder="Code, or the whole page Epic shows" /></label>
				<div><button class="btn-primary" type="submit">${icon('save')} Save</button></div>
			</form>
			<div class="border-t border-white/10 pt-4">
				<button class="btn-danger" type="button" data-action="botacc-delete" data-account-id="${id}">${icon('trash-2')} Remove this bot</button>
			</div>
		</div>`;
}

function advancedTab() {
	return `
		<p class="mb-3 text-sm text-zinc-500">Server-wide settings: bot engine (local fnbr or legacy FNLB), manual device auth, restart schedule, Epic session options and the FNLB token. Most changes apply on the next restart.</p>
		${renderConfigForm()}`;
}

export function renderBotModal() {
	const t = target();
	if (!t) return '';
	const tabs = t.fnlb ? [['advanced', 'sliders-horizontal', 'Advanced']] : t.isMain ? [...TABS, ['advanced', 'sliders-horizontal', 'Advanced']] : TABS;
	const tab = tabs.some(([key]) => key === state.botModal.tab) ? state.botModal.tab : tabs[0][0];
	const body = tab === 'advanced' ? advancedTab() : tab === 'look' ? lookTab(t) : tab === 'account' ? accountTab(t) : overviewTab(t);
	return `
		<div class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="bot-modal-title" data-action="bot-modal-backdrop">
			<div class="modal-panel w-full ${tab === 'advanced' ? 'max-w-5xl' : 'max-w-2xl'}" data-modal-panel>
				<div class="flex items-start justify-between gap-3 border-b border-white/10 p-4">
					<div class="flex min-w-0 items-center gap-3">
						<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fnlb-500/15 text-fnlb-300">${icon('bot', 'h-6 w-6')}</div>
						<div class="min-w-0">
							<p id="bot-modal-title" class="truncate text-lg font-bold">${escapeHtml(t.name)}</p>
							<p class="text-xs text-zinc-500">${t.fnlb ? 'Legacy FNLB engine' : `${t.isMain ? 'Main bot' : 'Extra bot'} · ${escapeHtml(platformLabel(t.platform))}`}</p>
						</div>
					</div>
					<button class="btn-secondary px-2" data-action="bot-modal-close" title="Close">${icon('x')}</button>
				</div>
				<div class="flex gap-1 border-b border-white/10 px-4">
					${tabs.map(
						([key, iconName, label]) => `
						<button class="tab ${tab === key ? 'active' : ''}" data-action="bot-modal-tab" data-tab="${key}">${icon(iconName, 'h-4 w-4')} ${label}</button>`
					).join('')}
				</div>
				<div class="p-4">${body}</div>
			</div>
		</div>`;
}
