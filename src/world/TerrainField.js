import { fbm2, clamp, smoothstep, lerp } from '../core/math.js';

// Height field for the mountain, derived from the road so they always agree:
//  1. a smooth "natural" slope = Shepard interpolation of nearby road heights
//  2. relief noise that grows with distance from the road
//  3. cut/fill constraints from every nearby road sample, so the terrain
//     never pokes through the asphalt and switchbacks get proper embankments.

export class TerrainField {

	constructor( track ) {

		this.track = track;
		this.wall = track.wallOffset;
		// coarse road samples for the Shepard interpolation
		this.coarse = [];
		for ( let i = 0; i < track.count; i += 6 ) this.coarse.push( [ track.px[ i ], track.pz[ i ], track.py[ i ] ] );
		this.cutSlope = 1.5;
		this.fillSlope = 0.75;
		this.cache = new Map();

	}

	// Natural slope from road heights (inverse-distance weighting). Also
	// reports the approximate distance to the road for far-field shaping.
	natural( x, z ) {

		let ws = 0, hs = 0, dmin = Infinity;
		for ( let k = 0; k < this.coarse.length; k ++ ) {

			const c = this.coarse[ k ];
			const dx = c[ 0 ] - x, dz = c[ 1 ] - z;
			const r2 = dx * dx + dz * dz;
			if ( r2 < dmin ) dmin = r2;
			const d2 = r2 + 400;
			const w = 1 / ( d2 * d2 );
			ws += w; hs += w * c[ 2 ];

		}

		this._lastFar = Math.sqrt( dmin );
		return hs / ws;

	}

	// Returns { h, dRoad } — terrain height and distance to nearest road centre.
	sample( x, z ) {

		const t = this.track;
		let upper = Infinity, lower = - Infinity, dMin = Infinity, yNear = 0;
		t.forEachNear( x, z, 80, ( i ) => {

			if ( i & 1 ) return; // every other sample (4 m) is plenty
			const dx = t.px[ i ] - x, dz = t.pz[ i ] - z;
			const d = Math.sqrt( dx * dx + dz * dz );
			if ( d < dMin ) {

				dMin = d; yNear = t.py[ i ];

			}

			const e = Math.max( 0, d - Math.max( t.wallL[ i ], t.wallR[ i ] ) );
			const u = t.py[ i ] - 0.35 + e * this.cutSlope;
			const l = t.py[ i ] - 0.6 - e * this.fillSlope;
			if ( u < upper ) upper = u;
			if ( l > lower ) lower = l;

		} );

		let h = this.natural( x, z );
		const far = this._lastFar;
		// relief: ridges and gullies, stronger away from the road
		const dr = Math.min( dMin, far, 400 );
		const amp = smoothstep( 10, 160, dr ) * 46 + 4;
		h += fbm2( x * 0.0045 + 13.1, z * 0.0045 - 7.7, 4 ) * amp;
		h += Math.abs( fbm2( x * 0.012, z * 0.012, 3 ) ) * smoothstep( 20, 90, dr ) * 10;
		// a ring of tall peaks enclosing the valley, far from the road
		const peaks = smoothstep( 350, 1400, far );
		h += peaks * ( 160 + fbm2( x * 0.0016 - 3.3, z * 0.0016 + 9.1, 4 ) * 220 );
		// hug the road corridor
		if ( dMin < Infinity ) {

			if ( lower > upper ) h = ( lower + upper ) * 0.5;
			else h = clamp( h, lower, upper );

		}

		return { h, dRoad: Math.min( dMin, far ), yNear };

	}

	height( x, z ) {

		return this.sample( x, z ).h;

	}

	// Height of the land beside the road at sample i, side = +1 (left) or -1 (right).
	sideHeight( i, side, dist = 14 ) {

		const t = this.track;
		const x = t.px[ i ] + t.lx[ i ] * side * ( t.wallOffset + dist );
		const z = t.pz[ i ] + t.lz[ i ] * side * ( t.wallOffset + dist );
		// natural slope (before cut/fill) decides whether we are in a cut or on a fill
		const n = this.natural( x, z ) + fbm2( x * 0.0045 + 13.1, z * 0.0045 - 7.7, 4 ) * 4;
		return n;

	}

}

export { lerp };
