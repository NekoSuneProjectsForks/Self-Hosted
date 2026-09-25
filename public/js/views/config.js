import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';

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

export function renderConfig() {
	const config = state.config || {};
	const engine = config.runtimeMode === 'fnlb' ? 'fnlb' : 'fnbr';
	const fnbr = engineOnly('fnbr', engine);
	const fnlb = engineOnly('fnlb', engine);
	return `
		<form data-form="config" class="grid gap-4 xl:grid-cols-[1fr_360px]">
			<section class="shell-panel rounded-lg p-4 sm:p-6">
				<div class="grid gap-4 md:grid-cols-2">
					<label class="md:col-span-2">
						<span class="label">Bot Engine</span>
						<select class="input" name="runtimeMode" data-action="config-engine">
							<option value="fnbr" ${config.runtimeMode !== 'fnlb' ? 'selected' : ''}>Local fnbr.js bot system</option>
							<option value="fnlb" ${config.runtimeMode === 'fnlb' ? 'selected' : ''}>Legacy FNLB cloud API/runtime</option>
						</select>
					</label>
					<label class="md:col-span-2" ${fnbr}>
					<span class="label">One-time Epic Authorization Code</span>
					<input class="input" name="authorizationCode" type="password" ${NO_AUTOFILL} placeholder="${config.authorizationCodeConfigured ? 'Saved authorization code pending use' : 'Paste 32 character code from Epic login redirect'}" />
						${config.deviceAuthConfigured ? '' : `
							<span class="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
								<a class="btn-secondary" href="https://www.epicgames.com/id/api/redirect?clientId=3f69e56c7649492c8cc29f1af08a8a12&responseType=code" target="_blank" rel="noopener noreferrer">${icon('external-link')} Get code from Epic</a>
								Sign in as the bot account, then copy the <code>authorizationCode</code> value and paste it here. It works once and expires in a few minutes.
							</span>
						`}
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
					<span class="label">Platform</span>
						<select class="input" name="platform">
							${['WIN', 'MAC', 'PSN', 'PS5', 'XBL', 'XSX', 'SWT', 'SWT2', 'IOS', 'AND', 'LUNA'].map((platform) => `<option value="${platform}" ${config.platform === platform ? 'selected' : ''}>${platform}</option>`).join('')}
						</select>
					</label>
					<label ${fnbr}>
					<span class="label">Default Status</span>
						<input class="input" name="defaultStatus" value="${escapeHtml(config.defaultStatus || '')}" placeholder="Battle Royale Lobby - 1 / 16" />
					</label>
					<label class="md:col-span-2" ${fnlb}>
					<span class="label">Legacy FNLB API Token</span>
					<input class="input" name="apiToken" type="password" ${NO_AUTOFILL} placeholder="${config.apiTokenConfigured ? `Saved: ${escapeHtml(config.apiTokenMasked)}` : 'API token'}" />
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
					</label>
					<label class="md:col-span-2" ${fnlb}>
					<span class="label">Legacy FNLB Bots (optional)</span>
						<input class="input" name="bots" value="${escapeHtml(config.bots || '')}" placeholder="Leave empty for all bots, or botId1,botId2" />
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
	`;
}
