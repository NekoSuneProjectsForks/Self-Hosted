import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
