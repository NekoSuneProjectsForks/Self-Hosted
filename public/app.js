const app = document.querySelector('#app');

const state = {
	authMode: 'login',
	resetToken: null,
	view: 'status',
	user: null,
	config: null,
	runtime: { status: 'offline' },
	logs: [],
	dashboard: null,
	bots: [],
	stats: null,
	categories: [],
	selectedBotId: null,
	selectedBotDetails: null,
	quickCommands: [],
	userSearchResults: [],
	itemSearchResults: [],
	commandResponses: [],
	adminUsers: [],
	adminOverview: null,
	toast: null,
	busy: false,
	autoRefresh: true,
	socket: null
};

const statusStyles = {
	offline: 'border-zinc-600/40 bg-zinc-500/10 text-zinc-300',
	starting: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
	online: 'border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300',
	active: 'border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300',
	restarting: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
	stopping: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
	error: 'border-red-400/40 bg-red-500/10 text-red-200',
	suspended: 'border-red-400/40 bg-red-500/10 text-red-200'
};

const logStyles = {
	0: 'text-zinc-300',
	1: 'text-fnlb-300',
	2: 'text-sky-200',
	3: 'text-amber-200',
	4: 'text-red-200'
};

function icon(name, classes = 'h-4 w-4') {
	return `<i data-lucide="${name}" class="${classes}"></i>`;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function setToast(message, type = 'info') {
	state.toast = { message, type };
	render();
	if (message) {
		setTimeout(() => {
			if (state.toast?.message === message) {
				state.toast = null;
				render();
			}
		}, 4200);
	}
}

async function api(path, options = {}) {
	const response = await fetch(path, {
		method: options.method || 'GET',
		headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
		body: options.body ? JSON.stringify(options.body) : undefined
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (response.status === 401 && !path.startsWith('/api/auth/')) {
			state.user = null;
			state.config = null;
			disconnectSocket();
			render();
		}
		throw new Error(data.error || 'Request failed.');
	}
	return data;
}

function detectResetToken() {
	const params = new URLSearchParams(window.location.search);
	const token = params.get('reset_token');
	if (token) {
		state.resetToken = token;
		state.authMode = 'reset';
		return true;
	}
	return false;
}

function clearResetTokenFromUrl() {
	const url = new URL(window.location.href);
	url.searchParams.delete('reset_token');
	window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function runtimeOnline() {
	return ['starting', 'online', 'restarting', 'stopping'].includes(state.runtime?.status);
}

function runtimeOnlineFor(user) {
	return ['starting', 'online', 'restarting', 'stopping'].includes(user.runtime?.status);
}

function usingLocalFnbr() {
	return state.config?.runtimeMode !== 'fnlb';
}

function dashboardAvailable() {
	if (!state.user || !state.config) return false;
	if (usingLocalFnbr()) {
		return state.config.deviceAuthConfigured || state.config.authorizationCodeConfigured || runtimeOnline();
	}
	return state.config.apiTokenConfigured;
}

function statusBadge(status, label = status) {
	return `<span class="badge ${statusStyles[status] || statusStyles.offline}">${escapeHtml(label || 'offline')}</span>`;
}

function formatDate(value) {
	if (!value) return 'Never';
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return 'Unknown';
	return date.toLocaleString();
}

function valueOrDash(value) {
	if (value === undefined || value === null || value === '') return '-';
	return escapeHtml(value);
}

function count(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
}

function tomorrowLocalInput() {
	const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
	date.setSeconds(0, 0);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function renderToast() {
	if (!state.toast) return '';
	const classes =
		state.toast.type === 'error'
			? 'border-red-400/30 bg-red-500/15 text-red-100'
			: 'border-fnlb-400/30 bg-fnlb-500/15 text-fnlb-100';
	return `<div class="fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-xl ${classes}">${escapeHtml(state.toast.message)}</div>`;
}

function renderAuthForm() {
	const mode = state.authMode;

	if (mode === 'forgot') {
		return `
			<div class="mb-6">
				<p class="text-lg font-bold">Forgot your password?</p>
				<p class="mt-1 text-sm text-zinc-500">Enter your account email and we'll send you a reset link.</p>
			</div>
			<form data-form="forgot" class="space-y-4">
				<label>
					<span class="label">Email</span>
					<input class="input" name="email" type="email" autocomplete="email" required />
				</label>
				<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
					${icon('mail')} Send reset link
				</button>
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="login">Back to login</button>
			</form>
		`;
	}

	if (mode === 'reset') {
		return `
			<div class="mb-6">
				<p class="text-lg font-bold">Choose a new password</p>
				<p class="mt-1 text-sm text-zinc-500">Set a new password for your account.</p>
			</div>
			<form data-form="reset" class="space-y-4">
				<input type="hidden" name="token" value="${escapeHtml(state.resetToken || '')}" />
				<label>
					<span class="label">New password</span>
					<input class="input" name="password" type="password" autocomplete="new-password" required minlength="8" />
				</label>
				<label>
					<span class="label">Confirm new password</span>
					<input class="input" name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" />
				</label>
				<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
					${icon('key-round')} Reset password
				</button>
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="login">Back to login</button>
			</form>
		`;
	}

	const loginActive = mode === 'login';
	return `
		<div class="mb-6 flex rounded-lg border border-white/10 bg-black/20 p-1">
			<button class="flex-1 rounded-md px-3 py-2 text-sm font-semibold ${loginActive ? 'bg-fnlb-500 text-fnlb-950' : 'text-zinc-400'}" data-auth-mode="login">Login</button>
			<button class="flex-1 rounded-md px-3 py-2 text-sm font-semibold ${!loginActive ? 'bg-fnlb-500 text-fnlb-950' : 'text-zinc-400'}" data-auth-mode="register">Register</button>
		</div>

		<form data-form="${loginActive ? 'login' : 'register'}" class="space-y-4">
			${!loginActive ? `
				<label>
					<span class="label">Username</span>
					<input class="input" name="username" autocomplete="username" required minlength="3" maxlength="40" />
				</label>
			` : ''}
			<label>
				<span class="label">Email</span>
				<input class="input" name="email" type="email" autocomplete="email" required />
			</label>
			<label>
				<span class="label">Password</span>
				<input class="input" name="password" type="password" autocomplete="${loginActive ? 'current-password' : 'new-password'}" required minlength="8" />
			</label>
			<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
				${icon(loginActive ? 'log-in' : 'user-plus')} ${loginActive ? 'Login' : 'Create Account'}
			</button>
			${loginActive ? `
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="forgot">Forgot your password?</button>
			` : ''}
		</form>
	`;
}

function renderAuth() {
	return `
		${renderToast()}
		<main class="flex min-h-screen items-center justify-center p-4">
			<section class="shell-panel grid w-full max-w-5xl overflow-hidden rounded-lg lg:grid-cols-[1fr_440px]">
				<div class="hidden min-h-[620px] border-r border-white/10 bg-black/20 p-8 lg:flex lg:flex-col lg:justify-between">
					<div>
						<div class="mb-8 flex items-center gap-3">
							<div class="flex h-11 w-11 items-center justify-center rounded-lg bg-fnlb-500 text-fnlb-950">${icon('bot', 'h-6 w-6')}</div>
							<div>
								<p class="text-lg font-bold">Lobby Bot Host Console</p>
								<p class="text-sm text-zinc-500">Self-hosted Fortnite lobby bot control</p>
							</div>
						</div>
						<div class="grid gap-3">
							<div class="card">
								<div class="mb-3 text-fnlb-300">${icon('shield-check', 'h-5 w-5')}</div>
								<p class="font-semibold">Encrypted cluster config</p>
								<p class="mt-1 text-sm text-zinc-400">API tokens and category data are stored with AES-256-GCM in SQLite.</p>
							</div>
							<div class="card">
								<div class="mb-3 text-fnlb-300">${icon('activity', 'h-5 w-5')}</div>
								<p class="font-semibold">Live fnbr bot status</p>
								<p class="mt-1 text-sm text-zinc-400">Bot cards, friends, blocked users, party state, cosmetics, chat, and command tools.</p>
							</div>
						</div>
					</div>
					<div class="rounded-lg border border-fnlb-400/20 bg-fnlb-500/10 p-4 text-sm text-fnlb-100">Secure multi-user hosting for local fnbr-powered lobby bots.</div>
				</div>

				<div class="p-6 sm:p-8">
					${renderAuthForm()}
				</div>
			</section>
		</main>
	`;
}

function renderShell() {
	const nav = [
		['status', 'activity', 'Live Bots'],
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

				${renderView()}
			</main>
		</div>
	`;
}

function viewTitle() {
	if (state.view === 'config') return 'Cluster Config';
	if (state.view === 'categories') return 'Categories';
	if (state.view === 'items') return 'Fortnite Items';
	if (state.view === 'admin') return 'Admin';
	if (state.view === 'profile') return 'User Profile';
	return usingLocalFnbr() ? 'Live Local Bots' : 'Live FNLB Bots';
}

function renderView() {
	if (state.view === 'config') return renderConfig();
	if (state.view === 'categories') return renderCategories();
	if (state.view === 'items') return renderItems();
	if (state.view === 'admin') return renderAdmin();
	if (state.view === 'profile') return renderProfile();
	return renderStatus();
}

function renderMetricCards() {
	const config = state.config || {};
	return `
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">${usingLocalFnbr() ? 'Engine' : 'Local Shards'}</p>
				<p class="mt-2 text-2xl font-bold">${usingLocalFnbr() ? 'fnbr' : escapeHtml(config.numberOfShards ?? 2)}</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">${usingLocalFnbr() ? 'Platform' : 'Bots per Shard'}</p>
				<p class="mt-2 text-2xl font-bold">${usingLocalFnbr() ? escapeHtml(config.platform || 'WIN') : escapeHtml(config.botsPerShard ?? 32)}</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">Restart Interval</p>
				<p class="mt-2 text-2xl font-bold">${escapeHtml(config.restartInterval ?? 3600)}s</p>
			</div>
			<div class="card">
				<p class="text-xs uppercase text-zinc-500">Restart Update</p>
				<p class="mt-2 text-lg font-bold">${config.autoUpdateOnRestart ? 'Forced' : 'Standard'}</p>
			</div>
		</div>
	`;
}

function renderFnlbStats() {
	const stats = state.stats || {};
	if (usingLocalFnbr()) {
		const localStats = stats.local || {};
		return `
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
				${statCard('Local Bots', localStats.total)}
				${statCard('Connected', localStats.connected)}
				${statCard('Friends', localStats.friends)}
				${statCard('Party Members', localStats.partyMembers)}
				${statCard('In Match', localStats.matches)}
			</div>
		`;
	}
	const publicStats = stats.public || {};
	const vipStats = stats.vip || {};
	return `
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
			${statCard('Public Total', publicStats.total)}
			${statCard('Public Online', publicStats.connected)}
			${statCard('Public Matches', publicStats.matches)}
			${statCard('VIP Total', vipStats.total)}
			${statCard('VIP Online', vipStats.connected)}
			${statCard('VIP Matches', vipStats.matches)}
		</div>
	`;
}

function statCard(label, value) {
	return `
		<div class="card">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-2 text-2xl font-bold">${count(value)}</p>
		</div>
	`;
}

function renderStatus() {
	return `
		<div class="grid gap-4">
			${renderMetricCards()}
			${renderFnlbStats()}
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-semibold">${usingLocalFnbr() ? 'Local fnbr Bot Status' : 'FNLB API Bot Status'}</p>
						<p class="mt-1 text-sm text-zinc-500">${usingLocalFnbr() ? 'Click a bot for live party, friends, pending requests, blocked users, command tools, chat, and cosmetics.' : 'Click a bot for friends, pending requests, blocked users, command tools, chat, and any lobby fields FNLB returns.'}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<label class="btn-secondary cursor-pointer">
							<input class="h-4 w-4 accent-fnlb-500" type="checkbox" data-action="toggle-auto-refresh" ${state.autoRefresh ? 'checked' : ''} />
							Auto refresh
						</label>
						<button class="btn-secondary" data-action="refresh-dashboard">${icon('refresh-cw')} Refresh</button>
					</div>
				</div>
				<div class="grid gap-4 xl:grid-cols-[1fr_440px]">
					${renderBots()}
					${renderBotDetails()}
				</div>
			</section>
		</div>
	`;
}

function renderBots() {
	if (!dashboardAvailable()) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">${usingLocalFnbr() ? 'Save Epic device auth or a one-time authorization code in Config to load your local fnbr bot.' : 'Save your FNLB API token in Config to load bots.'}</div>`;
	}
	if (!state.dashboard) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Loading ${usingLocalFnbr() ? 'local fnbr' : 'FNLB'} dashboard data...</div>`;
	}
	if (!state.bots.length) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No bots returned by the ${usingLocalFnbr() ? 'local fnbr runtime' : 'FNLB API'}.</div>`;
	}
	return `
		<div class="grid content-start gap-3 lg:grid-cols-2">
			${state.bots.map((bot) => renderBotCard(bot)).join('')}
		</div>
	`;
}

function renderBotCard(bot) {
	const selected = bot.id === state.selectedBotId;
	const status =
		bot.source === 'fnbr' && state.runtime?.status !== 'online'
			? '<span class="badge border-zinc-500/40 bg-zinc-500/10 text-zinc-300">offline</span>'
			: bot.mmsBannedUntil
			? '<span class="badge border-amber-400/40 bg-amber-500/10 text-amber-200">Temp MMS ban</span>'
			: bot.hasInvalidAuth
				? '<span class="badge border-red-400/40 bg-red-500/10 text-red-200">Invalid auth</span>'
				: bot.isDisabled
					? '<span class="badge border-zinc-500/40 bg-zinc-500/10 text-zinc-300">Disabled</span>'
					: '<span class="badge border-fnlb-400/40 bg-fnlb-500/10 text-fnlb-200">OK</span>';

	return `
		<button class="rounded-lg border ${selected ? 'border-fnlb-400/50 bg-fnlb-500/10' : 'border-white/10 bg-black/25 hover:bg-white/[0.06]'} p-4 text-left transition" data-bot-id="${escapeHtml(bot.id)}">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
				<p class="font-semibold">${escapeHtml(bot.nickname || bot.id)}</p>
					<p class="mt-1 break-all text-xs text-zinc-500">${escapeHtml(bot.email || bot.id)}</p>
				</div>
				${status}
			</div>
			<div class="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
				<p>Engine: <span class="text-zinc-200">${escapeHtml(bot.source || 'fnlb')}</span></p>
				<p>Flags: <span class="text-zinc-200">${escapeHtml(bot.flagsList?.join(', ') || 'None')}</span></p>
				<p>MMS ban: <span class="text-zinc-200">${escapeHtml(bot.mmsBannedUntil ? formatDate(bot.mmsBannedUntil) : 'No')}</span></p>
				<p>Friends: <span class="text-zinc-200">${valueOrDash(bot.friendsCount)}</span></p>
				<p>Matches: <span class="text-zinc-200">${valueOrDash(bot.matches)}</span></p>
			</div>
		</button>
	`;
}

function renderBotDetails() {
	if (!state.selectedBotId) {
		return `
			<aside class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">
				Select a bot to inspect live details and tools.
			</aside>
		`;
	}
	if (!state.selectedBotDetails) {
		return `<aside class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Loading bot details...</aside>`;
	}

	const { bot, friends, pendingFriends, blockedUsers } = state.selectedBotDetails;
	const onlineFriends = friends?.onlineFriends || [];
	const offlineFriends = friends?.offlineFriends || [];
	const incoming = pendingFriends?.incomingFriends || [];
	const outgoing = pendingFriends?.outgoingFriends || [];
	const party = bot.party || {};
	const partyMembers = Array.isArray(party.members) ? party.members : [];
	const match = bot.match || partyMembers.find((member) => member.id === bot.id)?.matchInfo || {};
	const cosmetics = bot.cosmetics || {};

	return `
		<aside class="grid max-h-[calc(100vh-180px)] gap-4 overflow-auto rounded-lg border border-white/10 bg-black/25 p-4">
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="text-lg font-bold">${escapeHtml(bot.nickname || bot.id)}</p>
					<p class="break-all text-xs text-zinc-500">${escapeHtml(bot.id)}</p>
				</div>
				<button class="btn-secondary px-2 py-2" data-action="close-bot-detail" title="Close">${icon('x')}</button>
			</div>

			<div class="grid gap-2 text-sm">
				${detailRow('Engine', bot.source || 'fnlb')}
				${detailRow('Email', bot.email)}
				${detailRow('Parent', bot.parent)}
				${detailRow('Flags', bot.flagsList?.join(', ') || 'None')}
				${detailRow('Presence', bot.presenceStatus || bot.status)}
				${detailRow('Friends Count', bot.friendsCount)}
				${detailRow('Matches', bot.matches)}
				${detailRow('Match State', match.location)}
				${detailRow('Match Players', match.playerCount)}
				${detailRow('Playlist', party.playlistId || match.playlist)}
				${detailRow('Party ID', party.id)}
				${detailRow('Party Players', partyMembers.length || bot.partyMembers)}
				${detailRow('Outfit', cosmetics.outfit)}
				${detailRow('Backpack', cosmetics.backpack)}
				${detailRow('Pickaxe', cosmetics.pickaxe)}
				${detailRow('Emote', cosmetics.emote)}
				${detailRow('MMS Banned Until', bot.mmsBannedUntil ? formatDate(bot.mmsBannedUntil) : 'No')}
			</div>

			${!party.id && !partyMembers.length && (bot.matches === undefined || (usingLocalFnbr() && state.runtime?.status !== 'online')) ? `
				<div class="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
					${usingLocalFnbr() ? 'The local bot is offline, so live party and friend data is unavailable until it starts.' : 'The current FNLB bot detail response does not expose lobby, playlist, party member, or match fields for this bot. If FNLB returns those fields later, this panel will display them automatically.'}
				</div>
			` : ''}

			<div class="grid grid-cols-2 gap-2">
				<button class="btn-secondary" data-action="toggle-bot-disabled" data-disabled="${bot.isDisabled ? 'false' : 'true'}">
					${icon(bot.isDisabled ? 'play' : 'pause')} ${bot.isDisabled ? 'Enable' : 'Disable'}
				</button>
				<button class="btn-secondary" data-action="refresh-selected-bot">${icon('refresh-cw')} Refresh</button>
			</div>

			${renderFriendPanels(onlineFriends, offlineFriends, incoming, outgoing, blockedUsers)}
			${renderSessionHistory(state.selectedBotDetails.sessions || [])}
			${renderBotTools()}
		</aside>
	`;
}

function detailRow(label, value) {
	return `
		<div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
			<span class="text-zinc-500">${escapeHtml(label)}</span>
			<span class="break-all text-right text-zinc-200">${valueOrDash(value)}</span>
		</div>
	`;
}

function renderFriendPanels(onlineFriends, offlineFriends, incoming, outgoing, blockedUsers) {
	return `
		<div class="grid gap-3">
			<div class="grid grid-cols-2 gap-2">
				${smallCount('Online Friends', onlineFriends.length)}
				${smallCount('Offline Friends', offlineFriends.length)}
				${smallCount('Incoming Requests', incoming.length)}
				${smallCount('Blocked Users', blockedUsers.length)}
			</div>
			${renderList('Online Friends', onlineFriends.slice(0, 8), (friend) => `${friend.displayName || friend.id}${friend.status ? ` - ${friend.status}` : ''}${friend.isJoinable ? ' - joinable' : ''}`)}
			${renderList('Pending Incoming', incoming.slice(0, 8), (friend) => friend.displayName || friend.id)}
			${renderList('Blocked Users', blockedUsers.slice(0, 8), (user) => user.displayName || user.id)}
		</div>
	`;
}

function smallCount(label, value) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<p class="text-xs uppercase text-zinc-500">${escapeHtml(label)}</p>
			<p class="mt-1 text-xl font-bold">${escapeHtml(value)}</p>
		</div>
	`;
}

function renderList(title, rows, getLabel) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<p class="mb-2 text-sm font-semibold">${escapeHtml(title)}</p>
			${rows.length ? `<div class="grid gap-1 text-xs text-zinc-400">${rows.map((row) => `<p class="break-all">${escapeHtml(getLabel(row))}</p>`).join('')}</div>` : '<p class="text-xs text-zinc-500">None</p>'}
		</div>
	`;
}

function renderBotTools() {
	return `
		<div class="grid gap-3">
			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="bot-action">
				<p class="mb-3 font-semibold">Friend, Block, Lobby Actions</p>
				<div class="grid gap-2">
					<select class="input py-2" name="action">
						<option value="add_friend">Add friend</option>
						<option value="remove_friend">Remove friend</option>
						<option value="block_user">Block user</option>
						<option value="unblock_user">Unblock user</option>
						<option value="invite">Invite friend</option>
						<option value="join_party">Join party by ID</option>
						<option value="kick">Kick user from lobby</option>
						<option value="kick_all">Kick all party members</option>
						<option value="hide_all">Hide all cosmetics</option>
						<option value="unhide_all">Unhide all cosmetics</option>
						<option value="set_playlist">Set playlist/island</option>
						<option value="ready">Ready up</option>
						<option value="unready">Unready</option>
						<option value="set_status">Set status text</option>
						<option value="say">Say command</option>
						<option value="leave_lobby">Leave lobby command</option>
					</select>
					<input class="input py-2" name="target" placeholder="Epic user ID / display name / value" />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('wand-2')} Run Action</button>
				</div>
				<p class="mt-2 text-xs text-zinc-500">${usingLocalFnbr() ? 'Local mode runs these directly through fnbr.js/Epic party and friends APIs.' : 'FNLB does not expose direct REST mutations for these actions, so this uses its documented command runner.'}</p>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="command-run">
				<p class="mb-3 font-semibold">Run Command</p>
				<div class="grid gap-2">
					<input class="input py-2" name="command" placeholder="command" required />
					<input class="input py-2" name="args" placeholder="args" />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('send')} Run</button>
				</div>
				<p class="mt-2 text-xs text-zinc-500">${usingLocalFnbr() ? 'Supported local commands include outfit, backpack, pickaxe, shoes, emote, ready, unready, set_status, set_playlist, invite, leave, and clear_emote.' : 'Runs the FNLB command runner for this bot.'}</p>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="chat-send">
				<p class="mb-3 font-semibold">Send Chat Message</p>
				<div class="grid gap-2">
					<input class="input py-2" name="content" placeholder="message" required />
					<input class="input py-2" name="locale" value="en" />
					<button class="btn-primary" type="submit">${icon('message-square')} Send</button>
				</div>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="quick-command-create">
				<p class="mb-3 font-semibold">Custom Quick Commands</p>
				<div class="grid gap-2">
					<input class="input py-2" name="name" placeholder="Button name" required maxlength="60" />
					<input class="input py-2" name="command" placeholder="command" required maxlength="255" />
					<input class="input py-2" name="args" placeholder="args" maxlength="255" />
					<button class="btn-secondary" type="submit">${icon('plus')} Save Command</button>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					${state.quickCommands.map((command) => `
						<span class="inline-flex overflow-hidden rounded-lg border border-white/10 bg-black/30">
							<button class="px-3 py-2 text-xs font-semibold text-fnlb-200 hover:bg-fnlb-500/10" data-action="run-quick-command" data-command-id="${command.id}">${escapeHtml(command.name)}</button>
							<button class="border-l border-white/10 px-2 py-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-200" data-action="delete-quick-command" data-command-id="${command.id}" title="Delete">${icon('x', 'h-3.5 w-3.5')}</button>
						</span>
					`).join('') || '<p class="text-xs text-zinc-500">No saved commands.</p>'}
				</div>
			</form>

			<form class="rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="user-search">
				<p class="mb-3 font-semibold">Search Epic Users</p>
				<div class="grid gap-2">
					<input class="input py-2" name="prefix" placeholder="display name prefix" required />
					<button class="btn-secondary" type="submit">${icon('search')} Search</button>
				</div>
				${state.userSearchResults.length ? `<div class="mt-3 grid gap-1 text-xs text-zinc-400">${state.userSearchResults.slice(0, 10).map((user) => `<p class="break-all">${escapeHtml(user.displayName || user.id)}</p>`).join('')}</div>` : ''}
			</form>

			${renderCommandResponses()}
		</div>
	`;
}

function renderSessionHistory(sessions) {
	return `
		<div class="rounded-lg border border-white/10 bg-white/[0.035] p-3">
			<div class="mb-3 flex items-center justify-between gap-3">
				<p class="font-semibold">Session History</p>
				<button class="btn-secondary px-2 py-1 text-xs" data-action="refresh-sessions">${icon('refresh-cw', 'h-3.5 w-3.5')} Refresh</button>
			</div>
			${sessions.length ? `
				<div class="grid gap-2">
					${sessions.slice(0, 8).map((session) => `
						<div class="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-400">
							<div class="flex flex-wrap justify-between gap-2">
								<span>${escapeHtml(formatDate(session.startedAt))}</span>
								${session.isActive ? statusBadge('active', 'active') : statusBadge('offline', 'ended')}
							</div>
							<div class="mt-2 grid grid-cols-2 gap-2">
								<span>Matches: <b class="text-zinc-200">${valueOrDash(session.matches)}</b></span>
								<span>Players: <b class="text-zinc-200">${valueOrDash(session.partyMembers)}</b></span>
								<span>Kills: <b class="text-zinc-200">${valueOrDash(session.kills)}</b></span>
								<span>Deaths: <b class="text-zinc-200">${valueOrDash(session.deaths)}</b></span>
							</div>
							<p class="mt-2 break-all text-zinc-500">Session: ${escapeHtml(session.id)}</p>
							${session.ReplayUploads?.length ? `<p class="mt-1 text-fnlb-300">${session.ReplayUploads.length} replay upload(s)</p>` : ''}
							${session.SessionStats?.length ? `<p class="mt-1 text-sky-300">${session.SessionStats.length} manual console stat entry(s)</p>` : ''}
							${session.SessionMedia?.length ? `<p class="mt-1 text-amber-200">${session.SessionMedia.length} screenshot/video evidence upload(s)</p>` : ''}
						</div>
					`).join('')}
				</div>
			` : '<p class="text-xs text-zinc-500">No saved sessions yet. Refreshing bot status creates history snapshots.</p>'}

			<form class="mt-3 grid gap-2" data-form="replay-upload" enctype="multipart/form-data">
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<input class="input py-2" name="replay" type="file" accept=".replay" required />
				<button class="btn-secondary" type="submit">${icon('upload')} Upload Replay</button>
				<p class="text-xs text-zinc-500">Upload after a match and pick the matching session. The server attempts to parse eliminations/stats and keeps the file linked even if parsing fails.</p>
			</form>

			<form class="mt-3 grid gap-2 rounded-lg border border-fnlb-400/20 bg-fnlb-500/10 p-3" data-form="manual-session-stats">
				<p class="font-semibold text-fnlb-100">Console Stats Entry</p>
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<div class="grid grid-cols-2 gap-2">
					<input class="input py-2" name="kills" type="number" min="0" placeholder="Kills" />
					<input class="input py-2" name="deaths" type="number" min="0" placeholder="Deaths" />
					<input class="input py-2" name="assists" type="number" min="0" placeholder="Assists" />
					<input class="input py-2" name="placement" type="number" min="1" placeholder="Placement" />
					<input class="input py-2" name="matches" type="number" min="0" placeholder="Matches" />
					<input class="input py-2" name="wins" type="number" min="0" placeholder="Wins" />
				</div>
				<input class="input py-2" name="notes" placeholder="Notes / proof link" />
				<button class="btn-primary" type="submit">${icon('save')} Save Console Stats</button>
			</form>

			<form class="mt-3 grid gap-2" data-form="session-media" enctype="multipart/form-data">
				<select class="input py-2" name="sessionId">
					${sessions.map((session) => `<option value="${session.id}">${escapeHtml(formatDate(session.startedAt))} / ${session.isActive ? 'active' : 'ended'}</option>`).join('')}
				</select>
				<input class="input py-2" name="media" type="file" accept="image/*,video/*" required />
				<input class="input py-2" name="notes" placeholder="Capture notes" />
				<button class="btn-secondary" type="submit">${icon('image-plus')} Upload Console Capture</button>
				<p class="text-xs text-zinc-500">For PS5/Xbox users: save a screenshot or short clip to your phone with the console app, then upload it here as evidence for this session.</p>
			</form>
		</div>
	`;
}

function renderCommandResponses() {
	if (!state.commandResponses.length) return '';
	return `
		<div class="rounded-lg border border-white/10 bg-black/30 p-3">
			<p class="mb-2 text-sm font-semibold">Recent API Responses</p>
			<div class="grid gap-2 text-xs">
				${state.commandResponses.slice(-6).reverse().map((response) => `
					<div class="${logStyles[response.format] || 'text-zinc-300'}">
						<span class="text-zinc-600">${escapeHtml(formatDate(response.createdAt))}</span>
						<span>${escapeHtml(response.content || response.nonce || 'OK')}</span>
					</div>
				`).join('')}
			</div>
		</div>
	`;
}

function renderCategories() {
	if (!dashboardAvailable()) {
		return `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">${usingLocalFnbr() ? 'Save Epic device auth or a one-time authorization code in Config to load your local loadout category.' : 'Save your FNLB API token in Config to load categories.'}</div>`;
	}
	return `
		<div class="grid gap-4">
			<div class="flex justify-end">
				<button class="btn-secondary" data-action="refresh-dashboard">${icon('refresh-cw')} Refresh</button>
			</div>
			<div class="grid gap-3 xl:grid-cols-2">
				${state.categories.length ? state.categories.map(renderCategoryCard).join('') : `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No categories returned by ${usingLocalFnbr() ? 'the local runtime' : 'FNLB'}.</div>`}
			</div>
		</div>
	`;
}

function renderItems() {
	const categoryOptions = state.categories
		.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name || category.id)}</option>`)
		.join('');
	return `
		<div class="grid gap-4">
			<section class="shell-panel rounded-lg p-4">
				<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="font-semibold">Realtime Equip To ${usingLocalFnbr() ? 'Local Bot' : 'FNLB Category'}</p>
						<p class="mt-1 text-sm text-zinc-500">${usingLocalFnbr() ? 'Pick the local loadout slot, then click Equip. If the bot is online, fnbr applies the cosmetic immediately without restart.' : 'Pick a category and slot, then click Equip on an item. This patches FNLB category config immediately without restarting your local bot cluster.'}</p>
					</div>
					<button class="btn-secondary" data-action="refresh-dashboard" type="button">${icon('refresh-cw')} Refresh Loadouts</button>
				</div>
				<div class="grid gap-3 md:grid-cols-[1fr_180px_160px]">
					<select class="input" id="item-equip-category" ${categoryOptions ? '' : 'disabled'}>
						${categoryOptions || '<option>No loadouts loaded</option>'}
					</select>
					<select class="input" id="item-equip-slot">
						<option value="startOutfit">Start outfit</option>
						<option value="startBackpack">Start backpack</option>
						<option value="startPickaxe">Start pickaxe</option>
						<option value="startShoes">Start shoes</option>
						<option value="joinEmote">Join emote</option>
						<option value="memberJoinEmote">Member join emote</option>
					</select>
					<select class="input" id="item-equip-mode">
						<option value="replace">Replace slot</option>
						<option value="append">Add to rotation</option>
					</select>
				</div>
			</section>
			<form class="shell-panel rounded-lg p-4" data-form="item-search">
				<div class="grid gap-3 md:grid-cols-[1fr_180px_120px]">
					<input class="input" name="q" placeholder="Search cosmetics, e.g. Renegade Raider, Star Wand" required />
					<select class="input" name="type">
						<option value="">Any type</option>
						<option value="outfit">Outfit</option>
						<option value="backpack">Backpack</option>
						<option value="pickaxe">Pickaxe</option>
						<option value="emote">Emote</option>
						<option value="shoes">Shoes</option>
					</select>
					<button class="btn-primary" type="submit">${icon('search')} Search</button>
				</div>
			</form>
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				${state.itemSearchResults.length ? state.itemSearchResults.map((item) => `
					<div class="rounded-lg border border-white/10 bg-black/25 p-4">
						<div class="aspect-square rounded-lg border border-white/10 bg-white/[0.04] p-3">
							${item.image ? `<img class="h-full w-full object-contain" src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : ''}
						</div>
						<p class="mt-3 font-semibold">${escapeHtml(item.name)}</p>
						<p class="mt-1 text-xs text-zinc-500">${escapeHtml(item.type || 'Item')} / ${escapeHtml(item.rarity || 'Unknown')}</p>
						<p class="mt-2 break-all rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-xs text-fnlb-200">${escapeHtml(item.id)}</p>
						<button class="btn-primary mt-3 w-full" data-action="equip-item" data-item-id="${escapeHtml(item.id)}" type="button" ${categoryOptions ? '' : 'disabled'}>${icon('shirt')} Equip</button>
					</div>
				`).join('') : `<div class="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">Search Fortnite cosmetics to get item IDs for ${usingLocalFnbr() ? 'local fnbr cosmetics and commands' : 'FNLB category cosmetics and commands'}.</div>`}
			</div>
		</div>
	`;
}

function renderCategoryCard(category) {
	const config = category.config || {};
	const ids = (rows) => (Array.isArray(rows) ? rows.map((item) => item.id).filter(Boolean).join(',') : '');
	return `
		<div class="rounded-lg border border-white/10 bg-black/25 p-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="font-semibold">${escapeHtml(category.name || category.id)}</p>
					<p class="mt-1 break-all text-xs text-zinc-500">${escapeHtml(category.id)}</p>
				</div>
				${category.isDisabled ? statusBadge('error', 'disabled') : statusBadge('active', 'active')}
			</div>
			<div class="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
				<p>Flags: <span class="text-zinc-200">${escapeHtml(category.flagsList?.join(', ') || 'None')}</span></p>
				<p>Managed: <span class="text-zinc-200">${category.isManaged ? 'Yes' : 'No'}</span></p>
				<p>Privacy: <span class="text-zinc-200">${valueOrDash(config.privacy)}</span></p>
				<p>Status lines: <span class="text-zinc-200">${count(config.statusText?.length)}</span></p>
				<p>Admins: <span class="text-zinc-200">${count(config.admins?.length)}</span></p>
				<p>Whitelist: <span class="text-zinc-200">${count(config.whitelistUsers?.length)}</span></p>
				<p>Blacklist: <span class="text-zinc-200">${count(config.blacklistUsers?.length)}</span></p>
				<p>Start banned bots: <span class="text-zinc-200">${config.startBannedBots ? 'Yes' : 'No'}</span></p>
				<p>Accept invites: <span class="text-zinc-200">${config.acceptInvites ? 'Yes' : 'No'}</span></p>
				<p>Accept friend requests: <span class="text-zinc-200">${config.acceptFriendRequests ? 'Yes' : 'No'}</span></p>
			</div>
			<form class="mt-4 grid gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3" data-form="category-cosmetics" data-category-id="${escapeHtml(category.id)}">
				<p class="font-semibold">Start / Join Cosmetics</p>
				<input class="input py-2" name="startOutfit" placeholder="Start outfit IDs" value="${escapeHtml(ids(config.startOutfit))}" />
				<input class="input py-2" name="startBackpack" placeholder="Start backpack IDs" value="${escapeHtml(ids(config.startBackpack))}" />
				<input class="input py-2" name="startPickaxe" placeholder="Start pickaxe IDs" value="${escapeHtml(ids(config.startPickaxe))}" />
				<input class="input py-2" name="startShoes" placeholder="Start shoes IDs" value="${escapeHtml(ids(config.startShoes))}" />
				<input class="input py-2" name="joinEmote" placeholder="Join emote IDs" value="${escapeHtml(ids(config.joinEmote))}" />
				<button class="btn-secondary" type="submit">${icon('save')} Save Cosmetics</button>
				<p class="text-xs text-zinc-500">Use the Items page to find exact Fortnite cosmetic IDs. ${usingLocalFnbr() ? 'Changes save to SQLite and apply live through fnbr when the bot is online.' : 'Changes apply through FNLB category config.'}</p>
			</form>
		</div>
	`;
}

function renderProfile() {
	return `
		<div class="grid gap-4">
			<section class="grid gap-3 md:grid-cols-3">
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Username</p>
					<p class="mt-2 text-xl font-bold">${escapeHtml(state.user.username)}</p>
				</div>
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Email</p>
					<p class="mt-2 break-all text-lg font-bold">${escapeHtml(state.user.email)}</p>
				</div>
				<div class="card">
					<p class="text-xs uppercase text-zinc-500">Role</p>
					<p class="mt-2 text-xl font-bold">${escapeHtml(state.user.role)}</p>
				</div>
			</section>

			<section class="shell-panel overflow-hidden rounded-lg">
				<div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div class="flex items-center gap-2 font-semibold">${icon('terminal')} Your Runtime Logs</div>
					<button class="btn-secondary" data-action="clear-logs">${icon('trash-2')} Clear</button>
				</div>
				<div id="profile-log" class="h-[520px] overflow-auto bg-black/35 p-4 font-mono text-xs leading-5">
					${state.logs.length ? state.logs.map((log) => `
						<div class="${logStyles[log.format] || logStyles[0]}">
							<span class="text-zinc-600">${escapeHtml(formatDate(log.createdAt))}</span>
							<span>${escapeHtml(log.content)}</span>
						</div>
					`).join('') : '<div class="text-zinc-500">No runtime output yet.</div>'}
				</div>
			</section>
		</div>
	`;
}

function renderConfig() {
	const config = state.config || {};
	return `
		<form data-form="config" class="grid gap-4 xl:grid-cols-[1fr_360px]">
			<section class="shell-panel rounded-lg p-4 sm:p-6">
				<div class="grid gap-4 md:grid-cols-2">
					<label class="md:col-span-2">
						<span class="label">Bot Engine</span>
						<select class="input" name="runtimeMode">
							<option value="fnbr" ${config.runtimeMode !== 'fnlb' ? 'selected' : ''}>Local fnbr.js bot system</option>
							<option value="fnlb" ${config.runtimeMode === 'fnlb' ? 'selected' : ''}>Legacy FNLB cloud API/runtime</option>
						</select>
					</label>
					<label class="md:col-span-2">
						<span class="label">One-time Epic Authorization Code</span>
						<input class="input" name="authorizationCode" type="password" autocomplete="off" placeholder="${config.authorizationCodeConfigured ? 'Saved authorization code pending use' : 'Paste 32 character code from Epic login redirect'}" />
					</label>
					<label>
						<span class="label">Device Auth Account ID</span>
						<input class="input" name="deviceAuthAccountId" autocomplete="off" placeholder="${config.deviceAuthConfigured ? `Saved: ${escapeHtml(config.deviceAuthMasked)}` : 'accountId'}" />
					</label>
					<label>
						<span class="label">Device Auth Device ID</span>
						<input class="input" name="deviceAuthDeviceId" autocomplete="off" placeholder="deviceId" />
					</label>
					<label class="md:col-span-2">
						<span class="label">Device Auth Secret</span>
						<input class="input" name="deviceAuthSecret" type="password" autocomplete="off" placeholder="secret" />
					</label>
					<label>
						<span class="label">Platform</span>
						<select class="input" name="platform">
							${['WIN', 'MAC', 'PSN', 'PS5', 'XBL', 'XSX', 'SWT', 'SWT2', 'IOS', 'AND', 'LUNA'].map((platform) => `<option value="${platform}" ${config.platform === platform ? 'selected' : ''}>${platform}</option>`).join('')}
						</select>
					</label>
					<label>
						<span class="label">Default Status</span>
						<input class="input" name="defaultStatus" value="${escapeHtml(config.defaultStatus || '')}" placeholder="Battle Royale Lobby - 1 / 16" />
					</label>
					<label class="md:col-span-2">
						<span class="label">Legacy FNLB API Token</span>
						<input class="input" name="apiToken" type="password" autocomplete="off" placeholder="${config.apiTokenConfigured ? `Saved: ${escapeHtml(config.apiTokenMasked)}` : 'API token'}" />
					</label>
					<label class="md:col-span-2">
						<span class="label">Legacy FNLB Categories</span>
						<input class="input" name="categories" value="${escapeHtml(config.categories || '')}" placeholder="123456789,987654321" />
					</label>
					<label class="md:col-span-2">
						<span class="label">Cluster Name</span>
						<input class="input" name="clusterName" value="${escapeHtml(config.clusterName || 'Local fnbr Cluster')}" required />
					</label>
					<label>
						<span class="label">Number of Shards</span>
						<input class="input" name="numberOfShards" type="number" min="1" max="64" value="${escapeHtml(config.numberOfShards ?? 2)}" required />
					</label>
					<label>
						<span class="label">Bots per Shard</span>
						<input class="input" name="botsPerShard" type="number" min="1" max="256" value="${escapeHtml(config.botsPerShard ?? 32)}" required />
					</label>
					<label>
						<span class="label">Restart Interval Seconds</span>
						<input class="input" name="restartInterval" type="number" min="60" max="604800" value="${escapeHtml(config.restartInterval ?? 3600)}" required />
					</label>
					<label>
						<span class="label">Log Level</span>
						<select class="input" name="logLevel">
							<option value="INFO" ${config.logLevel !== 'DEBUG' ? 'selected' : ''}>INFO</option>
							<option value="DEBUG" ${config.logLevel === 'DEBUG' ? 'selected' : ''}>DEBUG</option>
						</select>
					</label>
				</div>
			</section>

			<aside class="grid content-start gap-4">
				<div class="card">
					<p class="mb-4 font-semibold">Privacy</p>
					<label class="mb-3 flex items-center justify-between gap-3 text-sm">
						<span>Hide usernames in logs</span>
						<input class="h-5 w-5 accent-fnlb-500" name="hideUsernames" type="checkbox" ${config.hideUsernames ? 'checked' : ''} />
					</label>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>Hide emails in logs</span>
						<input class="h-5 w-5 accent-fnlb-500" name="hideEmails" type="checkbox" ${config.hideEmails ? 'checked' : ''} />
					</label>
				</div>
				<div class="card">
					<p class="mb-4 font-semibold">Updates</p>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>${usingLocalFnbr() ? 'Restart local fnbr bot on schedule' : 'Force FNLB update check before every restart'}</span>
						<input class="h-5 w-5 accent-fnlb-500" name="autoUpdateOnRestart" type="checkbox" ${config.autoUpdateOnRestart !== false ? 'checked' : ''} />
					</label>
				</div>
				<div class="card">
					<p class="mb-4 font-semibold">Epic Sessions</p>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>Kill other Fortnite tokens on login</span>
						<input class="h-5 w-5 accent-fnlb-500" name="killOtherTokens" type="checkbox" ${config.killOtherTokens ? 'checked' : ''} />
					</label>
					<label class="mt-3 flex items-center justify-between gap-3 text-sm">
						<span>Clear saved device auth</span>
						<input class="h-5 w-5 accent-fnlb-500" name="clearDeviceAuth" type="checkbox" />
					</label>
					<p class="mt-3 text-xs text-zinc-500">Leave off unless this bot account is only used by this server. Turning it on can kick other active sessions for that Epic account.</p>
				</div>
				<button class="btn-primary w-full" type="submit">${icon('save')} Save Config</button>
			</aside>
		</form>
	`;
}

function renderAdmin() {
	return `
		<div class="grid gap-4">
			<div class="grid gap-3 md:grid-cols-3">
				<div class="card"><p class="text-xs uppercase text-zinc-500">Users</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.users ?? 0)}</p></div>
				<div class="card"><p class="text-xs uppercase text-zinc-500">Admins</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.admins ?? 0)}</p></div>
				<div class="card"><p class="text-xs uppercase text-zinc-500">Suspended</p><p class="mt-2 text-2xl font-bold">${escapeHtml(state.adminOverview?.suspended ?? 0)}</p></div>
			</div>
			<section class="shell-panel overflow-hidden rounded-lg">
				<div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div class="flex items-center gap-2 font-semibold">${icon('users')} Users</div>
					<button class="btn-secondary" data-action="admin-refresh">${icon('refresh-cw')} Refresh</button>
				</div>
				<div class="overflow-x-auto">
					<table class="min-w-full text-left text-sm">
						<thead class="bg-black/30 text-xs uppercase text-zinc-500">
							<tr>
								<th class="px-4 py-3">User</th>
								<th class="px-4 py-3">Role</th>
								<th class="px-4 py-3">Status</th>
								<th class="px-4 py-3">Cluster</th>
								<th class="px-4 py-3">Suspend</th>
								<th class="px-4 py-3">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-white/10">
							${state.adminUsers.map(renderAdminUser).join('') || '<tr><td class="px-4 py-4 text-zinc-500" colspan="6">No users.</td></tr>'}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	`;
}

function renderAdminUser(user) {
	const suspended = user.status === 'suspended';
	return `
		<tr>
			<td class="px-4 py-4">
				<p class="font-semibold">${escapeHtml(user.username)}</p>
				<p class="text-xs text-zinc-500">${escapeHtml(user.email)}</p>
			</td>
			<td class="px-4 py-4">
				<div class="flex gap-2">
					<button class="btn-secondary px-2 py-1 text-xs ${user.role === 'admin' ? 'ring-1 ring-fnlb-400/30' : ''}" data-admin-action="role-admin" data-user-id="${user.id}">Admin</button>
					<button class="btn-secondary px-2 py-1 text-xs ${user.role === 'user' ? 'ring-1 ring-fnlb-400/30' : ''}" data-admin-action="role-user" data-user-id="${user.id}">User</button>
				</div>
			</td>
			<td class="px-4 py-4">
				${statusBadge(suspended ? 'suspended' : 'active', suspended ? 'suspended' : 'active')}
				<p class="mt-2 text-xs text-zinc-500">${suspended ? `${user.suspendedUntil ? `Until ${escapeHtml(formatDate(user.suspendedUntil))}` : 'Permanent'}${user.suspendedReason ? ` / ${escapeHtml(user.suspendedReason)}` : ''}` : 'Clear'}</p>
			</td>
			<td class="px-4 py-4">
				${statusBadge(user.runtime?.status || 'offline')}
				<p class="mt-2 text-xs text-zinc-500">${escapeHtml(user.runtimeMode || 'fnbr')} / Device auth ${user.deviceAuthConfigured ? 'saved' : 'missing'} / FNLB token ${user.apiTokenConfigured ? 'saved' : 'missing'}</p>
			</td>
			<td class="min-w-[280px] px-4 py-4">
				<div class="grid gap-2">
					<input class="input py-1 text-xs" data-suspend-until="${user.id}" type="datetime-local" value="${tomorrowLocalInput()}" />
					<input class="input py-1 text-xs" data-suspend-reason="${user.id}" placeholder="Reason" />
					<div class="flex flex-wrap gap-2">
						<button class="btn-secondary px-2 py-1 text-xs" data-admin-action="suspend-temp" data-user-id="${user.id}">${icon('clock', 'h-3.5 w-3.5')} Temp</button>
						<button class="btn-danger px-2 py-1 text-xs" data-admin-action="suspend-perm" data-user-id="${user.id}">${icon('ban', 'h-3.5 w-3.5')} Permanent</button>
						<button class="btn-secondary px-2 py-1 text-xs" data-admin-action="activate" data-user-id="${user.id}">${icon('check', 'h-3.5 w-3.5')} Activate</button>
					</div>
				</div>
			</td>
			<td class="px-4 py-4">
				<div class="flex gap-2">
					<button class="btn-primary px-2 py-1 text-xs" data-admin-action="start" data-user-id="${user.id}" ${runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('power', 'h-3.5 w-3.5')}</button>
					<button class="btn-danger px-2 py-1 text-xs" data-admin-action="stop" data-user-id="${user.id}" ${!runtimeOnlineFor(user) ? 'disabled' : ''}>${icon('square', 'h-3.5 w-3.5')}</button>
				</div>
			</td>
		</tr>
	`;
}

function render() {
	app.innerHTML = state.user ? renderShell() : renderAuth();
	window.lucide?.createIcons();
	const profileLog = document.querySelector('#profile-log');
	if (profileLog) profileLog.scrollTop = profileLog.scrollHeight;
}

async function loadSession() {
	const data = await api('/api/session');
	state.user = data.user;
	state.runtime = data.runtime || { status: 'offline' };
	if (state.user?.status === 'suspended') {
		state.user = null;
		throw new Error('This account is suspended.');
	}
}

async function loadMe() {
	if (!state.user) return;
	const data = await api('/api/me');
	state.user = data.user;
	state.config = data.config;
	state.runtime = data.runtime;
}

async function loadLogs() {
	const data = await api('/api/bot/logs');
	state.logs = data.logs || [];
}

async function loadQuickCommands() {
	const data = await api('/api/quick-commands');
	state.quickCommands = data.commands || [];
}

async function loadDashboard(shouldRender = true) {
	if (!dashboardAvailable()) return;
	const data = await api('/api/fnlb/dashboard');
	state.dashboard = data;
	state.bots = data.bots || [];
	state.stats = data.stats || null;
	state.categories = data.categories || [];
	if (shouldRender) render();
}

async function loadBotDetails(botId, shouldRender = true) {
	if (!botId) return;
	state.selectedBotId = botId;
	const data = await api(`/api/fnlb/bots/${encodeURIComponent(botId)}/details`);
	state.selectedBotDetails = data;
	if (shouldRender) render();
}

async function loadAdmin() {
	if (state.user?.role !== 'admin') return;
	const [overview, users] = await Promise.all([
		api('/api/admin/overview'),
		api('/api/admin/users')
	]);
	state.adminOverview = overview;
	state.adminUsers = users.users || [];
}

function connectSocket() {
	if (state.socket || !state.user) return;
	state.socket = io();
	state.socket.on('bot:status', (runtime) => {
		state.runtime = runtime;
		render();
	});
	state.socket.on('bot:log', (log) => {
		state.logs.push(log);
		if (state.logs.length > 250) state.logs.shift();
		if (state.view === 'profile') render();
	});
}

function disconnectSocket() {
	if (!state.socket) return;
	state.socket.disconnect();
	state.socket = null;
}

async function refreshAfterAuth() {
	await loadMe();
	await Promise.all([loadLogs(), loadQuickCommands()]);
	if (state.user?.role === 'admin') await loadAdmin();
	if (dashboardAvailable()) await loadDashboard(false).catch((error) => setToast(error.message, 'error'));
	connectSocket();
	render();
}

function pushApiResponse(response) {
	state.commandResponses.push({
		createdAt: new Date().toISOString(),
		format: Number(response?.format ?? 1),
		content: response?.content || response?.botName || response?.nonce || 'OK'
	});
	if (state.commandResponses.length > 20) state.commandResponses.shift();
}

document.addEventListener('click', async (event) => {
	const authMode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
	if (authMode) {
		state.authMode = authMode;
		render();
		return;
	}

	const view = event.target.closest('[data-view]')?.dataset.view;
	if (view) {
		state.view = view;
		try {
			if (view === 'admin') await loadAdmin();
			if ((view === 'status' || view === 'categories' || view === 'items') && !state.dashboard) await loadDashboard(false);
		} catch (error) {
			setToast(error.message, 'error');
		}
		render();
		return;
	}

	const botButton = event.target.closest('[data-bot-id]');
	if (botButton) {
		try {
			state.userSearchResults = [];
			state.commandResponses = [];
			state.selectedBotDetails = null;
			state.selectedBotId = botButton.dataset.botId;
			render();
			await loadBotDetails(botButton.dataset.botId);
		} catch (error) {
			setToast(error.message, 'error');
		}
		return;
	}

	const button = event.target.closest('[data-action], [data-admin-action]');
	if (!button) return;
	const action = button.dataset.action;
	const adminAction = button.dataset.adminAction;

	try {
		if (action === 'toggle-auto-refresh') {
			state.autoRefresh = button.checked;
			return;
		}
		if (action === 'logout') {
			await api('/api/auth/logout', { method: 'POST', body: {} });
			state.user = null;
			state.config = null;
			state.logs = [];
			state.dashboard = null;
			state.bots = [];
			state.selectedBotId = null;
			state.selectedBotDetails = null;
			disconnectSocket();
			render();
		}
		if (action === 'start') {
			state.busy = true;
			await api('/api/bot/start', { method: 'POST', body: {} });
			await loadMe();
			setToast('Cluster start requested.');
		}
		if (action === 'stop') {
			state.busy = true;
			await api('/api/bot/stop', { method: 'POST', body: {} });
			await loadMe();
			setToast('Cluster stopped.');
		}
		if (action === 'clear-logs') {
			await api('/api/bot/logs', { method: 'DELETE', body: {} });
			state.logs = [];
			render();
		}
		if (action === 'refresh-dashboard') {
			await loadDashboard(false);
			if (state.selectedBotId) await loadBotDetails(state.selectedBotId, false);
			render();
		}
		if (action === 'equip-item') {
			const categoryId = document.querySelector('#item-equip-category')?.value;
			const slot = document.querySelector('#item-equip-slot')?.value;
			const mode = document.querySelector('#item-equip-mode')?.value || 'replace';
			const itemId = button.dataset.itemId;
			if (!categoryId || !itemId) throw new Error('Choose a category and item first.');
			await api(`/api/fnlb/categories/${encodeURIComponent(categoryId)}/cosmetics`, {
				method: 'PATCH',
				body: { slot, itemId, mode }
			});
			await loadDashboard(false);
			setToast(usingLocalFnbr() ? 'Item equipped through local fnbr runtime.' : 'Item equipped to FNLB category. No bot restart was requested.');
			render();
		}
		if (action === 'close-bot-detail') {
			state.selectedBotId = null;
			state.selectedBotDetails = null;
			state.userSearchResults = [];
			state.commandResponses = [];
			render();
		}
		if (action === 'refresh-selected-bot') {
			await loadBotDetails(state.selectedBotId);
		}
		if (action === 'refresh-sessions') {
			await loadBotDetails(state.selectedBotId);
		}
		if (action === 'toggle-bot-disabled') {
			const disabled = button.dataset.disabled === 'true';
			await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}`, {
				method: 'PATCH',
				body: { disabled }
			});
			await loadDashboard(false);
			await loadBotDetails(state.selectedBotId, false);
			setToast(disabled ? 'Bot disabled.' : 'Bot enabled.');
			render();
		}
		if (action === 'run-quick-command') {
			const command = state.quickCommands.find((item) => item.id === button.dataset.commandId);
			if (!command) return;
			const result = await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/commands/run`, {
				method: 'POST',
				body: { command: command.command, args: command.args || '', locale: command.locale || 'en' }
			});
			pushApiResponse(result);
			render();
		}
		if (action === 'delete-quick-command') {
			await api(`/api/quick-commands/${button.dataset.commandId}`, { method: 'DELETE', body: {} });
			await loadQuickCommands();
			render();
		}
		if (action === 'admin-refresh') {
			await loadAdmin();
			render();
		}
		if (adminAction) {
			await handleAdminAction(adminAction, button.dataset.userId);
		}
	} catch (error) {
		setToast(error.message, 'error');
	} finally {
		state.busy = false;
	}
});

