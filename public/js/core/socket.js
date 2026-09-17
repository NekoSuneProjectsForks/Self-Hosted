import { state } from './state.js';
import { render } from './render.js';

/**
 * Targeted realtime updates. Each event patches just the slice of state it
 * affects, so an incoming message or a party change never triggers a full
 * dashboard reload.
 */
const LIVE_VIEWS = new Set(['lobby', 'friends', 'messages', 'matches', 'status']);

function renderIfVisible(...views) {
	if (views.includes(state.view)) render();
}

export function connectSocket() {
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

	state.socket.on('bot:updated', ({ bot }) => {
		if (!bot) return;
		state.bots = state.bots.map((row) => (row.id === bot.id ? bot : row));
		if (!state.bots.some((row) => row.id === bot.id)) state.bots = [bot];
		if (bot.party) state.party = bot.party;
		renderIfVisible('status', 'lobby');
	});

	state.socket.on('party:updated', ({ party }) => {
		state.party = party || null;
		renderIfVisible('lobby', 'status');
	});

	state.socket.on('party:message', (message) => {
		state.partyMessages.push(message);
		if (state.partyMessages.length > 200) state.partyMessages.shift();
		renderIfVisible('lobby');
	});

	state.socket.on('cosmetics:updated', ({ cosmetics }) => {
		if (!cosmetics || !state.bots.length) return;
		state.bots = state.bots.map((bot, index) => (index === 0 ? { ...bot, cosmetics } : bot));
		renderIfVisible('status', 'lobby', 'items');
	});

	// Friend list changes arrive as a signal to refetch, so the client never
	// tries to guess Epic's state from a partial event payload.
	state.socket.on('friends:updated', () => {
		state.friendsStale = true;
		if (LIVE_VIEWS.has(state.view)) {
			window.dispatchEvent(new CustomEvent('friends:refresh'));
		}
	});

	state.socket.on('friend:message', (message) => {
		if (!message?.friendId) return;
		const thread = state.messages[message.friendId] || [];
		state.messages = { ...state.messages, [message.friendId]: [...thread, message] };

		const isOpen = state.view === 'messages' && state.selectedFriendId === message.friendId;
		if (message.direction === 'incoming' && !isOpen) {
			state.unread = {
				...state.unread,
				[message.friendId]: (state.unread[message.friendId] || 0) + 1
			};
		}
		render();
	});

	state.socket.on('match:started', ({ round }) => {
		state.currentMatch = round || null;
		if (round) state.matches = [round, ...state.matches.filter((m) => m.id !== round.id)];
		renderIfVisible('matches', 'lobby', 'status');
	});

	state.socket.on('match:ended', ({ round }) => {
		state.currentMatch = null;
		if (round) state.matches = [round, ...state.matches.filter((m) => m.id !== round.id)];
		renderIfVisible('matches', 'lobby', 'status');
	});

	state.socket.on('match:updated', () => {
		renderIfVisible('matches', 'lobby');
	});
}

export function disconnectSocket() {
	if (!state.socket) return;
	state.socket.disconnect();
	state.socket = null;
}
