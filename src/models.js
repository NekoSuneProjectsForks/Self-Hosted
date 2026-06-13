import { join } from 'node:path';
import { DataTypes, Model, Op, Sequelize } from 'sequelize';
import { dataDir, ensureDataDirs } from './paths.js';

export const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: process.env.SQLITE_PATH || join(dataDir, 'fnlb-dashboard.sqlite'),
	logging: false
});

export class User extends Model {
	toSafeJSON() {
		return {
			id: this.id,
			username: this.username,
			email: this.email,
			role: this.role,
			status: this.status,
			suspendedUntil: this.suspendedUntil,
			suspendedReason: this.suspendedReason,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt
		};
	}
}

User.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		username: {
			type: DataTypes.STRING(40),
			allowNull: false,
			unique: true
		},
		email: {
			type: DataTypes.STRING(255),
			allowNull: false,
			unique: true
		},
		passwordHash: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		role: {
			type: DataTypes.ENUM('user', 'admin'),
			allowNull: false,
			defaultValue: 'user'
		},
		status: {
			type: DataTypes.ENUM('active', 'suspended'),
			allowNull: false,
			defaultValue: 'active'
		},
		suspendedUntil: {
			type: DataTypes.DATE,
			allowNull: true
		},
		suspendedReason: {
			type: DataTypes.STRING(255),
			allowNull: true
		}
	},
	{ sequelize, modelName: 'User' }
);

export class BotConfig extends Model {}

BotConfig.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false,
			unique: true
		},
		apiTokenEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		deviceAuthEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		authorizationCodeEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		categoriesEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		clusterNameEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		defaultStatusEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		localCategoryEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		runtimeMode: {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'fnbr'
		},
		platform: {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'WIN'
		},
		killOtherTokens: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		},
		numberOfShards: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 2
		},
		botsPerShard: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 32
		},
		restartInterval: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 3600
		},
		hideUsernames: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		},
		hideEmails: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		},
		autoUpdateOnRestart: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		},
		logLevel: {
			type: DataTypes.ENUM('INFO', 'DEBUG'),
			allowNull: false,
			defaultValue: 'INFO'
		}
	},
	{ sequelize, modelName: 'BotConfig' }
);

export class BotLog extends Model {}

BotLog.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		format: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0
		},
		content: {
			type: DataTypes.TEXT,
			allowNull: false
		}
	},
	{ sequelize, modelName: 'BotLog', updatedAt: false }
);

export class QuickCommand extends Model {}

QuickCommand.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		name: {
			type: DataTypes.STRING(60),
			allowNull: false
		},
		command: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		args: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		locale: {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'en'
		}
	},
	{ sequelize, modelName: 'QuickCommand' }
);

export class BotSession extends Model {}

BotSession.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		botId: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		botName: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		startedAt: {
			type: DataTypes.DATE,
			allowNull: false,
			defaultValue: DataTypes.NOW
		},
		lastSeenAt: {
			type: DataTypes.DATE,
			allowNull: false,
			defaultValue: DataTypes.NOW
		},
		endedAt: {
			type: DataTypes.DATE,
			allowNull: true
		},
		isActive: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		},
		matches: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		partyId: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		playlistId: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		partyMembers: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		kills: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		deaths: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		statsJson: {
			type: DataTypes.TEXT,
			allowNull: true
		}
	},
	{
		sequelize,
		modelName: 'BotSession',
		indexes: [
			{ fields: ['userId', 'botId', 'isActive'] },
			{ fields: ['userId', 'botId', 'startedAt'] }
		]
	}
);

export class ReplayUpload extends Model {}

ReplayUpload.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		botId: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		botSessionId: {
			type: DataTypes.UUID,
			allowNull: true
		},
		originalName: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		fileName: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		filePath: {
			type: DataTypes.STRING(1024),
			allowNull: false
		},
		size: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0
		},
		parsed: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		},
		parseError: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		kills: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		deaths: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		placement: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		matchStatsJson: {
			type: DataTypes.TEXT,
			allowNull: true
		}
	},
	{ sequelize, modelName: 'ReplayUpload' }
);

