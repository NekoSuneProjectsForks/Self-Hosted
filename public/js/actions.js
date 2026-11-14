import { state } from './core/state.js';
import { api } from './core/api.js';
import { render } from './core/render.js';
import { setToast } from './core/ui.js';
import { controlledHelper, controlOnline, dashboardAvailable, usingLocalFnbr } from './core/selectors.js';
import { connectSocket, disconnectSocket } from './core/socket.js';
import {
	activeBotId,
	loadAdmin,
	loadBotAccounts,
	loadBotDetails,
	loadDashboard,
	loadFriends,
	loadLogs,
	loadMatches,
	loadMe,
	loadMessages,
	loadParty,
	loadQuickCommands,
	loadSession
} from './data/loaders.js';
import { showEngineFields } from './views/config.js';

export function pushApiResponse(response) {
	state.commandResponses.push({
		createdAt: new Date().toISOString(),
		format: Number(response?.format ?? 1),
		content: response?.content || response?.botName || response?.nonce || 'OK'
	});
	if (state.commandResponses.length > 20) state.commandResponses.shift();
}

export async function refreshAfterAuth() {
	await loadMe();
	await Promise.all([loadLogs(), loadQuickCommands(), loadBotAccounts(false).catch(() => {})]);
	if (state.user?.role === 'admin') await loadAdmin();
	if (dashboardAvailable()) await loadDashboard(false).catch((error) => setToast(error.message, 'error'));
	connectSocket();
	await refreshLiveData().catch(() => {});
	render();
}

/** Pulls the live social/lobby slices once a bot is online. */
export async function refreshLiveData() {
	if (!controlOnline() || !activeBotId()) return;
	await Promise.allSettled([loadFriends(false), loadParty(false), loadMatches(false)]);
}

