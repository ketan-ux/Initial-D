import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over HTTPS on the LAN so a Meta Quest 3 can open
// the dev server directly (WebXR requires a secure context).
export default defineConfig( ( { mode } ) => ( {
	base: './',
	plugins: [ ...( mode === 'https' ? [ basicSsl() ] : [] ) ], // a literal array keeps config tooling happy
	server: { host: mode === 'https' ? true : 'localhost' },
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 2000,
		rollupOptions: {
			// three.js in its own long-cacheable chunk (Rolldown wants a function)
			output: { manualChunks: ( id ) => ( id.includes( '/node_modules/three/' ) ? 'three' : undefined ) }
		}
	}
} ) );
