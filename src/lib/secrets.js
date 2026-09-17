import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, ensureDataDirs } from './paths.js';

let encryptionKey;
let sessionSecret;

function parseKey(value, bytes) {
	const trimmed = value.trim();
	for (const encoding of ['base64', 'hex']) {
		const candidate = Buffer.from(trimmed, encoding);
		if (candidate.length === bytes) return candidate;
	}
	return createHash('sha256').update(trimmed).digest().subarray(0, bytes);
}

async function loadOrCreateSecret(fileName, bytes) {
	await ensureDataDirs();
	const filePath = join(dataDir, fileName);
	try {
		return (await readFile(filePath, 'utf8')).trim();
	} catch {
		const value = randomBytes(bytes).toString('base64');
		await writeFile(filePath, `${value}\n`, { mode: 0o600 });
		return value;
	}
}

export async function initSecrets() {
	const encryptionSource =
		process.env.ENCRYPTION_KEY || (await loadOrCreateSecret('encryption.key', 32));
	const sessionSource =
		process.env.SESSION_SECRET || (await loadOrCreateSecret('session.secret', 48));

	encryptionKey = parseKey(encryptionSource, 32);
	sessionSecret = sessionSource;
}

export function getSessionSecret() {
	if (!sessionSecret) throw new Error('Secrets have not been initialized.');
	return sessionSecret;
}

export function encryptText(value) {
	if (value === undefined || value === null || value === '') return null;
	if (!encryptionKey) throw new Error('Secrets have not been initialized.');

	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
	const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptText(value) {
	if (!value) return '';
	if (!String(value).startsWith('v1:')) return String(value);
	if (!encryptionKey) throw new Error('Secrets have not been initialized.');

	const [, ivBase64, tagBase64, encryptedBase64] = String(value).split(':');
	const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivBase64, 'base64'));
	decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

	return Buffer.concat([
		decipher.update(Buffer.from(encryptedBase64, 'base64')),
		decipher.final()
	]).toString('utf8');
}

export function maskSecret(value) {
	if (!value) return '';
	if (value.length <= 8) return '••••';
	return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
