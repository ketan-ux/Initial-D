import * as THREE from 'three/webgpu';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { ATLAS } from '../render/textures.js';
import { ROAD } from './trackData.js';

const U = ( col, t ) => ATLAS[ col ][ 0 ] + ( ATLAS[ col ][ 1 ] - ATLAS[ col ][ 0 ] ) * t;
const ACCENT_U = ( ATLAS.accent[ 0 ] + ATLAS.accent[ 1 ] ) * 0.5;

// Decide, per sample and side, whether the roadside is a cut (retaining
// wall up into the mountain) or a fill (guardrail above a drop).
export function classifySides( track, field ) {

	const n = track.count;
	const rawL = new Uint8Array( n ), rawR = new Uint8Array( n );
	const upL = new Float32Array( n ), upR = new Float32Array( n );
	for ( let i = 0; i < n; i += 2 ) {

		const y = track.py[ i ];
		const hl = field.sideHeight( i, 1 ) - y, hr = field.sideHeight( i, - 1 ) - y;
		for ( let k = i; k < Math.min( n, i + 2 ); k ++ ) {

			upL[ k ] = hl; upR[ k ] = hr;
			rawL[ k ] = hl > 1.6 ? 1 : 0;
			rawR[ k ] = hr > 1.6 ? 1 : 0;

		}

	}

	const filt = ( raw ) => {

		const out = new Uint8Array( n );
		const r = 14;
		for ( let i = 0; i < n; i ++ ) {

			let s = 0, c = 0;
			for ( let k = - r; k <= r; k ++ ) {

				const j = i + k;
				if ( j >= 0 && j < n ) {

					s += raw[ j ]; c ++;

				}

			}

			out[ i ] = s * 2 > c ? 1 : 0;

		}

		return out;

	};

	return { wallL: filt( rawL ), wallR: filt( rawR ), upL, upR };

}

/**
 * Builds the road as chunks of ~128 m. Each chunk is ONE draw call: asphalt,
 * gutters, shoulders, retaining walls, guardrails, posts, reflectors, chevrons
 * and lamp heads share the road atlas + vertex colours + a glow attribute.
 */
