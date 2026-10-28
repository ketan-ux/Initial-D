import { bus } from '../core/events.js';
import { XR_MULTIVIEW } from '../core/renderer.js';

// Immersive-VR session lifecycle: local-floor space, fixed foveation, the
// Quest 3's 90 Hz (or 72 Hz) refresh rate. Rendering uses the standard
// XRWebGLLayer path; WebXR Layers + OVR_multiview2 single-pass stereo is an
// opt-in experiment (?xrmultiview).
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
		// 'layers' (projection-layer path) only with the multiview experiment;
		// the default is the plain XRWebGLLayer path, which renders everything
		const init = { optionalFeatures: [ 'local-floor', 'bounded-floor', ...( XR_MULTIVIEW ? [ 'layers' ] : [] ), 'hand-tracking' ] };
		const session = await navigator.xr.requestSession( 'immersive-vr', init );
		const xr = this.renderer.xr;
		// three.js takes the projection-layer path whenever the browser exposes
		// XRWebGLBinding.createProjectionLayer (Quest does), regardless of the
		// requested features. That path (clearOnAccess: false + texture arrays)
		// is what broke on device, so steer it onto XRWebGLLayer unless the
		// multiview experiment is on.
		if ( ! XR_MULTIVIEW && '_supportsLayers' in xr ) xr._supportsLayers = false;
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
