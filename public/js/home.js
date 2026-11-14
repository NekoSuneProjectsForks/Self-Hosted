/**
 * Homepage ("/"): what this platform is, how the public bot list works
 * (and why a bot can be missing from it), with live counts. No login needed.
 */
const root = document.getElementById('home');
let counts = null;
let info = { registrationOpen: true, announcement: '' };
let user = null;

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

function feature(iconName, title, text) {
	return `
		<div class="shell-panel rounded-xl p-5">
			<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-fnlb-300">${icon(iconName, 'h-5 w-5')}</div>
			<p class="font-semibold">${title}</p>
			<p class="mt-1 text-sm text-zinc-400">${text}</p>
		</div>`;
}

function statusRow(badgeClass, label, text) {
	return `
		<div class="flex items-start gap-3 py-3">
			<span class="badge mt-0.5 shrink-0 ${badgeClass}">${label}</span>
			<p class="text-sm text-zinc-300">${text}</p>
		</div>`;
}

function render() {
	const available = counts?.available;
	const busy = counts?.busy;
	const account = user
		? `<a class="btn-primary" href="/dashboard">${icon('layout-dashboard')} Open dashboard</a>`
		: `<a class="btn-secondary" href="/login">${icon('log-in')} Log in</a>${info.registrationOpen ? `<a class="btn-primary" href="/register">${icon('user-plus')} Register</a>` : ''}`;
	root.innerHTML = `
		<div class="mx-auto max-w-6xl p-4 sm:p-8">
			<header class="mb-10 flex flex-wrap items-center justify-between gap-4">
				<a class="flex items-center gap-3" href="/">
					<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-fnlb-500 text-zinc-950">${icon('bot', 'h-6 w-6')}</div>
					<span class="text-lg font-bold">Lobby Bot Host</span>
				</a>
				<nav class="flex flex-wrap gap-2">
					<a class="btn-secondary" href="/public-lists">${icon('globe')} Public bots</a>
					${account}
				</nav>
			</header>

			${info.announcement ? `<div class="mb-6 flex items-start gap-3 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-sky-100">${icon('megaphone', 'mt-0.5 h-4 w-4 shrink-0')}<p class="whitespace-pre-line">${esc(info.announcement)}</p></div>` : ''}

			<section class="mb-12 grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
				<div>
					<h1 class="text-4xl font-bold leading-tight sm:text-5xl">Fortnite lobby bots, <span class="text-fnlb-300">hosted by the community</span>.</h1>
					<p class="mt-4 max-w-xl text-lg text-zinc-400">Grab a free bot from the public list for bot lobbies, or log in to run and customise your own bots: skins, emotes, level, friends, DMs and match tracking.</p>
					<div class="mt-6 flex flex-wrap gap-3">
						<a class="btn-primary px-5 py-3 text-base" href="/public-lists">${icon('swords', 'h-5 w-5')} Find a free bot</a>
						${user ? `<a class="btn-secondary px-5 py-3 text-base" href="/dashboard">${icon('layout-dashboard', 'h-5 w-5')} My dashboard</a>` : `<a class="btn-secondary px-5 py-3 text-base" href="/login">${icon('log-in', 'h-5 w-5')} Run your own</a>`}
					</div>
				</div>
				<div class="shell-panel rounded-xl p-6">
					<p class="text-xs uppercase text-zinc-500">Public bots right now</p>
					<div class="mt-3 grid grid-cols-2 gap-3">
						<div class="card"><p class="text-3xl font-bold text-fnlb-300">${available ?? '…'}</p><p class="text-sm text-zinc-400">free to use</p></div>
						<div class="card"><p class="text-3xl font-bold">${busy ?? '…'}</p><p class="text-sm text-zinc-400">in use</p></div>
					</div>
					<a class="btn-secondary mt-4 w-full" href="/public-lists">${icon('arrow-right')} See the list</a>
					<p class="mt-2 text-center text-xs text-zinc-600">Live</p>
				</div>
			</section>

			<section class="mb-12">
				<h2 class="mb-4 text-xl font-bold">How to use a public bot</h2>
				<div class="grid gap-3 md:grid-cols-3">
					${feature('copy', '1. Pick a free bot', 'Open the <a class="text-fnlb-300 underline" href="/public-lists">public bot list</a> and copy a bot\'s name. Only bots that are free right now are listed.')}
					${feature('user-plus', '2. Add and invite it', 'Send it a friend request in Fortnite (it accepts by itself), then invite it to your party. One bot per party.')}
					${feature('swords', '3. Ready up', 'Pick Battle Royale or Zero Build <b>Duos, Trios or Squads</b> with <b>No Fill</b> and ready up. Bot lobby bots ready with you.')}
				</div>
			</section>

			<section class="mb-12 grid gap-6 lg:grid-cols-2">
				<div>
					<h2 class="text-xl font-bold">Why isn't a bot on the list?</h2>
					<p class="mt-2 text-sm text-zinc-400">The list only shows bots you can actually use right now. A bot disappears from it, and comes back by itself, when:</p>
				</div>
				<div class="shell-panel divide-y divide-white/5 rounded-xl px-5">
					${statusRow('border-fnlb-400/40 bg-fnlb-500/15 text-fnlb-300', 'Free', 'Online, nobody is using it and it isn\'t banned. These are the bots you see on the list.')}
					${statusRow('border-amber-400/40 bg-amber-500/10 text-amber-200', 'In use', 'Someone already has it in their party, or it\'s matchmaking or in a match. It\'s hidden until it\'s free again, and only counted.')}
					${statusRow('border-zinc-600/40 bg-zinc-500/10 text-zinc-300', 'Offline', 'Its owner isn\'t running it right now.')}
					${statusRow('border-red-400/40 bg-red-500/10 text-red-200', 'Banned', 'Epic gave it a matchmaking ban, its login stopped working, or it\'s disabled. It returns when the ban ends or the owner fixes it.')}
					${statusRow('border-zinc-600/40 bg-zinc-500/10 text-zinc-300', 'Private', 'Its owner keeps it for themselves. Owners choose Public or Private per bot (or per FNLB category).')}
				</div>
			</section>

			<section class="mb-12">
				<h2 class="mb-4 text-xl font-bold">Run your own bots</h2>
				<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
					${feature('swords', 'Bot lobbies', 'Run FNLB bots for bot lobbies from your own dashboard, with a live queue history.')}
					${feature('shirt', 'Look and level', 'Skins, back blings, emotes, battle pass level, banner, plus copy any player\'s look.')}
					${feature('messages-square', 'Friends and DMs', 'Accept friends, block, and chat with your bot\'s friends from the browser.')}
					${feature('chart-line', 'Match tracking', 'Every match you play: mode, kills, wins and placements, read from Epic stats.')}
				</div>
				<p class="mt-4 text-sm text-zinc-500">${icon('triangle-alert', 'inline h-4 w-4 text-amber-300')} Always use a <b>dummy</b> Epic account for a bot, never your main account: bot accounts can be banned if they're abused.</p>
			</section>

			<footer class="border-t border-white/10 pt-6 text-center text-xs text-zinc-600">
				<p>Bots are run by community members. Be kind: don't spam invites, and leave the party when you're done so others can use it.</p>
				<p class="mt-1">Not affiliated with or endorsed by Epic Games. Fortnite is a trademark of Epic Games, Inc.</p>
			</footer>
		</div>`;
	window.lucide?.createIcons?.();
}

async function loadCounts() {
	try {
		const response = await fetch('/api/public/bots');
		if (response.ok) counts = (await response.json()).counts;
	} catch {
		// Leave the placeholders.
	}
	render();
}

(async function init() {
	render();
	const [infoResult, sessionResult] = await Promise.allSettled([
		fetch('/api/server-info').then((r) => (r.ok ? r.json() : null)),
		fetch('/api/session').then((r) => (r.ok ? r.json() : null))
	]);
	if (infoResult.value) info = { ...info, ...infoResult.value };
	user = sessionResult.value?.user || null;
	await loadCounts();
	// Live counts (same stream as /public-lists); fall back to a 3-second check.
	if (window.EventSource) {
		const stream = new EventSource('/api/public/bots/stream');
		let failures = 0;
		stream.addEventListener('bots', (event) => {
			failures = 0;
			try {
				counts = JSON.parse(event.data).counts;
				render();
			} catch {
				// Next message replaces it.
			}
		});
		stream.onerror = () => {
			failures += 1;
			if (failures >= 3) {
				stream.close();
				setInterval(loadCounts, 3000);
			}
		};
	} else {
		setInterval(loadCounts, 3000);
	}
})();
