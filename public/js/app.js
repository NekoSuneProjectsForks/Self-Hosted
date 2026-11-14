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

/**
 * Socket events re-render the whole page, which used to wipe whatever was
 * half-typed into a form (or a pop-up). Keep edited fields and focus.
 */
function fieldKey(el) {
	const form = el.closest('[data-form]');
	if (!form || !el.name) return null;
	return `${form.dataset.form}|${form.dataset.accountId || form.dataset.botId || ''}|${el.name}`;
}

function captureFields() {
	const saved = new Map();
	for (const el of app.querySelectorAll('[data-form] input, [data-form] select, [data-form] textarea')) {
		const key = fieldKey(el);
		if (!key) continue;
		const isCheck = el.type === 'checkbox' || el.type === 'radio';
		const dirty = isCheck ? el.checked !== el.defaultChecked : el.tagName === 'SELECT' ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
		if (dirty) saved.set(key, isCheck ? { checked: el.checked } : { value: el.value });
	}
	const active = document.activeElement;
	const focus = active && fieldKey(active) ? { key: fieldKey(active), start: active.selectionStart, end: active.selectionEnd } : null;
	return { saved, focus };
}

function restoreFields({ saved, focus }) {
	for (const el of app.querySelectorAll('[data-form] input, [data-form] select, [data-form] textarea')) {
		const key = fieldKey(el);
		const value = key && saved.get(key);
		if (value) {
			if ('checked' in value) el.checked = value.checked;
			else el.value = value.value;
		}
		if (focus && key === focus.key) {
			el.focus();
			try {
				if (focus.start != null) el.setSelectionRange(focus.start, focus.end);
			} catch {
				// Not a text field.
			}
		}
	}
}

/**
 * Keep the address bar in step with what's shown: /login or /register when
 * signed out (a reset link keeps its ?reset_token), /dashboard when signed in.
 */
function syncPath() {
	const { pathname, search, hash } = window.location;
	let want;
	if (state.user) {
		want = pathname.startsWith('/dashboard') ? pathname : '/dashboard';
	} else {
		want = state.authMode === 'register' ? '/register' : '/login';
	}
	if (want !== pathname) {
		const keep = !state.user && new URLSearchParams(search).has('reset_token') ? search : '';
		window.history.replaceState({}, document.title, `${want}${keep}${state.user ? hash : ''}`);
	}
}

function render() {
	syncPath();
	const fields = state.user ? captureFields() : null;
	app.innerHTML = state.user ? renderShell() : renderAuth();
	if (fields) restoreFields(fields);
	window.lucide?.createIcons();

	// Keep scrolling panels pinned to the newest entry.
	for (const id of ['#console-log', '#dm-log', '#party-chat-log']) {
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
	if (window.location.pathname === '/register') state.authMode = 'register';
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
