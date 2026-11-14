import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * A bot its owner chose to publish on the public community list (or keep
 * private). One row per (owner, engine, bot): engine "fnbr" uses the Epic
 * account ID, engine "fnlb" uses the FNLB bot ID.
 */
export class BotListing extends Model {}

BotListing.init(
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
		engine: {
			type: DataTypes.STRING(8),
			allowNull: false
		},
		botKey: {
			type: DataTypes.STRING(64),
			allowNull: false
		},
		// Last known Epic display name, so offline public bots still have a name.
		displayName: {
			type: DataTypes.STRING(64),
			allowNull: true
		},
		isPublic: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		},
		description: {
			type: DataTypes.STRING(160),
			allowNull: true
		},
		lastSeenAt: {
			type: DataTypes.DATE,
			allowNull: true
		}
	},
	{
		sequelize,
		modelName: 'BotListing',
		indexes: [{ unique: true, fields: ['userId', 'engine', 'botKey'] }, { fields: ['isPublic'] }]
	}
);
