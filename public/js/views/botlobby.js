import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon, statusBadge } from '../core/ui.js';
import { runtimeOnline, usingLocalFnbr } from '../core/selectors.js';
import { epicCodeButton, platformLabel, platformOptions } from '../core/platforms.js';

const NO_AUTOFILL = 'autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';

function mainPlatform() {
	return state.config?.platform || 'WIN';
}

/** The platform this bot logs in as: its own, or the main bot's. */
function effectivePlatform(account) {
	return account.platform || mainPlatform();
}

function mainParty() {
	return state.party && !state.controlBotId ? state.party : state.bots?.[0]?.party || null;
}

function inMainLobby(account) {
	const mainPartyId = mainParty()?.id;
	return Boolean(mainPartyId && account.bot?.party?.id === mainPartyId);
}

function accountCard(account) {
	const online = account.status === 'online';
	const running = ['starting', 'online', 'stopping'].includes(account.status);
	const bot = account.bot;
	const party = bot?.party;
	const controlled = state.controlBotId && state.controlBotId === account.accountId;
	const id = escapeHtml(account.id);

	return `
		<div class="card ${controlled ? 'ring-1 ring-fnlb-400/60' : ''}">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<p class="truncate font-semibold">${escapeHtml(account.label)}</p>
					<p class="truncate text-xs text-zinc-500">${escapeHtml(account.displayName || bot?.nickname || (account.accountId ? account.accountId : 'Not signed in yet'))}</p>
				</div>
				<div class="flex shrink-0 flex-col items-end gap-1">
					${statusBadge(account.status)}
					${inMainLobby(account) ? statusBadge('active', 'In main lobby') : ''}
					${account.autoStart ? statusBadge('starting', 'Auto-start') : ''}
				</div>
			</div>

			<dl class="mt-3 grid gap-1 text-xs text-zinc-400">
				<div class="flex justify-between gap-2"><dt>Platform</dt><dd>${escapeHtml(platformLabel(account.activePlatform || effectivePlatform(account)))}${account.platform ? '' : ' · main'}</dd></div>
				${account.activePlatform && account.activePlatform !== effectivePlatform(account) ? `<div class="text-amber-300">Restart this bot to switch to ${escapeHtml(platformLabel(effectivePlatform(account)))}.</div>` : ''}
				<div class="flex justify-between gap-2"><dt>Epic login</dt><dd>${account.deviceAuthConfigured ? `Device auth ${escapeHtml(account.deviceAuthMasked)}` : account.authorizationCodeConfigured ? 'Auth code waiting for first start' : 'None'}</dd></div>
				${online ? `<div class="flex justify-between gap-2"><dt>Party</dt><dd>${party ? `${party.size ?? party.members?.length ?? 1}/${party.maxSize ?? 16}` : '-'}</dd></div>` : ''}
				${online && bot?.cosmetics?.outfit ? `<div class="flex justify-between gap-2"><dt>Outfit</dt><dd class="truncate">${escapeHtml(bot.cosmetics.outfit)}</dd></div>` : ''}
				${account.startedAt ? `<div class="flex justify-between gap-2"><dt>Online since</dt><dd>${formatDate(account.startedAt)}</dd></div>` : ''}
			</dl>
			${account.lastError ? `<p class="mt-2 rounded border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-200">${escapeHtml(account.lastError)}</p>` : ''}

			<div class="mt-3 flex flex-wrap gap-2">
				${running
					? `<button class="btn-danger" data-action="botacc-stop" data-account-id="${id}" ${account.status !== 'online' ? 'disabled' : ''}>${icon('square')} Stop</button>`
					: `<button class="btn-primary" data-action="botacc-start" data-account-id="${id}">${icon('power')} Start</button>`}
				${online && runtimeOnline() && usingLocalFnbr() && !inMainLobby(account)
					? `<button class="btn-secondary" data-action="botacc-join-main" data-account-id="${id}">${icon('log-in')} Join main lobby</button>`
					: ''}
				${online
					? `<button class="btn-secondary" data-action="botacc-control" data-bot-account="${escapeHtml(account.accountId)}">${icon('gamepad-2')} ${controlled ? 'Controlling' : 'Control'}</button>
					   <button class="btn-secondary" data-action="botacc-leave" data-bot-account="${escapeHtml(account.accountId)}">${icon('log-out')} Leave party</button>`
					: ''}
				<button class="btn-secondary" data-action="botacc-toggle-autostart" data-account-id="${id}" data-auto-start="${account.autoStart ? 'false' : 'true'}">${icon(account.autoStart ? 'toggle-right' : 'toggle-left')} Auto-start</button>
			</div>

			<details class="mt-3">
				<summary class="cursor-pointer text-xs text-zinc-400">Sign in again / rename / remove</summary>
				<form class="mt-2 grid gap-2" data-form="botacc-update" data-account-id="${id}">
					<input class="input" name="label" value="${escapeHtml(account.label)}" maxlength="64" placeholder="Label" />
					<select class="input" name="platform" title="Platform this bot shows as">
						${platformOptions(account.platform, { includeMain: true, mainPlatform: mainPlatform() })}
					</select>
					<input class="input" name="authorizationCode" type="password" ${NO_AUTOFILL} placeholder="New one-time authorization code" />
					<div class="flex flex-wrap gap-2">
						${epicCodeButton('Get code')}
						<button class="btn-secondary" type="submit">${icon('save')} Save</button>
						<button class="btn-secondary" type="button" data-action="botacc-clear-auth" data-account-id="${id}">${icon('key-round')} Clear login</button>
						<button class="btn-danger" type="button" data-action="botacc-delete" data-account-id="${id}">${icon('trash-2')} Remove</button>
					</div>
				</form>
			</details>
		</div>
	`;
}