export class SessionStat extends Model {}

SessionStat.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		botId: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		botSessionId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		source: {
			type: DataTypes.ENUM('manual', 'public_delta', 'ocr'),
			allowNull: false,
			defaultValue: 'manual'
		},
		kills: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		deaths: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		assists: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		placement: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		matches: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		wins: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		notes: {
			type: DataTypes.TEXT,
			allowNull: true
		}
	},
	{ sequelize, modelName: 'SessionStat' }
);

export class SessionMedia extends Model {}

SessionMedia.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		botId: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		botSessionId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		originalName: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		fileName: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		filePath: {
			type: DataTypes.STRING(1024),
			allowNull: false
		},
		mimeType: {
			type: DataTypes.STRING(120),
			allowNull: true
		},
		size: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0
		},
		notes: {
			type: DataTypes.TEXT,
			allowNull: true
		}
	},
	{ sequelize, modelName: 'SessionMedia' }
);

export class PasswordReset extends Model {}

PasswordReset.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		userId: {
			type: DataTypes.UUID,
			allowNull: false
		},
		tokenHash: {
			type: DataTypes.STRING(64),
			allowNull: false,
			unique: true
		},
		expiresAt: {
			type: DataTypes.DATE,
			allowNull: false
		},
		usedAt: {
			type: DataTypes.DATE,
			allowNull: true
		}
	},
	{
		sequelize,
		modelName: 'PasswordReset',
		indexes: [{ fields: ['userId'] }]
	}
);

User.hasOne(BotConfig, { foreignKey: 'userId', onDelete: 'CASCADE' });
BotConfig.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(PasswordReset, { foreignKey: 'userId', onDelete: 'CASCADE' });
PasswordReset.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(BotLog, { foreignKey: 'userId', onDelete: 'CASCADE' });
BotLog.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(QuickCommand, { foreignKey: 'userId', onDelete: 'CASCADE' });
QuickCommand.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(BotSession, { foreignKey: 'userId', onDelete: 'CASCADE' });
BotSession.belongsTo(User, { foreignKey: 'userId' });
BotSession.hasMany(ReplayUpload, { foreignKey: 'botSessionId', onDelete: 'SET NULL' });
ReplayUpload.belongsTo(BotSession, { foreignKey: 'botSessionId' });
BotSession.hasMany(SessionStat, { foreignKey: 'botSessionId', onDelete: 'CASCADE' });
SessionStat.belongsTo(BotSession, { foreignKey: 'botSessionId' });
BotSession.hasMany(SessionMedia, { foreignKey: 'botSessionId', onDelete: 'CASCADE' });
SessionMedia.belongsTo(BotSession, { foreignKey: 'botSessionId' });

export async function initDatabase() {
	await ensureDataDirs();
	await sequelize.authenticate();
	await sequelize.sync();
	await ensureBotConfigColumns();
}

async function ensureBotConfigColumns() {
	const queryInterface = sequelize.getQueryInterface();
	const table = await queryInterface.describeTable('BotConfigs').catch(() => null);
	if (!table) return;

	if (!table.autoUpdateOnRestart) {
		await queryInterface.addColumn('BotConfigs', 'autoUpdateOnRestart', {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		});
	}
	if (!table.deviceAuthEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'deviceAuthEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.authorizationCodeEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'authorizationCodeEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.defaultStatusEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'defaultStatusEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.localCategoryEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'localCategoryEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.runtimeMode) {
		await queryInterface.addColumn('BotConfigs', 'runtimeMode', {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'fnbr'
		});
	}
	if (!table.platform) {
		await queryInterface.addColumn('BotConfigs', 'platform', {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'WIN'
		});
	}
	if (!table.killOtherTokens) {
		await queryInterface.addColumn('BotConfigs', 'killOtherTokens', {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		});
	}
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
