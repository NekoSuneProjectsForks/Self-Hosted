import { Op } from 'sequelize';
import { ensureDataDirs } from '../lib/paths.js';
import { sequelize } from './sequelize.js';
import { ensureBotConfigColumns } from './migrations.js';
import { BotLog } from './BotLog.js';
import './associations.js';

export { sequelize } from './sequelize.js';
export { BotConfig } from './BotConfig.js';
export { BotLog } from './BotLog.js';
export { BotSession } from './BotSession.js';
export { FriendMessage } from './FriendMessage.js';
export { MatchRound } from './MatchRound.js';
export { PasswordReset } from './PasswordReset.js';
export { QuickCommand } from './QuickCommand.js';
export { ReplayUpload } from './ReplayUpload.js';
export { SessionMedia } from './SessionMedia.js';
export { SessionStat } from './SessionStat.js';
export { User } from './User.js';

export async function initDatabase() {
	await ensureDataDirs();
	try {
		await sequelize.authenticate();
	} catch (error) {
		// sqlite3 is a native module. Some hosts (and npm's allow-scripts policy)
		// block its install script, which leaves the package present but without
		// a compiled binding. Say so plainly instead of failing with a stack
		// trace about a missing dialect.
		if (/sqlite3|dialect|bindings|NODE_MODULE_VERSION|\.node/i.test(error.message)) {
			throw new Error(
				`The SQLite driver could not be loaded: ${error.message}\n` +
					'The sqlite3 native binding is missing or was built for a different Node version.\n' +
					'Fix it with:  npm rebuild sqlite3\n' +
					"If your host blocked the install script, allow it first (npm: `npm approve-scripts sqlite3`), then rerun the rebuild."
			);
		}
		throw error;
	}
	await sequelize.sync();
	await ensureBotConfigColumns();
}

export async function normalizeSuspension(user) {
	if (!user || user.status !== 'suspended' || !user.suspendedUntil) return user;
	if (new Date(user.suspendedUntil).getTime() > Date.now()) return user;

	await user.update({
		status: 'active',
		suspendedUntil: null,
		suspendedReason: null
	});
	return user;
}

export async function pruneLogs(userId, keep = 500) {
	const oldRows = await BotLog.findAll({
		where: { userId },
		attributes: ['id'],
		order: [['createdAt', 'DESC']],
		offset: keep
	});
	if (!oldRows.length) return;
	await BotLog.destroy({ where: { id: { [Op.in]: oldRows.map((row) => row.id) } } });
}
