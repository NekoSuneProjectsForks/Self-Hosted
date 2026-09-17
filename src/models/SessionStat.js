import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
