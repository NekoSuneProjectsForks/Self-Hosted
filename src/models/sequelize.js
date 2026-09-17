import { join } from 'node:path';
import { Sequelize } from 'sequelize';
import { dataDir } from '../lib/paths.js';

export const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: process.env.SQLITE_PATH || join(dataDir, 'fnlb-dashboard.sqlite'),
	logging: false
});
