import express from 'express';
import multer from 'multer';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { Server as SocketServer } from 'socket.io';
import { RuntimeManager, userRoom } from './runtime/RuntimeManager.js';
import { initDatabase, normalizeSuspension, User } from './models/index.js';
import { initMailer } from './services/mailer.js';
import { closeOrphanedSessions } from './services/sessionHistory.js';
import { closeOrphanedMatchRounds } from './services/matchTracker.js';
import { mediaDir, publicDir, replayDir, rootDir } from './lib/paths.js';
import { initSecrets } from './lib/secrets.js';
import { createSessionMiddleware } from './http/session.js';
import { asyncRoute, httpError } from './http/helpers.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerBotRoutes } from './routes/bots.routes.js';
import { registerConfigRoutes } from './routes/config.routes.js';
import { registerLegacyRoutes } from './routes/legacy.routes.js';
import { registerQuickCommandRoutes } from './routes/quickCommands.routes.js';
import { registerUploadRoutes } from './routes/uploads.routes.js';

function createUploaders() {
	const upload = multer({
		dest: replayDir,
		limits: { fileSize: 75 * 1024 * 1024, files: 1 },
		fileFilter: (_req, file, cb) => {
			if (!file.originalname.toLowerCase().endsWith('.replay')) {
				return cb(httpError(400, 'Only .replay files can be uploaded.'));
			}
			return cb(null, true);
		}
	});

	const mediaUpload = multer({
		dest: mediaDir,
		limits: { fileSize: 250 * 1024 * 1024, files: 1 },
		fileFilter: (_req, file, cb) => {
			const ok =
				file.mimetype.startsWith('image/') ||
				file.mimetype.startsWith('video/') ||
				/\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i.test(file.originalname);
			if (!ok) return cb(httpError(400, 'Only image or video evidence files can be uploaded.'));
			return cb(null, true);
		}
	});

	return { upload, mediaUpload };
}

export async function createServer() {
	await initSecrets();
	await initMailer();
	await initDatabase();
	// An unclean shutdown leaves sessions and match rounds marked active forever.
	await closeOrphanedSessions().catch(() => {});
	await closeOrphanedMatchRounds().catch(() => {});
	if ((await User.count()) === 0) {
		console.log('[Lobby Bot Dashboard] No accounts exist yet. The first registered account will become admin.');
	}

	const app = express();
	const httpServer = createHttpServer(app);
	const io = new SocketServer(httpServer);
	const runtime = new RuntimeManager(io);
	const sessionMiddleware = await createSessionMiddleware();
	const { upload, mediaUpload } = createUploaders();

	app.disable('x-powered-by');
	// Required behind Nginx / Traefik / Cloudflare so secure cookies and the
	// client IP are resolved from the forwarded headers.
	if (process.env.TRUST_PROXY) {
		const value = process.env.TRUST_PROXY;
		app.set('trust proxy', /^\d+$/.test(value) ? Number.parseInt(value, 10) : value);
	}
	app.use(express.json({ limit: '1mb' }));
	app.use(sessionMiddleware);
	app.use('/vendor/lucide', express.static(join(rootDir, 'node_modules', 'lucide', 'dist', 'umd')));
	app.use(express.static(publicDir));

	app.use(
		asyncRoute(async (req, _res, next) => {
			if (!req.session.userId) return next();
			const user = await normalizeSuspension(await User.findByPk(req.session.userId));
			if (!user) {
				req.session.destroy(() => {});
				return next();
			}
			req.user = user;
			next();
		})
	);

	function requireAuth(req, _res, next) {
		if (!req.user) return next(httpError(401, 'Sign in to continue.'));
		return next();
	}

	function requireActive(req, _res, next) {
		if (req.user?.status === 'suspended') {
			return next(httpError(403, 'This account is suspended.'));
		}
		return next();
	}

	function requireAdmin(req, _res, next) {
		if (!req.user) return next(httpError(401, 'Sign in to continue.'));
		if (req.user.role !== 'admin') return next(httpError(403, 'Admin access is required.'));
		return next();
	}

	const ctx = {
		app,
		io,
		runtime,
		requireAuth,
		requireActive,
		requireAdmin,
		upload,
		mediaUpload
	};

	registerAuthRoutes(ctx);
	registerConfigRoutes(ctx);
	registerQuickCommandRoutes(ctx);
	registerBotRoutes(ctx);
	registerLegacyRoutes(ctx);
	registerUploadRoutes(ctx);
	registerAdminRoutes(ctx);

	io.engine.use(sessionMiddleware);
	io.use(async (socket, next) => {
		try {
			const userId = socket.request.session?.userId;
			if (!userId) return next(new Error('unauthorized'));
			const user = await normalizeSuspension(await User.findByPk(userId));
			if (!user) return next(new Error('unauthorized'));
			socket.user = user;
			return next();
		} catch (error) {
			return next(error);
		}
	});

	io.on('connection', (socket) => {
		socket.join(userRoom(socket.user.id));
		socket.emit('bot:status', runtime.serialize(socket.user.id));
	});

	app.get(/.*/, (req, res, next) => {
		if (req.path.startsWith('/api/')) return next();
		res.sendFile(join(publicDir, 'index.html'));
	});

	app.use((req, res, next) => {
		if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
		return next();
	});

	app.use((error, _req, res, _next) => {
		const status = error.status >= 400 && error.status < 600 ? error.status : 500;
		if (status >= 500) console.error(error);
		res.status(status).json({ error: error.message || 'Internal server error.' });
	});

	return { app, httpServer, io, runtime };
}