export function buildRoad( track, sides, material, opts = {} ) {

	const group = new THREE.Group();
	group.name = 'road';
	const chunkLen = 64;
	const lamps = []; // { x, y, z, fx, fz } for light-pool decals and optional lights
	const hw = ROAD.halfWidth, gw = ROAD.gutterWidth, sh = ROAD.shoulder;
	const W = track.wallOffset;
	const n = track.count;
	const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3( 1, 1, 1 ), tmpP = new THREE.Vector3();
	const upAxis = new THREE.Vector3( 0, 1, 0 );
	const postGeo = new THREE.BoxGeometry( 0.11, 0.9, 0.11 );
	const reflGeo = new THREE.BoxGeometry( 0.1, 0.07, 0.03 );
	const chevGeo = new THREE.BoxGeometry( 1.3, 0.6, 0.05 );
	const chevMarkGeo = new THREE.BoxGeometry( 0.12, 0.42, 0.02 );
	const poleGeo = new THREE.BoxGeometry( 0.16, 6.2, 0.16 );
	const armGeo = new THREE.BoxGeometry( 0.12, 0.12, 2.2 );
	const headGeo = new THREE.BoxGeometry( 0.5, 0.18, 0.8 );
	const lineGeo = new THREE.BoxGeometry( 1, 0.02, 1 );
	const uPoleGeo = new THREE.CylinderGeometry( 0.13, 0.17, 12, 6 );
	const crossGeo = new THREE.BoxGeometry( 1.9, 0.12, 0.12 );
	const insGeo = new THREE.BoxGeometry( 0.07, 0.14, 0.07 );
	const canGeo = new THREE.CylinderGeometry( 0.28, 0.28, 0.75, 8 );
	const barrierGeo = new THREE.BoxGeometry( 1.25, 0.82, 0.42 );
	const stripeGeo = new THREE.BoxGeometry( 0.2, 0.86, 0.44 );
	const wireGeo = new THREE.BoxGeometry( 0.035, 0.035, 1 );
	const POLE_EVERY = 20; // samples (~40 m)
	// utility-pole crossarm tips (world space) for sample i, or null if no pole
	const poleSide = ( i ) => {

		if ( i % POLE_EVERY !== 7 || i >= n ) return 0;
		const side = 1; // poles follow the left verge down the whole pass
		if ( track.wallL[ i ] > W + 0.5 || Math.abs( track.curv[ i ] ) > 1 / 24 ) return 0;
		return side;

	};

	const poleTips = ( i ) => {

		const side = poleSide( i );
		if ( ! side ) return null;
		const lat = side * ( W + 1.3 );
		const x = track.px[ i ] + track.lx[ i ] * lat, z = track.pz[ i ] + track.lz[ i ] * lat;
		const y = track.py[ i ] + 7.6;
		return [ - 0.8, 0, 0.8 ].map( ( o ) => new THREE.Vector3( x + track.lx[ i ] * o, y + ( o === 0 ? 0.35 : 0 ), z + track.lz[ i ] * o ) );

	};

	const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wq = new THREE.Quaternion(), _wz = new THREE.Vector3( 0, 0, 1 );

	const place = ( geo, i, lateral, yOff, rotY = 0, scale = null ) => {

		const x = track.px[ i ] + track.lx[ i ] * lateral;
		const z = track.pz[ i ] + track.lz[ i ] * lateral;
		const y = track.surfaceY( track.py[ i ], track.bank[ i ], Math.sign( lateral ) * Math.min( Math.abs( lateral ), hw + gw ) ) + yOff;
		const heading = Math.atan2( track.fx[ i ], track.fz[ i ] );
		tmpQ.setFromAxisAngle( upAxis, heading + rotY );
		tmpP.set( x, y, z );
		tmpM.compose( tmpP, tmpQ, scale || tmpS );
		return tmpM;

	};

	for ( let c0 = 0; c0 < n - 1; c0 += chunkLen ) {

		const c1 = Math.min( n - 1, c0 + chunkLen );
		const b = new GeoBuilder( { color: true, glow: true } );
		b.setColor( 0xffffff ).setGlow( 0 );

		const rowsAsphalt = [];
		const rowsG = { 1: [], [ - 1 ]: [] }, rowsS = { 1: [], [ - 1 ]: [] }, rowsW = { 1: [], [ - 1 ]: [] };
		const rowsRailF = { 1: [], [ - 1 ]: [] }, rowsRailB = { 1: [], [ - 1 ]: [] };
		const wallKinds = { 1: [], [ - 1 ]: [] };

		for ( let i = c0; i <= c1; i ++ ) {

			const cx = track.px[ i ], cz = track.pz[ i ], cy = track.py[ i ], bank = track.bank[ i ];
			const lx = track.lx[ i ], lz = track.lz[ i ];
			const v = ( i * track.spacing ) / ATLAS.tileLength;
			const P = ( d, yAdd = 0 ) => [ cx + lx * d, track.surfaceY( cy, bank, Math.max( - ( hw + gw ), Math.min( hw + gw, d ) ) ) + yAdd, cz + lz * d ];

			// asphalt, right edge -> left edge
			const ra = [];
			for ( let k = 0; k <= 6; k ++ ) {

				const d = - hw + ( 2 * hw * k ) / 6;
				const p = P( d );
				ra.push( b.vertex( p[ 0 ], p[ 1 ], p[ 2 ], U( 'asphalt', k / 6 ), v ) );

			}

			rowsAsphalt.push( ra );

			for ( const side of [ 1, - 1 ] ) {

				// U-gutter
				const rg = [];
				for ( let k = 0; k <= 4; k ++ ) {

					const e = ( gw * k ) / 4;
					const p = P( side * ( hw + e ) );
					rg.push( b.vertex( p[ 0 ], p[ 1 ], p[ 2 ], U( 'gutter', k / 4 ), v ) );

				}

				rowsG[ side ].push( rg );

				// shoulder
				const y0 = track.surfaceY( cy, bank, side * ( hw + gw ) );
				const rs = [];
				for ( const e of [ gw, gw + sh ] ) {

					const d = side * ( hw + e );
					rs.push( b.vertex( cx + lx * d, y0, cz + lz * d, U( 'gutter', 0.96 ), v ) );

				}

				rowsS[ side ].push( rs );

				const isOpen = ( side > 0 ? track.wallL : track.wallR )[ i ] > W + 0.5;
				const isWall = isOpen ? 2 : ( side > 0 ? sides.wallL : sides.wallR )[ i ];
				wallKinds[ side ].push( isWall );
				const up = side > 0 ? sides.upL[ i ] : sides.upR[ i ];
				const rw = [];
				if ( isOpen ) {

					for ( const d of [ W, W + 0.2, W + 0.4, W + 0.6 ] ) {

						const dd = side * d;
						rw.push( b.vertex( cx + lx * dd, y0 - 0.01, cz + lz * dd, U( 'gutter', 0.96 ), v ) );

					}

				} else if ( isWall ) {

					const wallH = Math.max( 2.6, Math.min( 6.5, up * 0.75 ) );
					const prof = [ [ W, 0, 0 ], [ W + 0.06, 0.32, 0.12 ], [ W + 0.12 + wallH * 0.2, wallH, 1 ], [ W + 2.4 + wallH * 0.2, wallH + 0.9, 1 ] ];
					for ( const [ d, h, t ] of prof ) {

						const dd = side * d;
						rw.push( b.vertex( cx + lx * dd, y0 + h, cz + lz * dd, U( 'wall', t ), v * 1.0 ) );

					}

				} else {

					const prof = [ [ W, 0, 0.02 ], [ W + 0.4, - 0.08, 0.04 ], [ W + 1.3, - 3.4, 0.08 ], [ W + 2.4, - 7.5, 0.1 ] ];
					for ( const [ d, h, t ] of prof ) {

						const dd = side * d;
						rw.push( b.vertex( cx + lx * dd, y0 + h, cz + lz * dd, U( 'wall', t ), v ) );

					}

				}

				rowsW[ side ].push( rw );

				// guardrail beam (front + back faces) on fill sides
				const rf = [], rb = [];
				const hs = [ 0.42, 0.5, 0.58, 0.66, 0.74, 0.82 ];
				const bulge = [ 0, 0.07, 0.0, 0.07, 0.0, 0.02 ];
				for ( let k = 0; k < hs.length; k ++ ) {

					const df = side * ( W - 0.12 - bulge[ k ] );
					const db = side * ( W - 0.09 - bulge[ k ] );
					rf.push( b.vertex( cx + lx * df, y0 + hs[ k ], cz + lz * df, U( 'rail', k / ( hs.length - 1 ) ), v ) );
					rb.push( b.vertex( cx + lx * db, y0 + hs[ k ], cz + lz * db, U( 'rail', k / ( hs.length - 1 ) ), v ) );

				}

				rowsRailF[ side ].push( rf );
				rowsRailB[ side ].push( rb );

			}

		}

		for ( let r = 0; r < rowsAsphalt.length - 1; r ++ ) {

			b.stripRows( rowsAsphalt[ r ], rowsAsphalt[ r + 1 ] );
			for ( const side of [ 1, - 1 ] ) {

				const flip = side < 0;
				b.stripRows( rowsG[ side ][ r ], rowsG[ side ][ r + 1 ], flip );
				b.stripRows( rowsS[ side ][ r ], rowsS[ side ][ r + 1 ], flip );
				b.stripRows( rowsW[ side ][ r ], rowsW[ side ][ r + 1 ], flip );
				if ( wallKinds[ side ][ r ] === 0 && wallKinds[ side ][ r + 1 ] === 0 ) {

					b.stripRows( rowsRailF[ side ][ r ], rowsRailF[ side ][ r + 1 ], flip );
					b.stripRows( rowsRailB[ side ][ r ], rowsRailB[ side ][ r + 1 ], ! flip );

				}

			}

		}

		// props along this chunk
		for ( let i = c0; i < c1; i ++ ) {

			for ( const side of [ 1, - 1 ] ) {

				const isOpen = ( side > 0 ? track.wallL : track.wallR )[ i ] > W + 0.5;
				const isWall = isOpen || ( side > 0 ? sides.wallL : sides.wallR )[ i ];
				if ( ! isWall && i % 2 === 0 ) {

					b.setColor( 0xb8bccb ).setGlow( 0 );
					b.addGeometry( postGeo, place( postGeo, i, side * ( W - 0.03 ), 0.45 ), { uv: [ U( 'rail', 0.5 ), 0.5 ] } );

				}

				if ( ! isWall && i % 10 === 0 ) {

					b.setColor( 0xff8a1e ).setGlow( 1.4 );
					b.addGeometry( reflGeo, place( reflGeo, i, side * ( W - 0.2 ), 0.62, side > 0 ? Math.PI / 2 : - Math.PI / 2 ), { uv: [ ACCENT_U, 0.5 ] } );
					b.setGlow( 0 );

				}

			}

			// chevron boards on the outside of hairpins
			const k = track.curv[ i ];
			const outside = k > 0 ? - 1 : 1;
			const outsideOpen = ( outside > 0 ? track.wallL : track.wallR )[ i ] > W + 0.5;
			if ( Math.abs( k ) > 1 / 26 && i % 6 === 0 && ! outsideOpen ) {

				const side = outside; // outside of the corner
				const rot = side > 0 ? Math.PI / 2 : - Math.PI / 2;
				b.setColor( 0xffd21f ).setGlow( 0.35 );
				b.addGeometry( chevGeo, place( chevGeo, i, side * ( W + 0.35 ), 1.25, rot ), { uv: [ ACCENT_U, 0.5 ] } );
				b.setColor( 0x16121c ).setGlow( 0 );
				// arrow points toward the turn direction
				const dir = k > 0 ? 1 : - 1;
				for ( const off of [ - 0.3, 0.1 ] ) {

					const m = place( chevMarkGeo, i, side * ( W + 0.31 ), 1.25, rot );
					const local = new THREE.Matrix4().makeTranslation( off * dir, 0, 0 ).multiply( new THREE.Matrix4().makeRotationZ( 0.5 * dir ) );
					const m2 = m.clone().multiply( local );
					b.addGeometry( chevMarkGeo, m2, { uv: [ ACCENT_U, 0.5 ] } );
					const local2 = new THREE.Matrix4().makeTranslation( off * dir, - 0.0, 0 ).multiply( new THREE.Matrix4().makeRotationZ( - 0.5 * dir ) );
					b.addGeometry( chevMarkGeo, m.clone().multiply( local2 ), { uv: [ ACCENT_U, 0.5 ] } );

				}

			}

			// street lamps: dense in hairpins, sparse elsewhere
			const hair = Math.abs( k ) > 1 / 40;
			if ( ( ( hair && i % 22 === 0 ) || ( ! hair && i % 90 === 45 ) ) && ! outsideOpen ) {

				const side = k > 0 ? - 1 : 1;
				const lat = side * ( W + 0.7 );
				b.setColor( 0x8d8fa0 ).setGlow( 0 );
				b.addGeometry( poleGeo, place( poleGeo, i, lat, 3.1 ), { uv: [ U( 'rail', 0.4 ), 0.5 ] } );
				const armLat = side * ( W - 0.4 );
				b.addGeometry( armGeo, place( armGeo, i, armLat, 6.1, Math.PI / 2 ), { uv: [ U( 'rail', 0.4 ), 0.5 ] } );
				b.setColor( 0xffb35a ).setGlow( 2.4 );
				const headLat = side * ( W - 1.4 );
				b.addGeometry( headGeo, place( headGeo, i, headLat, 5.95, 0 ), { uv: [ ACCENT_U, 0.5 ] } );
				b.setGlow( 0 );
				const hx = track.px[ i ] + track.lx[ i ] * headLat, hz = track.pz[ i ] + track.lz[ i ] * headLat;
				lamps.push( { x: hx, y: track.py[ i ] + 5.9, z: hz, roadY: track.py[ i ], fx: track.fx[ i ], fz: track.fz[ i ], s: i * track.spacing } );

			}

		}

		// utility poles with sagging power lines (the classic touge silhouette)
		for ( let i = c0; i < c1; i ++ ) {

			const tips = poleTips( i );
			if ( ! tips ) continue;
			const side = poleSide( i );
			const lat = side * ( W + 1.3 );
			b.setColor( 0x4f4a55 ).setGlow( 0 );
			b.addGeometry( uPoleGeo, place( uPoleGeo, i, lat, 2.0 ), { uv: [ U( 'rail', 0.3 ), 0.5 ] } );
			b.setColor( 0x3a3640 );
			const cm = place( crossGeo, i, lat, 0 );
			cm.elements[ 13 ] = track.py[ i ] + 7.6; // absolute height, like the wire tips
			b.addGeometry( crossGeo, cm, { uv: [ U( 'rail', 0.3 ), 0.5 ] } );
			b.setColor( 0xd8d6e0 );
			for ( const t of tips ) {

				tmpM.makeTranslation( t.x, t.y + 0.08, t.z );
				b.addGeometry( insGeo, tmpM, { uv: [ ACCENT_U, 0.5 ] } );

			}

			if ( ( i / POLE_EVERY | 0 ) % 3 === 0 ) {

				b.setColor( 0x6a6672 );
				const m = place( canGeo, i, lat - side * 0.38, 0 );
				m.elements[ 13 ] = track.py[ i ] + 6.4;
				b.addGeometry( canGeo, m, { uv: [ U( 'rail', 0.3 ), 0.5 ] } );

			}

			// wires to the next pole (if there is one), sagging ~0.5 m
			let j = i + POLE_EVERY;
			const next = poleTips( j );
			if ( ! next ) continue;
			b.setColor( 0x17151c );
			for ( let w = 0; w < 3; w ++ ) {

				const A = tips[ w ], B = next[ w ];
				const SEG = 6;
				for ( let k = 0; k < SEG; k ++ ) {

					const t0 = k / SEG, t1 = ( k + 1 ) / SEG;
					_wa.lerpVectors( A, B, t0 ); _wa.y -= Math.sin( t0 * Math.PI ) * 0.55;
					_wb.lerpVectors( A, B, t1 ); _wb.y -= Math.sin( t1 * Math.PI ) * 0.55;
					const len = _wa.distanceTo( _wb );
					_wq.setFromUnitVectors( _wz, _wb.clone().sub( _wa ).normalize() );
					tmpM.compose( _wa.clone().add( _wb ).multiplyScalar( 0.5 ), _wq, tmpS.set( 1, 1, len ) );
					b.addGeometry( wireGeo, tmpM, { uv: [ U( 'rail', 0.3 ), 0.5 ] } );

				}

			}

			tmpS.set( 1, 1, 1 );

		}

		// red / white water-filled barricades on the outside of tight corners
		for ( let i = c0; i < c1; i ++ ) {

			const k = track.curv[ i ];
			if ( Math.abs( k ) < 1 / 26 || i % 9 !== 4 ) continue;
			const side = k > 0 ? - 1 : 1;
			if ( ( side > 0 ? track.wallL : track.wallR )[ i ] > W + 0.5 ) continue;
			const m = place( barrierGeo, i, side * ( W - 0.55 ), 0.41 );
			b.setColor( 0xf2eff5 ).setGlow( 0.12 );
			b.addGeometry( barrierGeo, m, { uv: [ ACCENT_U, 0.5 ] } );
			b.setColor( 0xe0262e ).setGlow( 0.2 );
			for ( const o of [ - 0.36, 0.08 ] ) b.addGeometry( stripeGeo, m.clone().multiply( new THREE.Matrix4().makeTranslation( o, 0, 0 ).multiply( new THREE.Matrix4().makeRotationZ( 0.5 ) ) ), { uv: [ ACCENT_U, 0.5 ] } );
			b.setGlow( 0 );

		}

		// start & finish lines painted across the asphalt (chequered)
		for ( const [ s, label ] of [ [ track.startS, 'start' ], [ track.finishS, 'finish' ] ] ) {

			const i = Math.round( s / track.spacing );
			if ( i < c0 || i >= c1 ) continue;
			const cols = 10;
			for ( let r = 0; r < 2; r ++ ) for ( let q = 0; q < cols; q ++ ) {

				if ( ( q + r ) % 2 ) continue;
				const lat = - hw + ( q + 0.5 ) * ( 2 * hw / cols );
				const m = place( lineGeo, i, lat, 0.012, 0, new THREE.Vector3( 2 * hw / cols, 1, 0.8 ) );
				m.multiply( new THREE.Matrix4().makeTranslation( 0, 0, ( r - 0.5 ) * 1 ) );
				b.setColor( label === 'start' ? 0xf4f2ff : 0xf4f2ff ).setGlow( 0.05 );
				b.addGeometry( lineGeo, m, { uv: [ ACCENT_U, 0.5 ] } );

			}

		}

		const geo = b.build();
		const mesh = new THREE.Mesh( geo, material );
		mesh.name = `road_${c0}`;
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		group.add( mesh );

	}

	return { group, lamps };

}

// Light pools under street lamps: one instanced draw call for the whole pass.
export function buildLampPools( lamps, texture ) {

	const geo = new THREE.PlaneGeometry( 1, 1 );
	geo.rotateX( - Math.PI / 2 );
	const mat = new THREE.MeshBasicNodeMaterial( {
		map: texture, color: 0xffa860, transparent: true, depthWrite: false,
		blending: THREE.AdditiveBlending, opacity: 0.55
	} );
	mat.fog = true;
	const mesh = new THREE.InstancedMesh( geo, mat, Math.max( 1, lamps.length ) );
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3( 12, 1, 12 );
	lamps.forEach( ( l, i ) => {

		p.set( l.x, l.roadY + 0.06, l.z );
		q.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.atan2( l.fx, l.fz ) );
		m.compose( p, q, s );
		mesh.setMatrixAt( i, m );

	} );
	mesh.count = lamps.length;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere?.();
	mesh.frustumCulled = false;
	mesh.renderOrder = 2;
	mesh.name = 'lampPools';
	return mesh;

}
