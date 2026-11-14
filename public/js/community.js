/**
 * Public community bot list (no login). Read-only: it shows bots their owners
 * chose to publish and how to use them. There are no controls here.
 */
const root = document.getElementById('community');
let data = { bots: [], counts: { available: 0, busy: 0 } };
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

// The server only sends bots that are free right now (running, not banned,
// nobody in their party). Busy bots are only counted.

function card(bot) {
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
				<span class="badge border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300">Available</span>
			</div>
			${bot.description ? `<p class="text-sm text-zinc-300">${esc(bot.description)}</p>` : ''}
			<div class="flex flex-wrap gap-2 text-xs">
				${bot.botLobbies ? `<span class="chip border-fnlb-400/30 text-fnlb-200">${icon('swords', 'h-3 w-3')} Bot lobbies</span>` : `<span class="chip">${icon('sparkles', 'h-3 w-3')} Lobby bot</span>`}
				<span class="chip">${icon('circle-check', 'h-3 w-3')} Free now</span>
			</div>
			<div class="mt-auto flex gap-2">
				<button class="btn-secondary flex-1" data-copy="${esc(bot.displayName)}">${icon('copy')} Copy name</button>
			</div>
		</article>`;
}

function listHtml() {
	const q = query.toLowerCase();
	const bots = data.bots.filter((bot) => !q || bot.displayName.toLowerCase().includes(q));
	const busy = data.counts?.busy ?? 0;
	return bots.length
		? `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${bots.map(card).join('')}</div>`
		: `<div class="shell-panel rounded-xl p-8 text-center text-sm text-zinc-500">${data.bots.length ? 'No bots match.' : busy ? 'Every community bot is in use right now. This page updates by itself as soon as one is free.' : 'No community bots are online right now.'}</div>`;
}

function countsHtml() {
	const available = data.counts?.available ?? data.bots.length;
	const busy = data.counts?.busy ?? 0;
	return `
		<span class="badge border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300">${available} available</span>
		${busy ? `<span class="text-zinc-500">${busy} more in use right now. They show up again when they're free.</span>` : ''}`;
}

function liveHtml() {
	return live === 'live'
		? `<span class="inline-flex items-center gap-1.5 text-xs text-fnlb-300"><span class="h-2 w-2 animate-pulse rounded-full bg-fnlb-400"></span> Live</span>`
		: live === 'polling'
			? '<span class="text-xs text-zinc-500">Updating every 3 seconds</span>'
			: '<span class="text-xs text-zinc-500">Connecting…</span>';
}

/** Only the parts that change are redrawn, so the search box keeps focus. */
function update() {
	const list = root.querySelector('[data-list]');
	if (!list) return render();
	list.innerHTML = listHtml();
	root.querySelector('[data-counts]').innerHTML = countsHtml();
	root.querySelector('[data-live]').innerHTML = liveHtml();
	root.querySelector('[data-error]').innerHTML = error ? `<p class="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">${esc(error)}</p>` : '';
	window.lucide?.createIcons?.();
}

function render() {
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
				<div class="flex gap-2"><a class="btn-secondary" href="/">${icon('house')} Home</a><a class="btn-secondary" href="/login">${icon('log-in')} Member login</a></div>
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
				<p class="flex flex-wrap items-center gap-3 text-sm"><span data-counts>${countsHtml()}</span><span data-live>${liveHtml()}</span></p>
				<input class="input max-w-xs" data-search placeholder="Search bots" value="${esc(query)}" />
			</div>

			<div data-error></div>
			<div data-list>${listHtml()}</div>
			<p class="mt-6 text-center text-xs text-zinc-600">Bots appear and disappear live as they come free or get used. Not affiliated with Epic Games.</p>
		</div>`;
	window.lucide?.createIcons?.();
}

let live = 'connecting';
let pollTimer = null;

function apply(next) {
	data = next;
	error = '';
	update();
}

async function poll() {
	try {
		const response = await fetch('/api/public/bots', { cache: 'no-store' });
		if (!response.ok) throw new Error(`Could not load bots (${response.status}).`);
		apply(await response.json());
	} catch (err) {
		error = err.message;
		update();
	}
}

/** Polling fallback when the live stream can't connect (some proxies block it). */
function startPolling() {
	if (pollTimer) return;
	live = 'polling';
	poll();
	pollTimer = setInterval(poll, 3000);
}

function connect() {
	if (!window.EventSource) return startPolling();
	const stream = new EventSource('/api/public/bots/stream');
	let failures = 0;
	stream.addEventListener('bots', (event) => {
		failures = 0;
		live = 'live';
		try {
			apply(JSON.parse(event.data));
		} catch {
			// Ignore a malformed message; the next one replaces it.
		}
	});
	stream.onerror = () => {
		failures += 1;
		if (failures >= 3) {
			stream.close();
			startPolling();
		} else if (live !== 'live') {
			update();
		}
	};
}

root.addEventListener('click', async (event) => {
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
	update();
});

render();
connect();
