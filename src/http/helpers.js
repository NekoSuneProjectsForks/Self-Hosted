import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Shared HTTP helpers: error shaping, input cleaning and cosmetic utilities. */
export const appVersion = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

export function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

export function asyncRoute(handler) {
	return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function cleanEmail(value) {
	return String(value ?? '').trim().toLowerCase();
}

export function cleanUsername(value) {
	return String(value ?? '').trim();
}

export function validateAuthInput({ username, email, password }, requireUsername = false) {
	if (requireUsername && !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
		throw httpError(400, 'Username must be 3-40 characters and use letters, numbers, dots, dashes, or underscores.');
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw httpError(400, 'Enter a valid email address.');
	}
	if (String(password ?? '').length < 8) {
		throw httpError(400, 'Password must be at least 8 characters.');
	}
}

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashToken(token) {
	return createHash('sha256').update(token).digest('hex');
}

export function resetLinkBase(req) {
	const configured = process.env.APP_URL?.trim();
	if (configured) return configured.replace(/\/+$/, '');
	const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
	return `${proto}://${req.get('host')}`;
}

export function suspensionPayload(user) {
	const permanent = user.status === 'suspended' && !user.suspendedUntil;
	return {
		status: user.status,
		permanent,
		suspendedUntil: user.suspendedUntil,
		suspendedReason: user.suspendedReason
	};
}

export const botActionCommands = {
	add_friend: 'add_friend',
	remove_friend: 'remove_friend',
	block_user: 'block_user',
	unblock_user: 'unblock_user',
	invite: 'invite',
	join_party: 'join_party',
	kick: 'kick',
	kick_all: 'kick_all',
	hide_all: 'hide_all',
	unhide_all: 'unhide_all',
	set_playlist: 'set_playlist',
	ready: 'ready',
	unready: 'unready',
	set_status: 'set_status',
	say: 'say',
	leave_lobby: 'leave'
};

export function cosmeticList(value, withVariants = false) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.map((id) => (withVariants ? { id, variants: [] } : { id }));
}

export const cosmeticSlots = {
	startOutfit: true,
	startBackpack: true,
	startPickaxe: true,
	startShoes: true,
	startBanner: false,
	startBannerColor: false,
	joinOutfit: true,
	joinBackpack: true,
	joinPickaxe: true,
	joinShoes: true,
	joinEmote: false,
	memberJoinOutfit: true,
	memberJoinBackpack: true,
	memberJoinPickaxe: true,
	memberJoinShoes: true,
	memberJoinEmote: false
};

export function equipCosmetic(currentConfig, slot, itemId, mode = 'replace') {
	if (!Object.hasOwn(cosmeticSlots, slot)) {
		throw httpError(400, 'Unsupported cosmetic slot.');
	}
	if (!itemId || itemId.length > 255) throw httpError(400, 'A valid Fortnite item ID is required.');

	const withVariants = cosmeticSlots[slot];
	const nextItem = withVariants ? { id: itemId, variants: [] } : { id: itemId };
	const currentItems = Array.isArray(currentConfig[slot]) ? currentConfig[slot] : [];

	if (mode === 'append') {
		const withoutDuplicate = currentItems.filter((item) => item.id !== itemId);
		currentConfig[slot] = [...withoutDuplicate, nextItem].slice(0, 30);
		return;
	}

	currentConfig[slot] = [nextItem];
}

/**
 * Regenerates the session before the authenticated user is attached to it, so a
 * session ID an attacker planted beforehand cannot become an authenticated one.
 */
export function establishSession(req, userId) {
	return new Promise((resolve, reject) => {
		req.session.regenerate((error) => {
			if (error) return reject(error);
			req.session.userId = userId;
			req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
		});
	});
}

export function optionalInteger(value) {
	if (value === undefined || value === null || value === '') return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}
