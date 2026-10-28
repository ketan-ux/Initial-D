import * as THREE from 'three/webgpu';
import { FOG_COLOR } from './sky.js';

// Painted silhouette backdrop for short draw distances (VR): a cylinder of
// layered mountain ridges and treelines that sits just inside the far plane
// and follows the camera, so geometry dissolving into the mist meets a
// skyline instead of an empty edge. One draw call, one canvas texture,
// seamless around the full circle.
export class MistRing {

	constructor() {

		this.canvas = paint();
		const tex = new THREE.CanvasTexture( this.canvas );
		tex.colorSpace = THREE.NoColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.anisotropy = 4;
		const mat = new THREE.MeshBasicNodeMaterial( { map: tex, transparent: true, depthWrite: false, side: THREE.BackSide } );
		mat.fog = false;
		// unit radius, spans -0.62 … +0.26 of the radius around eye height
		const geo = new THREE.CylinderGeometry( 1, 1, 0.88, 72, 1, true ).translate( 0, - 0.18, 0 );
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.name = 'mistRing';
		this.mesh.renderOrder = - 5;
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;

	}

	update( cameraWorldPos, far ) {

		if ( ! this.mesh.visible ) return;
		this.mesh.position.copy( cameraWorldPos );
		this.mesh.scale.setScalar( far * 0.86 );

	}

}

// Periodic ridge line: sum of integer-frequency sines so it wraps at 2π.
function ridge( seed, octaves ) {

	const terms = [];
	for ( let i = 0; i < octaves; i ++ ) {

		const f = Math.round( ( 2 + i * 3.7 ) * ( 1 + seed * 0.3 ) );
		terms.push( { f, a: 1 / ( 1 + i * 1.4 ), p: seed * 13.1 + i * 2.3 } );

	}

	const norm = terms.reduce( ( s, t ) => s + t.a, 0 );
	return ( u ) => terms.reduce( ( s, t ) => s + Math.sin( u * Math.PI * 2 * t.f + t.p ) * t.a, 0 ) / norm;

}

function paint() {

	const W = 2048, H = 256;
	const c = document.createElement( 'canvas' );
	c.width = W; c.height = H;
	const ctx = c.getContext( '2d' );
	const fog = FOG_COLOR;
	const rgb = ( r, g, b, a = 1 ) => `rgba(${Math.round( r * 255 )},${Math.round( g * 255 )},${Math.round( b * 255 )},${a})`;
	const tint = ( k, a = 1 ) => rgb( fog.r * k, fog.g * k, fog.b * k, a );
	// rows: 0 = top of the cylinder (+0.26 R), H = bottom (-0.62 R). Eye
	// height (the horizon) sits at y = H * 0.26 / 0.88.
	const horizon = H * 0.26 / 0.88;

	// far ridges: pale, hazy; near ridges: darker, closer to the fog tone
	const layers = [
		{ seed: 0.9, base: horizon - 30, amp: 22, col: [ 1.32, 0.62 ] },
		{ seed: 2.1, base: horizon - 16, amp: 18, col: [ 1.16, 0.85 ] },
		{ seed: 3.4, base: horizon - 4, amp: 12, col: [ 0.96, 1 ] }
	];
	for ( const L of layers ) {

		const f = ridge( L.seed, 5 );
		ctx.fillStyle = tint( L.col[ 0 ], L.col[ 1 ] );
		ctx.beginPath();
		ctx.moveTo( 0, H );
		for ( let x = 0; x <= W; x += 4 ) ctx.lineTo( x, L.base - f( x / W ) * L.amp );
		ctx.lineTo( W, H );
		ctx.closePath();
		ctx.fill();

	}

	// treeline on the nearest ridge: cedar spikes and round sakura crowns
	const near = ridge( 3.4, 5 );
	let rnd = 7;
	const rand = () => ( ( rnd = ( rnd * 16807 ) % 2147483647 ) / 2147483647 );
	const tree = ( x, y, s, cedar, pink ) => {

		if ( cedar ) {

			ctx.fillStyle = tint( 0.82 );
			ctx.beginPath();
			ctx.moveTo( x - s * 0.45, y + 2 ); ctx.lineTo( x, y - s * 1.9 ); ctx.lineTo( x + s * 0.45, y + 2 );
			ctx.fill();

		} else {

			ctx.fillStyle = pink ? rgb( fog.r * 1.25, fog.g * 0.95, fog.b * 1.08 ) : tint( 0.9 ); // blossom haze
			ctx.beginPath(); ctx.arc( x, y - s * 0.5, s * 0.8, 0, Math.PI * 2 ); ctx.fill();

		}

	};

	for ( let x = 0; x < W; x += 3 + rand() * 6 ) {

		const y = layers[ 2 ].base - near( x / W ) * layers[ 2 ].amp;
		const s = 4 + rand() * 7, cedar = rand() < 0.55, pink = rand() < 0.5;
		tree( x, y, s, cedar, pink );
		// repeat across the seam so the wrap is invisible
		if ( x < 12 ) tree( x + W, y, s, cedar, pink );
		if ( x > W - 12 ) tree( x - W, y, s, cedar, pink );

	}

	// solid mist below the near ridge, and a soft fade into it
	const g = ctx.createLinearGradient( 0, horizon + 4, 0, horizon + 50 );
	g.addColorStop( 0, tint( 1, 0 ) );
	g.addColorStop( 1, tint( 1, 1 ) );
	ctx.fillStyle = g;
	ctx.fillRect( 0, horizon + 4, W, H - horizon - 4 );
	// haze veil over the ridges so they read as distant
	const v = ctx.createLinearGradient( 0, 0, 0, horizon + 6 );
	v.addColorStop( 0, tint( 1.2, 0 ) );
	v.addColorStop( 1, tint( 1.1, 0.35 ) );
	ctx.globalCompositeOperation = 'source-atop';
	ctx.fillStyle = v;
	ctx.fillRect( 0, 0, W, horizon + 6 );
	ctx.globalCompositeOperation = 'source-over';
	return c;

}
