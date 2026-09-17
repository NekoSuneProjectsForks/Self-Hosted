import { state } from './state.js';
import { render } from './render.js';
import { disconnectSocket } from './socket.js';

export async function api(path, options = {}) {
	const response = await fetch(path, {
		method: options.method || 'GET',
		headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
		body: options.body ? JSON.stringify(options.body) : undefined
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (response.status === 401 && !path.startsWith('/api/auth/')) {
			state.user = null;
			state.config = null;
			disconnectSocket();
			render();
		}
		throw new Error(data.error || 'Request failed.');
	}
	return data;
}
