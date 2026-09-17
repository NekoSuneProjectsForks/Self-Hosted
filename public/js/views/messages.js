import { state } from '../core/state.js';
import { escapeHtml, formatDate, icon } from '../core/ui.js';

function can(capability) {
	return state.runtime?.capabilities?.capabilities?.[capability] === true;
}

/** Everyone the bot could plausibly hold a DM thread with, newest activity first. */
function conversations() {
	const friends = [...(state.friends?.onlineFriends || []), ...(state.friends?.offlineFriends || [])];
	const rows = friends.map((friend) => {
		const thread = state.messages?.[friend.id] || [];
		const last = thread[thread.length - 1] || null;
		return {
			id: friend.id,
			name: friend.displayName || friend.id,
			isOnline: Boolean(friend.isOnline),
			unread: state.unread?.[friend.id] || 0,
			last
		};
	});

	// Anyone who has messaged the bot but is no longer on the friend list still
	// gets a thread, so history is never silently hidden.
	for (const id of Object.keys(state.messages || {})) {
		if (rows.some((row) => row.id === id)) continue;
		const thread = state.messages[id] || [];
		rows.push({
			id,
			name: thread[thread.length - 1]?.friendName || id,
			isOnline: false,
			unread: state.unread?.[id] || 0,
			last: thread[thread.length - 1] || null
		});
	}

	return rows.sort((a, b) => {
		const at = a.last ? new Date(a.last.sentAt).getTime() : 0;
		const bt = b.last ? new Date(b.last.sentAt).getTime() : 0;
		return bt - at;
	});
}

function conversationRow(row) {
	const selected = state.selectedFriendId === row.id;
	return `
		<button class="w-full rounded-lg border p-3 text-left transition ${
			selected ? 'border-fnlb-400/50 bg-fnlb-500/10' : 'border-white/5 bg-black/20 hover:border-white/20'
		}" data-conversation-id="${escapeHtml(row.id)}" data-conversation-name="${escapeHtml(row.name)}">
			<div class="flex items-center justify-between gap-2">
				<span class="min-w-0 truncate font-medium">${escapeHtml(row.name)}</span>
				${row.unread ? `<span class="badge border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300">${row.unread}</span>` : ''}
			</div>
			${
				row.last
					? `<p class="mt-1 truncate text-xs text-zinc-500">${row.last.direction === 'outgoing' ? 'You: ' : ''}${escapeHtml(row.last.content)}</p>`
					: '<p class="mt-1 text-xs text-zinc-600">No messages yet.</p>'
			}
		</button>
	`;
}

function thread() {
	const id = state.selectedFriendId;
	if (!id) {
		return `<div class="shell-panel flex-1 rounded-lg p-6 text-center text-sm text-zinc-500">Pick a conversation to read and reply.</div>`;
	}

	const messages = state.messages?.[id] || [];
	return `
		<div class="shell-panel flex flex-1 flex-col rounded-lg p-4">
			<p class="mb-3 font-semibold">${escapeHtml(state.selectedFriendName || id)}</p>
			<div class="mb-3 flex-1 space-y-2 overflow-y-auto rounded-lg bg-black/30 p-3" id="dm-log" style="max-height: 420px">
				${
					messages.length
						? messages
								.map(
									(message) => `
						<div class="flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}">
							<div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${
								message.direction === 'outgoing'
									? 'bg-fnlb-500/20 text-fnlb-100'
									: 'bg-white/5 text-zinc-200'
							}">
								<p class="whitespace-pre-wrap break-words">${escapeHtml(message.content)}</p>
								<p class="mt-1 text-[10px] text-zinc-500">${formatDate(message.sentAt)}</p>
							</div>
						</div>`
								)
								.join('')
						: '<p class="text-sm text-zinc-500">No messages in this conversation yet.</p>'
				}
			</div>
			<form class="flex gap-2" data-form="friend-message">
				<input class="input flex-1" name="content" placeholder="Write a direct message" autocomplete="off" />
				<button class="btn-primary" type="submit">${icon('send')} Send</button>
			</form>
		</div>
	`;
}

export function renderMessages() {
	if (state.runtime?.status !== 'online') {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">The bot is offline</p>
				<p class="mt-1 text-sm text-zinc-500">Direct messages are sent and received by the running bot.</p>
			</div>
		`;
	}
	if (!can('friendMessages')) {
		return `
			<div class="shell-panel rounded-lg p-6 text-center">
				<p class="font-semibold">Not supported by this engine</p>
				<p class="mt-1 text-sm text-zinc-500">The ${escapeHtml(state.runtime?.capabilities?.engine || 'active')} engine has no verified direct-message API, so this page is disabled rather than showing a control that would not work.</p>
			</div>
		`;
	}

	const rows = conversations();
	return `
		<div class="grid gap-4">
			<div class="flex items-center justify-between">
				<p class="text-sm text-zinc-500">Friend DMs are separate from lobby chat, which lives on the Lobby page.</p>
				<button class="btn-secondary" data-action="refresh-friends">${icon('refresh-cw')} Refresh</button>
			</div>
			<div class="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
				<div class="grid max-h-[560px] gap-2 overflow-y-auto">
					${rows.length ? rows.map(conversationRow).join('') : '<p class="text-sm text-zinc-500">No friends to message yet.</p>'}
				</div>
				${thread()}
			</div>
		</div>
	`;
}
