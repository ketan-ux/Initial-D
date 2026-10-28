import * as THREE from 'three/webgpu';
import {
	uniform, float, vec3, vec4, color as tslColor, normalView, normalWorld, positionViewDirection,
	positionLocal, normalLocal, smoothstep, mix, step, max, attribute, sin, materialColor,
	vertexColor
} from 'three/tsl';
import { quality } from '../core/quality.js';

// ---------------------------------------------------------------------------
// Anime / cel-shaded material system.
//
// The game runs a display-referred ("gamma space") pipeline: colour
// management is disabled and the renderer writes straight to the canvas or
// XR projection layer, which saves a full-screen colour-conversion pass on
// Quest and phones. Stepped toon ramps hide the non-linear lighting maths.
// ---------------------------------------------------------------------------

export const uTime = uniform( 0 ); // seconds; paused with the game
export const uMoonDir = uniform( new THREE.Vector3( - 0.35, 0.42, - 0.8 ).normalize() ); // ~25° up: often in frame
export const uAmbient = uniform( new THREE.Color( 0x5a4f8a ) ); // twilight bounce light
export const uRimColor = uniform( new THREE.Color( 0xffc8e8 ) ); // sakura-pink rim
export const uWind = uniform( 1.0 );

const rampCache = new Map();

// Stepped diffuse ramp: N hard bands, NearestFilter so the GPU never blends.
export function gradientMap( steps = 3 ) {

	if ( rampCache.has( steps ) ) return rampCache.get( steps );
	const presets = {
		2: [ 90, 255 ],
		3: [ 70, 160, 255 ],
		4: [ 55, 120, 190, 255 ]
	};
	const vals = presets[ steps ] || presets[ 3 ];
	const data = new Uint8Array( vals.length * 4 );
	vals.forEach( ( v, i ) => data.set( [ v, v, v, 255 ], i * 4 ) );
	const tex = new THREE.DataTexture( data, vals.length, 1, THREE.RGBAFormat );
	tex.minFilter = tex.magFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	rampCache.set( steps, tex );
	return tex;

}

// Fresnel ink-rim term in view space: thin bright band on silhouettes.
export function rimNode( strength = 0.6, width = 0.3, colorNode = uRimColor ) {

	const ndv = normalView.dot( positionViewDirection ).saturate();
	const fres = float( 1 ).sub( ndv );
	const band = smoothstep( float( 1 - width ), float( 1 - width + 0.06 ), fres );
	// only on surfaces facing the moon-ish upper hemisphere, like a back-light
	const up = normalWorld.y.mul( 0.5 ).add( 0.5 );
	return vec3( colorNode ).mul( band ).mul( up ).mul( strength );

}

// Baked "unlit" toon lighting used on the Low preset: one fixed moon light,
// two hard bands + ambient, evaluated without any scene lights.
function unlitToonLight() {

	const ndl = normalWorld.dot( uMoonDir );
	const band = step( float( 0.05 ), ndl ).mul( 0.45 ).add( step( float( 0.55 ), ndl ).mul( 0.2 ) );
	return vec3( uAmbient ).mul( 1.45 ).add( vec3( 0.75, 0.78, 1.0 ).mul( band ) );

}

/**
 * Create a toon material appropriate for the active quality preset.
 * opts: color, map, vertexColors, emissive, emissiveIntensity, rim, side,
 *       transparent, opacity, sway (foliage wind), unlitOverride
 */
