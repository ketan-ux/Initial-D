// Graphics scalability presets. Every renderer-facing system reads from the
// active preset object instead of hard-coding costs, so a single switch
// re-targets the game from a budget phone to a Quest 3 to a desktop GPU.

export const PRESETS = {
	low: {
		name: 'Low / Mobile',
		pixelRatioCap: 1.0,
		minPixelRatio: 0.5,
		antialias: false,
		toon: 'unlit', // baked-light toon, no dynamic lights evaluated per pixel
		shadows: 'blob',
		shadowMapSize: 0,
		headlightSpots: 0, // headlight pools are faked with additive decals
		post: false,
		bloom: false,
		chromatic: false,
		lightShafts: false,
		outlines: true,
		petals: 1200, // half density
		smokeParticles: 96,
		sparkParticles: 48,
		mirrors: false,
		mirrorSize: 0,
		mirrorRate: 0,
		drawDistance: 420,
		fogDensity: 1.25,
		treeDensity: 0.45,
		terrainDetail: 0.5,
		foveation: 0,
		targetFps: 60
	},
	quest: {
		name: 'Meta Quest 3',
		pixelRatioCap: 1.0,
		minPixelRatio: 0.7,
		antialias: true, // MSAA 4x on the XR projection layer
		toon: 'mobile',
		shadows: 'headlight', // single dynamic shadow map from the player's headlights
		shadowMapSize: 512,
		headlightSpots: 2,
		post: false,
		bloom: false,
		chromatic: false,
		lightShafts: false,
		outlines: true,
		petals: 2400,
		smokeParticles: 128,
		sparkParticles: 64,
		mirrors: true,
		mirrorSize: 384,
		mirrorRate: 2, // update every Nth frame
		drawDistance: 560,
		fogDensity: 1.0,
		treeDensity: 0.7,
		terrainDetail: 0.75,
		foveation: 1.0, // high-level fixed foveated rendering
		targetFps: 72
	},
	high: {
		name: 'High / Desktop',
		pixelRatioCap: 2.0, // native high-DPI
		minPixelRatio: 0.75,
		antialias: true,
		toon: 'full',
		shadows: 'csm',
		shadowMapSize: 2048,
		headlightSpots: 4,
		post: true,
		bloom: true,
		chromatic: true,
		lightShafts: true,
		outlines: true,
		petals: 6000,
		smokeParticles: 256,
		sparkParticles: 128,
		mirrors: true,
		mirrorSize: 768,
		mirrorRate: 2,
		drawDistance: 1400,
		fogDensity: 0.7,
		treeDensity: 1.0,
		terrainDetail: 1.0,
		foveation: 0,
		targetFps: 60
	}
};

export function isQuestBrowser() {

	const ua = navigator.userAgent || '';
	return /OculusBrowser|Quest/i.test( ua );

}

export function isMobile() {

	const ua = navigator.userAgent || '';
	if ( /Android|iPhone|iPad|iPod|Mobile/i.test( ua ) ) return true;
	// iPadOS reports as Mac; detect touch-capable "Macs".
	return navigator.maxTouchPoints > 1 && /Macintosh/.test( ua );

}

export function detectPreset() {

	if ( isQuestBrowser() ) return 'quest';
	if ( isMobile() ) return 'low';
	const cores = navigator.hardwareConcurrency || 4;
	const mem = navigator.deviceMemory || 8;
	if ( cores <= 4 && mem <= 4 ) return 'low';
	return 'high';

}

export function resolvePreset( choice ) {

	const key = choice === 'auto' || ! PRESETS[ choice ] ? detectPreset() : choice;
	return { key, ...PRESETS[ key ] };

}

// Live quality object: systems hold a reference and read fields every frame.
export const quality = { key: 'high', ...PRESETS.high };

export function applyPreset( choice ) {

	const p = resolvePreset( choice );
	Object.assign( quality, p );
	return quality;

}
