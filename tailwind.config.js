export default {
	content: ['./public/**/*.{html,js}', './src/**/*.js'],
	theme: {
		extend: {
			fontFamily: {
				sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
				mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
			},
			colors: {
				fnlb: {
					950: '#06110d',
					900: '#0a1912',
					850: '#0f2018',
					800: '#13281d',
					700: '#1d3a2b',
					500: '#25d366',
					400: '#38f081',
					300: '#8bffbb'
				}
			},
			boxShadow: {
				glow: '0 0 0 1px rgba(56,240,129,.22), 0 18px 60px rgba(6,17,13,.55)'
			}
		}
	}
};
