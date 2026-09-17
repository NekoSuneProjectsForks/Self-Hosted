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
	await sequelize.authenticate();
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