// A friends:updated socket event asks the client to refetch rather than guess.
window.addEventListener('friends:refresh', () => {
	loadFriends().catch(() => {});
});

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
			if (view === 'lobby') await loadParty(false);
			if (view === 'botlobby') await Promise.all([loadBotAccounts(false), loadParty(false).catch(() => {})]);
			if (view === 'friends' || view === 'messages') await loadFriends(false);
			if (view === 'matches') await loadMatches(false);
		} catch (error) {
			setToast(error.message, 'error');
		}
		render();
		return;
	}

	const friendButton = event.target.closest('[data-friend-id]:not([data-action])');
	if (friendButton) {
		state.selectedFriendId = friendButton.dataset.friendId;
		render();
		return;
	}

	const conversationButton = event.target.closest('[data-conversation-id]');
	if (conversationButton) {
		const friendId = conversationButton.dataset.conversationId;
		state.selectedFriendId = friendId;
		state.selectedFriendName = conversationButton.dataset.conversationName || friendId;
		render();
		try {
			await loadMessages(friendId);
		} catch (error) {
			setToast(error.message, 'error');
		}
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
		// ---- Bot Lobby (extra bot accounts) ----
		if (action && action.startsWith('botacc-') || action && action.startsWith('botlobby-')) {
			await handleBotLobbyAction(action, button);
			return;
		}

		// ---- live friend actions (no restart, act on the running bot) ----
		if (action === 'refresh-friends') {
			await loadFriends();
			return;
		}
		if (action === 'refresh-lobby') {
			await loadParty();
			return;
		}
		if (action === 'refresh-matches') {
			await loadMatches();
			return;
		}
		if (action === 'friend-open-messages') {
			state.selectedFriendId = button.dataset.friendId;
			state.view = 'messages';
			render();
			await loadMessages(button.dataset.friendId);
			return;
		}
		if (
			action === 'friend-accept' ||
			action === 'friend-decline' ||
			action === 'friend-remove' ||
			action === 'friend-block' ||
			action === 'friend-unblock'
		) {
			const friendId = button.dataset.friendId;
			const botId = activeBotId();
			const base = `/api/bots/${encodeURIComponent(botId)}/friends/${encodeURIComponent(friendId)}`;
			const routes = {
				'friend-accept': ['POST', `${base}/accept`],
				'friend-decline': ['POST', `${base}/decline`],
				'friend-remove': ['DELETE', base],
				'friend-block': ['POST', `${base}/block`],
				'friend-unblock': ['POST', `${base}/unblock`]
			};
			const [method, path] = routes[action];
			const result = await api(path, { method, body: {} });
			if (state.selectedFriendId === friendId && action !== 'friend-accept') {
				state.selectedFriendId = null;
			}
			await loadFriends(false);
			setToast(result?.content || 'Done.');
			render();
			return;
		}
		if (action === 'friend-invite') {
			const botId = activeBotId();
			await api(`/api/bots/${encodeURIComponent(botId)}/party`, {
				method: 'PATCH',
				body: { invite: button.dataset.friendId }
			});
			setToast('Party invite sent.');
			return;
		}
		if (action === 'friend-join') {
			const botId = activeBotId();
			await api(`/api/bots/${encodeURIComponent(botId)}/party`, {
				method: 'PATCH',
				body: { join: button.dataset.partyId }
			});
			await loadParty(false);
			setToast('Joined the party.');
			render();
			return;
		}

		// ---- live lobby controls ----
		const partyActions = {
			'party-ready': { ready: true },
			'party-unready': { ready: false },
			'party-sit-out': { sittingOut: true },
			'party-stop-sitting-out': { sittingOut: false },
			'party-hide': { hideMembers: true },
			'party-unhide': { hideMembers: false },
			'party-fill': { squadFill: true },
			'party-no-fill': { squadFill: false },
			'party-leave': { leave: true }
		};
		if (partyActions[action]) {
			const botId = activeBotId();
			const result = await api(`/api/bots/${encodeURIComponent(botId)}/party`, {
				method: 'PATCH',
				body: partyActions[action]
			});
			state.party = result.party || state.party;
			setToast(result.results?.[0]?.content || 'Lobby updated.');
			render();
			return;
		}
		if (action === 'party-kick' || action === 'party-promote') {
			const botId = activeBotId();
			const key = action === 'party-kick' ? 'kick' : 'promote';
			const result = await api(`/api/bots/${encodeURIComponent(botId)}/party`, {
				method: 'PATCH',
				body: { [key]: button.dataset.memberId }
			});
			state.party = result.party || state.party;
			setToast(result.results?.[0]?.content || 'Lobby updated.');
			render();
			return;
		}
		if (action === 'restart') {
			state.busy = true;
			await api('/api/bot/restart', { method: 'POST', body: {} });
			await loadMe();
			setToast('Runtime restarted with the latest configuration.');
		}
		if (action === 'clear-device-auth') {
			await api('/api/config/device-auth/clear', { method: 'POST', body: {} });
			await loadMe();
			setToast('Epic device auth cleared. Enter a new authorization code to sign in again.');
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
			const helper = controlledHelper();
			if (helper && itemId) {
				// An extra bot equips live only; the saved loadout belongs to the main bot.
				const result = await api(`/api/bots/${encodeURIComponent(helper.accountId)}/cosmetics`, {
					method: 'PATCH',
					body: { slot, itemId }
				});
				setToast(result?.content ? `${helper.label}: ${result.content}` : `Equipped on ${helper.label}.`);
				render();
				return;
			}
			if (!categoryId || !itemId) throw new Error('Choose a category and item first.');
			const equipResult = await api(`/api/fnlb/categories/${encodeURIComponent(categoryId)}/cosmetics`, {
				method: 'PATCH',
				body: { slot, itemId, mode }
			});
			await loadDashboard(false);
			// Only claim a live change when the runtime actually confirmed one.
			setToast(
				equipResult?.appliedLive
					? 'Equipped on the running bot. No restart needed.'
					: equipResult?.content ||
							'Saved as the startup loadout. It applies the next time the bot loads.'
			);
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

		// ---- live social / lobby forms (none of these need a restart) ----
		if (form.dataset.form === 'friend-add') {
			const botId = activeBotId();
			await api(`/api/bots/${encodeURIComponent(botId)}/friends`, {
				method: 'POST',
				body: { target: data.target }
			});
			form.reset();
			await loadFriends(false);
			setToast('Friend request sent.');
			render();
			return;
		}
		if (form.dataset.form === 'friend-message') {
			const botId = activeBotId();
			const friendId = state.selectedFriendId;
			if (!friendId) throw new Error('Pick a conversation first.');
			const result = await api(
				`/api/bots/${encodeURIComponent(botId)}/friends/${encodeURIComponent(friendId)}/messages`,
				{ method: 'POST', body: { content: data.content } }
			);
			form.reset();
			// The server echoes the stored message, so the thread updates without a refetch.
			if (result?.message) {
				const thread = state.messages[friendId] || [];
				state.messages = { ...state.messages, [friendId]: [...thread, result.message] };
			}
			render();
			return;
		}
		if (form.dataset.form === 'party-message') {
			const botId = activeBotId();
			await api(`/api/bots/${encodeURIComponent(botId)}/party/messages`, {
				method: 'POST',
				body: { content: data.content }
			});
			form.reset();
			setToast('Lobby message sent.');
			return;
		}
		if (
			form.dataset.form === 'party-privacy' ||
			form.dataset.form === 'party-playlist' ||
			form.dataset.form === 'party-status'
		) {
			const botId = activeBotId();
			const body =
				form.dataset.form === 'party-privacy'
					? { privacy: data.privacy }
					: form.dataset.form === 'party-playlist'
						? { playlist: data.playlist }
						: { status: data.status };
			const result = await api(`/api/bots/${encodeURIComponent(botId)}/party`, {
				method: 'PATCH',
				body
			});
			state.party = result.party || state.party;
			setToast(result.results?.[0]?.content || 'Lobby updated.');
			render();
			return;
		}

		if (form.dataset.form === 'botacc-create' || form.dataset.form === 'botacc-update' || form.dataset.form === 'botlobby-join') {
			await handleBotLobbyForm(form, data);
			return;
		}

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
				bots: data.bots,
				releaseChannel: data.releaseChannel,
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
	const engineSelect = event.target.closest('[data-action="config-engine"]');
	if (engineSelect) showEngineFields(engineSelect.form, engineSelect.value);
	const controlSelect = event.target.closest('[data-action="control-bot"]');
	if (controlSelect) switchControlledBot(controlSelect.value || null);
});

