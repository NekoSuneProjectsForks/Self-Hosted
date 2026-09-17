import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

export class FriendMessage extends Model {}

FriendMessage.init(
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
		friendId: {
			type: DataTypes.STRING(255),
			allowNull: false
		},
		friendName: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		direction: {
			type: DataTypes.ENUM('incoming', 'outgoing'),
			allowNull: false
		},
		content: {
			type: DataTypes.TEXT,
			allowNull: false
		},
		sentAt: {
			type: DataTypes.DATE,
			allowNull: false,
			defaultValue: DataTypes.NOW
		}
	},
	{
		sequelize,
		modelName: 'FriendMessage',
		indexes: [
			{ fields: ['userId', 'botId', 'friendId', 'sentAt'] },
			{ fields: ['userId', 'sentAt'] }
		]
	}
);
