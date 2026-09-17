/**
 * Indirection so any module can trigger a re-render without importing the view
 * layer. `app.js` installs the real renderer at startup, which keeps the module
 * graph acyclic.
 */
let renderer = () => {};

export function setRenderer(fn) {
	renderer = fn;
}

export function render() {
	renderer();
}
