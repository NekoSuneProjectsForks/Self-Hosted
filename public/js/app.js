import { state } from './core/state.js';
import { setRenderer } from './core/render.js';
import { setToast } from './core/ui.js';
import { clearResetTokenFromUrl, dashboardAvailable, detectResetToken } from './core/selectors.js';
import { renderAuth } from './views/auth.js';
import { renderShell } from './views/shell.js';
import {
	loadBotDetails,
	loadDashboard,
	loadMatches,
	loadParty,
	loadSession
} from './data/loaders.js';
import { refreshAfterAuth, refreshLiveData } from './actions.js';

const app = document.querySelector('#app');

function render() {
	app.innerHTML = state.user ? renderShell() : renderAuth();
	window.lucide?.createIcons();

	// Keep scrolling panels pinned to the newest entry.
	for (const id of ['#profile-log', '#dm-log', '#party-chat-log']) {
		const node = document.querySelector(id);
		if (node) node.scrollTop = node.scrollHeight;
	}
}

setRenderer(render);

// Poll only the views that are not already driven by Socket.IO events.
setInterval(async () => {
	if (!state.user || !state.autoRefresh) return;
	try {
		if (['status', 'categories'].includes(state.view) && dashboardAvailable()) {
			await loadDashboard(false);
			if (state.selectedBotId) await loadBotDetails(state.selectedBotId, false);
			render();
		}
		// The lobby and match views update live, so only the elapsed-time
		// readouts need a periodic repaint.
		if (state.view === 'lobby' || state.view === 'matches') render();
	} catch {
		// Keep polling quiet; manual refresh surfaces API errors.
	}
}, 15000);

(async function init() {
	try {
		// A password reset link always takes priority over any existing session.
		if (detectResetToken()) {
			render();
			return;
		}
		await loadSession();
		if (state.user) await refreshAfterAuth();
		else render();
	} catch (error) {
		setToast(error.message, 'error');
		render();
	}
})();

export { render, clearResetTokenFromUrl, loadParty, loadMatches, refreshLiveData };
