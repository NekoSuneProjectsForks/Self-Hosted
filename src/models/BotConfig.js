import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
		botsEncrypted: {
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
		releaseChannel: {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'stable'
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
		localBotEnabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
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
