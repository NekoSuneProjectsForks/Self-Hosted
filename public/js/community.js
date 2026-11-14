/**
 * Public community bot list (no login). Read-only: it shows bots their owners
 * chose to publish and how to use them. There are no controls here.
 */
const root = document.getElementById('community');
let data = { bots: [], counts: { total: 0, available: 0, busy: 0 } };
let filter = 'all';
let query = '';
let error = '';

function esc(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function icon(name, classes = 'h-4 w-4') {
	return `<i data-lucide="${name}" class="${classes}"></i>`;
}

const BADGE = {
	available: ['border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300', 'Available'],
	busy: ['border-amber-400/40 bg-amber-500/10 text-amber-200', 'In a party'],
	offline: ['border-zinc-600/40 bg-zinc-500/10 text-zinc-300', 'Offline']
};

function ago(value) {
	if (!value) return '';
	const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
	if (minutes < 2) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function card(bot) {
	const [badgeClass, badgeText] = BADGE[bot.status] || BADGE.offline;
	return `
		<article class="shell-panel flex flex-col gap-3 rounded-xl p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="flex min-w-0 items-center gap-3">
					<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-fnlb-300">${icon('bot', 'h-5 w-5')}</div>
					<div class="min-w-0">
						<p class="truncate font-semibold" title="${esc(bot.displayName)}">${esc(bot.displayName)}</p>
						<p class="text-xs text-zinc-500">${esc(bot.engineLabel)}</p>
					</div>
				</div>
				<span class="badge ${badgeClass}">${badgeText}</span>
			</div>
			${bot.description ? `<p class="text-sm text-zinc-300">${esc(bot.description)}</p>` : ''}
			<div class="flex flex-wrap gap-2 text-xs">
				${bot.botLobbies ? `<span class="chip border-fnlb-400/30 text-fnlb-200">${icon('swords', 'h-3 w-3')} Bot lobbies</span>` : `<span class="chip">${icon('sparkles', 'h-3 w-3')} Lobby bot</span>`}
				${bot.status !== 'offline' && bot.partySize ? `<span class="chip">${icon('users', 'h-3 w-3')} ${bot.partySize}/${bot.partyMax || 16}</span>` : ''}
				${bot.status === 'offline' && bot.lastSeenAt ? `<span class="chip">Seen ${esc(ago(bot.lastSeenAt))}</span>` : ''}
			</div>
			<div class="mt-auto flex gap-2">
				<button class="btn-secondary flex-1" data-copy="${esc(bot.displayName)}">${icon('copy')} Copy name</button>
			</div>
		</article>`;
}

function render() {
	const q = query.toLowerCase();
	const bots = data.bots.filter((bot) => (filter === 'all' || bot.status === filter) && (!q || bot.displayName.toLowerCase().includes(q)));
	const tab = (id, label, count) =>
		`<button class="tab ${filter === id ? 'active' : ''}" data-filter="${id}">${label}${count === undefined ? '' : ` <span class="text-xs text-zinc-500">${count}</span>`}</button>`;
	root.innerHTML = `
		<div class="mx-auto max-w-6xl p-4 sm:p-8">
			<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div class="flex items-center gap-3">
					<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-fnlb-500 text-zinc-950">${icon('bot', 'h-6 w-6')}</div>
					<div>
						<h1 class="text-2xl font-bold">Community bots</h1>
						<p class="text-sm text-zinc-500">Lobby bots shared by members of this server.</p>
					</div>
				</div>
				<a class="btn-secondary" href="/">${icon('log-in')} Member login</a>
			</header>

			<section class="shell-panel mb-6 rounded-xl p-4 text-sm text-zinc-300">
				<p class="font-semibold text-zinc-100">How to use a bot</p>
				<ol class="mt-2 list-decimal space-y-1 pl-5">
					<li>Copy a bot's name and send it a friend request in Fortnite. It accepts automatically.</li>
					<li>Invite it to your party. Use one bot per party.</li>
					<li><b>Bot lobby bots</b>: pick Battle Royale or Zero Build <b>Duos, Trios or Squads</b> with <b>No Fill</b> and ready up. The bot readies with you.</li>
				</ol>
				<p class="mt-2 text-xs text-zinc-500">Bots are run by community members. Be kind: don't spam invites, and leave the party when you're done so others can use it.</p>
			</section>

			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<nav class="flex flex-wrap gap-2">
					${tab('all', 'All', data.counts.total)}
					${tab('available', 'Available', data.counts.available)}
					${tab('busy', 'In a party', data.counts.busy)}
					${tab('offline', 'Offline')}
				</nav>
				<input class="input max-w-xs" data-search placeholder="Search bots" value="${esc(query)}" />
			</div>

			${error ? `<p class="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">${esc(error)}</p>` : ''}
			${
				bots.length
					? `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${bots.map(card).join('')}</div>`
					: `<div class="shell-panel rounded-xl p-8 text-center text-sm text-zinc-500">${data.bots.length ? 'No bots match.' : 'No community bots yet. Members can publish theirs from their Bots page.'}</div>`
			}
			<p class="mt-6 text-center text-xs text-zinc-600">Updates every 30 seconds. Not affiliated with Epic Games.</p>
		</div>`;
	window.lucide?.createIcons?.();
}

async function load() {
	try {
		const response = await fetch('/api/public/bots');
		if (!response.ok) throw new Error(`Could not load bots (${response.status}).`);
		data = await response.json();
		error = '';
	} catch (err) {
		error = err.message;
	}
	render();
}

root.addEventListener('click', async (event) => {
	const tab = event.target.closest('[data-filter]');
	if (tab) {
		filter = tab.dataset.filter;
		render();
		return;
	}
	const copy = event.target.closest('[data-copy]');
	if (copy) {
		try {
			await navigator.clipboard.writeText(copy.dataset.copy);
			copy.innerHTML = `${icon('check')} Copied`;
			window.lucide?.createIcons?.();
		} catch {
			window.prompt('Copy the bot name:', copy.dataset.copy);
		}
	}
});

root.addEventListener('input', (event) => {
	const input = event.target.closest('[data-search]');
	if (!input) return;
	query = input.value;
	const caret = input.selectionStart;
	render();
	const next = root.querySelector('[data-search]');
	next?.focus();
	next?.setSelectionRange(caret, caret);
});

load();
setInterval(load, 30000);
