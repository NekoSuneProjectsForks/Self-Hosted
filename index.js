import 'dotenv/config';
import { createServer } from './src/server.js';
import { sequelize } from './src/models/index.js';

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

const { httpServer, io, runtime } = await createServer();

httpServer.listen(port, host, () => {
	console.log(`Lobby bot dashboard listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

let shuttingDown = false;

/**
 * Shutdown order matters: bots are logged out of Epic (and FNLB clusters
 * stopped) before anything else closes, so accounts are not left online and
 * sessions/match rounds get closed properly.
 */
async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n[${signal}] Shutting down...`);

	const force = setTimeout(() => {
		console.error('Shutdown timed out, forcing exit.');
		process.exit(1);
	}, 30_000);
	force.unref();

	try {
		await runtime.stopAll();
		io.close();
		await new Promise((resolve) => httpServer.close(resolve));
		await sequelize.close();
		console.log('Shutdown complete.');
		process.exit(0);
	} catch (error) {
		console.error('Shutdown error:', error.message);
		process.exit(1);
	}
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
