const API_BASE = 'https://api.fnlb.net/v1';

const BOT_FLAGS = {
	Disabled: 1,
	Public: 2,
	InvalidAuth: 4
};

const CATEGORY_FLAGS = {
	Disabled: 1,
	Managed: 2
};

function authHeader(apiToken) {
	return apiToken.startsWith('Bearer ') ? apiToken : `Bearer ${apiToken}`;
}

function normalizeTimestamp(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function namesFromFlags(flags, flagMap) {
	return Object.entries(flagMap)
		.filter(([, bit]) => (flags & bit) === bit)
		.map(([name]) => name);
}

function requireToken(apiToken) {
	if (!apiToken) {
		const error = new Error('No FNLB API token is saved for this user.');
		error.status = 400;
		throw error;
	}
}

async function fnlbRequest(apiToken, path, options = {}) {
	requireToken(apiToken);

	const response = await fetch(`${API_BASE}${path}`, {
		method: options.method || 'GET',
		headers: {
			Authorization: authHeader(apiToken),
			Accept: 'application/json',
			...(options.body ? { 'Content-Type': 'application/json' } : {})
		},
		body: options.body ? JSON.stringify(options.body) : undefined
	});

	if (!response.ok) {
		let message = `FNLB API returned ${response.status}.`;
		try {
			const body = await response.json();
			message = body?.errors?.[0]?.message || body?.message || message;
		} catch {
			const text = await response.text().catch(() => '');
			if (text) message = text;
		}
		const error = new Error(message);
		error.status = [400, 401, 403, 404].includes(response.status) ? response.status : 502;
		throw error;
	}

	if (response.status === 204) return null;
	const contentType = response.headers.get('Content-Type') || '';
	if (contentType.includes('application/json')) return response.json();
	return response.text();
}

export function annotateBotStatus(bot) {
	const flags = Number(bot.flags ?? 0);
	const mmsBannedUntilMs = normalizeTimestamp(bot.mmsBannedUntil);
	const mmsBannedUntil =
		mmsBannedUntilMs && mmsBannedUntilMs > Date.now()
			? new Date(mmsBannedUntilMs).toISOString()
			: null;
	const partyMembers = Array.isArray(bot.party?.members) ? bot.party.members.length : null;

	return {
		...bot,
		flags,
		flagsList: namesFromFlags(flags, BOT_FLAGS),
		isDisabled: (flags & BOT_FLAGS.Disabled) === BOT_FLAGS.Disabled,
		hasInvalidAuth: (flags & BOT_FLAGS.InvalidAuth) === BOT_FLAGS.InvalidAuth,
		mmsBannedUntil,
		banState: mmsBannedUntil ? 'temporary_matchmaking_ban' : 'none',
		partyMembers,
		isInMatch: Number(bot.matches ?? 0) > 0 || Boolean(bot.party?.playlistId)
	};
}

export function annotateCategory(category) {
	const flags = Number(category.flags ?? 0);
	return {
		...category,
		flags,
		flagsList: namesFromFlags(flags, CATEGORY_FLAGS),
		isDisabled: (flags & CATEGORY_FLAGS.Disabled) === CATEGORY_FLAGS.Disabled,
		isManaged: (flags & CATEGORY_FLAGS.Managed) === CATEGORY_FLAGS.Managed
	};
}

export async function fetchFnlbBots(apiToken) {
	const bots = await fnlbRequest(apiToken, '/bots/');
	return Array.isArray(bots) ? bots.map(annotateBotStatus) : [];
}

export async function fetchFnlbDashboard(apiToken) {
	const [bots, stats, categories, user] = await Promise.all([
		fetchFnlbBots(apiToken),
		fnlbRequest(apiToken, '/bots/stats/').catch((error) => ({ error: error.message })),
		fnlbRequest(apiToken, '/categories/').catch((error) => ({ error: error.message })),
		fnlbRequest(apiToken, '/user/?includeEmail=true').catch((error) => ({ error: error.message }))
	]);

	return {
		bots,
		stats,
		categories: Array.isArray(categories) ? categories.map(annotateCategory) : [],
		categoriesError: categories?.error,
		statsError: stats?.error,
		user
	};
}

export async function fetchFnlbBotDetails(apiToken, botId) {
	const encoded = encodeURIComponent(botId);
	const [bot, friends, pendingFriends, blockedUsers] = await Promise.all([
		fnlbRequest(apiToken, `/bots/${encoded}/`).then(annotateBotStatus),
		fnlbRequest(apiToken, `/bots/${encoded}/friends/`).catch((error) => ({ error: error.message })),
		fnlbRequest(apiToken, `/bots/${encoded}/friends/pending/`).catch((error) => ({
			error: error.message
		})),
		fnlbRequest(apiToken, `/bots/${encoded}/users/blocked/`).catch((error) => ({
			error: error.message
		}))
	]);

	return {
		bot,
		friends: friends?.error ? { onlineFriends: [], offlineFriends: [], error: friends.error } : friends,
		pendingFriends: pendingFriends?.error
			? { incomingFriends: [], outgoingFriends: [], error: pendingFriends.error }
			: pendingFriends,
		blockedUsers: Array.isArray(blockedUsers) ? blockedUsers : [],
		blockedUsersError: blockedUsers?.error
	};
}

export async function runFnlbCommand(apiToken, botId, payload) {
	return fnlbRequest(apiToken, `/bots/${encodeURIComponent(botId)}/commands/run/`, {
		method: 'POST',
		body: {
			command: String(payload.command || '').trim(),
			args: String(payload.args || '').trim() || undefined,
			locale: String(payload.locale || 'en').trim() || 'en'
		}
	});
}

export async function sendFnlbChatMessage(apiToken, botId, payload) {
	return fnlbRequest(apiToken, `/bots/${encodeURIComponent(botId)}/chat/messages/`, {
		method: 'POST',
		body: {
			content: String(payload.content || '').trim(),
			locale: String(payload.locale || 'en').trim() || 'en'
		}
	});
}

export async function searchFnlbUsers(apiToken, botId, prefix) {
	const users = await fnlbRequest(
		apiToken,
		`/bots/${encodeURIComponent(botId)}/users/search/?prefix=${encodeURIComponent(prefix)}`
	);
	return Array.isArray(users) ? users : [];
}

export async function updateFnlbBot(apiToken, botId, payload) {
	return fnlbRequest(apiToken, `/bots/${encodeURIComponent(botId)}/`, {
		method: 'PATCH',
		body: payload
	});
}

export async function updateFnlbCategory(apiToken, categoryId, payload) {
	return fnlbRequest(apiToken, `/categories/${encodeURIComponent(categoryId)}/`, {
		method: 'PATCH',
		body: payload
	});
}
