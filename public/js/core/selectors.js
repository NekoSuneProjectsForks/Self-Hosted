import { state } from './state.js';
import { escapeHtml, icon } from './ui.js';

export function detectResetToken() {
	const params = new URLSearchParams(window.location.search);
	const token = params.get('reset_token');
	if (token) {
		state.resetToken = token;
		state.authMode = 'reset';
		return true;
	}
	return false;
}

export function clearResetTokenFromUrl() {
	const url = new URL(window.location.href);
	url.searchParams.delete('reset_token');
	window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function runtimeOnline() {
	return ['starting', 'online', 'restarting', 'stopping'].includes(state.runtime?.status);
}

export function runtimeOnlineFor(user) {
	return ['starting', 'online', 'restarting', 'stopping'].includes(user.runtime?.status);
}

export function usingLocalFnbr() {
	// Follow the engine that is actually running. Only fall back to the saved
	// config when nothing is online, otherwise the UI can end up rendering for a
	// different engine than the one the bot is on.
	const active = state.runtime?.activeMode;
	if (active) return active !== 'fnlb';
	return state.config?.runtimeMode !== 'fnlb';
}

export function restartRequiredBanner() {
	if (!state.runtime?.restartRequired) return '';
	const reason = state.runtime.restartReason || 'Restart required to apply the new configuration';
	return `
		<div class="mb-4 flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-semibold">Configuration changed</p>
				<p class="text-sm text-amber-200/90">${escapeHtml(reason)}</p>
			</div>
			<button class="btn-secondary shrink-0" data-action="restart">${icon('refresh-cw')} Restart Now</button>
		</div>`;
}

export function authRequiredBanner() {
	if (state.runtime?.status !== 'auth_required' && !state.runtime?.authRequired) return '';
	return `
		<div class="mb-4 flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-semibold">Authentication Required</p>
				<p class="text-sm text-amber-200/90">${escapeHtml(state.runtime?.lastError || 'Epic rejected the login. Sign in again.')}</p>
			</div>
			<div class="flex shrink-0 flex-wrap gap-2">
				<button class="btn-primary" data-action="epic-code-prompt" data-epic-target="main">${icon('log-in')} Sign in again</button>
				${state.config?.deviceAuthConfigured ? `<button class="btn-secondary" data-action="clear-device-auth">${icon('key-round')} Clear Device Auth</button>` : ''}
			</div>
		</div>`;
}

export function dashboardAvailable() {
	if (!state.user || !state.config) return false;
	if (usingLocalFnbr()) {
		return state.config.deviceAuthConfigured || state.config.authorizationCodeConfigured || runtimeOnline();
	}
	return state.config.apiTokenConfigured;
}

// ---- which bot the Lobby / Friends / Messages / Matches pages control ----

const FNBR_CAPABILITIES = {
	engine: 'fnbr',
	capabilities: {
		friends: true,
		friendMessages: true,
		friendRequests: true,
		blockedUsers: true,
		party: true,
		partyChat: true,
		cosmetics: true,
		realtimeCosmetics: true,
		playlist: true,
		privacy: true,
		readiness: true,
		sittingOut: true,
		squadFill: true,
		presence: true,
		matchTracking: true,
		searchUsers: true,
		promoteMember: true,
		multiBot: true,
		matchmakingCheck: true,
		dmCommands: true,
		autoReady: true,
		playerStats: true
	}
};

/** The extra bot account currently being controlled, or null for the main bot. */
export function controlledHelper() {
	if (!state.controlBotId || !usingLocalFnbr()) return null;
	return (state.botAccounts || []).find((account) => account.accountId === state.controlBotId) || null;
}

/** Legacy FNLB: the FNLB bot picked in the bot picker (defaults to the first). */
export function controlledFnlbBot() {
	if (usingLocalFnbr()) return null;
	const bots = state.bots || [];
	return bots.find((bot) => bot.id === state.controlBotId) || bots[0] || null;
}

export function controlBotId() {
	const helper = controlledHelper();
	if (helper) return helper.accountId;
	if (!usingLocalFnbr()) return controlledFnlbBot()?.id || state.selectedBotId || null;
	return state.bots?.[0]?.id || state.selectedBotId || null;
}

export function controlOnline() {
	const helper = controlledHelper();
	return helper ? helper.status === 'online' : state.runtime?.status === 'online';
}

export function controlBot() {
	const helper = controlledHelper();
	if (helper) return helper.bot;
	if (!usingLocalFnbr()) return controlledFnlbBot();
	return state.bots?.[0] || null;
}

export function controlCapabilities() {
	return controlledHelper() ? FNBR_CAPABILITIES : state.runtime?.capabilities;
}

export function controlCan(capability) {
	return controlCapabilities()?.capabilities?.[capability] === true;
}

/** True when a socket payload belongs to the bot the pages are controlling. */
export function isControlled(botId) {
	return !botId || botId === controlBotId();
}

export function isHelperBotId(botId) {
	return Boolean(botId) && (state.botAccounts || []).some((account) => account.accountId === botId);
}
