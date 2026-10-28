import * as THREE from 'three/webgpu';
import { pass, uniform, mix, vec2, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { clamp } from './math.js';

/**
 * Rendering backbone.
 *
 * - WebGPURenderer on its WebGL 2 backend: this is the Three.js renderer whose
 *   XR manager supports OVR_multiview2 single-pass stereo (both eyes drawn by
 *   one draw call into a texture-array projection layer) and fixed foveation.
 *   Pass ?backend=webgpu to try the native WebGPU backend on desktop.
 * - Display-referred output (no colour-conversion pass) for Quest and phones.
 * - High preset: post pipeline with selective bloom (emissive > 1.0 only) and
 *   drift-driven chromatic aberration; cascaded moonlight shadows.
 * - Adaptive resolution keeps the frame inside the preset's budget.
 */
export const XR_MULTIVIEW = new URLSearchParams( location.search ).has( 'xrmultiview' );

export class RenderSystem {

	constructor( quality ) {

		this.quality = quality;
		this.pipeline = null;
		this.uChroma = uniform( 0 );
		this.uBloom = uniform( 0.55 );
		this.dynamicScale = 1;
		this.userScale = 1;
		this._frameTimes = [];
		this._lastAdjust = 0;

	}

	async init( container ) {

		THREE.ColorManagement.enabled = false;
		const q = this.quality;
		const params = new URLSearchParams( location.search );
		const useWebGPU = params.get( 'backend' ) === 'webgpu' && 'gpu' in navigator;

		const renderer = new THREE.WebGPURenderer( {
			antialias: q.antialias,
			forceWebGL: ! useWebGPU,
			// OVR_multiview2 single-pass stereo is opt-in (?xrmultiview): on Quest 3
			// the multiview + projection-layer path dropped many materials and left
			// the background uncleared. Standard two-view XR rendering is the default.
			multiview: XR_MULTIVIEW,
			powerPreference: 'high-performance',
			alpha: false,
			stencil: false
		} );
		await renderer.init();
		renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.setClearColor( 0x241a3a, 1 );
		renderer.shadowMap.enabled = q.shadows === 'csm' || q.shadows === 'headlight';
		renderer.shadowMap.type = THREE.PCFShadowMap;
		renderer.xr.enabled = true;
		renderer.xr.setReferenceSpaceType( 'local-floor' );
		renderer.xr.setFoveation( q.foveation );
		renderer.domElement.id = 'game-canvas';
		container.appendChild( renderer.domElement );
		this.renderer = renderer;
		this.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
		this.applyPixelRatio();
		this.resize();
		window.addEventListener( 'resize', () => this.resize() );
		return renderer;

	}

	get xrPresenting() {

		return this.renderer.xr.isPresenting;

	}

	applyPixelRatio() {

		const q = this.quality;
		const dpr = Math.min( window.devicePixelRatio || 1, q.pixelRatioCap );
		const pr = clamp( dpr * this.userScale * this.dynamicScale, q.minPixelRatio * 0.5, 3 );
		this.renderer.setPixelRatio( pr );
		this.pixelRatio = pr;

	}

	resize() {

		const w = window.innerWidth, h = window.innerHeight;
		this.renderer.setSize( w, h );
		if ( this.camera ) {

			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();

		}

	}

	setupScene( scene, camera, moon ) {

		this.scene = scene;
		this.camera = camera;
		const q = this.quality;

		if ( q.shadows === 'csm' && moon ) {

			moon.castShadow = true;
			moon.shadow.mapSize.set( q.shadowMapSize, q.shadowMapSize );
			moon.shadow.camera.near = 1;
			moon.shadow.camera.far = 900;
			moon.shadow.bias = - 0.0004;
			moon.shadow.normalBias = 0.02;
			const csm = new CSMShadowNode( moon, { cascades: 3, maxFar: 220, mode: 'practical', lightMargin: 120 } );
			csm.fade = true;
			moon.shadow.shadowNode = csm;
			this.csm = csm;

		}

		this.buildPipeline();

	}

	buildPipeline() {

		const q = this.quality;
		this.pipeline?.dispose?.();
		this.pipeline = null;
		if ( ! q.post ) return;
		const scenePass = pass( this.scene, this.camera );
		const color = scenePass.getTextureNode( 'output' );
		let out = color;
		if ( q.chromatic ) {

			// strength scales with drift angle; zero cost visually when gripping
			out = chromaticAberration( out, this.uChroma, vec2( 0.5, 0.5 ), float( 1.15 ) );

		}

		if ( q.bloom ) {

			// threshold > 1: only emissive gauges, lamps, tail-lights and neon bloom
			const b = bloom( color, 0.6, 0.35, 1.0 );
			b.strength = this.uBloom;
			out = out.add( b );

		}

		this.pipeline = new THREE.RenderPipeline( this.renderer, out );
		this.pipeline.outputColorTransform = false;

	}

	setCamera( camera ) {

		if ( this.camera === camera ) return;
		this.camera = camera;
		this.resize();
		if ( this.pipeline ) this.buildPipeline();

	}

	render( scene, camera, driftAmount = 0 ) {

		this.uChroma.value = clamp( driftAmount, 0, 1 ) * 0.85;
		// the post pipeline's scene pass is bound to one scene + camera: rebuild
		// it when the game switches between the mountain and the garage
		if ( this.quality.post && ! this.xrPresenting && ( scene !== this.scene || camera !== this.camera ) ) {

			this.scene = scene;
			this.camera = camera;
			this.resize();
			this.buildPipeline();

		}

		if ( this.pipeline && ! this.xrPresenting && camera === this.camera ) {

			this.pipeline.render();

		} else {

			this.renderer.render( scene, camera );

		}

	}

	// Adaptive resolution: track frame time and nudge the pixel ratio so we
	// stay inside the preset's frame budget (flatscreen only; XR keeps native
	// resolution and leans on foveation instead).
	adapt( dt, enabled ) {

		if ( ! enabled || this.xrPresenting ) return;
		const ft = this._frameTimes;
		ft.push( dt );
		if ( ft.length > 45 ) ft.shift();
		const now = performance.now();
		if ( now - this._lastAdjust < 1500 || ft.length < 45 ) return;
		const avg = ft.reduce( ( a, b ) => a + b, 0 ) / ft.length;
		const budget = 1 / this.quality.targetFps;
		let changed = false;
		if ( avg > budget * 1.18 && this.dynamicScale > 0.55 ) {

			this.dynamicScale = Math.max( 0.55, this.dynamicScale * 0.88 );
			changed = true;

		} else if ( avg < budget * 0.8 && this.dynamicScale < 1 ) {

			this.dynamicScale = Math.min( 1, this.dynamicScale * 1.06 );
			changed = true;

		}

		if ( changed ) {

			this._lastAdjust = now;
			ft.length = 0;
			this.applyPixelRatio();
			this.resize();

		}

	}

	get drawCalls() {

		return this.renderer.info.render.drawCalls;

	}

}
