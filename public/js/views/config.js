import { state } from '../core/state.js';
import { epicCodeButton, platformLabel, platformOptions } from '../core/platforms.js';
import { addForm, localLocked } from './botlobby.js';
import { escapeHtml, icon, statusBadge } from '../core/ui.js';

// Browsers and password managers autofill any password field, which would
// silently submit a stale one-time code or token on the next save.
const NO_AUTOFILL = 'autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';

/**
 * Marks an element as belonging to one engine. The config form shows only the
 * selected engine's fields; hidden ones keep their values and are still saved.
 */
function engineOnly(engine, current) {
	return `data-engine="${engine}" ${engine === current ? '' : 'hidden'}`;
}

/** Runs when the Bot Engine dropdown changes, before the form is saved. */
export function showEngineFields(form, engine) {
	for (const element of form.querySelectorAll('[data-engine]')) {
		element.hidden = element.dataset.engine !== engine;
	}
}

/** Server / engine settings form. Shown in the main bot's Advanced tab. */
export function renderConfigForm() {
	return renderConfig({ withAccounts: false });
}

export function renderConfig({ withAccounts = true } = {}) {
	const config = state.config || {};
	const locked = localLocked();
	// While the local engine is admin-only, non-admins work with Legacy FNLB.
	const engine = locked || config.runtimeMode === 'fnlb' ? 'fnlb' : 'fnbr';
	const fnbr = engineOnly('fnbr', engine);
	const fnlb = engineOnly('fnlb', engine);
	return `
		<form data-form="config" class="grid gap-4 xl:grid-cols-[1fr_360px]">
			<section class="shell-panel rounded-lg p-4 sm:p-6">
				<div class="grid gap-4 md:grid-cols-2">
					<label class="md:col-span-2">
						<span class="label">Bot Engine</span>
						<select class="input" name="runtimeMode" data-action="config-engine">
							<option value="fnbr" ${engine === 'fnbr' ? 'selected' : ''} ${locked ? 'disabled' : ''}>Local fnbr.js bot system${locked ? ' (admins only for now)' : ''}</option>
							<option value="fnlb" ${engine === 'fnlb' ? 'selected' : ''}>Legacy FNLB cloud API/runtime</option>
						</select>
						${locked ? '<span class="mt-1 block text-xs text-zinc-500">The local engine is admin-only while it\'s being tested. Legacy FNLB gives you bot lobbies, friends, DMs and skins.</span>' : ''}
					</label>
					<label class="md:col-span-2" ${fnbr}>
					<span class="label">One-time Epic Authorization Code</span>
					<input class="input" name="authorizationCode" type="password" ${NO_AUTOFILL} placeholder="${config.authorizationCodeConfigured ? 'Saved authorization code pending use' : config.deviceAuthConfigured ? 'Signed in. Paste a new code only to switch account' : 'Paste the code, or the whole page Epic shows'}" />
						<span class="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
							${epicCodeButton(config.deviceAuthConfigured ? 'Sign in with a different account' : 'Sign in with Epic / get code', 'main')}
							<span>Use a <strong class="text-red-300">dummy account</strong>, never your main. Paste the <code>authorizationCode</code> or the whole page. It works once and expires in a few minutes.</span>
						</span>
					</label>
					<label ${fnbr}>
					<span class="label">Device Auth Account ID</span>
					<input class="input" name="deviceAuthAccountId" ${NO_AUTOFILL} placeholder="${config.deviceAuthConfigured ? `Saved: ${escapeHtml(config.deviceAuthMasked)}` : 'accountId'}" />
					</label>
					<label ${fnbr}>
					<span class="label">Device Auth Device ID</span>
					<input class="input" name="deviceAuthDeviceId" ${NO_AUTOFILL} placeholder="deviceId" />
					</label>
					<label class="md:col-span-2" ${fnbr}>
					<span class="label">Device Auth Secret</span>
					<input class="input" name="deviceAuthSecret" type="password" ${NO_AUTOFILL} placeholder="secret" />
					</label>
					<label ${fnbr}>
					<span class="label">Platform the bot shows as</span>
						<select class="input" name="platform">
							${platformOptions(config.platform || 'WIN')}
						</select>
						<span class="mt-1 block text-xs text-zinc-500">Players see this platform icon on the bot in Fortnite. A change applies on the next restart.</span>
					</label>
					<label ${fnbr}>
					<span class="label">Default Status</span>
						<input class="input" name="defaultStatus" value="${escapeHtml(config.defaultStatus || '')}" placeholder="Battle Royale Lobby - 1 / 16" />
					</label>
					<label class="md:col-span-2" ${fnlb}>
					<span class="label">Legacy FNLB API Token</span>
					<input class="input" name="apiToken" type="password" ${NO_AUTOFILL} placeholder="${config.apiTokenConfigured ? `Saved: ${escapeHtml(config.apiTokenMasked)}` : 'FNLB_...'}" />
					<span class="mt-2 block rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
						<span class="flex items-center gap-1.5 font-semibold text-zinc-200">${icon('key-round', 'h-3.5 w-3.5')} Where do I find my FNLB API token?</span>
						<span class="mt-1 block">1. Sign in to FNLB at <a href="https://app.fnlb.net/account" class="text-fnlb-300 underline hover:text-fnlb-200" target="_blank" rel="noopener noreferrer">app.fnlb.net/account</a> (or in the FNLB app).</span>
						<span class="block">2. Open the <b>API tokens</b> section in your account settings and create a token.</span>
						<span class="block">3. Copy it (it starts with <code class="text-zinc-300">FNLB_</code>), paste it here and press Save Config.</span>
						<span class="mt-1 block text-zinc-500">The token can act as you, so keep it private. If it leaks, revoke it there and make a new one. More: <a href="https://developers.fnlb.net/docs/getting-started/authenticating" class="text-fnlb-300 underline hover:text-fnlb-200" target="_blank" rel="noopener noreferrer">FNLB docs</a>.</span>
						<a class="btn-secondary mt-2 inline-flex" href="https://app.fnlb.net/account" target="_blank" rel="noopener noreferrer">${icon('external-link', 'h-3.5 w-3.5')} Open FNLB account page</a>
					</span>
					</label>
					<label ${fnlb}>
					<span class="label">Legacy FNLB Release Channel</span>
						<select class="input" name="releaseChannel">
							<option value="stable" ${config.releaseChannel !== 'beta' ? 'selected' : ''}>Stable (recommended)</option>
							<option value="beta" ${config.releaseChannel === 'beta' ? 'selected' : ''}>Beta</option>
						</select>
					</label>
					<label class="md:col-span-2" ${fnlb}>
					<span class="label">Legacy FNLB Categories (optional)</span>
						<input class="input" name="categories" value="${escapeHtml(config.categories || '')}" placeholder="Leave empty for all categories, or 123456789,987654321" />
						<span class="mt-1 block text-xs text-zinc-500">Category IDs: open <a href="https://app.fnlb.net/bots" class="text-fnlb-300 underline hover:text-fnlb-200" target="_blank" rel="noopener noreferrer">app.fnlb.net/bots</a>, select a bot and look under <b>About this bot</b>. Separate several with commas.</span>
					</label>
					<label class="md:col-span-2" ${fnlb}>
					<span class="label">Legacy FNLB Bots (optional)</span>
						<input class="input" name="bots" value="${escapeHtml(config.bots || '')}" placeholder="Leave empty for all bots, or botId1,botId2" />
						<span class="mt-1 block text-xs text-zinc-500">Bot IDs: on <a href="https://app.fnlb.net/bots" class="text-fnlb-300 underline hover:text-fnlb-200" target="_blank" rel="noopener noreferrer">app.fnlb.net/bots</a>, select a bot and copy its <b>FNLB ID</b> under About this bot.</span>
					</label>
					<label class="md:col-span-2">
						<span class="label">Cluster Name</span>
						<input class="input" name="clusterName" value="${escapeHtml(config.clusterName || 'Local fnbr Cluster')}" required />
					</label>
					<label ${fnlb}>
					<span class="label">Number of Shards</span>
						<input class="input" name="numberOfShards" type="number" min="1" max="64" value="${escapeHtml(config.numberOfShards ?? 2)}" required />
					</label>
					<label ${fnlb}>
					<span class="label">Bots per Shard</span>
						<input class="input" name="botsPerShard" type="number" min="1" max="256" value="${escapeHtml(config.botsPerShard ?? 32)}" required />
					</label>
					<label>
						<span class="label">Restart Interval Seconds</span>
						<input class="input" name="restartInterval" type="number" min="60" max="604800" value="${escapeHtml(config.restartInterval ?? 3600)}" required />
					</label>
					<label ${fnlb}>
					<span class="label">Log Level</span>
						<select class="input" name="logLevel">
							<option value="INFO" ${config.logLevel !== 'DEBUG' ? 'selected' : ''}>INFO</option>
							<option value="DEBUG" ${config.logLevel === 'DEBUG' ? 'selected' : ''}>DEBUG</option>
						</select>
					</label>
				</div>
			</section>

			<aside class="grid content-start gap-4">
				<div class="card" ${fnlb}>
				<p class="mb-4 font-semibold">Privacy</p>
					<label class="mb-3 flex items-center justify-between gap-3 text-sm">
						<span>Hide usernames in logs</span>
						<input class="h-5 w-5 accent-fnlb-500" name="hideUsernames" type="checkbox" ${config.hideUsernames ? 'checked' : ''} />
					</label>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>Hide emails in logs</span>
						<input class="h-5 w-5 accent-fnlb-500" name="hideEmails" type="checkbox" ${config.hideEmails ? 'checked' : ''} />
					</label>
				</div>
				<div class="card">
					<p class="mb-4 font-semibold">Updates</p>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span ${fnbr}>Restart local fnbr bot on schedule</span>
						<span ${fnlb}>Force FNLB update check before every restart</span>
						<input class="h-5 w-5 accent-fnlb-500" name="autoUpdateOnRestart" type="checkbox" ${config.autoUpdateOnRestart !== false ? 'checked' : ''} />
					</label>
				</div>
				<div class="card" ${fnbr}>
				<p class="mb-4 font-semibold">Epic Sessions</p>
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>Kill other Fortnite tokens on login</span>
						<input class="h-5 w-5 accent-fnlb-500" name="killOtherTokens" type="checkbox" ${config.killOtherTokens ? 'checked' : ''} />
					</label>
					<label class="mt-3 flex items-center justify-between gap-3 text-sm">
						<span>Clear saved device auth</span>
						<input class="h-5 w-5 accent-fnlb-500" name="clearDeviceAuth" type="checkbox" />
					</label>
					<p class="mt-3 text-xs text-zinc-500">Leave off unless this bot account is only used by this server. Turning it on can kick other active sessions for that Epic account.</p>
				</div>
				<button class="btn-primary w-full" type="submit">${icon('save')} Save Config</button>
			</aside>
		</form>
		${withAccounts && engine === 'fnbr' ? renderBotAccounts() : ''}
	`;
}

