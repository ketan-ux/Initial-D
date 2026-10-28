import * as THREE from 'three/webgpu';
import {
	attribute, uniform, vec3, vec4, float, step, mix, normalView, positionViewDirection, smoothstep,
	vertexColor, materialColor
} from 'three/tsl';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { toonMaterial, outlineMaterial, uRimColor, LAYER_OUTLINE, syncToonTwin } from '../render/toon.js';
import { paintLivery, SIDE_Y0, SIDE_Y1, TOP_V0, TOP_V1, PLATE_UV, SWATCH } from './liveries.js';
import { createBlobShadow } from '../render/textures.js';
import { clamp, lerp } from '../core/math.js';

// Procedural, cel-shaded JDM car built from loft keyframes in carSpecs.js.
// Local frame: +z forward, +x left, +y up; origin on the ground at mid-wheelbase.

let blobTex = null;

function interpKeys( keys, f ) {

	if ( f <= keys[ 0 ][ 0 ] ) return keys[ 0 ].slice( 1 );
	for ( let i = 0; i < keys.length - 1; i ++ ) {

		const a = keys[ i ], b = keys[ i + 1 ];
		if ( f <= b[ 0 ] ) {

			let t = ( f - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			t = t * t * ( 3 - 2 * t ) * 0.6 + t * 0.4; // ease between keys for softer curvature
			return a.slice( 1 ).map( ( v, k ) => lerp( v, b[ k + 1 ], t ) );

		}

	}

	return keys[ keys.length - 1 ].slice( 1 );

}

const inRange = ( f, r ) => r && f >= r[ 0 ] && f <= r[ 1 ];

export class CarModel {

	constructor( spec, liveryIndex = 0, quality ) {

		this.spec = spec;
		this.quality = quality;
		this.root = new THREE.Group();
		this.root.name = `car_${spec.id}`;
		this.chassis = new THREE.Group();
		this.root.add( this.chassis );
		this.midF = spec.frontAxleF + spec.wheelbase / 2;
		this.uniforms = {
			tail: uniform( 0.9 ), brake: uniform( 0 ), reverse: uniform( 0 ), marker: uniform( 1.0 ),
			head: uniform( 0 ), discHeat: uniform( 0 ), wear: uniform( 0 )
		};
		this.popupAngle = 0; // 0 closed .. 1 open
		this.popupTarget = 0;
		this.steer = 0;
		this.wheelSpin = 0;
		this._build( liveryIndex );

	}

	zOf( f ) {

		return this.midF - f;

	}

	setLivery( index ) {

		const old = this.livery;
		this.livery = paintLivery( this.spec, index );
		this.bodyMaterial.map = this.livery;
		this.bodyMaterial.needsUpdate = true;
		syncToonTwin( this.bodyMaterial ); // VR lite twin, if any
		old?.dispose();

	}

	_build( liveryIndex ) {

		const spec = this.spec;
		const L = spec.length;
		this.livery = paintLivery( spec, liveryIndex );
		this.bodyMaterial = toonMaterial( { map: this.livery, rim: 0.55 } );
		this.glassMaterial = makeGlassMaterial();
		this.lightMaterial = makeLightMaterial( this.uniforms );

		const bodyB = new GeoBuilder( { color: false } );
		const glassB = new GeoBuilder( { color: false } );
		const lightB = new GeoBuilder( { color: true, glow: true } ); // glow attr carries the light kind
		const hullB = new GeoBuilder( { color: false } );

		// ---- sample loft sections ---------------------------------------
		const axles = [ spec.frontAxleF, spec.frontAxleF + spec.wheelbase ];
		const rA = spec.wheelRadius * 1.13;
		const fs = [];
		const N = 46;
		for ( let i = 0; i <= N; i ++ ) fs.push( ( i / N ) * L );
		// extra sections around the arches for round wheel openings
		for ( const fa of axles ) for ( let k = - 4; k <= 4; k ++ ) fs.push( fa + ( k / 4 ) * rA * 1.02 );
		fs.sort( ( a, b ) => a - b );
		const uniq = fs.filter( ( v, i ) => i === 0 || v - fs[ i - 1 ] > 0.012 );

		const sections = uniq.map( ( f ) => {

			let [ w0, w1, w2, yb, ybelt, yEdge, yCenter ] = interpKeys( spec.loft, f );
			for ( const fa of axles ) {

				const dz = f - fa;
				if ( Math.abs( dz ) < rA ) {

					const arch = spec.wheelRadius + Math.sqrt( rA * rA - dz * dz ) * 0.98;
					yb = Math.max( yb, arch );

				}

			}

			const y3 = Math.max( ybelt - 0.2, yb + 0.1 );
			const crown = yCenter >= yEdge ? 0.02 : 0;
			const z = this.zOf( f );
			const lower = [
				[ w1 * 0.985, ybelt ], [ w1, y3 ], [ w0, Math.min( yb + 0.07, y3 - 0.02 ) ], [ w0 * 0.9, yb ], [ 0, yb + 0.02 ]
			];
			const upper = [
				[ w1 * 0.985, ybelt ], [ w2, yEdge ], [ w2 * 0.52, lerp( yEdge, yCenter, 0.8 ) + crown ], [ 0, yCenter + crown * 0.5 ]
			];
			return { f, z, lower, upper, w1, ybelt, yEdge, yCenter, w2 };

		} );
		this.sections = sections;

		const sideUV = ( x, y, f ) => {

			const vLocal = clamp( ( y - SIDE_Y0 ) / ( SIDE_Y1 - SIDE_Y0 ), 0, 1 );
			return x >= 0 ? [ f / L, 0.75 + vLocal * 0.25 ] : [ 1 - f / L, 0.5 + vLocal * 0.25 ];

		};

		const topUV = ( x, f ) => [ f / L, TOP_V0 + clamp( ( x + 1 ) / 2, 0, 1 ) * ( TOP_V1 - TOP_V0 ) ];

		// ---- lower body (shared vertices, smooth) ------------------------
		const lowerRows = [];
		for ( const s of sections ) {

			const ring = [];
			const pts = [ ...s.lower, ...s.lower.slice( 0, - 1 ).reverse().map( ( [ x, y ] ) => [ - x, y ] ) ];
			for ( const [ x, y ] of pts ) {

				const [ u, v ] = sideUV( x === 0 ? 1 : x, y, s.f );
				ring.push( bodyB.vertex( x, y, s.z, u, v ) );

			}

			lowerRows.push( ring );

		}

		for ( let k = 0; k < lowerRows.length - 1; k ++ ) bodyB.stripRows( lowerRows[ k ], lowerRows[ k + 1 ], true );

		// ---- upper body / glass (per-quad split, normals from a smooth temp mesh)
		const upperPts = sections.map( ( s ) => [ ...s.upper, ...s.upper.slice( 0, - 1 ).reverse().map( ( [ x, y ] ) => [ - x, y ] ) ] );
		const M = upperPts[ 0 ].length;
		const tmp = new GeoBuilder( { color: false } );
		const tmpRows = upperPts.map( ( pts, k ) => pts.map( ( [ x, y ] ) => tmp.vertex( x, y, sections[ k ].z ) ) );
		for ( let k = 0; k < tmpRows.length - 1; k ++ ) tmp.stripRows( tmpRows[ k ], tmpRows[ k + 1 ] );
		const tmpGeo = tmp.build();
		const nrm = tmpGeo.attributes.normal;
		const g = spec.glass;
		const pillar = ( f ) => g.pillars.some( ( r ) => inRange( f, r ) );
		for ( let k = 0; k < sections.length - 1; k ++ ) {

			const fc = ( sections[ k ].f + sections[ k + 1 ].f ) / 2;
			for ( let j = 0; j < M - 1; j ++ ) {

				const sideSeg = j === 0 || j === M - 2;
				let isGlass = false;
				if ( sideSeg ) isGlass = inRange( fc, g.side ) && ! pillar( fc );
				else isGlass = inRange( fc, g.windshield ) || inRange( fc, g.rear );
				// keep a body-coloured frame around the windshield / rear glass
				if ( ! sideSeg && isGlass && ( j === 1 || j === M - 3 ) && ( inRange( fc, [ g.windshield[ 0 ], g.windshield[ 0 ] + 0.05 ] ) ) ) isGlass = false;
				const B = isGlass ? glassB : bodyB;
				const quad = [ [ k, j ], [ k + 1, j ], [ k + 1, j + 1 ], [ k, j + 1 ] ];
				const ids = quad.map( ( [ kk, jj ] ) => {

					const [ x, y ] = upperPts[ kk ][ jj ];
					const vi = tmpRows[ kk ][ jj ];
					const [ u, v ] = topUV( x, sections[ kk ].f );
					return B.vertexN( x, y, sections[ kk ].z, u, v, nrm.getX( vi ), nrm.getY( vi ), nrm.getZ( vi ) );

				} );
				B.quad( ids[ 0 ], ids[ 1 ], ids[ 2 ], ids[ 3 ] );

			}

		}

		// ---- end caps -----------------------------------------------------
		for ( const [ idx, dir ] of [ [ 0, 1 ], [ sections.length - 1, - 1 ] ] ) {

			const s = sections[ idx ];
			const ring = [];
			const lowerFull = [ ...s.lower, ...s.lower.slice( 0, - 1 ).reverse().map( ( [ x, y ] ) => [ - x, y ] ) ]; // left belt -> bottom -> right belt
			const upperRev = [ ...s.upper.slice( 1 ), ...s.upper.slice( 1, - 1 ).reverse().map( ( [ x, y ] ) => [ - x, y ] ) ].reverse(); // right edge -> top -> left edge
			for ( const p of [ ...lowerFull, ...upperRev ] ) ring.push( p );
			let cx = 0, cy = 0;
			for ( const [ x, y ] of ring ) {

				cx += x; cy += y;

			}

			cx /= ring.length; cy /= ring.length;
			const [ cu, cv ] = [ SWATCH.grey[ 0 ], SWATCH.grey[ 1 ] ];
			const centre = bodyB.vertexN( cx, cy, s.z, cu, cv, 0, 0, dir );
			const ids = ring.map( ( [ x, y ] ) => {

				const [ u, v ] = topUV( x, s.f );
				return bodyB.vertexN( x, y, s.z, u, v, 0, 0, dir );

			} );
			for ( let i = 0; i < ids.length; i ++ ) {

				const a = ids[ i ], b2 = ids[ ( i + 1 ) % ids.length ];
				// winding chosen so the cap faces outward (dir)
				if ( dir > 0 ) bodyB.tri( centre, b2, a );
				else bodyB.tri( centre, a, b2 );

			}

		}

		// ---- outline hull (single smooth ring) ----------------------------
		const hullRings = sections.map( ( s ) => {

			// bottom centre -> left side up -> roof centre, then mirrored down the right
			const half = [ ...s.lower.slice().reverse(), ...s.upper.slice( 1 ) ];
			return [ ...half, ...half.slice( 1, - 1 ).reverse().map( ( [ x, y ] ) => [ - x, y ] ) ];

		} );
		const hullRows = hullRings.map( ( ring, k ) => ring.map( ( [ x, y ] ) => hullB.vertex( x, y, sections[ k ].z ) ) );
		for ( let k = 0; k < hullRows.length - 1; k ++ ) {

			// close the ring (last -> first) too
			hullB.stripRows( [ ...hullRows[ k ], hullRows[ k ][ 0 ] ], [ ...hullRows[ k + 1 ], hullRows[ k + 1 ][ 0 ] ] );

		}

		for ( const [ k, dir ] of [ [ 0, 1 ], [ hullRows.length - 1, - 1 ] ] ) {

			const ring = hullRings[ k ];
			let cy = 0;
			for ( const p of ring ) cy += p[ 1 ];
			const c = hullB.vertex( 0, cy / ring.length, sections[ k ].z + dir * 0.01 );
			const ids = hullRows[ k ];
			for ( let i = 0; i < ids.length; i ++ ) {

				const a = ids[ i ], b2 = ids[ ( i + 1 ) % ids.length ];
				if ( dir > 0 ) hullB.tri( c, a, b2 );
				else hullB.tri( c, b2, a );

			}

		}

		// ---- details: bumpers, mirrors, spoiler, plates, exhaust, lights -----
		this._details( bodyB, lightB, sections );

		const bodyGeo = bodyB.build();
		const body = new THREE.Mesh( bodyGeo, this.bodyMaterial );
		body.name = 'body';
		body.castShadow = true;
		this.body = body;
		const glass = new THREE.Mesh( glassB.build(), this.glassMaterial );
		glass.name = 'glass';
		this.glass = glass;
		const lights = new THREE.Mesh( lightB.build(), this.lightMaterial );
		lights.name = 'lights';
		this.lights = lights;
		this.chassis.add( body, glass, lights );
		this.doorMirrors = new THREE.Mesh( this._mirrorGeo, this.bodyMaterial );
		this.doorMirrors.name = 'doorMirrors';
		this.chassis.add( this.doorMirrors );

		if ( this.quality.outlines ) {

			const hullGeo = hullB.build();
			// ensure outward normals for the inverted hull
			const outline = new THREE.Mesh( hullGeo, outlineMaterial( 0.022 ) );
			outline.name = 'outline';
			outline.layers.set( LAYER_OUTLINE );
			this.outline = outline;
			this.chassis.add( outline );

		}

		this._buildPopups();
		this._buildWheels();
		this._buildShadow();

	}

	_details( bodyB, lightB, sections ) {

		const spec = this.spec;
		const L = spec.length;
		const sw = ( name ) => ( { uv: SWATCH[ name ] } );
		const box = ( w, h, d ) => new THREE.BoxGeometry( w, h, d );
		const m = ( x, y, z, rx = 0, ry = 0, rz = 0 ) => new THREE.Matrix4().compose(
			new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz ) ), new THREE.Vector3( 1, 1, 1 ) );
		const secAt = ( f ) => {

			let best = sections[ 0 ];
			for ( const s of sections ) if ( Math.abs( s.f - f ) < Math.abs( best.f - f ) ) best = s;
			return best;

		};

		const front = secAt( 0.02 ), rear = secAt( L - 0.02 );
		const zF = this.zOf( 0 ), zR = this.zOf( L );
		// bumpers (black lower lip + grille slot)
		bodyB.addGeometry( box( front.w1 * 2 * 0.92, 0.12, 0.12 ), m( 0, 0.3, zF - 0.02 ), sw( 'black' ) );
		bodyB.addGeometry( box( front.w1 * 1.1, 0.07, 0.03 ), m( 0, 0.43, zF + 0.01 ), sw( 'grille' ) );
		bodyB.addGeometry( box( rear.w1 * 2 * 0.95, 0.12, 0.12 ), m( 0, 0.36, zR + 0.03 ), sw( 'black' ) );
		// number plates (front + rear) sample the plate region of the livery
		const plate = new THREE.PlaneGeometry( 0.34, 0.17 );
		const plateUV = ( u, v ) => [ PLATE_UV.u0 + u * ( PLATE_UV.u1 - PLATE_UV.u0 ), PLATE_UV.v0 + v * ( PLATE_UV.v1 - PLATE_UV.v0 ) ];
		bodyB.addGeometry( plate, m( 0, 0.36, zF + 0.05 ), { uvRemap: plateUV } );
		bodyB.addGeometry( plate, m( 0, 0.52, zR - 0.025, 0, Math.PI, 0 ), { uvRemap: plateUV } );
		// side mirrors on the doors
		// door mirrors: their own small mesh so the cabin view can hide them
		// (the cockpit has its own working mirrors in the same spot)
		const fm = spec.glass.side[ 0 ] + 0.12;
		const sm = secAt( fm );
		const mirB = new GeoBuilder( { color: false } );
		for ( const s of [ 1, - 1 ] ) {

			mirB.addGeometry( box( 0.16, 0.1, 0.16 ), m( s * ( sm.w1 + 0.06 ), sm.ybelt + 0.1, this.zOf( fm ) ), sw( 'black' ) );

		}

		this._mirrorGeo = mirB.build();

		// spoiler
		if ( spec.spoiler === 'trunk' ) {

			// notchback: ducktail lip on the trunk lid edge
			const sp = secAt( L - 0.1 );
			bodyB.addGeometry( box( 1.3, 0.04, 0.16 ), m( 0, sp.yCenter + 0.025, this.zOf( L - 0.12 ), 0.2 ), sw( 'black' ) );

		} else if ( spec.spoiler === 'wing' ) {

			const sp = secAt( L - 0.25 );
			for ( const s of [ 1, - 1 ] ) bodyB.addGeometry( box( 0.05, 0.16, 0.1 ), m( s * 0.55, sp.yCenter + 0.08, this.zOf( L - 0.22 ) ), sw( 'black' ) );
			bodyB.addGeometry( box( 1.5, 0.035, 0.3 ), m( 0, sp.yCenter + 0.17, this.zOf( L - 0.24 ), - 0.08 ), { uvRemap: ( u, v ) => [ 0.92 + u * 0.06, TOP_V0 + 0.2 + v * 0.05 ] } );

		} else {

			const sp = secAt( spec.glass.rear[ 0 ] );
			bodyB.addGeometry( box( 1.12, 0.03, 0.14 ), m( 0, sp.yCenter + 0.03, this.zOf( spec.glass.rear[ 0 ] - 0.05 ), 0.15 ), sw( 'black' ) );

		}

		// exhaust tip
		bodyB.addGeometry( new THREE.CylinderGeometry( 0.045, 0.045, 0.16, 8 ).rotateX( Math.PI / 2 ), m( - 0.45, 0.26, zR - 0.03 ), sw( 'chrome' ) );

		// ---- lights (glow attribute = kind: 0 marker, 1 tail, 2 brake, 3 reverse) ----
		const lamp = ( geo, mat, hex, kind ) => {

			lightB.setColor( hex ).setGlow( kind );
			lightB.addGeometry( geo, mat );

		};

		const tailY = spec.tail.y;
		if ( spec.tail.style === 'bar' ) {

			for ( const s of [ 1, - 1 ] ) {

				lamp( box( 0.5, spec.tail.h, 0.03 ), m( s * 0.46, tailY, zR - 0.005 ), 0xff2a3a, 1 );
				lamp( box( 0.16, spec.tail.h * 0.9, 0.032 ), m( s * 0.15, tailY, zR - 0.006 ), 0xffffff, 3 );
				lamp( box( 0.3, spec.tail.h * 0.6, 0.034 ), m( s * 0.52, tailY, zR - 0.007 ), 0xff3b2a, 2 );

			}

		} else {

			for ( const s of [ 1, - 1 ] ) for ( let k = 0; k < 3; k ++ ) {

				const disc = new THREE.CylinderGeometry( 0.075, 0.075, 0.03, 14 ).rotateX( Math.PI / 2 );
				lamp( disc, m( s * ( 0.28 + k * 0.17 ), tailY, zR - 0.01 ), k === 0 ? 0xffffff : 0xff2a3a, k === 0 ? 3 : ( k === 2 ? 2 : 1 ) );

			}

		}

		// front turn signals / markers (amber)
		for ( const s of [ 1, - 1 ] ) lamp( box( 0.2, 0.06, 0.03 ), m( s * ( front.w1 * 0.7 ), 0.4, zF + 0.01 ), 0xffa020, 0 );
		// high-mount brake light
		lamp( box( 0.3, 0.03, 0.02 ), m( 0, secAt( spec.glass.rear[ 1 ] ).yCenter + 0.02, this.zOf( spec.glass.rear[ 1 ] ) ), 0xff2a3a, 2 );

	}

	// Fixed projector headlamps (S13): slim lenses in the nose fascia either
	// side of a narrow grille. Same glow kind as the pop-up lenses.
	_buildFixedLamps() {

		const spec = this.spec, hl = spec.headlamps;
		const [ , w1, , , ybelt, yEdge ] = interpKeys( spec.loft, 0.03 );
		const zF = this.zOf( 0.035 );
		const y = ( ybelt + yEdge ) / 2 - 0.01;
		const b = new GeoBuilder( { color: true, glow: true } );
		for ( const s of [ 1, - 1 ] ) {

			const x = s * Math.min( hl.x, w1 - hl.w / 2 - 0.02 );
			b.setColor( 0x15141a ).setGlow( 0 );
			b.addGeometry( new THREE.BoxGeometry( hl.w + 0.03, hl.h + 0.03, 0.05 ), new THREE.Matrix4().makeTranslation( x, y, zF - 0.01 ) );
			b.setColor( 0xfff4d6 ).setGlow( 4 );
			b.addGeometry( new THREE.BoxGeometry( hl.w * 0.55, hl.h, 0.05 ), new THREE.Matrix4().makeTranslation( x + s * hl.w * 0.18, y, zF + 0.005 ) );
			b.addGeometry( new THREE.BoxGeometry( hl.w * 0.3, hl.h * 0.8, 0.05 ), new THREE.Matrix4().makeTranslation( x - s * hl.w * 0.28, y, zF + 0.004 ) );

		}

		this.chassis.add( new THREE.Mesh( b.build(), this.lightMaterial ) );
		this.popups = new THREE.Group(); // keeps update() uniform for both lamp types
		this.chassis.add( this.popups );
		this.popupClosed = 0;
		this.headAnchors = [ 1, - 1 ].map( ( s ) => {

			const o = new THREE.Object3D();
			o.position.set( s * hl.x, y, zF + 0.04 );
			this.chassis.add( o );
			return o;

		} );

	}

	_buildPopups() {

		if ( ! this.spec.popup ) return this._buildFixedLamps();
		const spec = this.spec, pu = spec.popup;
		const sec = this.sections.reduce( ( a, s ) => ( Math.abs( s.f - pu.f - pu.d ) < Math.abs( a.f - pu.f - pu.d ) ? s : a ), this.sections[ 0 ] );
		// hood surface height at the pod's lateral position, front and rear edge
		const hoodY = ( f ) => {

			const [ , , w2, , , yEdge, yCenter ] = interpKeys( spec.loft, f );
			const t = clamp( pu.x / Math.max( w2, 0.01 ), 0, 1 );
			return lerp( yCenter, yEdge, t * t );

		};

		void sec;
		const hingeY = hoodY( pu.f + pu.d ) + 0.004;
		const hingeZ = this.zOf( pu.f + pu.d );
		this.popupClosed = Math.atan2( hoodY( pu.f ) - hoodY( pu.f + pu.d ), pu.d ); // follow hood slope
		this.popups = new THREE.Group();
		this.popups.position.set( 0, hingeY, hingeZ );
		this.chassis.add( this.popups );
		const lidB = new GeoBuilder( { color: false } );
		const lensB = new GeoBuilder( { color: true, glow: true } );
		const h = 0.1;
		for ( const s of [ 1, - 1 ] ) {

			const x = s * pu.x;
			// housing (box hinged at its rear-top edge, local +z forward)
			const housing = new THREE.BoxGeometry( pu.w, h, pu.d );
			const mm = new THREE.Matrix4().makeTranslation( x, - h / 2, pu.d / 2 );
			// top face samples the livery top band at the hood position; sides use black
			lidB.addGeometry( housing, mm, {
				uvRemap: ( u, v ) => [ ( pu.f + ( 1 - v ) * pu.d ) / spec.length, TOP_V0 + ( ( x + 1 ) / 2 ) * ( TOP_V1 - TOP_V0 ) ]
			} );
			// lens on the underside: faces forward once the pod stands up
			// dark bezel with an inset, rounded lens so an open pod reads as a lamp
			const bezel = new THREE.PlaneGeometry( pu.w * 0.94, pu.d * 0.9 ).rotateX( Math.PI / 2 );
			lensB.setColor( 0x0d0c10 ).setGlow( 0 );
			lensB.addGeometry( bezel, new THREE.Matrix4().makeTranslation( x, - h - 0.002, pu.d / 2 ) );
			const lens = new THREE.CircleGeometry( 0.5, 20 ).scale( pu.w * 0.72, pu.d * 0.62, 1 ).rotateX( Math.PI / 2 );
			lensB.setColor( 0xffeccc ).setGlow( 4 );
			lensB.addGeometry( lens, new THREE.Matrix4().makeTranslation( x, - h - 0.004, pu.d / 2 ) );
			lensB.setColor( 0x0d0c10 ).setGlow( 0 );

		}

		const lid = new THREE.Mesh( lidB.build(), this.bodyMaterial );
		const lens = new THREE.Mesh( lensB.build(), this.lightMaterial );
		this.popups.add( lid, lens );
		// headlight anchors for spotlights (in pod space)
		this.headAnchors = [ 1, - 1 ].map( ( s ) => {

			const o = new THREE.Object3D();
			o.position.set( s * pu.x, - h, pu.d * 0.5 );
			this.popups.add( o );
			return o;

		} );

	}

	_buildWheels() {

		const spec = this.spec;
		const r = spec.wheelRadius, w = spec.tireWidth;
		const b = new GeoBuilder( { color: true, glow: true } );
		// tyre: lathe profile for a rounded sidewall
		const prof = [];
		for ( let i = 0; i <= 8; i ++ ) {

			const a = - Math.PI / 2 + ( i / 8 ) * Math.PI;
			prof.push( new THREE.Vector2( r - 0.045 + Math.cos( a ) * 0.045, Math.sin( a ) * w * 0.5 ) );

		}

		const tyre = new THREE.LatheGeometry( [ new THREE.Vector2( r * 0.66, - w * 0.5 ), ...prof, new THREE.Vector2( r * 0.66, w * 0.5 ) ], 20 );
		tyre.rotateZ( Math.PI / 2 );
		b.setColor( 0x1c1a21 ).setGlow( - 1 ); // glow -1 marks tyre rubber (wear tint)
		b.addGeometry( tyre, null );
		// brake disc (glows when hot)
		const disc = new THREE.CylinderGeometry( r * 0.62, r * 0.62, 0.025, 18 ).rotateZ( Math.PI / 2 );
		b.setColor( 0x4d4a55 ).setGlow( 1 ); // steel; glows orange when hot
		b.addGeometry( disc, new THREE.Matrix4().makeTranslation( - w * 0.18, 0, 0 ) );
		b.setGlow( 0 );
		// rim face + spokes
		b.setColor( spec.rimColor );
		const face = new THREE.CylinderGeometry( r * 0.66, r * 0.66, 0.03, 20, 1, true ).rotateZ( Math.PI / 2 );
		b.addGeometry( face, new THREE.Matrix4().makeTranslation( w * 0.42, 0, 0 ) );
		const hub = new THREE.CylinderGeometry( r * 0.16, r * 0.18, 0.06, 10 ).rotateZ( Math.PI / 2 );
		b.addGeometry( hub, new THREE.Matrix4().makeTranslation( w * 0.42, 0, 0 ) );
		const spokes = { spoke5: 5, spoke6: 6 }[ spec.rimStyle ] ?? 8;
		for ( let i = 0; i < spokes; i ++ ) {

			const a = ( i / spokes ) * Math.PI * 2;
			const sp = new THREE.BoxGeometry( 0.03, r * 0.5, spokes <= 6 ? 0.07 : 0.035 );
			const mm = new THREE.Matrix4().makeRotationX( a ).premultiply( new THREE.Matrix4().makeTranslation( w * 0.44, 0, 0 ) )
				.multiply( new THREE.Matrix4().makeTranslation( 0, r * 0.38, 0 ) );
			b.addGeometry( sp, mm );

		}

		const ring = new THREE.TorusGeometry( r * 0.64, 0.018, 4, 20 ).rotateY( Math.PI / 2 );
		b.addGeometry( ring, new THREE.Matrix4().makeTranslation( w * 0.45, 0, 0 ) );
		const geo = b.build();

		const mat = toonMaterial( { vertexColors: true, rim: 0.25 } );
		// brake-disc heat glow + tyre wear tint (garage inspection)
		const glow = attribute( 'glow', 'float' );
		const heat = this.uniforms.discHeat;
		const isTyre = float( 1 ).sub( step( - 0.5, glow ) );
		const extra = vec3( 1.0, 0.35, 0.05 ).mul( glow.max( 0 ) ).mul( heat ).mul( 2.2 )
			.add( vec3( 0.32, 0.28, 0.36 ).mul( isTyre ).mul( this.uniforms.wear ) ); // worn rubber goes shiny grey
		mat.emissiveNode = mat.emissiveNode ? mat.emissiveNode.add( extra ) : extra;
		mat.userData.keepLit = true; // custom nodes; small on screen, so VR keeps it as is
		this.wheelMaterial = mat;
		const inst = new THREE.InstancedMesh( geo, mat, 4 );
		inst.name = 'wheels';
		inst.frustumCulled = false;
		inst.castShadow = true;
		this.wheels = inst;
		this.root.add( inst );
		const fz = this.zOf( spec.frontAxleF ), rz = this.zOf( spec.frontAxleF + spec.wheelbase );
		const tx = spec.track / 2;
		this.wheelPos = [
			new THREE.Vector3( tx, r, fz ), new THREE.Vector3( - tx, r, fz ),
			new THREE.Vector3( tx, r, rz ), new THREE.Vector3( - tx, r, rz )
		];
		this.wheelDrop = [ 0, 0, 0, 0 ];
		this._wq = new THREE.Quaternion();
		this._wm = new THREE.Matrix4();
		this._ws = new THREE.Vector3( 1, 1, 1 );
		this._we = new THREE.Euler( 0, 0, 0, 'YXZ' );
		this.updateWheels( 0 );

	}

	_buildShadow() {

		if ( this.quality.shadows !== 'blob' && this.quality.shadows !== 'headlight' ) return;
		blobTex = blobTex || createBlobShadow();
		const mat = new THREE.MeshBasicNodeMaterial( { map: blobTex, transparent: true, depthWrite: false } );
		mat.fog = true;
		const geo = new THREE.PlaneGeometry( this.spec.width * 1.35, this.spec.length * 1.2 );
		geo.rotateX( - Math.PI / 2 );
		const m = new THREE.Mesh( geo, mat );
		m.position.y = 0.03;
		m.renderOrder = 1;
		m.name = 'blob';
		this.root.add( m );
		this.blob = m;

	}

	// Wheel transforms: suspension drop per wheel, steering on the front axle, spin.
	updateWheels( dt ) {

		const inst = this.wheels;
		for ( let i = 0; i < 4; i ++ ) {

			const p = this.wheelPos[ i ];
			const steer = i < 2 ? this.steer : 0;
			const mirror = p.x < 0 ? Math.PI : 0; // rim face outward on the right side
			this._we.set( mirror ? - this.wheelSpin : this.wheelSpin, steer + mirror, 0, 'YXZ' );
			this._wq.setFromEuler( this._we );
			const pos = new THREE.Vector3( p.x, p.y - this.wheelDrop[ i ], p.z );
			this._wm.compose( pos, this._wq, this._ws );
			inst.setMatrixAt( i, this._wm );

		}

		inst.instanceMatrix.needsUpdate = true;

	}

	setHeadlights( on ) {

		this.popupTarget = on ? 1 : 0;

	}

	update( dt, state ) {

		// pop-up headlight animation: motor-like ease
		const speed = 2.2;
		if ( this.popupAngle !== this.popupTarget ) {

			const d = this.popupTarget - this.popupAngle;
			this.popupAngle += Math.sign( d ) * Math.min( Math.abs( d ), dt * speed );

		}

		const e = this.popupAngle * this.popupAngle * ( 3 - 2 * this.popupAngle );
		if ( this.spec.popup ) {

			this.popups.rotation.x = - this.popupClosed - e * 1.15;
			this.uniforms.head.value = e > 0.7 ? ( e - 0.7 ) / 0.3 * 1.0 : 0;

		} else this.uniforms.head.value = this.popupTarget; // fixed lamps switch instantly
		if ( state ) {

			this.steer = state.steerAngle ?? 0;
			this.wheelSpin = state.wheelSpin ?? 0;
			this.uniforms.brake.value = state.brake > 0.05 ? 1 : 0;
			this.uniforms.reverse.value = state.reversing ? 1 : 0;
			this.uniforms.discHeat.value = state.discHeat ?? 0;

		}

		this.updateWheels( dt );

	}

	// FPP: hide glass (and outline) so the player looks out through the cabin.
	setInterior( on ) {

		this.glass.visible = ! on;
		if ( this.outline ) this.outline.visible = ! on;
		// from the driver's seat the raised pods read as floating boxes over the
		// hood line; the headlight beams still come from the car's spotlights
		this.popups.visible = ! on;
		this.doorMirrors.visible = ! on;

	}

	dispose() {

		this.root.traverse( ( o ) => {

			if ( o.isMesh ) o.geometry.dispose();

		} );
		this.livery?.dispose();

	}

}

