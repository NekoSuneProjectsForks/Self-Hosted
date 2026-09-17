import { state } from '../core/state.js';
import { escapeHtml, icon, renderToast, statusBadge } from '../core/ui.js';
import { authRequiredBanner, restartRequiredBanner, runtimeOnline, usingLocalFnbr } from '../core/selectors.js';
import { renderStatus } from './status.js';
import { renderCategories } from './categories.js';
import { renderItems } from './items.js';
import { renderProfile } from './profile.js';
import { renderConfig } from './config.js';
import { renderAdmin } from './admin.js';
import { renderLobby } from './lobby.js';
import { renderFriends } from './friends.js';
import { renderMessages } from './messages.js';
import { renderMatches } from './matches.js';

/** Total unread DMs, surfaced in the nav so incoming messages are noticeable. */
function messagesNavLabel() {
	const unread = Object.values(state.unread || {}).reduce((total, n) => total + Number(n || 0), 0);
	return unread ? `Messages (${unread})` : 'Messages';
}

export function renderShell() {
	const nav = [
		['status', 'activity', 'Live Bots'],
		['lobby', 'users', 'Lobby'],
		['friends', 'contact', 'Friends'],
		['messages', 'message-square', messagesNavLabel()],
		['matches', 'swords', 'Matches'],
		['categories', 'folders', 'Categories'],
		['items', 'shirt', 'Items'],
		['profile', 'user', 'Profile'],
		['config', 'settings-2', 'Config']
	];
	if (state.user?.role === 'admin') nav.push(['admin', 'shield', 'Admin']);

	return `
		${renderToast()}
		<div class="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
			<aside class="border-b border-white/10 bg-black/25 p-4 backdrop-blur lg:min-h-screen lg:border-b-0 lg:border-r">
				<div class="mb-6 flex items-center justify-between lg:block">
					<div class="flex items-center gap-3">
						<div class="flex h-11 w-11 items-center justify-center rounded-lg bg-fnlb-500 text-fnlb-950">${icon('bot', 'h-6 w-6')}</div>
						<div>
							<p class="font-bold">Lobby Bot Host</p>
							<p class="text-xs text-zinc-500">${escapeHtml(state.user.username)} / ${escapeHtml(state.user.role)}</p>
						</div>
					</div>
					<button class="btn-secondary lg:hidden" data-action="logout" title="Logout">${icon('log-out')}</button>
				</div>
				<nav class="grid gap-2">
					${nav.map(([view, iconName, label]) => `
						<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}">
							${icon(iconName)} ${label}
						</button>
					`).join('')}
				</nav>
				<div class="mt-6 hidden lg:block">
					<button class="btn-secondary w-full" data-action="logout">${icon('log-out')} Logout</button>
				</div>
			</aside>

			<main class="p-4 sm:p-6 lg:p-8">
				<header class="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
					<div>
						<div class="mb-2 flex flex-wrap items-center gap-3">
							${statusBadge(state.runtime?.status)}
							<span class="text-sm text-zinc-500">${escapeHtml(state.config?.clusterName || 'Self Hosted Cluster')}</span>
						</div>
						<h1 class="text-2xl font-bold text-zinc-50 sm:text-3xl">${viewTitle()}</h1>
					</div>
					<div class="flex flex-wrap gap-2">
						<button class="btn-primary" data-action="start" ${runtimeOnline() ? 'disabled' : ''}>${icon('power')} Start Cluster</button>
						<button class="btn-danger" data-action="stop" ${!runtimeOnline() ? 'disabled' : ''}>${icon('square')} Stop Cluster</button>
					</div>
				</header>

				${restartRequiredBanner()}
				${authRequiredBanner()}

				${renderView()}
			</main>
		</div>
	`;
}

export function viewTitle() {
	if (state.view === 'lobby') return 'Lobby';
	if (state.view === 'friends') return 'Friends';
	if (state.view === 'messages') return 'Messages';
	if (state.view === 'matches') return 'Matches';
	if (state.view === 'config') return 'Cluster Config';
	if (state.view === 'categories') return 'Categories';
	if (state.view === 'items') return 'Fortnite Items';
	if (state.view === 'admin') return 'Admin';
	if (state.view === 'profile') return 'User Profile';
	return usingLocalFnbr() ? 'Live Local Bots' : 'Live FNLB Bots';
}

export function renderView() {
	if (state.view === 'lobby') return renderLobby();
	if (state.view === 'friends') return renderFriends();
	if (state.view === 'messages') return renderMessages();
	if (state.view === 'matches') return renderMatches();
	if (state.view === 'config') return renderConfig();
	if (state.view === 'categories') return renderCategories();
	if (state.view === 'items') return renderItems();
	if (state.view === 'admin') return renderAdmin();
	if (state.view === 'profile') return renderProfile();
	return renderStatus();
}
