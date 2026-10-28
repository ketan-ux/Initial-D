import * as THREE from 'three/webgpu';
import { vec3, vec4, float, materialColor } from 'three/tsl';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { toonMaterial } from '../render/toon.js';
import { makeCanvas, canvasToTexture, createLightPool } from '../render/textures.js';
import { mulberry32 } from '../core/math.js';

// The tuner garage around the showroom turntable: concrete floor, corrugated
// walls, steel beams, fluorescent tubes, enamel pendant lamps, red tool
// chests, tyre stacks, a workbench, posters and a neon sign, and a rolled-up
// door opening onto the sakura night with the moon over the mountains.
//
// Everything opaque shares one vertex-coloured toon mesh, everything self-lit
// shares one emissive mesh, so the whole set is a handful of draw calls.
// Garage space: car at the origin facing +z, door wall at z = -ROOM.d.
export const ROOM = { w: 8, d: 8, h: 4.4, doorW: 5, doorH: 3.45 };

const M4 = new THREE.Matrix4();
const at = ( x, y, z, ry = 0, rx = 0, rz = 0 ) => M4.clone().compose(
	new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz ) ), new THREE.Vector3( 1, 1, 1 ) );

export function buildGarageSet( quality ) {

	const group = new THREE.Group();
	group.name = 'garageSet';
	const rng = mulberry32( 86 );
	const b = new GeoBuilder( { color: true, sway: true, glow: true } );
	const e = new GeoBuilder( { color: true } );
	const box = ( B, w, h, d, x, y, z, color, ry = 0 ) => {

		B.setColor( color );
		B.addGeometry( new THREE.BoxGeometry( w, h, d ), at( x, y, z, ry ) );

	};

	const { w: W, d: D, h: H, doorW, doorH } = ROOM;

	// ---- shell -------------------------------------------------------------
	// side walls: concrete block wainscot + corrugated sheet ribs above
	for ( const sx of [ - 1, 1 ] ) {

		const x = sx * W;
		box( b, 0.2, 1.2, D * 2, x + sx * 0.1, 0.6, 0, 0x4f4552 );
		for ( let z = - D + 0.4; z < D; z += 0.4 ) box( b, 0.04, 0.02, 0.38, x - sx * 0.005, 1.2, z, 0x3c3340 ); // block joints
		box( b, 0.2, H - 1.2, D * 2, x + sx * 0.1, 1.2 + ( H - 1.2 ) / 2, 0, 0x6b5a66 );
		for ( let z = - D + 0.15; z < D; z += 0.3 ) box( b, 0.05, H - 1.25, 0.1, x - sx * 0.02, 1.2 + ( H - 1.2 ) / 2, z, rng() < 0.5 ? 0x7a6874 : 0x725f6c ); // planks
		for ( let z = - D + 1.2; z < D; z += 2.6 ) box( b, 0.14, H, 0.18, x - sx * 0.06, H / 2, z, 0x3a2c30 ); // posts

	}

	// front wall (behind the default camera) and the door wall
	box( b, W * 2, H, 0.2, 0, H / 2, D + 0.1, 0x6b5a66 );
	const sideW = W - doorW;
	for ( const sx of [ - 1, 1 ] ) {

		box( b, sideW, H, 0.2, sx * ( doorW + sideW / 2 ), H / 2, - D - 0.1, 0x6b5a66 );
		for ( let x = doorW + 0.35; x < W; x += 0.3 ) box( b, 0.1, H - 1.25, 0.05, sx * x, 1.2 + ( H - 1.2 ) / 2, - D + 0.02, rng() < 0.5 ? 0x7a6874 : 0x725f6c );
		box( b, sideW, 1.2, 0.06, sx * ( doorW + sideW / 2 ), 0.6, - D + 0.03, 0x4f4552 );
		// heavy timber door jambs
		box( b, 0.32, doorH + 0.3, 0.36, sx * ( doorW + 0.16 ), ( doorH + 0.3 ) / 2, - D + 0.05, 0x3a2a2c );

	}

	box( b, doorW * 2, H - doorH, 0.2, 0, doorH + ( H - doorH ) / 2, - D - 0.1, 0x6b5a66 );
	box( b, doorW * 2 + 0.7, 0.32, 0.4, 0, doorH + 0.16, - D + 0.08, 0x3a2a2c ); // header beam
	// rolled-up shutter: drum housing + bottom rail + a few slats still showing
	b.setColor( 0x6e6b80 );
	b.addGeometry( new THREE.CylinderGeometry( 0.3, 0.3, doorW * 2, 14 ).rotateZ( Math.PI / 2 ), at( 0, doorH + 0.62, - D + 0.45 ) );
	for ( let k = 0; k < 2; k ++ ) box( b, doorW * 2 - 0.1, 0.1, 0.04, 0, doorH - 0.05 - k * 0.11, - D + 0.3, k % 2 ? 0x5e5664 : 0x6e6674 );
	box( b, doorW * 2 - 0.1, 0.05, 0.07, 0, doorH - 0.24, - D + 0.3, 0x2a2430 );

	// ceiling + steel I-beams
	box( b, W * 2, 0.15, D * 2, 0, H + 0.075, 0, 0x2a2734 );
	for ( let z = - D + 1.5; z < D; z += 2.6 ) {

		box( b, W * 2, 0.06, 0.22, 0, H - 0.03, z, 0x45414f );
		box( b, W * 2, 0.26, 0.04, 0, H - 0.16, z, 0x3d3947 );
		box( b, W * 2, 0.04, 0.22, 0, H - 0.29, z, 0x45414f );

	}

	// ---- props ---------------------------------------------------------------
	// red / blue rolling tool chests (right wall), drawers + chrome pulls
	for ( const [ z, tall, col ] of [ [ - D + 1.4, true, 0xc8352f ], [ - D + 2.7, false, 0x2f4f9a ], [ - D + 5, true, 0xc8352f ] ] ) {

		const x = W - 0.42;
		const hgt = tall ? 1.05 : 0.95;
		box( b, 0.62, hgt, 1.15, x, 0.12 + hgt / 2, z, col );
		const n = tall ? 6 : 5;
		for ( let k = 0; k < n; k ++ ) {

			const y = 0.22 + ( k + 0.5 ) * ( hgt - 0.12 ) / n;
			box( b, 0.02, 0.012, 1.08, x - 0.315, y + ( hgt - 0.12 ) / n * 0.45, z, col === 0xc8352f ? 0x7a1d1a : 0x1c2f60 );
			box( b, 0.04, 0.025, 0.5, x - 0.335, y, z, 0xd8dbe4 ); // pulls face into the room

		}

		for ( const dz of [ - 0.48, 0.48 ] ) box( b, 0.1, 0.1, 0.1, x, 0.06, z + dz, 0x16151b ); // casters
		if ( tall ) {

			// top box with lid
			box( b, 0.55, 0.42, 1.05, x, 0.12 + hgt + 0.21, z, col );
			box( b, 0.58, 0.05, 1.08, x, 0.12 + hgt + 0.44, z, 0x2a2430 );

		}

	}

	// tyre stacks (door corners + left wall)
	const tyre = new THREE.TorusGeometry( 0.28, 0.11, 6, 16 ).rotateX( Math.PI / 2 );
	const hub = new THREE.CylinderGeometry( 0.17, 0.17, 0.2, 10 );
	for ( const [ x, z, n ] of [ [ - doorW - 0.75, - D + 0.75, 5 ], [ - doorW - 1.45, - D + 0.6, 4 ], [ - W + 0.7, - D + 1.0, 4 ], [ - W + 0.7, - D + 1.8, 3 ], [ doorW + 0.75, - D + 0.6, 2 ], [ - W + 0.7, 1.6, 4 ] ] ) {

		for ( let k = 0; k < n; k ++ ) {

			const jx = ( rng() - 0.5 ) * 0.06, jz = ( rng() - 0.5 ) * 0.06;
			b.setColor( 0x19171e );
			b.addGeometry( tyre, at( x + jx, 0.11 + k * 0.215, z + jz, rng() * 3 ) );
			b.setColor( 0x2c2a33 );
			b.addGeometry( hub, at( x + jx, 0.11 + k * 0.215, z + jz ) );

		}

	}

	// workbench + pegboard with tool silhouettes (left wall)
	{

		const x = - W + 0.4, z0 = 0.2, len = 2.6;
		box( b, 0.75, 0.06, len, x + 0.05, 0.92, z0 + len / 2, 0x8a5a3a );
		for ( const dz of [ 0.08, len - 0.08 ] ) for ( const dx of [ - 0.25, 0.35 ] ) box( b, 0.06, 0.9, 0.06, x + dx, 0.45, z0 + dz, 0x3a3846 );
		box( b, 0.7, 0.04, len - 0.1, x + 0.05, 0.3, z0 + len / 2, 0x6a4530 );
		box( b, 0.03, 1.0, len, x - 0.3, 1.65, z0 + len / 2, 0x5a5468 );
		for ( let k = 0; k < 11; k ++ ) {

			const tz = z0 + 0.2 + k * 0.22, th = 0.18 + rng() * 0.25;
			box( b, 0.03, th, 0.035 + ( k % 3 ) * 0.01, x - 0.27, 1.85 - th / 2, tz, [ 0x23212a, 0xd23d36, 0xc9ccd6 ][ k % 3 ] );

		}

		// vise + a parts box
		box( b, 0.2, 0.14, 0.16, x + 0.25, 1.02, z0 + 0.35, 0x3d5a8a );
		box( b, 0.35, 0.18, 0.5, x + 0.05, 1.04, z0 + 1.6, 0x2f6b4a );

	}

	// steel shelf with oil cans and boxes (right of the door)
	{

		const x = W - 0.3, z = 0.3;
		for ( const dz of [ - 0.75, 0.75 ] ) for ( const dx of [ - 0.2, 0.2 ] ) box( b, 0.04, 2.0, 0.04, x + dx, 1.0, z + dz, 0x4a4757 );
		for ( const y of [ 0.3, 0.95, 1.6 ] ) {

			box( b, 0.45, 0.03, 1.55, x, y, z, 0x5f5c6e );
			for ( let k = 0; k < 6; k ++ ) {

				const col = [ 0xf2c21b, 0x2d6cdf, 0xd23d36, 0x2f8a4a ][ ( rng() * 4 ) | 0 ];
				b.setColor( col );
				b.addGeometry( new THREE.CylinderGeometry( 0.06, 0.06, 0.2, 8 ), at( x + ( rng() - 0.5 ) * 0.15, y + 0.115, z - 0.6 + k * 0.24 ) );

			}

		}

	}

	// ---- turntable surround -------------------------------------------------
	b.setColor( 0x2a2833 );
	b.addGeometry( new THREE.RingGeometry( 3.02, 3.35, 48 ).rotateX( - Math.PI / 2 ), at( 0, 0.012, 0 ) );

	// ---- lamps ----------------------------------------------------------------
	// fluorescent tube fixtures between the beams
	for ( const x of [ - 3.6, 3.6 ] ) for ( const z of [ - 5.2, - 0.9, 3.6 ] ) {

		box( b, 0.22, 0.07, 1.5, x, H - 0.4, z, 0x8a8798 );
		for ( const dz of [ - 0.6, 0.6 ] ) box( b, 0.02, 0.36, 0.02, x, H - 0.2, z + dz, 0x2a2734 );
		e.setColor( 0xdfe8ff );
		e.addGeometry( new THREE.CylinderGeometry( 0.025, 0.025, 1.4, 6 ).rotateX( Math.PI / 2 ), at( x - 0.05, H - 0.455, z ) );
		e.addGeometry( new THREE.CylinderGeometry( 0.025, 0.025, 1.4, 6 ).rotateX( Math.PI / 2 ), at( x + 0.05, H - 0.455, z ) );

	}

	// wall tube on the right wall above the tool chests
	box( b, 0.12, 0.1, 1.5, W - 0.08, 2.75, - D + 3.4, 0x8a8798 );
	e.setColor( 0xdfe8ff );
	e.addGeometry( new THREE.CylinderGeometry( 0.03, 0.03, 1.4, 6 ).rotateX( Math.PI / 2 ), at( W - 0.15, 2.7, - D + 3.4 ) );

	// enamel pendant lamps over the car
	const pendants = [ [ - 2.2, - 1.2 ], [ 2.2, - 1.2 ], [ 0, 2.4 ] ];
	for ( const [ x, z ] of pendants ) {

		const yS = 3.15;
		b.setColor( 0x16151b );
		b.addGeometry( new THREE.CylinderGeometry( 0.008, 0.008, H - yS, 4 ), at( x, yS + ( H - yS ) / 2, z ) );
		b.setColor( 0x245a46 );
		b.addGeometry( new THREE.CylinderGeometry( 0.06, 0.36, 0.26, 16, 1, true ), at( x, yS - 0.13, z ) );
		b.setColor( 0xf3efe0 );
		b.addGeometry( new THREE.CylinderGeometry( 0.055, 0.34, 0.25, 16, 1, true ).scale( - 1, 1, 1 ), at( x, yS - 0.135, z ) ); // inside face
		e.setColor( 0xffd8a0 );
		e.addGeometry( new THREE.SphereGeometry( 0.075, 10, 8 ), at( x, yS - 0.22, z ) );

	}

	// glowing turntable ring
	e.setColor( 0.55, 0.26, 0.05 ); // dimmer than the lamps: a thin glow line, not a bloom halo
	e.addGeometry( new THREE.TorusGeometry( 3.0, 0.028, 4, 72 ).rotateX( Math.PI / 2 ), at( 0, 0.03, 0 ) );

	// ---- outside: apron, sakura, lantern, mountains ---------------------------
	b.setColor( 0x2b2934 );
	b.addGeometry( new THREE.PlaneGeometry( doorW * 2 + 1, 9 ).rotateX( - Math.PI / 2 ), at( 0, 0.005, - D - 4.6 ) );
	b.setColor( 0x2a3f45 );
	b.addGeometry( new THREE.CircleGeometry( 70, 40 ).rotateX( - Math.PI / 2 ), at( 0, - 0.02, - D - 30 ) );
	for ( let i = 0; i < 260; i ++ ) {

		const px = ( rng() - 0.5 ) * 22, pz = - D - 1 - rng() * 14;
		b.setColor( [ 0xf2b3cf, 0xffd3e6, 0xf7a1c8 ][ ( rng() * 3 ) | 0 ] );
		b.addGeometry( new THREE.CircleGeometry( 0.06 + rng() * 0.08, 5 ).rotateX( - Math.PI / 2 ), at( px, 0.012 + rng() * 0.004, pz ) );

	}

	// lean = direction the crown spreads toward (over the door opening)
	const tree = ( tx, tz, s, lean = 0, base = 3.2 ) => {

		b.setColor( 0x3d2a30 ).setSway( 0 );
		b.addGeometry( new THREE.CylinderGeometry( 0.28 * s, 0.55 * s, base * s, 8 ).translate( 0, base * s / 2, 0 ), at( tx, 0, tz, 0, 0, - lean * 0.12 ) );
		for ( let i = 0; i < 6; i ++ ) {

			const br = new THREE.CylinderGeometry( 0.08 * s, 0.2 * s, 3.4 * s, 6 ).translate( 0, 1.7 * s, 0 );
			b.addGeometry( br, at( tx, base * 0.85 * s, tz ).multiply( new THREE.Matrix4().makeRotationY( i * 1.05 + lean ) ).multiply( new THREE.Matrix4().makeRotationZ( 1.05 ) ) );

		}

		for ( let i = 0; i < 34; i ++ ) {

			const a = rng() * Math.PI * 2, r = rng() * 4.2 * s;
			const ox = Math.cos( a ) * r + lean * 1.6 * s, oz = Math.sin( a ) * r;
			// outer puffs droop lower: a soft, weeping silhouette
			const y = ( base + 1.2 + rng() * 2.2 - ( r / ( 4.2 * s ) ) * 1.3 ) * s;
			b.setColor( [ 0xffb8d6, 0xff9cc6, 0xffd3e6, 0xf7a1c8, 0xe889b8 ][ ( rng() * 5 ) | 0 ] ).setSway( 1 ).setGlow( 0.32 + rng() * 0.12 );
			const puff = new THREE.IcosahedronGeometry( ( 1.0 + rng() * 0.9 ) * s, 1 ).scale( 1, 0.7, 1 );
			b.addGeometry( puff, at( tx + ox, y, tz + oz ) );

		}

		b.setSway( 0 ).setGlow( 0 );

	};

	tree( - doorW - 1.4, - D - 3.4, 1.1, 1 );
	tree( doorW + 1.2, - D - 4.2, 1.05, - 1 );
	tree( - 13, - D - 15, 1.2, 0, 4 );
	tree( 12, - D - 19, 1.1, 0, 4 );
	// stone lantern (tōrō) by the apron
	{

		const x = 2.4, z = - D - 2.6;
		b.setColor( 0x8a8496 );
		b.addGeometry( new THREE.CylinderGeometry( 0.35, 0.45, 0.3, 6 ).translate( 0, 0.15, 0 ), at( x, 0, z ) );
		b.addGeometry( new THREE.CylinderGeometry( 0.12, 0.14, 0.9, 6 ).translate( 0, 0.75, 0 ), at( x, 0, z ) );
		b.addGeometry( new THREE.ConeGeometry( 0.55, 0.4, 6 ).translate( 0, 1.85, 0 ), at( x, 0, z ) );
		e.setColor( 0xffb35a );
		e.addGeometry( new THREE.BoxGeometry( 0.42, 0.4, 0.42 ), at( x, 1.42, z ) );

	}

	// dark forest clumps on the hillside below the ridges
	for ( let i = 0; i < 70; i ++ ) {

		const x = ( rng() - 0.5 ) * 110, z = - D - 30 - rng() * 40;
		const r = 1.0 + rng() * 0.9;
		b.setColor( [ 0x24403f, 0x2c4a44, 0x1f3638, 0x34504a ][ ( rng() * 4 ) | 0 ] );
		b.addGeometry( new THREE.IcosahedronGeometry( r, 0 ).scale( 1, 0.8 + rng() * 0.5, 1 ), at( x, r * 0.5, z, rng() * 3 ) );

	}

	// layered mountain ridges framed by the door
	const ridge = ( z, color, seed, hgt ) => {

		const r = mulberry32( seed );
		b.setColor( color );
		for ( let i = 0; i < 9; i ++ ) {

			const x = ( i - 4 ) * 22 + ( r() - 0.5 ) * 10;
			const hh = hgt * ( 0.6 + r() * 0.6 );
			b.addGeometry( new THREE.ConeGeometry( 11 + r() * 7, hh, 5 ).translate( 0, hh / 2 - 1, 0 ), at( x, 0, z, r() * 3 ) );

		}

	};

	// low enough that the ridgeline sits a few degrees up in the door frame
	ridge( - 78, 0x3b2f66, 11, 6.5 );
	ridge( - 110, 0x2c2452, 12, 10 );

	const envMat = toonMaterial( { vertexColors: true, sway: true, rim: 0.25, glowAttr: 'glow' } );
	const env = new THREE.Mesh( b.build(), envMat );
	env.name = 'garageShell';
	env.receiveShadow = true;
	group.add( env );

	// concrete floor with stains and saw-cut joints
	const floor = new THREE.Mesh( new THREE.PlaneGeometry( W * 2, D * 2 ).rotateX( - Math.PI / 2 ), toonMaterial( { map: concreteTexture(), rim: 0 } ) );
	floor.name = 'garageFloor';
	floor.receiveShadow = true;
	group.add( floor );

	// self-lit parts (tubes, bulbs, ring, lantern) — bloom on High
	const emMat = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
	emMat.colorNode = vec4( vec3( float( 2.2 ) ), 1 ); // multiplied by vertex colour
	emMat.fog = false;
	void materialColor;
	const em = new THREE.Mesh( e.build(), emMat );
	em.name = 'garageLamps';
	group.add( em );

	// posters + neon sign share one textured mesh
	group.add( buildSigns() );

	// big anime moon low over the ridges, lined up with the door from the default view
	const moon = new THREE.Group();
	const moonMat = new THREE.MeshBasicNodeMaterial( { color: 0xfff6dc } );
	moonMat.colorNode = vec4( vec3( materialColor ).mul( 1.6 ), 1 );
	moonMat.fog = false;
	const disc = new THREE.Mesh( new THREE.CircleGeometry( 4.6, 40 ), moonMat );
	const haloMat = new THREE.MeshBasicNodeMaterial( { color: 0xb9a8ff, transparent: true, opacity: 0.18, depthWrite: false } );
	haloMat.fog = false;
	const halo = new THREE.Mesh( new THREE.RingGeometry( 4.9, 9.5, 40 ), haloMat );
	moon.add( disc, halo );
	moon.position.set( - 47, 16.7, - 125 );
	moon.lookAt( 4.2, 1.3, 5.3 );
	moon.name = 'garageMoon';
	group.add( moon );

	// ---- lights ------------------------------------------------------------------
	const lights = [];
	if ( quality.toon !== 'unlit' ) {

		group.add( new THREE.HemisphereLight( 0x9c8fe0, 0x4a3a40, 1.15 ) );
		const moonLight = new THREE.DirectionalLight( 0xb8c2ff, 0.9 );
		moonLight.position.set( - 3, 6, - 12 );
		group.add( moonLight );
		const spots = quality.key === 'high' ? pendants : pendants.slice( 0, 2 );
		for ( const [ x, z ] of spots ) {

			const s = new THREE.SpotLight( 0xffd2a0, 7, 9, 0.9, 0.7, 1.2 );
			s.position.set( x, 2.95, z );
			s.target.position.set( x * 0.4, 0, z * 0.4 );
			group.add( s, s.target );
			lights.push( s );

		}

	} else {

		// unlit toon (Low): warm light pools painted on the floor
		const poolMat = new THREE.MeshBasicNodeMaterial( { map: createLightPool(), color: 0xffd9a8, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending } );
		for ( const [ x, z ] of pendants ) {

			const p = new THREE.Mesh( new THREE.PlaneGeometry( 3.4, 3.4 ).rotateX( - Math.PI / 2 ), poolMat );
			p.position.set( x, 0.02, z );
			group.add( p );

		}

	}

	return { group, lights };

}

