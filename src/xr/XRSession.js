import { bus } from '../core/events.js';

// Immersive-VR session lifecycle. Requests the WebXR Layers feature, which
// lets the Three.js XR manager allocate a texture-array projection layer and
// render both eyes in one pass via OVR_multiview2; applies fixed foveation
// and picks the Quest 3's 90 Hz (or 72 Hz) refresh rate.
export class XRSessionManager {

	constructor( renderer, quality ) {

		this.renderer = renderer;
		this.quality = quality;
		this.session = null;
		this.supported = false;
		this.preferredRate = 90;

	}

	async check() {

		try {

			this.supported = !! ( navigator.xr && await navigator.xr.isSessionSupported( 'immersive-vr' ) );

		} catch ( e ) {

			this.supported = false;

		}

		return this.supported;

	}

	async enter() {

		if ( this.session ) return;
		const init = { optionalFeatures: [ 'local-floor', 'bounded-floor', 'layers', 'hand-tracking' ] };
		const session = await navigator.xr.requestSession( 'immersive-vr', init );
		const xr = this.renderer.xr;
		xr.setReferenceSpaceType( 'local-floor' );
		xr.setFoveation( this.quality.foveation ?? 1 );
		await xr.setSession( session );
		xr.setFoveation( this.quality.foveation ?? 1 );
		this.session = session;
		session.addEventListener( 'end', () => {

			this.session = null;
			bus.emit( 'xr-end' );

		} );
		this.setFrameRate( this.preferredRate );
		bus.emit( 'xr-start', {
			multiview: xr.useMultiview ? xr.useMultiview() : false,
			layers: session.enabledFeatures?.includes( 'layers' ) ?? false
		} );

	}

	async setFrameRate( hz ) {

		this.preferredRate = hz;
		const s = this.session;
		if ( ! s || ! s.updateTargetFrameRate || ! s.supportedFrameRates ) return;
		const rates = Array.from( s.supportedFrameRates );
		const pick = rates.includes( hz ) ? hz : rates.filter( ( r ) => r <= hz ).sort( ( a, b ) => b - a )[ 0 ];
		if ( pick ) {

			try {

				await s.updateTargetFrameRate( pick );

			} catch ( e ) { /* not supported */ }

		}

	}

	async exit() {

		await this.session?.end();

	}

	get presenting() {

		return !! this.session;

	}

}
