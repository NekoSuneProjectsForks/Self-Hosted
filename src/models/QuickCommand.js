import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