// Dark toon glass with a painted sky reflection band and a strong rim.
function makeGlassMaterial() {

	const mat = new THREE.MeshBasicNodeMaterial( { color: 0x1a1830 } );
	const ndv = normalView.dot( positionViewDirection ).saturate();
	const fres = float( 1 ).sub( ndv );
	const band = smoothstep( float( 0.35 ), float( 0.45 ), normalView.y ).mul( smoothstep( float( 0.75 ), float( 0.6 ), normalView.y ) );
	const sky = mix( vec3( 0.1, 0.09, 0.2 ), vec3( 0.55, 0.42, 0.78 ), fres.mul( 0.8 ) );
	mat.colorNode = sky.add( vec3( uRimColor ).mul( band ).mul( 0.35 ) ).add( vec3( 0.9, 0.85, 1.0 ).mul( smoothstep( float( 0.82 ), float( 0.9 ), fres ) ).mul( 0.4 ) );
	return mat;

}

// Emissive lamps. The per-vertex `glow` attribute stores the lamp kind and
// the per-car uniforms decide how bright each kind is right now.
function makeLightMaterial( u ) {

	const mat = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
	const k = attribute( 'glow', 'float' );
	const isMarker = float( 1 ).sub( step( 0.5, k ) );
	const isTail = step( 0.5, k ).sub( step( 1.5, k ) );
	const isBrake = step( 1.5, k ).sub( step( 2.5, k ) );
	const isRev = step( 2.5, k ).sub( step( 3.5, k ) );
	const isHead = step( 3.5, k );
	const intensity = isMarker.mul( u.marker ).mul( 0.9 )
		.add( isTail.mul( u.tail.add( u.brake.mul( 1.6 ) ) ) )
		.add( isBrake.mul( u.tail.mul( 0.35 ).add( u.brake.mul( 2.6 ) ) ) )
		.add( isRev.mul( u.reverse.mul( 1.8 ).add( 0.12 ) ) )
		.add( isHead.mul( u.head.mul( 2.6 ).add( 0.08 ) ) );
	// colorNode is multiplied by vertex colour afterwards; base 0.15 keeps lenses visible when off
	mat.colorNode = vec4( vec3( intensity.add( 0.15 ) ), 1 );
	mat.fog = false;
	void materialColor; void vertexColor;
	return mat;

}