function concreteTexture() {

	const S = 1024;
	const c = makeCanvas( S, S ), ctx = c.getContext( '2d' );
	ctx.fillStyle = '#626072';
	ctx.fillRect( 0, 0, S, S );
	const r = mulberry32( 5 );
	// mottling
	for ( let i = 0; i < 1400; i ++ ) {

		ctx.fillStyle = `rgba(${r() < 0.5 ? '40,38,52' : '140,136,156'},${0.03 + r() * 0.05})`;
		const s = 8 + r() * 60;
		ctx.beginPath(); ctx.ellipse( r() * S, r() * S, s, s * ( 0.4 + r() * 0.6 ), r() * 3, 0, Math.PI * 2 ); ctx.fill();

	}

	// oil stains
	for ( let i = 0; i < 9; i ++ ) {

		const x = r() * S, y = r() * S, s = 30 + r() * 90;
		const g = ctx.createRadialGradient( x, y, 0, x, y, s );
		g.addColorStop( 0, 'rgba(22,20,30,0.45)' ); g.addColorStop( 1, 'rgba(22,20,30,0)' );
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.ellipse( x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2 ); ctx.fill();

	}

	// saw-cut joints
	ctx.strokeStyle = 'rgba(30,28,40,0.7)';
	ctx.lineWidth = 3;
	for ( let k = 0; k <= 4; k ++ ) {

		ctx.beginPath(); ctx.moveTo( k * S / 4, 0 ); ctx.lineTo( k * S / 4, S ); ctx.stroke();
		ctx.beginPath(); ctx.moveTo( 0, k * S / 4 ); ctx.lineTo( S, k * S / 4 ); ctx.stroke();

	}

	// painted bay lines near the walls
	ctx.fillStyle = '#e8c23a';
	ctx.fillRect( 0, S * 0.06, S, 10 );
	ctx.fillRect( 0, S * 0.94 - 10, S, 10 );
	return canvasToTexture( c );

}

