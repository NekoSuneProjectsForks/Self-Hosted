/**
 * Common interface every engine adapter implements.
 *
 * Methods that an engine genuinely cannot perform throw `unsupported()` rather
 * than silently doing nothing, so the dashboard never shows a control that
 * pretends to work. `getCapabilities()` is the honest, machine-readable version
 * of the same information and is what the UI should drive off.
 */
export function unsupported(engine, operation) {
	const error = new Error(`The ${engine} engine does not support ${operation}.`);
	error.status = 501;
	error.unsupported = true;
	return error;
}

export function runtimeError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

export class BaseRuntime {
	constructor({ engine, userId, startConfig, appendLog, emit }) {
		this.engine = engine;
		this.kind = engine;
		this.userId = userId;
		this.startConfig = startConfig;
		this.appendLog = appendLog;
		this.emit = emit || (() => {});
	}

	log(content, format = 0) {
		this.appendLog?.(this.userId, content, format);
	}

	unsupported(operation) {
		return unsupported(this.engine, operation);
	}

	// ---- lifecycle -------------------------------------------------------
	async start() {
		throw this.unsupported('start');
	}

	async stop() {
		throw this.unsupported('stop');
	}

	async restart() {
		await this.stop();
		await this.start();
	}

	// ---- read ------------------------------------------------------------
	async getDashboard() {
		throw this.unsupported('dashboard');
	}

	async getBots() {
		throw this.unsupported('listing bots');
	}

	async getBotDetails() {
		throw this.unsupported('bot details');
	}

	async getFriends() {
		throw this.unsupported('friends');
	}

	async getPendingFriends() {
		throw this.unsupported('pending friends');
	}

	async getBlockedUsers() {
		throw this.unsupported('blocked users');
	}

	async comparePresence() {
		throw this.unsupported('presence diagnostics');
	}

	async getParty() {
		throw this.unsupported('party state');
	}

	// ---- messaging -------------------------------------------------------
	async sendFriendMessage() {
		throw this.unsupported('friend messages');
	}

	async sendPartyMessage() {
		throw this.unsupported('party chat');
	}

	// ---- friends ---------------------------------------------------------
	async addFriend() {
		throw this.unsupported('adding friends');
	}

	async acceptFriend() {
		throw this.unsupported('accepting friend requests');
	}

	async declineFriend() {
		throw this.unsupported('declining friend requests');
	}

	async removeFriend() {
		throw this.unsupported('removing friends');
	}

	async blockUser() {
		throw this.unsupported('blocking users');
	}

	async unblockUser() {
		throw this.unsupported('unblocking users');
	}

	// ---- party -----------------------------------------------------------
	async inviteUser() {
		throw this.unsupported('party invites');
	}

	async joinParty() {
		throw this.unsupported('joining parties');
	}

	async leaveParty() {
		throw this.unsupported('leaving parties');
	}

	async kickMember() {
		throw this.unsupported('kicking members');
	}

	async promoteMember() {
		throw this.unsupported('promoting members');
	}

	async setStatus() {
		throw this.unsupported('presence status');
	}

	async setPlaylist() {
		throw this.unsupported('playlists');
	}

	async setPrivacy() {
		throw this.unsupported('party privacy');
	}

	async setReadiness() {
		throw this.unsupported('readiness');
	}

	async setSittingOut() {
		throw this.unsupported('sitting out');
	}

	// ---- cosmetics -------------------------------------------------------
	async setCosmetic() {
		throw this.unsupported('cosmetics');
	}

	async setEmote() {
		throw this.unsupported('emotes');
	}

	async clearEmote() {
		throw this.unsupported('clearing emotes');
	}

	// ---- misc ------------------------------------------------------------
	async searchUsers() {
		throw this.unsupported('user search');
	}

	async runCommand() {
		throw this.unsupported('commands');
	}

	getCapabilities() {
		return { engine: this.engine, capabilities: {} };
	}
}
