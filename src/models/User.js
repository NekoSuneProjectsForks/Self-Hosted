import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

export class User extends Model {
	toSafeJSON() {
		return {
			id: this.id,
			username: this.username,
			email: this.email,
			role: this.role,
			status: this.status,
			suspendedUntil: this.suspendedUntil,
			suspendedReason: this.suspendedReason,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt
		};
	}
}

User.init(
	{
		id: {
			type: DataTypes.UUID,
			defaultValue: DataTypes.UUIDV4,
			primaryKey: true
		},
		username: {
			type: DataTypes.STRING(40),
			allowNull: false,
			unique: true
		},
		email: {
			type: DataTypes.STRING(255),
			allowNull: false,
			unique: true
		},
		passwordHash: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		role: {
			type: DataTypes.ENUM('user', 'admin'),
			allowNull: false,
			defaultValue: 'user'
		},
		status: {
			type: DataTypes.ENUM('active', 'suspended'),
			allowNull: false,
			defaultValue: 'active'
		},
		suspendedUntil: {
			type: DataTypes.DATE,
			allowNull: true
		},
		suspendedReason: {
			type: DataTypes.STRING(255),
			allowNull: true
		}
	},
	{ sequelize, modelName: 'User' }
);
