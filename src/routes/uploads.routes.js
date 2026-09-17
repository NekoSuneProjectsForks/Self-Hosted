import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ReplayUpload, SessionMedia, SessionStat } from '../models/index.js';
import { getBotSessions, resolveUploadSession } from '../services/sessionHistory.js';
import { parseReplayFile } from '../services/replayParser.js';
import { searchFortniteCosmetics } from '../services/fortniteItems.js';
import { mediaDir, replayDir } from '../lib/paths.js';
import { asyncRoute, httpError, optionalInteger } from '../http/helpers.js';

export function registerUploadRoutes(ctx) {
	const { app, requireAuth, requireActive, upload, mediaUpload } = ctx;

	app.post(
		'/api/fnlb/bots/:botId/replays',
		requireAuth,
		requireActive,
		upload.single('replay'),
		asyncRoute(async (req, res) => {
			if (!req.file) throw httpError(400, 'Replay file is required.');
			await mkdir(join(replayDir, req.user.id), { recursive: true });

			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			let parsed = false;
			let parseError = null;
			let parsedData = null;
			try {
				parsedData = await parseReplayFile(req.file.path);
				parsed = true;
			} catch (error) {
				parseError = error.message;
			}

			const replay = await ReplayUpload.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				originalName: req.file.originalname,
				fileName: req.file.filename,
				filePath: req.file.path,
				size: req.file.size,
				parsed,
				parseError,
				kills: parsedData?.kills ?? null,
				deaths: parsedData?.deaths ?? null,
				placement: parsedData?.placement ?? null,
				matchStatsJson: parsedData ? JSON.stringify(parsedData.raw) : null
			});

			if (parsedData) {
				await session.update({
					kills: parsedData.kills,
					deaths: parsedData.deaths,
					statsJson: JSON.stringify({
						...(session.statsJson ? JSON.parse(session.statsJson) : {}),
						replay: parsedData.raw
					})
				});
			}

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ replay, sessions });
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/session-stats',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			const stat = await SessionStat.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				source: 'manual',
				kills: optionalInteger(req.body.kills),
				deaths: optionalInteger(req.body.deaths),
				assists: optionalInteger(req.body.assists),
				placement: optionalInteger(req.body.placement),
				matches: optionalInteger(req.body.matches),
				wins: optionalInteger(req.body.wins),
				notes: String(req.body.notes || '').trim() || null
			});

			await session.update({
				kills: stat.kills ?? session.kills,
				deaths: stat.deaths ?? session.deaths,
				lastSeenAt: new Date()
			});

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ stat, sessions });
		})
	);

	app.post(
		'/api/fnlb/bots/:botId/session-media',
		requireAuth,
		requireActive,
		mediaUpload.single('media'),
		asyncRoute(async (req, res) => {
			if (!req.file) throw httpError(400, 'Image or video file is required.');
			await mkdir(join(mediaDir, req.user.id), { recursive: true });

			const session = await resolveUploadSession(req.user.id, req.params.botId, req.body.sessionId);
			const media = await SessionMedia.create({
				userId: req.user.id,
				botId: req.params.botId,
				botSessionId: session.id,
				originalName: req.file.originalname,
				fileName: req.file.filename,
				filePath: req.file.path,
				mimeType: req.file.mimetype,
				size: req.file.size,
				notes: String(req.body.notes || '').trim() || null
			});

			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.status(201).json({ media, sessions });
		})
	);

	app.get(
		'/api/fortnite/items',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const query = String(req.query.q || '').trim();
			const type = String(req.query.type || '').trim();
			if (!query) throw httpError(400, 'Search text is required.');
			const items = await searchFortniteCosmetics(query, type);
			return res.json({ items, source: 'fortnite-api.com' });
		})
	);

	app.get(
		'/api/admin/overview',
		requireAdmin,
		asyncRoute(async (_req, res) => {
			const [users, admins, suspended] = await Promise.all([
				User.count(),
				User.count({ where: { role: 'admin' } }),
				User.count({ where: { status: 'suspended' } })
			]);
			return res.json({ users, admins, suspended });
		})
	);
}
