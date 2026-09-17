import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

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
