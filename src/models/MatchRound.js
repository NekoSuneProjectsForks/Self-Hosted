import { DataTypes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

export class MatchRound extends Model {}

MatchRound.init(
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
		partyId: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		playlistId: {
			type: DataTypes.STRING(255),
			allowNull: true
		},
		startedAt: {
			type: DataTypes.DATE,
			allowNull: false,
			defaultValue: DataTypes.NOW
		},
		endedAt: {
			type: DataTypes.DATE,
			allowNull: true
		},
		duration: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		status: {
			type: DataTypes.ENUM('matchmaking', 'in_match', 'ended'),
			allowNull: false,
			defaultValue: 'in_match'
		},
		// Every stat below is nullable on purpose: Epic presence does not expose
		// them, so they stay null unless a replay upload or a manual entry fills
		// them in. `source` records where the numbers actually came from.
		placement: {
			type: DataTypes.INTEGER,
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
		assists: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		win: {
			type: DataTypes.BOOLEAN,
			allowNull: true
		},
		partyMembers: {
			type: DataTypes.INTEGER,
			allowNull: true
		},
		metadataJson: {
			type: DataTypes.TEXT,
			allowNull: true
		},
		source: {
			type: DataTypes.ENUM('presence', 'replay', 'manual', 'fnlb', 'epic'),
			allowNull: false,
			defaultValue: 'presence'
		}
	},
	{
		sequelize,
		modelName: 'MatchRound',
		indexes: [
			{ fields: ['userId', 'botId', 'startedAt'] },
			{ fields: ['botSessionId'] },
			{ fields: ['userId', 'botId', 'status'] }
		]
	}
);
