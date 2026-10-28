import * as THREE from 'three/webgpu';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { ATLAS, createTextTexture } from '../render/textures.js';
import { ROAD } from './trackData.js';
import { mulberry32 } from '../core/math.js';

const ACCENT_U = ( ATLAS.accent[ 0 ] + ATLAS.accent[ 1 ] ) * 0.5;
const LANE_U = ATLAS.asphalt[ 0 ] + 0.04;

// Summit staging lot and the cooldown lot at the bottom. Called before the
// terrain is built so the ground is levelled and the physics walls widen.
export function defineLots( track ) {

	const W = track.wallOffset;
	const lots = [
		{ name: 'summit', s0: 0, s1: 150, side: 1, depth: 20 },
		{ name: 'cooldown', s0: track.cooldownS - 70, s1: track.cooldownS + 90, side: - 1, depth: 26 }
	];
	for ( const lot of lots ) {

		const i0 = track.indexAt( lot.s0 ), i1 = track.indexAt( lot.s1 );
		const arr = lot.side > 0 ? track.wallL : track.wallR;
		for ( let i = i0; i <= i1; i ++ ) {

			const taper = Math.min( 1, ( i - i0 ) / 6, ( i1 - i ) / 6 );
			arr[ i ] = W + lot.depth * Math.max( 0, taper );

		}

		lot.i0 = i0; lot.i1 = i1;
		// parking slot centre for the post-race cooldown
		const mid = Math.round( ( i0 + i1 ) / 2 );
		lot.parkS = mid * track.spacing;
		lot.parkLateral = lot.side * ( W + lot.depth * 0.55 );

	}

	track.lots = lots;
	return lots;

}