export function toonMaterial( opts = {} ) {

	const unlit = opts.unlit ?? quality.toon === 'unlit';
	const rimStrength = opts.rim ?? 0.45;
	let mat;

	if ( unlit ) {

		mat = new THREE.MeshBasicNodeMaterial( {
			color: opts.color ?? 0xffffff,
			map: opts.map ?? null,
			vertexColors: !! opts.vertexColors,
			side: opts.side ?? THREE.FrontSide,
			transparent: !! opts.transparent,
			opacity: opts.opacity ?? 1
		} );
		// materialColor already includes `map`; vertex colours are multiplied in
		// afterwards by NodeMaterial.setupDiffuseColor().
		let col = vec3( materialColor ).mul( unlitToonLight() );
		if ( rimStrength > 0 ) col = col.add( rimNode( rimStrength * 0.8 ) );
		if ( opts.emissive ) col = col.add( vec3( tslColor( opts.emissive ) ).mul( opts.emissiveIntensity ?? 1 ) );
		// per-vertex glow (reflectors, lamp bulbs); tinted by vertex colour later
		if ( opts.glowAttr ) col = col.add( vec3( attribute( opts.glowAttr, 'float' ) ) );
		mat.colorNode = vec4( col, 1 );

	} else {

		mat = new THREE.MeshToonNodeMaterial( {
			color: opts.color ?? 0xffffff,
			map: opts.map ?? null,
			vertexColors: !! opts.vertexColors,
			gradientMap: gradientMap( quality.toon === 'mobile' ? 2 : 3 ),
			side: opts.side ?? THREE.FrontSide,
			transparent: !! opts.transparent,
			opacity: opts.opacity ?? 1
		} );
		let em = vec3( 0 );
		if ( rimStrength > 0 ) em = em.add( rimNode( rimStrength ) );
		if ( opts.emissive ) em = em.add( vec3( tslColor( opts.emissive ) ).mul( opts.emissiveIntensity ?? 1 ) );
		// toon bounce: lift the darkest band so night scenes stay readable
		let base = vec3( materialColor );
		if ( opts.vertexColors ) base = base.mul( vertexColor().rgb );
		em = em.add( base.mul( vec3( uAmbient ) ).mul( 0.55 ) );
		if ( opts.glowAttr ) em = em.add( vertexColor().rgb.mul( attribute( opts.glowAttr, 'float' ) ) );
		mat.emissiveNode = em;

	}

	if ( opts.sway ) {

		// Foliage wind: vertices with a "sway" attribute (0 at trunk base, 1 at
		// canopy) wobble in the vertex shader; no CPU cost.
		const sw = attribute( 'sway', 'float' );
		const phase = positionLocal.x.mul( 0.13 ).add( positionLocal.z.mul( 0.11 ) );
		const t = uTime.mul( 1.3 ).add( phase );
		const off = vec3( sin( t ).mul( 0.18 ), float( 0 ), sin( t.mul( 0.77 ).add( 1.3 ) ).mul( 0.14 ) ).mul( sw ).mul( uWind );
		mat.positionNode = positionLocal.add( off );

	}

	mat.fog = opts.fog ?? true;
	mat.userData.toonOpts = opts; // lets setToonLighting() build an unlit twin
	return mat;

}

// Self-lit material for gauges, lamps, taillights. `intensity` > 1 drives
// selective bloom on the High preset (bloom threshold sits above 1.0).
export function emissiveMaterial( hex, intensity = 1, opts = {} ) {

	const mat = new THREE.MeshBasicNodeMaterial( {
		color: hex,
		transparent: !! opts.transparent,
		opacity: opts.opacity ?? 1,
		side: opts.side ?? THREE.FrontSide,
		depthWrite: opts.depthWrite ?? true,
		blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending
	} );
	const strength = uniform( intensity );
	mat.colorNode = vec4( vec3( materialColor ).mul( strength ), 1 );
	mat.userData.strength = strength;
	mat.fog = opts.fog ?? false;
	return mat;

}

const outlineCache = new Map();

// Inverted-hull ink outline: back faces pushed out along normals, flat ink.
export function outlineMaterial( thickness = 0.022, hex = 0x140c1c ) {

	const key = thickness + ':' + hex;
	if ( outlineCache.has( key ) ) return outlineCache.get( key );
	const mat = new THREE.MeshBasicNodeMaterial( { color: hex, side: THREE.BackSide } );
	mat.positionNode = positionLocal.add( normalLocal.mul( thickness ) );
	mat.fog = true;
	outlineCache.set( key, mat );
	return mat;

}

// VR lite lighting: per-pixel lights are the frame-rate killer in stereo
// (the cockpit alone fills most of each eye), so in VR every lit toon
// material in `root` is swapped for its unlit twin: the same baked toon
// ramp, rim and emissive the Low preset uses, with no light or shadow maths.
// Twins are cached per material; unlit = false swaps the originals back.
const _twins = new WeakMap();
export function setToonLighting( root, unlit ) {

	root.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		const m = o.material;
		if ( unlit ) {

			const opts = m?.userData?.toonOpts;
			if ( ! opts || m.isMeshBasicNodeMaterial || m.userData.keepLit ) return;
			let twin = _twins.get( m );
			if ( ! twin ) {

				twin = toonMaterial( { ...opts, unlit: true } );
				twin.side = m.side;
				twin.userData.litOriginal = m;
				_twins.set( m, twin );

			}

			syncToonTwin( m );
			o.material = twin;

		} else if ( m?.userData?.litOriginal ) o.material = m.userData.litOriginal;

	} );

}

// Carry a later map/colour change (e.g. a new livery) over to the twin.
export function syncToonTwin( m ) {

	const twin = _twins.get( m );
	if ( ! twin ) return;
	if ( twin.map !== m.map ) {

		twin.map = m.map; twin.needsUpdate = true;

	}

	twin.color.copy( m.color );

}

// Ink hulls live on their own layer: cameras opt in, so mirrors skip them
// and VR can drop them (they double the draw calls of what they outline).
export const LAYER_OUTLINE = 6;

export function addOutline( mesh, thickness = 0.022, hex = 0x140c1c ) {

	if ( ! quality.outlines ) return null;
	const o = new THREE.Mesh( mesh.geometry, outlineMaterial( thickness, hex ) );
	o.name = 'outline';
	o.castShadow = false;
	o.receiveShadow = false;
	o.renderOrder = - 1;
	o.matrixAutoUpdate = false;
	o.layers.set( LAYER_OUTLINE );
	mesh.add( o );
	return o;

}

export { mix, max };
