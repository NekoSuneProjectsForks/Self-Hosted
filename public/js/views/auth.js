import { state } from '../core/state.js';
import { escapeHtml, icon } from '../core/ui.js';

export function renderAuthForm() {
	const mode = state.authMode;

	if (mode === 'forgot') {
		return `
			<div class="mb-6">
				<p class="text-lg font-bold">Forgot your password?</p>
				<p class="mt-1 text-sm text-zinc-500">Enter your account email and we'll send you a reset link.</p>
			</div>
			<form data-form="forgot" class="space-y-4">
				<label>
					<span class="label">Email</span>
					<input class="input" name="email" type="email" autocomplete="email" required />
				</label>
				<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
					${icon('mail')} Send reset link
				</button>
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="login">Back to login</button>
			</form>
		`;
	}

	if (mode === 'reset') {
		return `
			<div class="mb-6">
				<p class="text-lg font-bold">Choose a new password</p>
				<p class="mt-1 text-sm text-zinc-500">Set a new password for your account.</p>
			</div>
			<form data-form="reset" class="space-y-4">
				<input type="hidden" name="token" value="${escapeHtml(state.resetToken || '')}" />
				<label>
					<span class="label">New password</span>
					<input class="input" name="password" type="password" autocomplete="new-password" required minlength="8" />
				</label>
				<label>
					<span class="label">Confirm new password</span>
					<input class="input" name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" />
				</label>
				<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
					${icon('key-round')} Reset password
				</button>
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="login">Back to login</button>
			</form>
		`;
	}

	const loginActive = mode === 'login';
	return `
		<div class="mb-6 flex rounded-lg border border-white/10 bg-black/20 p-1">
			<button class="flex-1 rounded-md px-3 py-2 text-sm font-semibold ${loginActive ? 'bg-fnlb-500 text-fnlb-950' : 'text-zinc-400'}" data-auth-mode="login">Login</button>
			<button class="flex-1 rounded-md px-3 py-2 text-sm font-semibold ${!loginActive ? 'bg-fnlb-500 text-fnlb-950' : 'text-zinc-400'}" data-auth-mode="register">Register</button>
		</div>

		<form data-form="${loginActive ? 'login' : 'register'}" class="space-y-4">
			${!loginActive ? `
				<label>
					<span class="label">Username</span>
					<input class="input" name="username" autocomplete="username" required minlength="3" maxlength="40" />
				</label>
			` : ''}
			<label>
				<span class="label">Email</span>
				<input class="input" name="email" type="email" autocomplete="email" required />
			</label>
			<label>
				<span class="label">Password</span>
				<input class="input" name="password" type="password" autocomplete="${loginActive ? 'current-password' : 'new-password'}" required minlength="8" />
			</label>
			<button class="btn-primary w-full" type="submit" ${state.busy ? 'disabled' : ''}>
				${icon(loginActive ? 'log-in' : 'user-plus')} ${loginActive ? 'Login' : 'Create Account'}
			</button>
			${loginActive ? `
				<button type="button" class="w-full text-center text-sm text-zinc-400 hover:text-fnlb-300" data-auth-mode="forgot">Forgot your password?</button>
			` : ''}
		</form>
	`;
}

export function renderAuth() {
	return `
		${renderToast()}
		<main class="flex min-h-screen items-center justify-center p-4">
			<section class="shell-panel grid w-full max-w-5xl overflow-hidden rounded-lg lg:grid-cols-[1fr_440px]">
				<div class="hidden min-h-[620px] border-r border-white/10 bg-black/20 p-8 lg:flex lg:flex-col lg:justify-between">
					<div>
						<div class="mb-8 flex items-center gap-3">
							<div class="flex h-11 w-11 items-center justify-center rounded-lg bg-fnlb-500 text-fnlb-950">${icon('bot', 'h-6 w-6')}</div>
							<div>
								<p class="text-lg font-bold">Lobby Bot Host Console</p>
								<p class="text-sm text-zinc-500">Self-hosted Fortnite lobby bot control</p>
							</div>
						</div>
						<div class="grid gap-3">
							<div class="card">
								<div class="mb-3 text-fnlb-300">${icon('shield-check', 'h-5 w-5')}</div>
								<p class="font-semibold">Encrypted cluster config</p>
								<p class="mt-1 text-sm text-zinc-400">API tokens and category data are stored with AES-256-GCM in SQLite.</p>
							</div>
							<div class="card">
								<div class="mb-3 text-fnlb-300">${icon('activity', 'h-5 w-5')}</div>
								<p class="font-semibold">Live fnbr bot status</p>
								<p class="mt-1 text-sm text-zinc-400">Bot cards, friends, blocked users, party state, cosmetics, chat, and command tools.</p>
							</div>
						</div>
					</div>
					<div class="rounded-lg border border-fnlb-400/20 bg-fnlb-500/10 p-4 text-sm text-fnlb-100">Secure multi-user hosting for local fnbr-powered lobby bots.</div>
				</div>

				<div class="p-6 sm:p-8">
					${renderAuthForm()}
				</div>
			</section>
		</main>
	`;
}
