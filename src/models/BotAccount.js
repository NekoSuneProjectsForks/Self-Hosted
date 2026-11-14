import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * Extra Epic accounts a user runs alongside their main local fnbr bot, so
 * several bots can sit in one lobby. Each has its own encrypted device auth.
 */
export class BotAccount extends Model {}

BotAccount.init(
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
		label: {
			type: DataTypes.STRING(64),
			allowNull: false
		},
		// Filled in after the first successful Epic login.
		accountId: {
			type: DataTypes.STRING(64),
			allowNull: true
		},
		displayName: {
			type: DataTypes.STRING(64),
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
		// Fortnite platform this bot presents as; null = same as the main bot.
		platform: {
			type: DataTypes.STRING(16),
			allowNull: true
		},
		// Start with the main bot and join its lobby automatically.
		autoStart: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		}
	},
	{
		sequelize,
		modelName: 'BotAccount',
		indexes: [{ fields: ['userId'] }]
	}
);
