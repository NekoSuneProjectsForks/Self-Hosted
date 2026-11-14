import { state } from './state.js';
import { escapeHtml, icon } from './ui.js';

/** Fortnite platform codes a bot can present as, with readable names. */
export const PLATFORMS = [
	['WIN', 'Windows PC'],
	['MAC', 'Mac'],
	['PSN', 'PlayStation 4'],
	['PS5', 'PlayStation 5'],
	['XBL', 'Xbox One'],
	['XSX', 'Xbox Series X|S'],
	['SWT', 'Nintendo Switch'],
	['SWT2', 'Nintendo Switch 2'],
	['IOS', 'iOS'],
	['AND', 'Android'],
	['LUNA', 'Amazon Luna']
];

const NAMES = Object.fromEntries(PLATFORMS);

export function platformLabel(code) {
	if (!code) return '-';
	return NAMES[code] ? `${NAMES[code]} (${code})` : code;
}

export function platformOptions(selected, { includeMain = false, mainPlatform = null } = {}) {
	const main = includeMain
		? `<option value="" ${!selected ? 'selected' : ''}>Same as main bot${mainPlatform ? `: ${escapeHtml(NAMES[mainPlatform] || mainPlatform)}` : ''}</option>`
		: '';
	return (
		main +
		PLATFORMS.map(
			([code, name]) => `<option value="${code}" ${selected === code ? 'selected' : ''}>${escapeHtml(name)} (${code})</option>`
		).join('')
	);
}

// ---- One-time Epic authorization code: warn before sending anyone to Epic ----

export const EPIC_CODE_URL =
	'https://www.epicgames.com/id/api/redirect?clientId=3f69e56c7649492c8cc29f1af08a8a12&responseType=code';

export function epicCodeButton(label = 'Get code from Epic') {
	return `<button class="btn-secondary" type="button" data-action="epic-code-prompt">${icon('external-link')} ${escapeHtml(label)}</button>`;
}

export function renderEpicCodePrompt() {
	if (!state.epicCodePrompt) return '';
	const ack = Boolean(state.epicCodeAck);
	return `
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="epic-code-title">
			<div class="w-full max-w-lg rounded-lg border border-red-400/40 bg-zinc-950 p-5 shadow-2xl">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 text-red-300">${icon('triangle-alert', 'h-6 w-6')}</div>
					<div>
						<p id="epic-code-title" class="text-lg font-bold text-red-200">Use a dummy account, not your main account</p>
						<p class="mt-2 text-sm text-zinc-300">The account you sign in with becomes the bot. Running a lobby bot on an account carries a <strong>high risk of that account being banned</strong> if it is abused or reported. Never use the account you play on or have bought items on.</p>
					</div>
				</div>

				<ol class="mt-4 list-decimal space-y-1 pl-5 text-sm text-zinc-400">
					<li>Open a private/incognito window and sign in to Epic as the <strong>dummy</strong> account.</li>
					<li>Open the link below in that window.</li>
					<li>Copy the whole page Epic shows (or just the <code>authorizationCode</code> value) and paste it into the code box.</li>
					<li>Start the bot within a few minutes. The code works once.</li>
				</ol>

				<label class="mt-4 block">
					<span class="label">Epic authorization link</span>
					<input class="input font-mono text-xs" readonly value="${escapeHtml(EPIC_CODE_URL)}" data-epic-code-url />
				</label>

				<label class="mt-4 flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-zinc-200">
					<input class="mt-1 h-4 w-4 accent-fnlb-500" type="checkbox" data-action="epic-code-ack" ${ack ? 'checked' : ''} />
					I understand. I'm using a dummy account, not my main account.
				</label>

				<div class="mt-4 flex flex-wrap justify-end gap-2">
					<button class="btn-secondary" type="button" data-action="epic-code-cancel">Cancel</button>
					<button class="btn-secondary" type="button" data-action="epic-code-copy" ${ack ? '' : 'disabled'}>${icon('copy')} Copy link</button>
					<button class="btn-primary" type="button" data-action="epic-code-open" ${ack ? '' : 'disabled'}>${icon('external-link')} Open Epic</button>
				</div>
			</div>
		</div>
	`;
}