/** Points the live pages at another bot and reloads its lobby/social state. */
async function switchControlledBot(botId) {
	state.controlBotId = botId;
	state.party = null;
	state.partyMessages = [];
	state.friends = { onlineFriends: [], offlineFriends: [] };
	state.pendingFriends = { incomingFriends: [], outgoingFriends: [] };
	state.blockedUsers = [];
	state.selectedFriendId = null;
	state.messages = {};
	state.unread = {};
	state.matches = [];
	state.currentMatch = null;
	render();
	await refreshLiveData().catch((error) => setToast(error.message, 'error'));
	render();
}

function summarize(results, verb) {
	const rows = results || [];
	if (!rows.length) return 'No extra bots are online.';
	const ok = rows.filter((row) => row.ok).length;
	const failed = rows.filter((row) => !row.ok);
	return `${ok}/${rows.length} ${verb}.${failed.length ? ` ${failed.map((row) => `${row.label}: ${row.error}`).join(' · ')}` : ''}`;
}

async function handleBotLobbyAction(action, button) {
	const id = button.dataset.accountId;
	const path = id ? `/api/bot-accounts/${encodeURIComponent(id)}` : '';
	if (action === 'botacc-start') {
		setToast('Signing the bot in to Epic...');
		render();
		const result = await api(`${path}/start`, { method: 'POST', body: { joinMain: true } });
		state.botAccounts = result.accounts || state.botAccounts;
		setToast(result.join ? `${result.content} ${result.join.content}` : result.content);
	}
	if (action === 'botacc-stop') {
		const result = await api(`${path}/stop`, { method: 'POST', body: {} });
		state.botAccounts = result.accounts || state.botAccounts;
		if (state.controlBotId && !controlledHelper()) await switchControlledBot(null);
		setToast(result.content);
	}
	if (action === 'botacc-join-main') {
		setToast('Joining the main lobby...');
		render();
		const result = await api(`${path}/join-main`, { method: 'POST', body: {} });
		setToast(result.content);
	}
	if (action === 'botacc-leave') {
		const result = await api(`/api/bots/${encodeURIComponent(button.dataset.botAccount)}/party`, {
			method: 'PATCH',
			body: { leave: true }
		});
		setToast(result.results?.[0]?.content || 'Left the party.');
	}
	if (action === 'botacc-control') {
		await switchControlledBot(button.dataset.botAccount);
		state.view = 'lobby';
		await loadParty(false).catch(() => {});
		setToast('Live pages now control this bot. Switch back with the picker at the top.');
	}
	if (action === 'botacc-toggle-autostart') {
		await api(path, { method: 'PATCH', body: { autoStart: button.dataset.autoStart === 'true' } });
	}
	if (action === 'botacc-clear-auth') {
		await api(`${path}/clear-auth`, { method: 'POST', body: {} });
		setToast('Login cleared. Add a new authorization code to sign this bot in again.');
	}
	if (action === 'botacc-delete') {
		if (!window.confirm('Remove this bot account? Its saved Epic login is deleted.')) return;
		await api(path, { method: 'DELETE', body: {} });
		setToast('Bot account removed.');
	}
	if (action === 'botlobby-start-all') {
		setToast('Starting every extra bot...');
		render();
		const result = await api('/api/bot-lobby/start-all', { method: 'POST', body: { joinMain: true } });
		state.botAccounts = result.accounts || state.botAccounts;
		setToast(`${summarize(result.results, 'started')}${result.joins?.length ? ` ${summarize(result.joins, 'joined the main lobby')}` : ''}`);
	}
	if (action === 'botlobby-stop-all') {
		const result = await api('/api/bot-lobby/stop-all', { method: 'POST', body: {} });
		state.botAccounts = result.accounts || state.botAccounts;
		if (state.controlBotId) await switchControlledBot(null);
		setToast('Every extra bot stopped.');
	}
	if (action === 'botlobby-join-main') {
		setToast('Bringing every extra bot into the main lobby...');
		render();
		const result = await api('/api/bot-lobby/join-main', { method: 'POST', body: {} });
		setToast(summarize(result.results, 'joined the main lobby'));
	}
	if (action === 'botlobby-leave') {
		const result = await api('/api/bot-lobby/leave', { method: 'POST', body: {} });
		setToast(summarize(result.results, 'left their party'));
	}
	await loadBotAccounts(false).catch(() => {});
	render();
}

async function handleBotLobbyForm(form, data) {
	if (form.dataset.form === 'botacc-create') {
		await api('/api/bot-accounts', {
			method: 'POST',
			body: { label: data.label, authorizationCode: data.authorizationCode, autoStart: data.autoStart === 'true' }
		});
		form.reset();
		setToast('Bot account added. Start it now, before the authorization code expires.');
	}
	if (form.dataset.form === 'botacc-update') {
		await api(`/api/bot-accounts/${encodeURIComponent(form.dataset.accountId)}`, {
			method: 'PATCH',
			body: { label: data.label, authorizationCode: data.authorizationCode }
		});
		setToast(data.authorizationCode ? 'New code saved. Start the bot to sign in.' : 'Saved.');
	}
	if (form.dataset.form === 'botlobby-join') {
		const result = await api('/api/bot-lobby/join', { method: 'POST', body: { target: data.target } });
		setToast(summarize(result.results, 'joined'));
	}
	await loadBotAccounts(false).catch(() => {});
	render();
}


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
