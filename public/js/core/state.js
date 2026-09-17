/** Single shared client state object. Views read it; actions mutate it. */
export const state = {
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
	// Live lobby / social state, kept per running bot and refreshed by Socket.IO
	// events rather than by reloading the whole dashboard.
	party: null,
	partyMessages: [],
	friends: { onlineFriends: [], offlineFriends: [] },
	pendingFriends: { incomingFriends: [], outgoingFriends: [] },
	blockedUsers: [],
	selectedFriendId: null,
	selectedFriendName: null,
	messages: {},
	unread: {},
	matches: [],
	currentMatch: null,
	toast: null,
	busy: false,
	autoRefresh: true,
	socket: null
};

export const statusStyles = {
	offline: 'border-zinc-600/40 bg-zinc-500/10 text-zinc-300',
	starting: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
	online: 'border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300',
	active: 'border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300',
	restarting: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
	stopping: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
	error: 'border-red-400/40 bg-red-500/10 text-red-200',
	auth_required: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
	suspended: 'border-red-400/40 bg-red-500/10 text-red-200'
};

export const logStyles = {
	0: 'text-zinc-300',
	1: 'text-fnlb-300',
	2: 'text-sky-200',
	3: 'text-amber-200',
	4: 'text-red-200'
};
