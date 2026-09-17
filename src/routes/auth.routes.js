import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import { PasswordReset, User, normalizeSuspension } from '../models/index.js';
import { sendPasswordResetEmail } from '../services/mailer.js';
import {
	PASSWORD_RESET_TTL_MS,
	asyncRoute,
	cleanEmail,
	cleanUsername,
	establishSession,
	hashToken,
	httpError,
	resetLinkBase,
	suspensionPayload,
	validateAuthInput
} from '../http/helpers.js';

export function registerAuthRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	app.get(
		'/api/session',
		asyncRoute(async (req, res) => {
			if (!req.user) return res.json({ user: null });
			return res.json({
				user: req.user.toSafeJSON(),
				runtime: runtime.serialize(req.user.id),
				suspension: suspensionPayload(req.user)
			});
		})
	);

	app.post(
		'/api/auth/register',
		asyncRoute(async (req, res) => {
			const username = cleanUsername(req.body.username);
			const email = cleanEmail(req.body.email);
			const password = String(req.body.password ?? '');
			validateAuthInput({ username, email, password }, true);

			const firstUser = (await User.count()) === 0;
			const passwordHash = await bcrypt.hash(password, 12);

			const user = await User.create({
				username,
				email,
				passwordHash,
				role: firstUser ? 'admin' : 'user'
			}).catch((error) => {
				if (error.name === 'SequelizeUniqueConstraintError') {
					throw httpError(409, 'That username or email is already registered.');
				}
				throw error;
			});

			await establishSession(req, user.id);
			return res.status(201).json({ user: user.toSafeJSON() });
		})
	);

	app.post(
		'/api/auth/login',
		asyncRoute(async (req, res) => {
			const email = cleanEmail(req.body.email);
			const password = String(req.body.password ?? '');
			validateAuthInput({ email, password }, false);

			const user = await normalizeSuspension(await User.findOne({ where: { email } }));
			if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
				throw httpError(401, 'Invalid email or password.');
			}
			if (user.status === 'suspended') {
				throw httpError(403, 'This account is suspended.');
			}

			await establishSession(req, user.id);
			return res.json({ user: user.toSafeJSON() });
		})
	);

	app.post('/api/auth/logout', (req, res) => {
		req.session.destroy(() => res.json({ ok: true }));
	});

	app.post(
		'/api/auth/forgot-password',
		asyncRoute(async (req, res) => {
			const email = cleanEmail(req.body.email);
			// Always respond the same way so the endpoint cannot be used to enumerate accounts.
			const genericResponse = {
				ok: true,
				message: 'If an account exists for that email, a password reset link has been sent.'
			};
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(genericResponse);

			const user = await User.findOne({ where: { email } });
			if (!user) return res.json(genericResponse);

			// Invalidate any outstanding tokens for this user before issuing a new one.
			await PasswordReset.destroy({ where: { userId: user.id, usedAt: null } });

			const token = randomBytes(32).toString('hex');
			await PasswordReset.create({
				userId: user.id,
				tokenHash: hashToken(token),
				expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
			});

			const resetUrl = `${resetLinkBase(req)}/?reset_token=${token}`;
			try {
				await sendPasswordResetEmail({
					to: user.email,
					username: user.username,
					resetUrl,
					expiresMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000)
				});
			} catch (error) {
				console.error(`[Mailer] Failed to send password reset email: ${error.message}`);
			}
			return res.json(genericResponse);
		})
	);

	app.post(
		'/api/auth/reset-password',
		asyncRoute(async (req, res) => {
			const token = String(req.body.token ?? '').trim();
			const password = String(req.body.password ?? '');
			if (!token) throw httpError(400, 'A reset token is required.');
			if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');

			const record = await PasswordReset.findOne({
				where: {
					tokenHash: hashToken(token),
					usedAt: null,
					expiresAt: { [Op.gt]: new Date() }
				}
			});
			if (!record) throw httpError(400, 'This reset link is invalid or has expired. Request a new one.');

			const user = await User.findByPk(record.userId);
			if (!user) throw httpError(400, 'This reset link is invalid or has expired. Request a new one.');

			user.passwordHash = await bcrypt.hash(password, 12);
			await user.save();
			await record.update({ usedAt: new Date() });
			// Drop any other outstanding tokens for this account.
			await PasswordReset.destroy({ where: { userId: user.id, usedAt: null } });

			return res.json({ ok: true, message: 'Your password has been reset. You can now sign in.' });
		})
	);
}