/** Create, edit and delete extra bot accounts (also reachable from the Bots page). */
function renderBotAccounts() {
	const accounts = state.botAccounts || [];
	const rows = accounts
		.map((account) => {
			const id = escapeHtml(account.id);
			return `
			<tr class="border-t border-white/5">
				<td class="py-2 pr-3 font-medium text-zinc-100">${escapeHtml(account.label)}</td>
				<td class="py-2 pr-3 text-zinc-400">${escapeHtml(account.displayName || account.accountId || (account.authorizationCodeConfigured ? 'Code saved, not signed in' : 'Not signed in'))}</td>
				<td class="py-2 pr-3 text-zinc-400">${escapeHtml(platformLabel(account.platform || config().platform || 'WIN'))}${account.platform ? '' : ' <span class="text-zinc-600">(main)</span>'}</td>
				<td class="py-2 pr-3">${statusBadge(account.status)}</td>
				<td class="py-2 pr-3 text-zinc-400">${account.autoStart ? 'Yes' : 'No'}</td>
				<td class="py-2 text-right">
					<div class="inline-flex gap-2">
						<button class="btn-secondary py-1.5" type="button" data-action="bot-settings" data-bot-key="${id}" data-tab="account">${icon('pencil')} Edit</button>
						<button class="btn-danger py-1.5" type="button" data-action="botacc-delete" data-account-id="${id}">${icon('trash-2')} Delete</button>
					</div>
				</td>
			</tr>`;
		})
		.join('');
	return `
		<section class="mt-4 grid gap-4">
			<div class="shell-panel rounded-xl p-4">
				<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
					<p class="font-semibold">Bot accounts</p>
					<button class="btn-secondary py-1.5" type="button" data-view="bots">${icon('bot')} Open Bots page</button>
				</div>
				<p class="mt-1 text-sm text-zinc-500">Extra Epic accounts that run next to the main bot. The main bot's own sign-in is in the form above. Edit opens the bot's settings.</p>
				${accounts.length
					? `<div class="mt-3 overflow-x-auto"><table class="w-full text-left text-sm">
						<thead class="text-xs uppercase text-zinc-500"><tr><th class="py-2 pr-3 font-semibold">Label</th><th class="py-2 pr-3 font-semibold">Epic account</th><th class="py-2 pr-3 font-semibold">Platform</th><th class="py-2 pr-3 font-semibold">Status</th><th class="py-2 pr-3 font-semibold">Auto-start</th><th></th></tr></thead>
						<tbody>${rows}</tbody>
					</table></div>`
					: '<p class="mt-3 text-sm text-zinc-500">No extra bots yet. Add one below.</p>'}
			</div>
			${addForm()}
		</section>`;
}

function config() {
	return state.config || {};
}
