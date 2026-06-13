import nodemailer from 'nodemailer';

let transporter = null;
let mailFrom = '';
let configured = false;

function bool(value, fallback = false) {
	if (value === undefined || value === null || value === '') return fallback;
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * Initialise the SMTP transport from environment variables. When SMTP is not
 * configured the mailer falls back to logging messages to the server console,
 * so password resets still work for local / self-hosted setups.
 */
export async function initMailer() {
	const host = process.env.SMTP_HOST?.trim();
	mailFrom = process.env.SMTP_FROM?.trim() || 'FNLB Dashboard <no-reply@localhost>';

	if (!host) {
		transporter = null;
		configured = false;
		console.log('[Mailer] SMTP is not configured. Password reset links will be printed to this console.');
		return;
	}

	const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
	const secure = bool(process.env.SMTP_SECURE, port === 465);
	const user = process.env.SMTP_USER?.trim();
	const pass = process.env.SMTP_PASS;

	transporter = nodemailer.createTransport({
		host,
		port,
		secure,
		auth: user ? { user, pass } : undefined
	});

	try {
		await transporter.verify();
		configured = true;
		console.log(`[Mailer] SMTP ready via ${host}:${port} (secure=${secure}).`);
	} catch (error) {
		configured = false;
		console.error(`[Mailer] SMTP verification failed (${error.message}). Falling back to console output.`);
		transporter = null;
	}
}

export function isMailerConfigured() {
	return configured;
}

async function deliver({ to, subject, text, html }) {
	if (!transporter) {
		console.log('\n===== EMAIL (SMTP not configured) =====');
		console.log(`To:      ${to}`);
		console.log(`Subject: ${subject}`);
		console.log(text);
		console.log('=======================================\n');
		return { delivered: false };
	}

	await transporter.sendMail({ from: mailFrom, to, subject, text, html });
	return { delivered: true };
}

export async function sendPasswordResetEmail({ to, username, resetUrl, expiresMinutes }) {
	const subject = 'Reset your FNLB Dashboard password';
	const text = [
		`Hi ${username || 'there'},`,
		'',
		'We received a request to reset the password for your FNLB Dashboard account.',
		'Open the link below to choose a new password:',
		'',
		resetUrl,
		'',
		`This link expires in ${expiresMinutes} minutes and can only be used once.`,
		'If you did not request this, you can safely ignore this email.',
		'',
		'— FNLB Dashboard'
	].join('\n');

	const html = `
		<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:auto;color:#e4e4e7;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:28px">
			<h2 style="margin:0 0 16px;color:#fafafa">Reset your password</h2>
			<p style="margin:0 0 12px;color:#a1a1aa">Hi ${escapeHtml(username || 'there')}, we received a request to reset the password for your FNLB Dashboard account.</p>
			<p style="margin:0 0 20px;color:#a1a1aa">Click the button below to choose a new password.</p>
			<p style="margin:0 0 24px">
				<a href="${escapeAttr(resetUrl)}" style="display:inline-block;background:#22c55e;color:#052e16;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">Reset password</a>
			</p>
			<p style="margin:0 0 8px;color:#71717a;font-size:13px">Or paste this link into your browser:</p>
			<p style="margin:0 0 20px;word-break:break-all;font-size:13px"><a href="${escapeAttr(resetUrl)}" style="color:#4ade80">${escapeHtml(resetUrl)}</a></p>
			<p style="margin:0;color:#71717a;font-size:12px">This link expires in ${expiresMinutes} minutes and can only be used once. If you did not request this, you can safely ignore this email.</p>
		</div>`;

	return deliver({ to, subject, text, html });
}

function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function escapeAttr(value) {
	return escapeHtml(value);
}
