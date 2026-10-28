import { bus } from '../core/events.js';
import { XR_LAYERS } from '../core/renderer.js';

// Immersive-VR session lifecycle: local-floor space, fixed foveation, a
// 72 Hz target and a reduced framebuffer scale. Rendering uses the standard
// XRWebGLLayer path; the WebXR Layers projection layer (?xrlayers) and
// OVR_multiview2 single-pass stereo on top of it (?xrmultiview) are opt-in.
export class XRSessionManager {

	constructor( renderer, quality ) {

		this.renderer = renderer;
		this.quality = quality;
		this.session = null;
		this.supported = false;
		this.preferredRate = quality.targetFps || 72;

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
		// 'layers' (projection-layer path) only with ?xrlayers / ?xrmultiview;
		// the default is the plain XRWebGLLayer path, which renders correctly
		const init = { optionalFeatures: [ 'local-floor', 'bounded-floor', ...( XR_LAYERS ? [ 'layers' ] : [] ), 'hand-tracking' ] };
		const session = await navigator.xr.requestSession( 'immersive-vr', init );
		const xr = this.renderer.xr;
		// three.js takes the projection-layer path whenever the browser exposes
		// XRWebGLBinding.createProjectionLayer (Quest does), regardless of the
		// requested features. That path (clearOnAccess: false + texture arrays)
		// is what broke on device, so steer it onto XRWebGLLayer unless asked.
		if ( ! XR_LAYERS && '_supportsLayers' in xr ) xr._supportsLayers = false;
		// Quest 3's recommended eye buffer is ~1680x1760; 0.8 of it is ~36%
		// fewer pixels, and fixed foveation softens the periphery further
		xr.setFramebufferScaleFactor( this.quality.xrScale ?? 0.8 );
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
