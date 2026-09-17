import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
