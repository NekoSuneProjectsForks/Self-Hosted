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

export function epicCodeButton(label = 'Sign in / get code', target = 'main') {
	return `<button class="btn-secondary" type="button" data-action="epic-code-prompt" data-epic-target="${escapeHtml(target)}">${icon('log-in')} ${escapeHtml(label)}</button>`;
}

function targetText() {
	const target = state.epicCodeTarget || 'main';
	if (target === 'main') return 'your main bot';
	if (target === 'new') return 'a new extra bot';
	const account = (state.botAccounts || []).find((row) => row.id === target);
	return account ? `the extra bot "${escapeHtml(account.label)}"` : 'this bot';
}

function renderSignInProgress(login) {
	const expired = login.status === 'expired';
	return `
		<div class="mt-4 rounded-lg border border-fnlb-400/30 bg-fnlb-500/10 p-4 text-sm">
			${expired
				? '<p class="font-semibold text-amber-200">The sign-in expired. Start again.</p>'
				: `<p class="text-zinc-300">1. Open Epic's page, preferably in a private window so you don't sign in as your main account.</p>
				   <a class="btn-primary mt-2" href="${escapeHtml(login.url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')} Open Epic sign-in</a>
				   <p class="mt-3 text-zinc-300">2. Sign in with the <strong>dummy</strong> account's email and password. If Epic asks for a code, enter:</p>
				   <p class="mt-1 font-mono text-2xl font-bold tracking-widest text-zinc-50">${escapeHtml(login.userCode)}</p>
				   <p class="mt-3 flex items-center gap-2 text-zinc-400">${icon('loader', 'h-4 w-4 animate-spin')} Waiting for you to finish on Epic. This updates by itself.</p>`}
		</div>`;
}

export function renderEpicCodePrompt() {
	if (!state.epicCodePrompt) return '';
	const ack = Boolean(state.epicCodeAck);
	const login = state.epicLogin;
	return `
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="epic-code-title">
			<div class="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-lg border border-red-400/40 bg-zinc-950 p-5 shadow-2xl">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 text-red-300">${icon('triangle-alert', 'h-6 w-6')}</div>
					<div>
						<p id="epic-code-title" class="text-lg font-bold text-red-200">Use a dummy account, not your main account</p>
						<p class="mt-2 text-sm text-zinc-300">You're signing in ${targetText()}. Whatever account you sign in with becomes the bot. Running a lobby bot on an account carries a <strong>high risk of that account being banned</strong> if it is abused or reported. Never use the account you play on or have bought items on.</p>
					</div>
				</div>

				<label class="mt-4 flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-zinc-200">
					<input class="mt-1 h-4 w-4 accent-fnlb-500" type="checkbox" data-action="epic-code-ack" ${ack ? 'checked' : ''} ${login ? 'disabled' : ''} />
					I understand. I'm using a dummy account, not my main account.
				</label>

				${login ? renderSignInProgress(login) : `
					<div class="mt-4 rounded-lg border border-white/10 p-4">
						<p class="font-semibold text-zinc-100">Sign in with Epic <span class="text-xs font-normal text-fnlb-300">(recommended)</span></p>
						<p class="mt-1 text-sm text-zinc-400">Sign in on Epic's own page with the account's email and password. Epic handles captcha and 2FA, this dashboard never sees the password, and the login is saved automatically. There's nothing to copy.</p>
						<button class="btn-primary mt-3" type="button" data-action="epic-signin-start" ${ack ? '' : 'disabled'}>${icon('log-in')} Sign in with Epic</button>
					</div>

					<div class="mt-3 rounded-lg border border-white/10 p-4">
						<p class="font-semibold text-zinc-100">Or paste a one-time code</p>
						<ol class="mt-1 list-decimal space-y-1 pl-5 text-sm text-zinc-400">
							<li>In a private window, sign in to Epic as the <strong>dummy</strong> account.</li>
							<li>Open the link below in that window.</li>
							<li>Copy the whole page (or just the <code>authorizationCode</code> value) into the code box.</li>
							<li>Start the bot within about 5 minutes. A code works once.</li>
						</ol>
						<input class="input mt-2 font-mono text-xs" readonly value="${escapeHtml(EPIC_CODE_URL)}" data-epic-code-url />
						<div class="mt-2 flex flex-wrap gap-2">
							<button class="btn-secondary" type="button" data-action="epic-code-copy" ${ack ? '' : 'disabled'}>${icon('copy')} Copy link</button>
							<button class="btn-secondary" type="button" data-action="epic-code-open" ${ack ? '' : 'disabled'}>${icon('external-link')} Open link</button>
						</div>
					</div>`}

				<div class="mt-4 flex justify-end">
					<button class="btn-secondary" type="button" data-action="epic-code-cancel">${login ? 'Cancel sign-in' : 'Close'}</button>
				</div>
			</div>
		</div>
	`;
}
