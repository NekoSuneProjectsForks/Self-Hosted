import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * A Fortnite player whose matches the dashboard records from Epic's public
 * stats (works with any engine, including Legacy FNLB, because a tracker bot
 * reads the stats from outside the party). `baselineJson` is the last stats
 * snapshot; each new match is the difference to the next one.
 */
export class TrackedPlayer extends Model {}

TrackedPlayer.init(
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
		accountId: {
			type: DataTypes.STRING(64),
			allowNull: false
		},
		displayName: {
			type: DataTypes.STRING(64),
			allowNull: true
		},
		// "bot": one of the user's own bot accounts, tracked automatically.
		// "player": someone the user added by name.
		kind: {
			type: DataTypes.STRING(8),
			allowNull: false,
			defaultValue: 'player'
		},
		enabled: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		},
		baselineJson: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		lastPolledAt: {
			type: DataTypes.DATE,
			allowNull: true
		},
		lastError: {
			type: DataTypes.STRING(255),
			allowNull: true
		}
	},
	{
		sequelize,
		modelName: 'TrackedPlayer',
		indexes: [{ fields: ['userId'] }, { unique: true, fields: ['userId', 'accountId'] }]
	}
);
