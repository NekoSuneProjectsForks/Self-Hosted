import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
