import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over HTTPS on the LAN so a Meta Quest 3 can open
// the dev server directly (WebXR requires a secure context).
export default defineConfig( ( { mode } ) => ( {
	base: './',
	plugins: mode === 'https' ? [ basicSsl() ] : [],
	server: { host: mode === 'https' ? true : 'localhost' },
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 2000,
		rollupOptions: {
			output: { manualChunks: { three: [ 'three', 'three/webgpu', 'three/tsl' ] } }
		}
	}
} ) );