function addForm() {
	const full = state.botAccounts.length >= state.maxBotAccounts;
	return `
		<section class="shell-panel rounded-lg p-4">
			<p class="font-semibold">Add a bot account</p>
			<p class="mt-1 text-sm text-zinc-500">Use a separate <strong class="text-red-300">dummy</strong> Epic account for each bot, never your main account. Bot accounts are at high risk of a ban if abused. Get the code while signed in as <em>that</em> account (a private window helps), then paste the code or the whole page Epic shows. Codes work once and expire within minutes, so start the bot soon after adding it. After the first login the device auth is saved encrypted and reused.</p>
			<form class="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto_auto]" data-form="botacc-create">
				<input class="input" name="label" maxlength="64" placeholder="Label, e.g. Bot 2" />
				<input class="input" name="authorizationCode" type="password" ${NO_AUTOFILL} placeholder="Code, or the whole page Epic shows" required />
				<select class="input" name="platform" title="Platform this bot shows as">
					${platformOptions('', { includeMain: true, mainPlatform: mainPlatform() })}
				</select>
				<label class="flex items-center gap-2 text-sm text-zinc-300">
					<input class="h-4 w-4 accent-fnlb-500" type="checkbox" name="autoStart" value="true" /> Auto-start
				</label>
				<button class="btn-primary" type="submit" ${full ? 'disabled' : ''}>${icon('plus')} Add</button>
			</form>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
				${epicCodeButton()}
				${state.botAccounts.length}/${state.maxBotAccounts} extra bots
			</div>
		</section>
	`;
}

const SETTING_LABELS = [
	['autoReady', 'Auto-ready', 'Bots ready up once every player in the lobby is ready, and unready if one backs out.'],
	['partyCommands', 'Lobby chat commands', 'Players type !ready, !unready or !sitout in lobby chat and every bot follows.'],
	['dmCommands', 'DM commands', 'Friends DM a bot CID_ / EID_ / !stats / !help and so on.'],
	['acceptInvites', 'Accept party invites', 'Your own bots always accept each other either way.'],
	['acceptFriendRequests', 'Accept friend requests', 'Your own bots always accept each other either way.']
];

function settingsPanel() {
	const settings = state.lobbySettings;
	if (!settings) return '';
	return `
		<section class="shell-panel rounded-lg p-4">
			<p class="font-semibold">Lobby behaviour</p>
			<p class="mt-1 text-sm text-zinc-500">Applies to the main bot and every extra bot straight away, with no restart.</p>
			<div class="mt-3 grid gap-2 md:grid-cols-2">
				${SETTING_LABELS.map(
					([key, label, help]) => `
					<label class="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm">
						<input class="mt-1 h-4 w-4 accent-fnlb-500" type="checkbox" data-action="lobby-setting" data-setting="${key}" ${settings[key] ? 'checked' : ''} />
						<span><span class="font-medium text-zinc-200">${label}</span><br /><span class="text-xs text-zinc-500">${help}</span></span>
					</label>`
				).join('')}
			</div>
		</section>
	`;
}

export function renderBotLobby() {
	const accounts = state.botAccounts || [];
	const online = accounts.filter((account) => account.status === 'online').length;
	const mainOnline = runtimeOnline() && usingLocalFnbr();
	const party = mainParty();

	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-lg p-4">
				<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<p class="font-semibold">Bot Lobby</p>
						<p class="mt-1 text-sm text-zinc-500">Run extra local fnbr bots next to your main bot and fill a lobby with them. Main bot: ${mainOnline ? `online${party ? `, party ${party.size ?? party.members?.length ?? 1}/${party.maxSize ?? 16}` : ''}` : 'offline'}. Extra bots online: ${online}/${accounts.length}.</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button class="btn-primary" data-action="botlobby-start-all" ${!accounts.length ? 'disabled' : ''}>${icon('power')} Start all${mainOnline ? ' + join' : ''}</button>
						<button class="btn-secondary" data-action="botlobby-join-main" ${!online || !mainOnline ? 'disabled' : ''}>${icon('users')} All join main lobby</button>
						<button class="btn-secondary" data-action="botlobby-leave" ${!online ? 'disabled' : ''}>${icon('log-out')} All leave</button>
						<button class="btn-danger" data-action="botlobby-stop-all" ${!online ? 'disabled' : ''}>${icon('square')} Stop all</button>
					</div>
				</div>
				<form class="mt-3 flex flex-col gap-2 sm:flex-row" data-form="botlobby-join">
					<input class="input" name="target" placeholder="Friend name or party ID: every online extra bot joins it" />
					<button class="btn-secondary shrink-0" type="submit" ${!online ? 'disabled' : ''}>${icon('log-in')} All join</button>
				</form>
				<p class="mt-2 text-xs text-zinc-500">To join a friend's party, each bot must be friends with them. Pick a bot with <strong>Control</strong> and use the Friends page to add them. Friends can also DM any bot <code>!help</code> for lobby commands.</p>
			</section>

			${settingsPanel()}

			${addForm()}

			${accounts.length
				? `<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">${accounts.map(accountCard).join('')}</div>`
				: `<div class="shell-panel rounded-lg p-6 text-center text-sm text-zinc-500">No extra bot accounts yet. Add one above to start building a bot lobby.</div>`}
		</div>
	`;
}
