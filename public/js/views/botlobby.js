import { state } from '../core/state.js';
import { escapeHtml, icon, statusBadge } from '../core/ui.js';
import { runtimeOnline, usingLocalFnbr } from '../core/selectors.js';
import { epicCodeButton, platformLabel, platformOptions } from '../core/platforms.js';

const NO_AUTOFILL = 'autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';

export function mainPlatform() {
	return state.config?.platform || 'WIN';
}

/** The platform an extra bot logs in as: its own, or the main bot's. */
export function effectivePlatform(account) {
	return account.platform || mainPlatform();
}

function mainParty() {
	return state.party && !state.controlBotId ? state.party : state.bots?.[0]?.party || null;
}

export function inMainLobby(account) {
	const mainPartyId = mainParty()?.id;
	return Boolean(mainPartyId && account.bot?.party?.id === mainPartyId);
}

/** One tile per bot. Click opens the settings pop-up. */
function botTile({ key, name, sub, status, platform, bot, badges = [], actions = '' }) {
	const party = bot?.party;
	const cosmetics = bot?.cosmetics || {};
	const level = bot?.profile?.battlePassLevel ?? null;
	return `
		<div class="bot-tile group">
			<button class="flex w-full items-start gap-3 text-left" data-action="bot-settings" data-bot-key="${escapeHtml(key)}" title="Open settings">
				<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-fnlb-300">${icon('bot', 'h-6 w-6')}</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<p class="truncate font-semibold text-zinc-50">${escapeHtml(name)}</p>
						${statusBadge(status)}
					</div>
					<p class="truncate text-xs text-zinc-500">${escapeHtml(sub)}</p>
					<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
						<span class="chip">${icon('monitor-smartphone', 'h-3 w-3')} ${escapeHtml(platformLabel(platform))}</span>
						${level ? `<span class="chip">${icon('star', 'h-3 w-3')} Level ${escapeHtml(String(level))}</span>` : ''}
						${party ? `<span class="chip">${icon('users', 'h-3 w-3')} ${escapeHtml(String(party.size ?? party.members?.length ?? 1))}/${escapeHtml(String(party.maxSize ?? 16))}</span>` : ''}
						${cosmetics.outfit ? `<span class="chip max-w-[12rem] truncate" title="${escapeHtml(cosmetics.outfit)}">${icon('shirt', 'h-3 w-3')} ${escapeHtml(cosmetics.outfit)}</span>` : ''}
						${badges.join('')}
					</div>
				</div>
				<span class="text-zinc-600 transition group-hover:text-zinc-300">${icon('settings-2')}</span>
			</button>
			${actions ? `<div class="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">${actions}</div>` : ''}
		</div>`;
}

function mainTile() {
	const bot = state.bots?.[0] || null;
	const online = runtimeOnline();
	return botTile({
		key: 'main',
		name: bot?.nickname || 'Main bot',
		sub: state.config?.deviceAuthConfigured ? 'Main bot · signed in' : 'Main bot · not signed in',
		status: state.runtime?.status || 'offline',
		platform: mainPlatform(),
		bot: online ? bot : null,
		badges: ['<span class="chip border-fnlb-400/30 text-fnlb-200">Main</span>'],
		actions: online
			? `<button class="btn-danger py-1.5" data-action="stop">${icon('square')} Stop</button>`
			: `<button class="btn-primary py-1.5" data-action="start">${icon('power')} Start</button>`
	});
}

