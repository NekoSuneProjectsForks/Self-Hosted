import { FriendMessage, sequelize } from '../models/index.js';
import {
	clearDeviceAuthForUser,
	getPlainConfig,
	updateLocalCategoryConfig
} from '../services/configStore.js';
import {
	getCurrentMatchRound,
	getMatchRound,
	getMatchRounds
} from '../services/matchTracker.js';
import { appVersion, asyncRoute, equipCosmetic, httpError } from '../http/helpers.js';

export function registerBotRoutes(ctx) {
	const { app, runtime, requireAuth, requireActive, requireAdmin, io } = ctx;

	// ---------------------------------------------------------------------
	// Generic engine-neutral API. The runtime adapter decides whether each call
	// goes to the local fnbr bot or to legacy FNLB, so the frontend never has to
	// know which engine is running.
	// ---------------------------------------------------------------------

	app.get(
		'/api/health',
		asyncRoute(async (_req, res) => {
			let database = 'ok';
			try {
				await sequelize.authenticate();
			} catch {
				database = 'error';
			}
			return res.status(database === 'ok' ? 200 : 503).json({
				ok: database === 'ok',
				database,
				uptime: Math.round(process.uptime()),
				version: appVersion
			});
		})
	);

	app.get(
		'/api/dashboard',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			const adapter = runtime.active(req.user.id);
			const dashboard = adapter
				? await adapter.getDashboard(runtime.localCategory(config))
				: runtime.offlineDashboard(req.user.id, config);
			return res.json({
				...dashboard,
				runtime: runtime.serialize(req.user.id),
				capabilities: runtime.capabilities(req.user.id)
			});
		})
	);

	app.get(
		'/api/bots',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const config = await getPlainConfig(req.user.id);
			const adapter = runtime.active(req.user.id);
			const bots = adapter
				? (await adapter.getDashboard(runtime.localCategory(config))).bots
				: runtime.offlineDashboard(req.user.id, config).bots;
			return res.json({ bots, capabilities: runtime.capabilities(req.user.id) });
		})
	);

	app.get(
		'/api/bots/:botId/friends',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			const [friends, pendingFriends, blocked] = await Promise.all([
				adapter.getFriends(req.params.botId),
				adapter
					.getPendingFriends(req.params.botId)
					.catch(() => ({ incomingFriends: [], outgoingFriends: [] })),
				adapter.getBlockedUsers(req.params.botId).catch(() => [])
			]);
			return res.json({ ...friends, pendingFriends, blockedUsers: blocked });
		})
	);

	app.post(
		'/api/bots/:botId/friends',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			const target = String(req.body.target || req.body.friendId || '').trim();
			return res.status(201).json(await adapter.addFriend(target));
		})
	);

	app.delete(
		'/api/bots/:botId/friends/:friendId',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json(await adapter.removeFriend(req.params.friendId));
		})
	);

	app.post(
		'/api/bots/:botId/friends/:friendId/accept',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json(await adapter.acceptFriend(req.params.friendId));
		})
	);

	app.post(
		'/api/bots/:botId/friends/:friendId/decline',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json(await adapter.declineFriend(req.params.friendId));
		})
	);

	app.post(
		'/api/bots/:botId/friends/:friendId/block',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json(await adapter.blockUser(req.params.friendId));
		})
	);

	app.post(
		'/api/bots/:botId/friends/:friendId/unblock',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json(await adapter.unblockUser(req.params.friendId));
		})
	);

	app.get(
		'/api/bots/:botId/friends/:friendId/messages',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const rows = await FriendMessage.findAll({
				where: {
					userId: req.user.id,
					botId: req.params.botId,
					friendId: req.params.friendId
				},
				order: [['sentAt', 'ASC']],
				limit: 200
			});
			return res.json({ messages: rows.map((row) => row.toJSON()) });
		})
	);

	app.post(
		'/api/bots/:botId/friends/:friendId/messages',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const content = String(req.body.content || '').trim();
			if (!content) throw httpError(400, 'Message content is required.');
			if (content.length > 2000) throw httpError(400, 'Message is too long.');
			const adapter = runtime.requireActive(req.user.id);
			return res.status(201).json(await adapter.sendFriendMessage(req.params.friendId, content));
		})
	);

	app.get(
		'/api/bots/:botId/blocked',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json({ blockedUsers: await adapter.getBlockedUsers(req.params.botId) });
		})
	);

	app.get(
		'/api/bots/:botId/party',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			return res.json({ party: await adapter.getParty(req.params.botId) });
		})
	);

	app.post(
		'/api/bots/:botId/party/messages',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const content = String(req.body.content || '').trim();
			if (!content) throw httpError(400, 'Message content is required.');
			const adapter = runtime.requireActive(req.user.id);
			return res.status(201).json(await adapter.sendPartyMessage(content, req.params.botId));
		})
	);

	// Live lobby controls. None of these require a restart.
	app.patch(
		'/api/bots/:botId/party',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			const results = [];

			if (req.body.privacy !== undefined) results.push(await adapter.setPrivacy(req.body.privacy));
			if (req.body.playlist !== undefined) results.push(await adapter.setPlaylist(req.body.playlist));
			if (req.body.squadFill !== undefined) results.push(await adapter.setSquadFill(req.body.squadFill));
			if (req.body.ready !== undefined) results.push(await adapter.setReadiness(req.body.ready));
			if (req.body.sittingOut !== undefined) results.push(await adapter.setSittingOut(req.body.sittingOut));
			if (req.body.hideMembers !== undefined) results.push(await adapter.hideMembers(req.body.hideMembers));
			if (req.body.status !== undefined) results.push(await adapter.setStatus(req.body.status));
			if (req.body.invite !== undefined) results.push(await adapter.inviteUser(req.body.invite));
			if (req.body.kick !== undefined) results.push(await adapter.kickMember(req.body.kick));
			if (req.body.promote !== undefined) results.push(await adapter.promoteMember(req.body.promote));
			if (req.body.join !== undefined) results.push(await adapter.joinParty(req.body.join));
			if (req.body.leave) results.push(await adapter.leaveParty());

			if (!results.length) throw httpError(400, 'No supported party update was provided.');
			return res.json({ ok: true, results, party: await adapter.getParty(req.params.botId) });
		})
	);

	app.patch(
		'/api/bots/:botId/cosmetics',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const adapter = runtime.requireActive(req.user.id);
			if (req.body.clearEmote) return res.json(await adapter.clearEmote());

			const slot = String(req.body.slot || '').trim();
			const itemId = String(req.body.itemId || '').trim();
			if (!slot || !itemId) throw httpError(400, 'A cosmetic slot and item ID are required.');

			// Equip live first; only persist as a default once the runtime has
			// confirmed the item was accepted.
			const applied = await adapter.setCosmetic(slot, itemId, { categoryId: req.body.categoryId });

			if (req.body.saveDefault) {
				const startSlot = `start${slot[0].toUpperCase()}${slot.slice(1)}`;
				await updateLocalCategoryConfig(req.user.id, async (nextConfig) => {
					equipCosmetic(nextConfig, startSlot, itemId, 'replace');
				}).catch(() => {});
			}
			return res.json(applied);
		})
	);

	app.get(
		'/api/bots/:botId/matches',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			return res.json({
				current: await getCurrentMatchRound(req.user.id, req.params.botId),
				matches: await getMatchRounds(req.user.id, req.params.botId)
			});
		})
	);

	app.get(
		'/api/bots/:botId/matches/:matchId',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const match = await getMatchRound(req.user.id, req.params.matchId);
			if (!match || match.botId !== req.params.botId) throw httpError(404, 'Match not found.');
			return res.json({ match });
		})
	);

	app.get(
		'/api/users/search',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const prefix = String(req.query.prefix || req.query.q || '').trim();
			if (!prefix) throw httpError(400, 'Search prefix is required.');
			const adapter = runtime.requireActive(req.user.id);
			const users = await adapter.searchUsers(prefix, req.query.platform || 'epic', req.query.botId);
			return res.json({ users });
		})
	);

	app.post(
		'/api/bot/restart',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			await runtime.restart(req.user.id, req.user);
			return res.json({ runtime: runtime.serialize(req.user.id) });
		})
	);

	// "Clear Device Auth" / "Reauthenticate". Stops the bot first so it cannot
	// keep running on credentials that have just been removed.
	app.post(
		'/api/config/device-auth/clear',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			await runtime.stop(req.user.id, 'Bot stopped to clear Epic device auth.').catch(() => {});
			const result = await clearDeviceAuthForUser(req.user.id);
			runtime.appendLog(req.user.id, 'Epic device auth cleared. A new authorization code is required.', 2);
			return res.json({ ...result, runtime: runtime.serialize(req.user.id) });
		})
	);

	app.get(
		'/api/fnlb/bots/:botId/sessions',
		requireAuth,
		requireActive,
		asyncRoute(async (req, res) => {
			const sessions = await getBotSessions(req.user.id, req.params.botId);
			return res.json({ sessions });
		})
	);
}