export function buildLocations( track, field, material, quality ) {

	const group = new THREE.Group();
	group.name = 'locations';
	const b = new GeoBuilder( { color: true, glow: true } );
	const hw = ROAD.halfWidth, gw = ROAD.gutterWidth, sh = ROAD.shoulder;
	const rng = mulberry32( 404 );
	const up = new THREE.Vector3( 0, 1, 0 );
	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3( 1, 1, 1 );

	const frameAt = ( i, lateral, yOff = 0, rot = 0, scale = null ) => {

		const lat = Math.sign( lateral ) * Math.min( Math.abs( lateral ), hw + gw );
		const y = track.surfaceY( track.py[ i ], track.bank[ i ], lat ) + yOff;
		p.set( track.px[ i ] + track.lx[ i ] * lateral, y, track.pz[ i ] + track.lz[ i ] * lateral );
		q.setFromAxisAngle( up, Math.atan2( track.fx[ i ], track.fz[ i ] ) + rot );
		return m4.compose( p, q, scale || sc );

	};

	const box = ( w, h, d ) => new THREE.BoxGeometry( w, h, d );
	const accent = { uv: [ ACCENT_U, 0.5 ] };

	for ( const lot of track.lots ) {

		const side = lot.side;
		// --- lot surface ---
		const rows = [];
		for ( let i = lot.i0; i <= lot.i1; i ++ ) {

			const wall = ( side > 0 ? track.wallL : track.wallR )[ i ];
			const y0 = track.surfaceY( track.py[ i ], track.bank[ i ], side * ( hw + gw ) ) - 0.015;
			const row = [];
			b.setColor( 0xb9b4c8 ).setGlow( 0 );
			for ( let k = 0; k <= 4; k ++ ) {

				const d = side * ( hw + gw + sh * 0.5 + ( wall - ( hw + gw + sh * 0.5 ) ) * k / 4 );
				row.push( b.vertex( track.px[ i ] + track.lx[ i ] * d, y0, track.pz[ i ] + track.lz[ i ] * d, LANE_U + k * 0.025, i * track.spacing / 9 ) );

			}

			rows.push( row );

		}

		for ( let r = 0; r < rows.length - 1; r ++ ) b.stripRows( rows[ r ], rows[ r + 1 ], side < 0 );

		// --- parking stripes ---
		const W = track.wallOffset;
		b.setColor( 0xf2f0fa ).setGlow( 0.04 );
		for ( let i = lot.i0 + 8; i < lot.i1 - 8; i += 3 ) {

			const len = lot.depth * 0.45;
			const lat = side * ( W + lot.depth - len * 0.5 - 1 );
			b.addGeometry( box( len, 0.03, 0.12 ), frameAt( i, lat, 0.0, Math.PI / 2 ), accent );

		}

		// --- outer fence (low guardrail) ---
		const postG = box( 0.1, 0.9, 0.1 );
		b.setColor( 0xb8bccb );
		for ( let i = lot.i0; i <= lot.i1; i += 2 ) {

			const wall = ( side > 0 ? track.wallL : track.wallR )[ i ];
			b.addGeometry( postG, frameAt( i, side * ( wall - 0.05 ), 0.45 ), { uv: [ ATLAS.rail[ 0 ] + 0.05, 0.5 ] } );
			if ( i + 2 <= lot.i1 ) {

				const wall2 = ( side > 0 ? track.wallL : track.wallR )[ i + 2 ];
				const a = new THREE.Vector3( track.px[ i ] + track.lx[ i ] * side * wall, 0, track.pz[ i ] + track.lz[ i ] * side * wall );
				const c = new THREE.Vector3( track.px[ i + 2 ] + track.lx[ i + 2 ] * side * wall2, 0, track.pz[ i + 2 ] + track.lz[ i + 2 ] * side * wall2 );
				const len = a.distanceTo( c );
				const yA = track.surfaceY( track.py[ i ], track.bank[ i ], side * ( hw + gw ) );
				const mid = a.clone().add( c ).multiplyScalar( 0.5 );
				const ang = Math.atan2( c.x - a.x, c.z - a.z );
				const mm = new THREE.Matrix4().compose( new THREE.Vector3( mid.x, yA + 0.7, mid.z ), new THREE.Quaternion().setFromAxisAngle( up, ang ), sc );
				b.addGeometry( box( 0.06, 0.3, len + 0.05 ), mm, { uv: [ ATLAS.rail[ 0 ] + 0.06, 0.5 ] } );

			}

		}

		// --- vending machines glowing at the back of the lot ---
		const vmI = lot.i0 + Math.round( ( lot.i1 - lot.i0 ) * 0.3 );
		for ( let k = 0; k < 3; k ++ ) {

			const i = vmI + k;
			const wall = ( side > 0 ? track.wallL : track.wallR )[ i ];
			const lat = side * ( wall - 1.2 );
			const rot = side > 0 ? - Math.PI / 2 : Math.PI / 2;
			b.setColor( [ 0xd23c3c, 0x2f6fd8, 0xf2f2f2 ][ k ] ).setGlow( 0.12 );
			b.addGeometry( box( 1.0, 1.85, 0.75 ), frameAt( i, lat, 0.93, rot ), accent );
			// lit display window
			b.setColor( 0xe8f4ff ).setGlow( 1.6 );
			const fm = frameAt( i, lat - side * 0.39, 1.15, rot ).clone();
			b.addGeometry( box( 0.8, 0.9, 0.02 ), fm, accent );
			b.setGlow( 0 );

		}

		// --- lantern string (chochin) along the lot ---
		const lanternG = new THREE.CylinderGeometry( 0.22, 0.22, 0.42, 8 );
		for ( let i = lot.i0 + 4; i < lot.i1 - 4; i += 4 ) {

			const wall = ( side > 0 ? track.wallL : track.wallR )[ i ];
			b.setColor( rng() < 0.5 ? 0xff4a3a : 0xfff1d6 ).setGlow( 1.3 );
			b.addGeometry( lanternG, frameAt( i, side * ( wall - 0.4 ), 3.1 ), accent );

		}

		b.setGlow( 0 );
		// --- torii gate at the summit, bench at the cooldown lot ---
		if ( lot.name === 'summit' ) {

			const i = lot.i0 + Math.round( ( lot.i1 - lot.i0 ) * 0.7 );
			const wall = track.wallL[ i ];
			const lat = side * ( wall - 3 );
			b.setColor( 0xe8462e ).setGlow( 0.12 );
			for ( const off of [ - 1.6, 1.6 ] ) {

				const mm = frameAt( i, lat, 2.2, Math.PI / 2 ).clone().multiply( new THREE.Matrix4().makeTranslation( off, 0, 0 ) );
				b.addGeometry( new THREE.CylinderGeometry( 0.17, 0.2, 4.4, 8 ), mm, accent );

			}

			b.addGeometry( box( 4.6, 0.25, 0.35 ), frameAt( i, lat, 3.7, Math.PI / 2 ), accent );
			b.setColor( 0x1b1420 );
			b.addGeometry( box( 5.2, 0.28, 0.45 ), frameAt( i, lat, 4.45, Math.PI / 2 ), accent );

		}

		// --- spectators gathered at the lot edge ---
		addSpectators( b, track, lot.i0 + 10, lot.i1 - 10, side, ( i ) => ( side > 0 ? track.wallL : track.wallR )[ i ] - 1.5, rng, frameAt, 18 );

	}

	// --- spectators at the famous corners ---
	for ( const tag of [ 'hairpin1', 'hairpin2', 'fiveHairpins' ] ) {

		const s = track.tags[ tag ];
		if ( s == null ) continue;
		const i0 = track.indexAt( s + 10 ), i1 = track.indexAt( s + 40 );
		const k = track.curv[ i0 + 4 ];
		const side = k > 0 ? 1 : - 1; // inside of the hairpin
		addSpectators( b, track, i0, i1, side, () => track.wallOffset + 1.6, rng, frameAt, 12 );

	}

	const mesh = new THREE.Mesh( b.build(), material );
	mesh.name = 'lots';
	mesh.matrixAutoUpdate = false;
	mesh.receiveShadow = true;
	group.add( mesh );

	// Start / finish gantries with banners.
	group.add( makeGantry( track, track.startS, [ '峠 DOWNHILL', 'スタート' ], '#ff3d6e' ) );
	group.add( makeGantry( track, track.finishS, [ 'GOAL', 'ゴール' ], '#2fd2ff' ) );
	return { group, lots: track.lots };

}