// Two posters (left wall) and a neon "峠 GARAGE" sign beside the door, drawn
// into one canvas; the sign half is boosted so it blooms on High.
function buildSigns() {

	const S = 1024;
	const c = makeCanvas( S, S / 2 ), ctx = c.getContext( '2d' );
	// poster 1: race poster
	let g = ctx.createLinearGradient( 0, 0, 0, 512 );
	g.addColorStop( 0, '#ff8a1a' ); g.addColorStop( 1, '#d8264a' );
	ctx.fillStyle = g; ctx.fillRect( 0, 0, 256, 512 );
	ctx.fillStyle = '#fff6e8';
	ctx.font = '900 150px "Noto Serif JP", "Hiragino Mincho ProN", serif';
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	ctx.fillText( '峠', 128, 190 );
	ctx.font = 'italic 900 38px Kanit, "Arial Black", sans-serif';
	ctx.fillText( 'DOWNHILL', 128, 330 );
	ctx.fillText( 'BATTLE', 128, 372 );
	ctx.font = '700 20px Kanit, Arial, sans-serif';
	ctx.fillText( 'AKIYAMA PASS · 23:00', 128, 450 );
	ctx.strokeStyle = '#16141b'; ctx.lineWidth = 10; ctx.strokeRect( 5, 5, 246, 502 );
	// poster 2: tyre ad
	ctx.fillStyle = '#1b1a22'; ctx.fillRect( 256, 0, 256, 512 );
	ctx.fillStyle = '#f2c21b';
	ctx.beginPath(); ctx.arc( 384, 200, 92, 0, Math.PI * 2 ); ctx.lineWidth = 28; ctx.strokeStyle = '#f2c21b'; ctx.stroke();
	ctx.font = 'italic 900 52px Kanit, "Arial Black", sans-serif';
	ctx.fillText( 'GRIP', 384, 365 );
	ctx.font = '700 22px Kanit, Arial, sans-serif';
	ctx.fillStyle = '#ffffff';
	ctx.fillText( 'RADIAL · 195/60R15', 384, 420 );
	// neon sign (right half)
	ctx.fillStyle = '#08070c'; ctx.fillRect( 512, 0, 512, 512 );
	ctx.shadowColor = '#ff5fa8'; ctx.shadowBlur = 30;
	ctx.fillStyle = '#ffd1ea';
	ctx.font = '900 210px "Noto Serif JP", "Hiragino Mincho ProN", serif';
	ctx.fillText( '峠', 768, 200 );
	ctx.shadowColor = '#5fe1ff';
	ctx.fillStyle = '#d6f7ff';
	ctx.font = 'italic 900 84px Kanit, "Arial Black", sans-serif';
	ctx.fillText( 'GARAGE', 768, 400 );
	const tex = canvasToTexture( c );

	const b = new GeoBuilder( { color: true } );
	const quad = ( u0, u1, w, h, m, bright ) => {

		b.setColor( bright, bright, bright );
		b.addGeometry( new THREE.PlaneGeometry( w, h ), m, { uvRemap: ( u, v ) => [ u0 + u * ( u1 - u0 ), v ] } );

	};

	const W = ROOM.w;
	quad( 0, 0.25, 0.8, 1.6, at( - W + 0.02, 2.35, - 1.6, Math.PI / 2 ), 1 );
	quad( 0.25, 0.5, 0.8, 1.6, at( - W + 0.02, 2.35, - 0.5, Math.PI / 2 ), 1 );
	quad( 0.5, 1, 1.15, 1.15, at( - ROOM.doorW - 1.5, 2.85, - ROOM.d + 0.04 ), 2.2 );
	const mat = new THREE.MeshBasicNodeMaterial( { map: tex, vertexColors: true } );
	mat.fog = true;
	const mesh = new THREE.Mesh( b.build(), mat );
	mesh.name = 'garageSigns';
	return mesh;

}
