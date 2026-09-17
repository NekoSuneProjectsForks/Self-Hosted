import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
