import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseRuntime, runtimeError } from './BaseRuntime.js';
import { fnlbDataDir } from '../lib/paths.js';
import {
	fetchFnlbBotDetails,
	fetchFnlbBots,
	fetchFnlbDashboard,
	runFnlbCommand,
	searchFnlbUsers,
	sendFnlbChatMessage,
	updateFnlbBot,
	updateFnlbCategory
} from '../services/fnlbApi.js';

/**
 * The `fnlb` package is imported lazily and only from this file. If FNLB's
 * distribution server, package or API is broken, the local fnbr engine is
 * completely unaffected — nothing outside this module touches it.
 */
async function loadLegacyFnlb() {
	try {
		const module = await import('fnlb');
		return module.default ?? module;
	} catch (error) {
		throw runtimeError(
			503,
			`The legacy FNLB package could not be loaded: ${error.message}. Local fnbr mode does not need it.`
		);
	}
}

/** FNLB commands that the dashboard is known to be able to run. */
const FNLB_COMMANDS = {
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

export class LegacyFnlbRuntime extends BaseRuntime {
	constructor(options) {
		super({ ...options, engine: 'fnlb' });
		this.manager = null;
		this.plainConfig = options.plainConfig;
		this.apiToken = options.plainConfig?.apiToken || '';
	}

	getCapabilities() {
		return {
			engine: 'fnlb',
			capabilities: {
				friends: true,
				// FNLB exposes friend lists but the dashboard has no verified
				// endpoint for sending a direct message through it.
				friendMessages: false,
				// Accept/decline ride on Epic's add/remove friend semantics via
				// FNLB's existing add_friend / remove_friend commands.
				friendRequests: true,
				blockedUsers: true,
				party: true,
				partyChat: true,
				cosmetics: true,
				// Not claimed: no verified FNLB command for changing a running
				// bot's cosmetics exists in this codebase. Category edits are
				// persisted and take effect on the next bot reload.
				realtimeCosmetics: false,
				playlist: true,
				privacy: false,
				readiness: true,
				sittingOut: false,
				squadFill: false,
				presence: true,
				matchTracking: false,
				searchUsers: true,
				promoteMember: false,
				multiBot: true
			},
			notes: {
				realtimeCosmetics:
					'FNLB category cosmetics are saved immediately but only appear on a bot after it reloads. No verified live FNLB cosmetic command is available.'
			}
		};
	}

	requireToken() {
		if (!this.apiToken) throw runtimeError(400, 'No FNLB API token is saved for this user.');
		return this.apiToken;
	}

	async start() {
		const FNLB = await loadLegacyFnlb();
		const clusterDir = join(fnlbDataDir, this.userId);
		await mkdir(clusterDir, { recursive: true });

		this.manager = new FNLB({
			clusterName: this.plainConfig.clusterName,
			fnlbPath: clusterDir,
			onLogMessage: (message) => this.appendLog(this.userId, message.content, message.format),
			onSubProcessLogMessage: (message) => this.appendLog(this.userId, message.content, message.format)
		});

		this.log(`Starting legacy FNLB cluster ${this.plainConfig.clusterName}...`, 2);
		await this.manager.start(this.startConfig);
	}

	async stop() {
		if (!this.manager) return;
		const manager = this.manager;
		this.manager = null;
		await manager.stop();
	}

	async update() {
		if (!this.manager) return;
		await this.manager.update(true);
	}

	async getDashboard() {
		return fetchFnlbDashboard(this.requireToken());
	}

	async getBots() {
		return fetchFnlbBots(this.requireToken());
	}

	async getBotDetails(botId) {
		return fetchFnlbBotDetails(this.requireToken(), botId);
	}

	async getFriends(botId) {
		return (await this.getBotDetails(botId)).friends;
	}

	async getPendingFriends(botId) {
		return (await this.getBotDetails(botId)).pendingFriends;
	}

	async getBlockedUsers(botId) {
		return (await this.getBotDetails(botId)).blockedUsers;
	}

	async getParty(botId) {
		const details = await this.getBotDetails(botId);
		return details.bot?.party ?? null;
	}

	async sendPartyMessage(content, botId, locale = 'en') {
		return sendFnlbChatMessage(this.requireToken(), botId, { content, locale });
	}

	async sendFriendMessage() {
		throw this.unsupported('direct friend messages');
	}

	// ---- friends --------------------------------------------------------
	//
	// Epic exposes friendships through a single endpoint pair, which FNLB's
	// `add_friend` / `remove_friend` commands sit on top of:
	//
	//   POST   /friends/{self}/friends/{id}  -> send a request, OR accept an
	//                                           incoming one
	//   DELETE /friends/{self}/friends/{id}  -> remove a friend, OR decline an
	//                                           incoming request, OR cancel an
	//                                           outgoing one
	//
	// So accepting is `add_friend` and declining/cancelling is `remove_friend`.
	// Both commands are already in FNLB_COMMANDS; no command name is invented.

	async addFriend(target, botId) {
		await this.runCommand('add_friend', target, botId);
		return { content: 'Friend request sent.', format: 1, source: 'fnlb' };
	}

	async acceptFriend(friendId, botId) {
		await this.runCommand('add_friend', friendId, botId);
		return { content: 'Friend request accepted.', format: 1, source: 'fnlb' };
	}

	async declineFriend(friendId, botId) {
		await this.runCommand('remove_friend', friendId, botId);
		return {
			content: 'Friend request declined or cancelled.',
			format: 1,
			source: 'fnlb'
		};
	}

	async removeFriend(friendId, botId) {
		await this.runCommand('remove_friend', friendId, botId);
		return { content: 'Friend removed.', format: 1, source: 'fnlb' };
	}

	async blockUser(target, botId) {
		await this.runCommand('block_user', target, botId);
		return { content: 'User blocked.', format: 1, source: 'fnlb' };
	}

	async unblockUser(target, botId) {
		await this.runCommand('unblock_user', target, botId);
		return { content: 'User unblocked.', format: 1, source: 'fnlb' };
	}

	// ---- party ----------------------------------------------------------

	async inviteUser(target, botId) {
		await this.runCommand('invite', target, botId);
		return { content: 'Party invite sent.', format: 1, source: 'fnlb' };
	}

	async joinParty(target, botId) {
		await this.runCommand('join_party', target, botId);
		return { content: 'Joined party.', format: 1, source: 'fnlb' };
	}

	async leaveParty(botId) {
		await this.runCommand('leave_lobby', '', botId);
		return { content: 'Left the party.', format: 1, source: 'fnlb' };
	}

	async kickMember(target, botId) {
		await this.runCommand('kick', target, botId);
		return { content: 'Party member kicked.', format: 1, source: 'fnlb' };
	}

	async setStatus(status, botId) {
		await this.runCommand('set_status', status, botId);
		return { content: 'Presence status updated.', format: 1, source: 'fnlb' };
	}

	async setPlaylist(mnemonic, botId) {
		await this.runCommand('set_playlist', mnemonic, botId);
		return { content: 'Playlist updated.', format: 1, source: 'fnlb' };
	}

	async setReadiness(ready, botId) {
		await this.runCommand(ready ? 'ready' : 'unready', '', botId);
		return {
			content: ready ? 'Bot marked ready.' : 'Bot marked not ready.',
			format: 1,
			source: 'fnlb'
		};
	}

	async hideMembers(hide, botId) {
		await this.runCommand(hide ? 'hide_all' : 'unhide_all', '', botId);
		return {
			content: hide ? 'Party members hidden.' : 'Party members unhidden.',
			format: 1,
			source: 'fnlb'
		};
	}

	// ---- genuinely unsupported by the FNLB command set ------------------

	async setPrivacy() {
		throw this.unsupported('party privacy');
	}

	async promoteMember() {
		throw this.unsupported('promoting members');
	}

	async setSittingOut() {
		throw this.unsupported('sitting out');
	}

	async setSquadFill() {
		throw this.unsupported('squad fill');
	}

	/**
	 * Persists the cosmetic to the FNLB category. It does NOT claim the running
	 * bot changed: `appliedLive` is false so the UI can say "applies on reload"
	 * instead of showing a change that has not happened.
	 */
	async setCosmetic(slot, itemId, { categoryId, category, nextConfig } = {}) {
		if (!categoryId) throw runtimeError(400, 'An FNLB category is required to save a cosmetic.');
		// Without the caller-built config this would PATCH the category with an
		// undefined config and wipe the saved loadout, so refuse instead.
		if (!nextConfig || typeof nextConfig !== 'object') {
			throw runtimeError(
				400,
				'FNLB cosmetics must be saved through the category endpoint so the existing loadout is preserved. Use PATCH /api/fnlb/categories/:categoryId/cosmetics.'
			);
		}
		const result = await updateFnlbCategory(this.requireToken(), categoryId, {
			name: category?.name,
			config: nextConfig
		});
		return {
			...result,
			categoryId,
			config: nextConfig,
			slot,
			itemId,
			appliedLive: false,
			requiresReload: true,
			content:
				'Saved to the FNLB category. FNLB has no verified live cosmetic command, so running bots pick this up on their next reload.',
			source: 'fnlb'
		};
	}

	async searchUsers(prefix, platform, botId) {
		return searchFnlbUsers(this.requireToken(), botId, prefix);
	}

	async updateBot(botId, payload) {
		return updateFnlbBot(this.requireToken(), botId, payload);
	}

	async updateCategory(categoryId, payload) {
		return updateFnlbCategory(this.requireToken(), categoryId, payload);
	}

	async runCommand(command, args, botId, locale = 'en') {
		const normalized = String(command || '').trim();
		if (!normalized) throw runtimeError(400, 'Command is required.');
		return runFnlbCommand(this.requireToken(), botId, {
			command: FNLB_COMMANDS[normalized] || normalized,
			args,
			locale
		});
	}
}

export { loadLegacyFnlb };