document.addEventListener('submit', async (event) => {
	const form = event.target.closest('[data-form]');
	if (!form) return;
	event.preventDefault();
	const data = Object.fromEntries(new FormData(form).entries());

	try {
		state.busy = true;
		if (form.dataset.form === 'login') {
			const result = await api('/api/auth/login', { method: 'POST', body: data });
			state.user = result.user;
			await refreshAfterAuth();
		}
		if (form.dataset.form === 'register') {
			const result = await api('/api/auth/register', { method: 'POST', body: data });
			state.user = result.user;
			await refreshAfterAuth();
		}
		if (form.dataset.form === 'forgot') {
			const result = await api('/api/auth/forgot-password', { method: 'POST', body: { email: data.email } });
			state.authMode = 'login';
			setToast(result.message || 'If that email exists, a reset link has been sent.');
			render();
		}
		if (form.dataset.form === 'reset') {
			if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
			const result = await api('/api/auth/reset-password', {
				method: 'POST',
				body: { token: data.token, password: data.password }
			});
			state.resetToken = null;
			state.authMode = 'login';
			clearResetTokenFromUrl();
			setToast(result.message || 'Password reset. You can now sign in.');
			render();
		}
		if (form.dataset.form === 'config') {
			const payload = {
				runtimeMode: data.runtimeMode || 'fnbr',
				apiToken: data.apiToken || '',
				authorizationCode: data.authorizationCode || '',
				deviceAuthAccountId: data.deviceAuthAccountId || '',
				deviceAuthDeviceId: data.deviceAuthDeviceId || '',
				deviceAuthSecret: data.deviceAuthSecret || '',
				categories: data.categories,
				clusterName: data.clusterName,
				defaultStatus: data.defaultStatus,
				platform: data.platform,
				killOtherTokens: Boolean(data.killOtherTokens),
				clearDeviceAuth: Boolean(data.clearDeviceAuth),
				numberOfShards: data.numberOfShards,
				botsPerShard: data.botsPerShard,
				restartInterval: data.restartInterval,
				hideUsernames: Boolean(data.hideUsernames),
				hideEmails: Boolean(data.hideEmails),
				autoUpdateOnRestart: Boolean(data.autoUpdateOnRestart),
				logLevel: data.logLevel
			};
			const result = await api('/api/config', { method: 'PUT', body: payload });
			state.config = result.config;
			state.runtime = result.runtime;
			state.dashboard = null;
			setToast('Config saved.');
			render();
		}
		if (form.dataset.form === 'command-run') {
			const result = await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/commands/run`, {
				method: 'POST',
				body: data
			});
			pushApiResponse(result);
			form.reset();
			render();
		}
		if (form.dataset.form === 'chat-send') {
			const result = await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/chat/messages`, {
				method: 'POST',
				body: data
			});
			pushApiResponse(result);
			form.reset();
			render();
		}
		if (form.dataset.form === 'quick-command-create') {
			await api('/api/quick-commands', { method: 'POST', body: { ...data, locale: data.locale || 'en' } });
			await loadQuickCommands();
			form.reset();
			render();
		}
		if (form.dataset.form === 'user-search') {
			const result = await api(
				`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/users/search?prefix=${encodeURIComponent(data.prefix)}`
			);
			state.userSearchResults = result.users || [];
			render();
		}
		if (form.dataset.form === 'bot-action') {
			const result = await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/actions`, {
				method: 'POST',
				body: data
			});
			pushApiResponse(result);
			render();
		}
		if (form.dataset.form === 'replay-upload') {
			const formData = new FormData(form);
			const response = await fetch(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/replays`, {
				method: 'POST',
				body: formData
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(result.error || 'Replay upload failed.');
			state.selectedBotDetails.sessions = result.sessions || [];
			setToast(result.replay?.parsed ? 'Replay parsed and linked to the session.' : `Replay saved. Parser note: ${result.replay?.parseError || 'not parsed'}`);
			render();
		}
		if (form.dataset.form === 'manual-session-stats') {
			const result = await api(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/session-stats`, {
				method: 'POST',
				body: data
			});
			state.selectedBotDetails.sessions = result.sessions || [];
			setToast('Console stats saved to the selected session.');
			render();
		}
		if (form.dataset.form === 'session-media') {
			const formData = new FormData(form);
			const response = await fetch(`/api/fnlb/bots/${encodeURIComponent(state.selectedBotId)}/session-media`, {
				method: 'POST',
				body: formData
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(result.error || 'Media upload failed.');
			state.selectedBotDetails.sessions = result.sessions || [];
			setToast('Console capture linked to the selected session.');
			render();
		}
		if (form.dataset.form === 'item-search') {
			const result = await api(`/api/fortnite/items?q=${encodeURIComponent(data.q)}&type=${encodeURIComponent(data.type || '')}`);
			state.itemSearchResults = result.items || [];
			render();
		}
		if (form.dataset.form === 'category-cosmetics') {
			const categoryId = form.dataset.categoryId;
			await api(`/api/fnlb/categories/${encodeURIComponent(categoryId)}/cosmetics`, {
				method: 'PATCH',
				body: data
			});
			await loadDashboard(false);
			setToast(usingLocalFnbr() ? 'Local loadout saved and applied when the bot is online.' : 'Category cosmetics saved to FNLB. No bot restart was requested.');
			render();
		}
	} catch (error) {
		setToast(error.message, 'error');
	} finally {
		state.busy = false;
	}
});

document.addEventListener('change', (event) => {
	const autoRefresh = event.target.closest('[data-action="toggle-auto-refresh"]');
	if (autoRefresh) state.autoRefresh = autoRefresh.checked;
});

async function handleAdminAction(action, userId) {
	if (!userId) return;
	if (action === 'role-admin' || action === 'role-user') {
		await api(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			body: { role: action === 'role-admin' ? 'admin' : 'user' }
		});
	}
	if (action === 'activate') {
		await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: { status: 'active' } });
	}
	if (action === 'suspend-temp') {
		const until = document.querySelector(`[data-suspend-until="${userId}"]`)?.value;
		const reason = document.querySelector(`[data-suspend-reason="${userId}"]`)?.value;
		await api(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			body: {
				status: 'suspended',
				suspendedUntil: until ? new Date(until).toISOString() : null,
				suspendedReason: reason || null
			}
		});
	}
	if (action === 'suspend-perm') {
		const reason = document.querySelector(`[data-suspend-reason="${userId}"]`)?.value;
		await api(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			body: { status: 'suspended', suspendedUntil: null, suspendedReason: reason || null }
		});
	}
	if (action === 'start') {
		await api(`/api/admin/users/${userId}/bot/start`, { method: 'POST', body: {} });
	}
	if (action === 'stop') {
		await api(`/api/admin/users/${userId}/bot/stop`, { method: 'POST', body: {} });
	}
	await loadAdmin();
	setToast('Admin change saved.');
	render();
}

setInterval(async () => {
	if (!state.user || !state.autoRefresh || !dashboardAvailable()) return;
	if (!['status', 'categories'].includes(state.view)) return;
	try {
		await loadDashboard(false);
		if (state.selectedBotId) await loadBotDetails(state.selectedBotId, false);
		render();
	} catch {
		// Keep polling quiet; manual refresh surfaces API errors.
	}
}, 15000);

(async function init() {
	try {
		// A password reset link always takes priority over any existing session.
		if (detectResetToken()) {
			render();
			return;
		}
		await loadSession();
		if (state.user) await refreshAfterAuth();
		else render();
	} catch (error) {
		setToast(error.message, 'error');
		render();
	}
})();
