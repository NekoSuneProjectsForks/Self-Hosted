import { state } from '../core/state.js';
import { escapeHtml, icon, renderToast, statusBadge } from '../core/ui.js';
import { authRequiredBanner, restartRequiredBanner, runtimeOnline, usingLocalFnbr } from '../core/selectors.js';
import { renderStatus } from './status.js';
import { renderCategories } from './categories.js';
import { renderItems } from './items.js';
import { renderProfile } from './profile.js';
import { renderAdmin } from './admin.js';
import { renderLobby } from './lobby.js';
import { renderFriends } from './friends.js';
import { renderMessages } from './messages.js';
import { renderMatches } from './matches.js';
import { renderBotLobby } from './botlobby.js';
import { renderConsole } from './console.js';
import { renderBotModal } from './botmodal.js';
import { renderEpicCodePrompt } from '../core/platforms.js';
import { renderBannerPicker } from '../core/banners.js';

/** Old view names from bookmarks / earlier versions. */
const VIEW_ALIASES = { botlobby: 'bots', profile: 'account', config: 'bots' };

export function currentView() {
	return VIEW_ALIASES[state.view] || state.view;
}

function unreadCount() {
	return Object.values(state.unread || {}).reduce((total, n) => total + Number(n || 0), 0);
}

function navGroups() {
	const local = usingLocalFnbr();
	const unread = unreadCount();
	const groups = [
		[null, [['status', 'layout-dashboard', 'Dashboard']]],
		[
			'Play',
			[
				['lobby', 'users', 'Lobby'],
				['friends', 'contact', 'Friends'],
				['messages', 'message-square', 'Messages', unread],
				['matches', 'swords', 'Matches']
			]
		],
		[
			'Bots',
			[
				['bots', 'bot', 'Bots'],
				['items', 'shirt', 'Locker']
			]
		],
		[
			'System',
			[
				['console', 'terminal', 'Console'],
				...(local ? [] : [['categories', 'folders', 'Categories']]),
				['account', 'user', 'Account'],
				...(state.user?.role === 'admin' ? [['admin', 'shield', 'Admin']] : [])
			]
		]
	];
	return groups;
}

function renderNav() {
	const view = currentView();
	return navGroups()
		.map(
			([title, items]) => `
			<div class="grid gap-1">
				${title ? `<p class="nav-heading">${title}</p>` : ''}
				${items
					.map(
						([key, iconName, label, badge]) => `
					<button class="nav-item ${view === key ? 'active' : ''}" data-view="${key}">
						${icon(iconName)} <span class="flex-1 text-left">${label}</span>
						${badge ? `<span class="rounded-full bg-fnlb-500 px-1.5 text-[11px] font-bold text-fnlb-950">${badge}</span>` : ''}
					</button>`
					)
					.join('')}
			</div>`
		)
		.join('');
}

/** Chooses which bot the Lobby / Friends / Messages / Matches / Locker pages act on. */
function controlPicker() {
	const helpers = (state.botAccounts || []).filter((account) => account.status === 'online' && account.accountId);
	if (!helpers.length) return '';
	const mainName = state.bots?.[0]?.nickname || 'Main bot';
	return `
		<label class="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-zinc-400" title="Which bot the live pages control">
			${icon('gamepad-2')}
			<select class="bg-transparent py-1 text-sm text-zinc-100 outline-none" data-action="control-bot">
				<option class="bg-zinc-900" value="" ${!state.controlBotId ? 'selected' : ''}>${escapeHtml(mainName)} (main)</option>
				${helpers
					.map(
						(account) =>
							`<option class="bg-zinc-900" value="${escapeHtml(account.accountId)}" ${state.controlBotId === account.accountId ? 'selected' : ''}>${escapeHtml(account.label)}${account.displayName ? ` (${escapeHtml(account.displayName)})` : ''}</option>`
					)
					.join('')}
			</select>
		</label>`;
}

export function renderShell() {
	const local = usingLocalFnbr();
	const online = runtimeOnline();
	return `
		${renderToast()}
		${renderEpicCodePrompt()}
		${renderBotModal()}
		${renderBannerPicker()}
		<div class="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
			<aside class="flex flex-col gap-5 border-b border-white/10 bg-black/30 p-4 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-fnlb-500 text-fnlb-950 shadow-glow">${icon('bot', 'h-5 w-5')}</div>
						<div class="min-w-0">
							<p class="font-bold leading-tight">Lobby Bot Host</p>
							<p class="truncate text-xs text-zinc-500">${escapeHtml(state.user.username)} · ${escapeHtml(state.user.role)}</p>
						</div>
					</div>
					<button class="btn-secondary lg:hidden" data-action="logout" title="Logout">${icon('log-out')}</button>
				</div>
				<nav class="grid gap-4">${renderNav()}</nav>
				<div class="mt-auto hidden gap-2 lg:grid">
					<a class="nav-item" href="/public-lists" target="_blank" rel="noopener">${icon('globe')} Public bot list</a>
					<a class="nav-item" href="/">${icon('house')} Homepage</a>
					<button class="btn-secondary w-full" data-action="logout">${icon('log-out')} Logout</button>
				</div>
			</aside>

			<main class="min-w-0">
				<header class="sticky top-0 z-30 flex flex-col gap-3 border-b border-white/10 bg-fnlb-950/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
					<div class="flex min-w-0 items-center gap-3">
						<h1 class="truncate text-xl font-bold text-zinc-50 sm:text-2xl">${viewTitle()}</h1>
						${statusBadge(state.runtime?.status)}
						<span class="hidden rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-400 sm:inline">${local ? 'Local fnbr' : 'FNLB'}</span>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						${controlPicker()}
						<button class="btn-primary" data-action="start" ${online ? 'disabled' : ''}>${icon('power')} ${local ? 'Start bot' : 'Start cluster'}</button>
						<button class="btn-danger" data-action="stop" ${!online ? 'disabled' : ''}>${icon('square')} Stop</button>
					</div>
				</header>

				<div class="p-4 sm:p-6 lg:p-8">
					${announcementBanner()}
					${restartRequiredBanner()}
					${authRequiredBanner()}
					${renderView()}
				</div>
			</main>
		</div>
	`;
}

export function viewTitle() {
	const titles = {
		lobby: 'Lobby',
		friends: 'Friends',
		messages: 'Messages',
		matches: 'Matches',
		bots: 'Bots',
		items: 'Locker',
		console: 'Console',
		categories: 'Categories',
		account: 'Account',
		admin: 'Admin'
	};
	return titles[currentView()] || (usingLocalFnbr() ? 'Dashboard' : 'FNLB Dashboard');
}

/** The admin's server-wide announcement (Admin → Server). */
function announcementBanner() {
	const text = state.serverInfo?.announcement;
	if (!text) return '';
	return `<div class="mb-4 flex items-start gap-3 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-sky-100">${icon('megaphone', 'mt-0.5 h-4 w-4 shrink-0')}<p class="whitespace-pre-line">${escapeHtml(text)}</p></div>`;
}

export function renderView() {
	const view = currentView();
	if (view === 'bots') return renderBotLobby();
	if (view === 'lobby') return renderLobby();
	if (view === 'friends') return renderFriends();
	if (view === 'messages') return renderMessages();
	if (view === 'matches') return renderMatches();
	if (view === 'console') return renderConsole();
	if (view === 'categories') return renderCategories();
	if (view === 'items') return renderItems();
	if (view === 'admin') return renderAdmin();
	if (view === 'account') return renderProfile();
	return renderStatus();
}