// Low-poly humanoid spectators (~20 parts each, merged into the lot mesh):
// shoes, legs, hips, tapered jacket torso, posed arms + hands, neck, head
// with hair and sometimes a cap. Poses: hands down, filming on a phone,
// cheering, arms folded. Local frame: +z faces the road, origin at the feet.
const P = {
	shoe: new THREE.BoxGeometry( 0.11, 0.07, 0.25 ).translate( 0, 0.035, 0.03 ),
	leg: new THREE.CylinderGeometry( 0.068, 0.058, 0.8, 6 ).translate( 0, - 0.4, 0 ),
	hips: new THREE.BoxGeometry( 0.33, 0.15, 0.2 ),
	torso: new THREE.CylinderGeometry( 0.2, 0.165, 0.56, 8 ).scale( 1, 1, 0.62 ),
	collar: new THREE.CylinderGeometry( 0.1, 0.16, 0.06, 8 ).scale( 1, 1, 0.7 ),
	arm: new THREE.CylinderGeometry( 0.055, 0.045, 0.6, 6 ).translate( 0, - 0.3, 0 ),
	hand: new THREE.SphereGeometry( 0.05, 6, 4 ),
	neck: new THREE.CylinderGeometry( 0.05, 0.055, 0.09, 6 ),
	head: new THREE.SphereGeometry( 0.115, 8, 6 ).scale( 0.92, 1.05, 1 ),
	hair: new THREE.SphereGeometry( 0.124, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58 ),
	cap: new THREE.CylinderGeometry( 0.125, 0.125, 0.06, 8 ),
	brim: new THREE.BoxGeometry( 0.2, 0.012, 0.11 ),
	phone: new THREE.BoxGeometry( 0.075, 0.14, 0.012 )
};
const JACKETS = [ 0x2e3a8c, 0xc8323c, 0x1f1f2a, 0xe8e2d0, 0x3a7d5a, 0xf0a020, 0x7a3a9a, 0x4a5a6a ];
const PANTS = [ 0x1d2233, 0x2a2a30, 0x3b4a6b, 0x5a4a3a, 0x18161c ];
const SKIN = [ 0xf1c9a5, 0xe0ac7e, 0xc68e5e, 0xf5d6bb ];
const HAIR = [ 0x15121a, 0x2a1d17, 0x4a2e1e, 0xc9a14a, 0x8a3a2a ];