function accountTile(account) {
	const online = account.status === 'online';
	const running = ['starting', 'online', 'stopping'].includes(account.status);
	const id = escapeHtml(account.id);
	const restartHint = account.activePlatform && account.activePlatform !== effectivePlatform(account);
	return botTile({
		key: account.id,
		name: account.label,
		sub: account.displayName || account.accountId || 'Not signed in yet',
		status: account.status,
		platform: account.activePlatform || effectivePlatform(account),
		bot: online ? account.bot : null,
		badges: [
			inMainLobby(account) ? '<span class="chip border-fnlb-400/30 text-fnlb-200">In main lobby</span>' : '',
			account.autoStart ? '<span class="chip">Auto-start</span>' : '',
			account.tracker ? '<span class="chip border-sky-400/30 text-sky-200">Tracker</span>' : '',
			restartHint ? `<span class="chip border-amber-400/30 text-amber-200">Restart to switch to ${escapeHtml(platformLabel(effectivePlatform(account)))}</span>` : '',
			account.lastError ? `<span class="chip border-red-400/30 text-red-200" title="${escapeHtml(account.lastError)}">Error</span>` : ''
		],
		actions: `
			${running
				? `<button class="btn-danger py-1.5" data-action="botacc-stop" data-account-id="${id}" ${online ? '' : 'disabled'}>${icon('square')} Stop</button>`
				: `<button class="btn-primary py-1.5" data-action="botacc-start" data-account-id="${id}">${icon('power')} Start</button>`}
			${online && runtimeOnline() && usingLocalFnbr() && !inMainLobby(account)
				? `<button class="btn-secondary py-1.5" data-action="botacc-join-main" data-account-id="${id}">${icon('log-in')} Join main lobby</button>`
				: ''}`
	});
}

export function addForm() {
	const full = state.botAccounts.length >= state.maxBotAccounts;
	return `
		<section class="shell-panel rounded-xl p-4">
			<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<p class="font-semibold">Add an extra bot</p>
				<span class="text-xs text-zinc-500">${state.botAccounts.length}/${state.maxBotAccounts} extra bots</span>
			</div>
			<p class="mt-1 text-sm text-zinc-500">Use a separate <strong class="text-red-300">dummy</strong> Epic account for each bot, never your main; bot accounts are at high risk of a ban if abused. Easiest: <strong>Sign in with Epic</strong>. Or paste a one-time code (or the whole page Epic shows).</p>
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
			<div class="mt-2">${epicCodeButton('Sign in with Epic / get code', 'new')}</div>
		</section>
	`;
}

const SETTING_LABELS = [
	['autoReady', 'Auto-ready with the players', 'The bot readies last, after every player. Use Duos, Trios or Squads (not Solo) with No Fill, like FNLB.'],
	['mirrorLeader', "Match the leader's mode", "The bot copies the leader's selected mode (Build / Zero Build, team size, fill, region), like a real client does."],
	['leaveWhenQueueStarts', 'Step out when you ready up (fallback)', "If the party still can't start a match with the bot in it: the bot leaves when the leader readies, so they queue on their own, and rejoins after their match."],
	['leaveOnMatchStart', 'Leave when the match starts', 'Once the match loads, the bot leaves your party so it is free again.'],
	['rejoinAfterMatch', 'Rejoin after the match', 'When you are back in a lobby, the bot rejoins your party (if it is joinable).'],
	['botsSitOut', 'Sit out instead of readying', 'Only for parties that want to play without the bot. Off by default.'],
	['partyCommands', 'Lobby chat commands', 'Players type !ready, !unready, !sitout or !copy in lobby chat.'],
	['dmCommands', 'DM commands', 'Friends DM a bot CID_ / EID_ / !level / !copy / !help and so on.'],
	['emotePlayOnce', 'Play emotes once', 'Stop an emote after its length instead of looping it.'],
	['acceptInvites', 'Accept party invites', 'Your own bots always accept each other either way.'],
	['acceptFriendRequests', 'Accept friend requests', 'Your own bots always accept each other either way.']
];

