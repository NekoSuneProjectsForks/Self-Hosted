import connectSessionSequelize from 'connect-session-sequelize';
import session from 'express-session';
import { sequelize } from '../models/index.js';
import { getSessionSecret } from '../lib/secrets.js';

export async function createSessionMiddleware() {
	const SequelizeStore = connectSessionSequelize(session.Store);
	const store = new SequelizeStore({
		db: sequelize,
		tableName: 'Sessions',
		checkExpirationInterval: 15 * 60 * 1000,
		expiration: 7 * 24 * 60 * 60 * 1000
	});
	await store.sync();

	return session({
		name: 'fnlb.sid',
		secret: getSessionSecret(),
		store,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.COOKIE_SECURE === 'true',
			maxAge: 7 * 24 * 60 * 60 * 1000
		}
	});
}
