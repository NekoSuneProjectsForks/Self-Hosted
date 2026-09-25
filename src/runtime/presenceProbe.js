/**
 * Diagnostic for "friends can't invite the bot". Fortnite decides whether to
 * offer Invite / Join from the presence a friend publishes, so the useful
 * question is: how does the bot's presence differ from a real client's?
 *
 * fnbr parses incoming presence into FriendPresence and drops the raw props,
 * and has no hook for what it sends. The probe records both sides verbatim:
 *   - outgoing: wraps `client.stomp.patchPresence`
 *   - incoming: listens to the STOMP socket for `presence.v1.UPDATE`
 * It only observes; nothing it does changes what fnbr sends or receives.
 */

const MAX_FRIENDS = 50;

/** Pulls the JSON body out of a raw STOMP frame ("MESSAGE\nheaders\n\nbody\0"). */
export function stompBody(frame) {
	const text = String(frame ?? '');
	const split = text.indexOf('\n\n');
	if (split === -1) return null;
	const body = text.slice(split + 2).replace(/\0+$/, '').trim();
	if (!body) return null;
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

/**
 * Keys only one side has, and keys both have with different values. Values are
 * compared as published strings (Epic's "b"/"i"/"s"/"m" prefixed encoding).
 */
export function diffPresence(bot, friend) {
	const botProps = bot?.props || {};
	const friendProps = friend?.props || {};
	const onlyFriend = Object.keys(friendProps).filter((key) => !(key in botProps)).sort();
	const onlyBot = Object.keys(botProps).filter((key) => !(key in friendProps)).sort();
	const different = Object.keys(friendProps)
		.filter((key) => key in botProps && String(botProps[key]) !== String(friendProps[key]))
		.sort()
		.map((key) => ({ key, bot: botProps[key], friend: friendProps[key] }));
	return { onlyFriend, onlyBot, different };
}

export class PresenceProbe {
	constructor(deploymentId) {
		this.deploymentId = deploymentId;
		this.sent = null;
		this.received = new Map();
	}

	/** Must run before `client.login()` so the first presence is captured. */
	install(client) {
		const stomp = client?.stomp;
		if (!stomp) return;
		this.deploymentId ||= client.config?.eosDeploymentId;

		const patchPresence = stomp.patchPresence.bind(stomp);
		stomp.patchPresence = async (activity, props, status) => {
			this.recordSent(activity, props, status);
			return patchPresence(activity, props, status);
		};

		// STOMP reconnects create a new socket, so re-attach after every connect.
		const connect = stomp.connect.bind(stomp);
		stomp.connect = async (...args) => {
			const result = await connect(...args);
			this.attach(stomp.connection);
			return result;
		};
		this.attach(stomp.connection);
	}

	attach(connection) {
		if (!connection || connection.__presenceProbe) return;
		connection.__presenceProbe = true;
		connection.on('message', (frame) => this.recordFrame(frame));
	}

	recordSent(activity, props, status) {
		this.sent = {
			activity: String(activity ?? ''),
			status: status || 'online',
			props: { ...(props || {}) },
			at: new Date().toISOString()
		};
	}

	recordFrame(frame) {
		const data = stompBody(frame);
		if (data?.type !== 'presence.v1.UPDATE') return;
		const accountId = data.payload?.accountId;
		if (!accountId) return;
		const perNs = Array.isArray(data.payload.perNs) ? data.payload.perNs : [];
		const presence = perNs.find((ns) => ns.ns === this.deploymentId) || perNs[0];
		if (!presence) return;

		this.received.delete(accountId);
		this.received.set(accountId, {
			activity: String(presence.activity?.value ?? ''),
			status: presence.status || data.payload.status || 'online',
			props: { ...(presence.props || {}) },
			at: new Date().toISOString()
		});
		// Keep the most recently updated friends only.
		while (this.received.size > MAX_FRIENDS) this.received.delete(this.received.keys().next().value);
	}

	compare(friendId) {
		const friend = friendId ? this.received.get(friendId) || null : null;
		return {
			bot: this.sent,
			friend,
			recordedFriends: [...this.received.keys()],
			diff: this.sent && friend ? diffPresence(this.sent, friend) : null
		};
	}
}
