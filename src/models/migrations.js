import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * Additive column migrations for databases created before a field existed.
 * `sequelize.sync()` does not add columns to existing tables, so each new
 * BotConfig field needs an entry here.
 */
export async function ensureBotConfigColumns() {
	const queryInterface = sequelize.getQueryInterface();
	const table = await queryInterface.describeTable('BotConfigs').catch(() => null);
	if (!table) return;

	if (!table.autoUpdateOnRestart) {
		await queryInterface.addColumn('BotConfigs', 'autoUpdateOnRestart', {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		});
	}
	if (!table.deviceAuthEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'deviceAuthEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.authorizationCodeEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'authorizationCodeEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.defaultStatusEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'defaultStatusEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.localCategoryEncrypted) {
		await queryInterface.addColumn('BotConfigs', 'localCategoryEncrypted', {
			type: DataTypes.TEXT,
			allowNull: true
		});
	}
	if (!table.runtimeMode) {
		await queryInterface.addColumn('BotConfigs', 'runtimeMode', {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'fnbr'
		});
	}
	if (!table.platform) {
		await queryInterface.addColumn('BotConfigs', 'platform', {
			type: DataTypes.STRING(16),
			allowNull: false,
			defaultValue: 'WIN'
		});
	}
	if (!table.killOtherTokens) {
		await queryInterface.addColumn('BotConfigs', 'killOtherTokens', {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false
		});
	}
	if (!table.localBotEnabled) {
		await queryInterface.addColumn('BotConfigs', 'localBotEnabled', {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true
		});
	}
}