function settingsPanel() {
	const settings = state.lobbySettings;
	if (!settings) return '';
	return `
		<section class="shell-panel rounded-xl p-4">
			<p class="font-semibold">Lobby behaviour <span class="text-xs font-normal text-zinc-500">all bots · applies straight away</span></p>
			<div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
				${SETTING_LABELS.map(
					([key, label, help]) => `
					<label class="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm">
						<input class="mt-1 h-4 w-4 accent-fnlb-500" type="checkbox" data-action="lobby-setting" data-setting="${key}" ${settings[key] ? 'checked' : ''} />
						<span><span class="font-medium text-zinc-200">${label}</span><br /><span class="text-xs text-zinc-500">${help}</span></span>
					</label>`
				).join('')}
			</div>
			<label class="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
				Emote length
				<input class="input w-24 py-1" type="number" min="1" max="60" step="0.5" value="${escapeHtml(String(settings.emoteSeconds ?? 6))}" data-action="lobby-emote-seconds" ${settings.emotePlayOnce ? '' : 'disabled'} />
				seconds <span class="text-xs text-zinc-500">(most dances are 4 to 8 s)</span>
			</label>
			<label class="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
				Fortnite build (netCL)
				<input class="input w-40 py-1" placeholder="Automatic" value="${escapeHtml(settings.partyBuildId ? String(settings.partyBuildId).split(':').pop() : '')}" data-action="lobby-build" />
				<span class="text-xs text-zinc-500">Leave empty: the bot looks it up. Set it if the Matchmaking check says the build is unknown. Applies when a bot starts.</span>
			</label>
		</section>
	`;
}

/** Local engine locked to admins (Admin → Server)? */
export function localLocked() {
	return state.serverInfo?.localEngineAdminOnly !== false && state.user?.role !== 'admin';
}

/** Why a public bot is or isn't on the community page right now. */
function listingState(bot) {
	if (bot.state === 'available') return `<p class="mt-1 text-xs text-fnlb-300">${icon('circle-check', 'inline h-3 w-3')} On the community page now</p>`;
	const until = bot.until ? ` until ${escapeHtml(new Date(bot.until).toLocaleString())}` : '';
	const label = { busy: 'Hidden while in use', offline: 'Hidden while offline', banned: 'Hidden: banned', disabled: 'Hidden: disabled' }[bot.state] || 'Hidden';
	return `<p class="mt-1 text-xs ${bot.state === 'banned' || bot.state === 'disabled' ? 'text-red-300' : 'text-amber-200'}">${icon('eye-off', 'inline h-3 w-3')} ${label}${until}${bot.reason ? ` · ${escapeHtml(bot.reason)}` : ''}</p>`;
}

/** Community listing: each bot Public (on /community) or Private. */
function communityPanel() {
	const data = state.listings;
	const bots = data?.bots || [];
	const row = (bot) => `
		<div class="card grid gap-2">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate font-semibold">${escapeHtml(bot.name)}</p>
					<p class="text-xs text-zinc-500">${escapeHtml(bot.note)}${bot.online ? ' · online' : ''}</p>
					${bot.isPublic ? listingState(bot) : ''}
				</div>
				<div class="flex rounded-lg border border-white/10 p-0.5 text-xs" role="group" aria-label="Visibility">
					<button class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${!bot.isPublic ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}" data-action="listing-visibility" data-engine="${escapeHtml(bot.engine)}" data-key="${escapeHtml(bot.botKey)}" data-name="${escapeHtml(bot.name)}" data-public="false">${icon('lock', 'h-3.5 w-3.5')} Private</button>
					<button class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${bot.isPublic ? 'bg-fnlb-500/20 text-fnlb-200' : 'text-zinc-400 hover:text-zinc-200'}" data-action="listing-visibility" data-engine="${escapeHtml(bot.engine)}" data-key="${escapeHtml(bot.botKey)}" data-name="${escapeHtml(bot.name)}" data-public="true">${icon('globe', 'h-3.5 w-3.5')} Public</button>
				</div>
			</div>
			${
				bot.isPublic
					? `<form class="flex gap-2" data-form="listing-desc">
						<input type="hidden" name="engine" value="${escapeHtml(bot.engine)}" />
						<input type="hidden" name="botKey" value="${escapeHtml(bot.botKey)}" />
						<input class="input py-1.5 text-sm" name="description" maxlength="160" placeholder="Short note for the community (optional), e.g. Zero Build bot lobbies, EU" value="${escapeHtml(bot.description)}" />
						<button class="btn-secondary shrink-0" type="submit">${icon('save')} Save</button>
					</form>`
					: ''
			}
		</div>`;
	return `
		<section class="shell-panel rounded-xl p-4">
			<div class="mb-3 flex flex-wrap items-start justify-between gap-2">
				<div>
					<p class="flex items-center gap-2 font-semibold">${icon('globe')} Community listing</p>
					<p class="mt-1 text-sm text-zinc-500"><b>Public</b> bots appear on the <a class="text-fnlb-300 underline" href="/community" target="_blank" rel="noopener">community page</a> (no login needed), so anyone can add them and use them in a party. <b>Private</b> bots are yours only. It only lists a public bot while it's <b>running, not banned and free</b>: once someone has it in their party (or it's in a match) it's hidden until it's free again. The page only shows the name and your note: nobody else gets your friends, DMs, skins or settings.</p>
				</div>
				<a class="btn-secondary" href="/community" target="_blank" rel="noopener">${icon('external-link')} Open page</a>
			</div>
			${data?.fnlbError ? `<p class="mb-2 text-sm text-amber-200">${escapeHtml(data.fnlbError)}</p>` : ''}
			${
				!data
					? '<p class="text-sm text-zinc-500">Loading…</p>'
					: bots.length
						? `<div class="grid gap-2 lg:grid-cols-2">${bots.map(row).join('')}</div>`
						: `<p class="text-sm text-zinc-500">No bots to list yet. ${localLocked() ? 'Add your FNLB API token in Advanced settings so your FNLB bots show here.' : 'Sign in a bot, or add your FNLB API token.'}</p>`
			}
		</section>`;
}

