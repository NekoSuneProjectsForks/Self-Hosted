import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * Server-wide settings an admin manages (server tracker bot, registration,
 * announcement). Values are JSON, encrypted at rest like other secrets.
 */
export class ServerSetting extends Model {}

ServerSetting.init(
	{
		key: {
			type: DataTypes.STRING(64),
			primaryKey: true
		},
		valueEncrypted: {
			type: DataTypes.TEXT,
			allowNull: true
		}
	},
	{ sequelize, modelName: 'ServerSetting' }
);
