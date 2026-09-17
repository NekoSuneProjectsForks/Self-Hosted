import 'dotenv/config';

// Fail fast with a readable message. Several dependencies (notably
// connect-session-sequelize 8) require Node 22, and on an older runtime they
// fail deep inside an import with no useful context.
const major = Number.parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
	console.error(
		`This dashboard requires Node 22 or newer. You are running Node ${process.versions.node}.\n` +
			'On Pterodactyl, switch the server egg/image to a Node 22 (or newer) build and restart.'
	);
	process.exit(1);
}

const { createServer } = await import('./src/server.js');
const { sequelize } = await import('./src/models/index.js');

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