function lockedPanel() {
	return `
		<section class="shell-panel rounded-xl p-4">
			<p class="flex items-center gap-2 font-semibold">${icon('lock')} Local engine: admins only for now</p>
			<p class="mt-1 text-sm text-zinc-500">The local engine and extra bots are being tested and can't do bot lobbies yet. Use the <b>Legacy FNLB</b> engine (Advanced settings) for your bots; friends, DMs and skins all work there.</p>
			<button class="btn-secondary mt-3" data-action="bot-settings" data-bot-key="main" data-tab="advanced">${icon('sliders-horizontal')} Advanced settings</button>
		</section>`;
}

export function renderBotLobby() {
	if (localLocked()) {
		return `<div class="grid gap-4">${lockedPanel()}${communityPanel()}</div>`;
	}
	const accounts = state.botAccounts || [];
	const online = accounts.filter((account) => account.status === 'online').length;
	const mainOnline = runtimeOnline() && usingLocalFnbr();

	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-xl p-4">
				<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<p class="font-semibold">Your bots</p>
						<p class="mt-1 text-sm text-zinc-500">Click a bot to open its settings: battle pass level, look, platform, sign-in and more. Extra bots online: ${online}/${accounts.length}.</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button class="btn-secondary" data-action="bot-settings" data-bot-key="main" data-tab="advanced">${icon('sliders-horizontal')} Advanced settings</button>
						<button class="btn-primary" data-action="botlobby-start-all" ${!accounts.length ? 'disabled' : ''}>${icon('power')} Start all${mainOnline ? ' + join' : ''}</button>
						<button class="btn-secondary" data-action="botlobby-join-main" ${!online || !mainOnline ? 'disabled' : ''}>${icon('users')} All join main</button>
						<button class="btn-secondary" data-action="botlobby-leave" ${!online ? 'disabled' : ''}>${icon('log-out')} All leave</button>
						<button class="btn-danger" data-action="botlobby-stop-all" ${!online ? 'disabled' : ''}>${icon('square')} Stop all</button>
					</div>
				</div>
				<form class="mt-3 flex flex-col gap-2 sm:flex-row" data-form="botlobby-join">
					<input class="input" name="target" placeholder="Friend name or party ID: every online extra bot joins it" />
					<button class="btn-secondary shrink-0" type="submit" ${!online ? 'disabled' : ''}>${icon('log-in')} All join</button>
				</form>
			</section>

			<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
				${usingLocalFnbr() ? mainTile() : ''}
				${accounts.map(accountTile).join('')}
			</div>

			${communityPanel()}
			${addForm()}
			${settingsPanel()}
		</div>
	`;
}
