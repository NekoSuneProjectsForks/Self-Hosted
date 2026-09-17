import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { render } from '../core/render.js';
import { dashboardAvailable } from '../core/selectors.js';

export async function loadSession() {
	const data = await api('/api/session');
	state.user = data.user;
	state.runtime = data.runtime || { status: 'offline' };
	if (state.user?.status === 'suspended') {
		state.user = null;
		throw new Error('This account is suspended.');
	}
}

export async function loadMe() {
	if (!state.user) return;
	const data = await api('/api/me');
	state.user = data.user;
	state.config = data.config;
	state.runtime = data.runtime;
}

export async function loadLogs() {
	const data = await api('/api/bot/logs');
	state.logs = data.logs || [];
}

export async function loadQuickCommands() {
	const data = await api('/api/quick-commands');
	state.quickCommands = data.commands || [];
}

export async function loadDashboard(shouldRender = true) {
	if (!dashboardAvailable()) return;
	const data = await api('/api/fnlb/dashboard');
	state.dashboard = data;
	state.bots = data.bots || [];
	state.stats = data.stats || null;
	state.categories = data.categories || [];
	if (shouldRender) render();
}

export async function loadBotDetails(botId, shouldRender = true) {
	if (!botId) return;
	state.selectedBotId = botId;
	const data = await api(`/api/fnlb/bots/${encodeURIComponent(botId)}/details`);
	state.selectedBotDetails = data;
	if (shouldRender) render();
}

export async function loadAdmin() {
	if (state.user?.role !== 'admin') return;
	const [overview, users] = await Promise.all([
		api('/api/admin/overview'),
		api('/api/admin/users')
	]);
	state.adminOverview = overview;
	state.adminUsers = users.users || [];
}

function activeBotId() {
	return state.bots?.[0]?.id || state.selectedBotId || null;
}

/** Friends, pending requests and the block list for the running bot. */
export async function loadFriends(shouldRender = true) {
	const botId = activeBotId();
	if (!botId || state.runtime?.status !== 'online') return;
	const data = await api(`/api/bots/${encodeURIComponent(botId)}/friends`);
	state.friends = {
		onlineFriends: data.onlineFriends || [],
		offlineFriends: data.offlineFriends || []
	};
	state.pendingFriends = data.pendingFriends || { incomingFriends: [], outgoingFriends: [] };
	state.blockedUsers = data.blockedUsers || [];
	if (shouldRender) render();
}

export async function loadParty(shouldRender = true) {
	const botId = activeBotId();
	if (!botId || state.runtime?.status !== 'online') return;
	const data = await api(`/api/bots/${encodeURIComponent(botId)}/party`);
	state.party = data.party || null;
	if (shouldRender) render();
}

export async function loadMatches(shouldRender = true) {
	const botId = activeBotId();
	if (!botId) return;
	const data = await api(`/api/bots/${encodeURIComponent(botId)}/matches`);
	state.matches = data.matches || [];
	state.currentMatch = data.current || null;
	if (shouldRender) render();
}

export async function loadMessages(friendId, shouldRender = true) {
	const botId = activeBotId();
	if (!botId || !friendId) return;
	const data = await api(
		`/api/bots/${encodeURIComponent(botId)}/friends/${encodeURIComponent(friendId)}/messages`
	);
	state.messages = { ...state.messages, [friendId]: data.messages || [] };
	state.unread = { ...state.unread, [friendId]: 0 };
	if (shouldRender) render();
}

export { activeBotId };
