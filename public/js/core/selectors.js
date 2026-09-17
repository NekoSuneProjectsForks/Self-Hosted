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
				<p class="text-sm text-amber-200/90">The stored Epic device auth was rejected. Clear it and sign in again with a new one-time authorization code.</p>
			</div>
			<button class="btn-secondary shrink-0" data-action="clear-device-auth">${icon('key-round')} Clear Device Auth</button>
		</div>`;
}

export function dashboardAvailable() {
	if (!state.user || !state.config) return false;
	if (usingLocalFnbr()) {
		return state.config.deviceAuthConfigured || state.config.authorizationCodeConfigured || runtimeOnline();
	}
	return state.config.apiTokenConfigured;
}