function addSpectators( b, track, i0, i1, side, latFn, rng, frameAt, count ) {

	const E = ( x, y, z, rx = 0, ry = 0, rz = 0 ) => new THREE.Matrix4().compose(
		new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz ) ), new THREE.Vector3( 1, 1, 1 ) );
	const uv = { uv: [ ACCENT_U, 0.5 ] };
	for ( let n = 0; n < count; n ++ ) {

		const i = Math.min( track.count - 1, Math.round( i0 + rng() * ( i1 - i0 ) ) );
		const lat = side * ( latFn( i ) + rng() * 1.2 );
		const rot = ( side > 0 ? - Math.PI / 2 : Math.PI / 2 ) + ( rng() - 0.5 ) * 0.8;
		const base = frameAt( i, lat, 0, rot ).clone().multiply( new THREE.Matrix4().makeScale( 1, 0.94 + rng() * 0.12, 1 ) );
		const add = ( geo, local, color, glow = 0 ) => {

			b.setColor( color ).setGlow( glow );
			b.addGeometry( geo, base.clone().multiply( local ), uv );

		};

		const jacket = JACKETS[ ( rng() * JACKETS.length ) | 0 ], pants = PANTS[ ( rng() * PANTS.length ) | 0 ];
		const skin = SKIN[ ( rng() * SKIN.length ) | 0 ], hair = HAIR[ ( rng() * HAIR.length ) | 0 ];
		const pose = rng(); // < .35 phone, < .55 cheer, < .7 folded, else relaxed
		for ( const sx of [ - 1, 1 ] ) {

			add( P.shoe, E( sx * 0.1, 0, 0 ), 0x111015 );
			add( P.leg, E( sx * 0.1, 0.86, 0, 0, 0, sx * 0.03 ), pants );

		}

		add( P.hips, E( 0, 0.88, 0 ), pants );
		add( P.torso, E( 0, 1.2, 0 ), jacket );
		add( P.collar, E( 0, 1.49, 0 ), jacket );
		add( P.neck, E( 0, 1.53, 0 ), skin );
		add( P.head, E( 0, 1.67, 0.01 ), skin );
		if ( rng() < 0.25 ) {

			add( P.cap, E( 0, 1.75, 0 ), JACKETS[ ( rng() * JACKETS.length ) | 0 ] );
			add( P.brim, E( 0, 1.725, 0.1 ), 0x1a1820 );

		} else add( P.hair, E( 0, 1.675, - 0.012 ), hair );

		// arms hang from the shoulders; the pose bends them about the shoulder joint
		for ( const sx of [ - 1, 1 ] ) {

			let rx = 0.05, rz = sx * 0.12; // relaxed
			if ( pose < 0.35 && sx > 0 ) {

				rx = - 1.35; rz = - 0.35; // right arm up, filming

			} else if ( pose >= 0.35 && pose < 0.55 ) {

				rx = - 0.3; rz = sx * 2.6; // both arms raised, cheering

			} else if ( pose >= 0.55 && pose < 0.7 ) {

				rx = - 1.25; rz = - sx * 0.75; // arms folded across the chest

			}

			const shoulder = E( sx * 0.22, 1.44, 0, rx, 0, rz );
			add( P.arm, shoulder, jacket );
			add( P.hand, shoulder.clone().multiply( E( 0, - 0.62, 0 ) ), skin );
			if ( pose < 0.35 && sx > 0 ) add( P.phone, shoulder.clone().multiply( E( 0, - 0.66, 0.04, Math.PI / 2 ) ), 0xd8ecff, 1.2 );

		}

	}

	b.setGlow( 0 );

}

function makeGantry( track, s, lines, color ) {

	const g = new THREE.Group();
	g.name = 'gantry';
	const pt = track.pointAt( s );
	const W = track.wallOffset;
	const poleMat = new THREE.MeshBasicNodeMaterial( { color: 0x2a2436 } );
	const tex = createTextTexture( lines, { width: 1024, height: 256, bg: '#14101f', color: color, size: 96 } );
	const banMat = new THREE.MeshBasicNodeMaterial( { map: tex, side: THREE.DoubleSide } );
	banMat.fog = true;
	const pole = new THREE.BoxGeometry( 0.25, 6.4, 0.25 );
	for ( const sgn of [ 1, - 1 ] ) {

		const m = new THREE.Mesh( pole, poleMat );
		m.position.set( pt.x + pt.lx * sgn * ( W + 0.4 ) - pt.lx * 0, pt.y + 3.2, pt.z + pt.lz * sgn * ( W + 0.4 ) );
		g.add( m );

	}

	const ban = new THREE.Mesh( new THREE.PlaneGeometry( 2 * W + 0.6, 1.5 ), banMat );
	ban.position.set( pt.x, pt.y + 5.7, pt.z );
	ban.rotation.y = Math.atan2( pt.fx, pt.fz ) + Math.PI;
	g.add( ban );
	return g;

}
