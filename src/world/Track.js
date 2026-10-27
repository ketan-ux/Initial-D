import { LAYOUT, ROAD, WALL_OFFSET, FINISH_INTO_SEGMENT, START_INTO_SEGMENT } from './trackData.js';
import { clamp } from '../core/math.js';

// Centerline model of the pass. Pure math (no rendering) so it can be unit-
// checked in Node and shared by physics, AI, terrain, minimap and replay.
//
// Conventions: forward = (cos θ, -sin θ) in the XZ plane; increasing θ turns
// left. left = (fz, -fx). Lateral offset d > 0 is left of the centerline.

export class Track {

	constructor( layout = LAYOUT, opts = {} ) {

		this.spacing = ROAD.sampleSpacing;
		this.halfWidth = ROAD.halfWidth;
		this.wallOffset = WALL_OFFSET;
		this.startY = opts.startY ?? 360;
		this._build( layout );
		this._buildRacingLine();

	}

	_build( layout ) {

		// 1. expand to 1 m curvature / grade arrays
		const kappa = [], grade = [], tags = {};
		for ( const seg of layout ) {

			if ( seg.tag ) tags[ seg.tag ] = kappa.length;
			if ( seg.straight ) {

				for ( let i = 0; i < seg.straight; i ++ ) {

					kappa.push( 0 ); grade.push( seg.grade );

				}

			} else {

				const len = Math.round( seg.arc * Math.abs( seg.angle ) * Math.PI / 180 );
				const k = ( seg.angle > 0 ? 1 : - 1 ) / seg.arc;
				for ( let i = 0; i < len; i ++ ) {

					kappa.push( k ); grade.push( seg.grade );

				}

			}

		}

		// 2. smooth curvature into clothoid-like transitions; smooth grade into vertical curves
		const ks = boxSmooth( boxSmooth( kappa, 9 ), 9 );
		const gs = boxSmooth( boxSmooth( grade, 25 ), 25 );

		// 3. integrate at 1 m
		const n1 = ks.length;
		const px = new Float64Array( n1 + 1 ), py = new Float64Array( n1 + 1 ), pz = new Float64Array( n1 + 1 );
		let th = 0, x = 0, y = this.startY, z = 0;
		px[ 0 ] = x; py[ 0 ] = y; pz[ 0 ] = z;
		for ( let i = 0; i < n1; i ++ ) {

			const thMid = th + ks[ i ] * 0.5;
			x += Math.cos( thMid );
			z -= Math.sin( thMid );
			y += gs[ i ];
			th += ks[ i ];
			px[ i + 1 ] = x; py[ i + 1 ] = y; pz[ i + 1 ] = z;

		}

		// 4. resample every `spacing` metres into typed arrays
		const step = this.spacing;
		const n = Math.floor( n1 / step ) + 1;
		this.count = n;
		this.length = ( n - 1 ) * step;
		this.px = new Float32Array( n ); this.py = new Float32Array( n ); this.pz = new Float32Array( n );
		this.fx = new Float32Array( n ); this.fz = new Float32Array( n );
		this.lx = new Float32Array( n ); this.lz = new Float32Array( n );
		this.curv = new Float32Array( n ); this.bank = new Float32Array( n ); this.grade = new Float32Array( n );
		for ( let i = 0; i < n; i ++ ) {

			const j = Math.min( i * step, n1 );
			this.px[ i ] = px[ j ]; this.py[ i ] = py[ j ]; this.pz[ i ] = pz[ j ];
			const k = ks[ Math.min( j, n1 - 1 ) ];
			this.curv[ i ] = k;
			this.grade[ i ] = gs[ Math.min( j, n1 - 1 ) ];
			// bank toward the inside of corners, up to ~5.5 degrees
			this.bank[ i ] = clamp( k * 1.6, - 0.095, 0.095 );

		}

		for ( let i = 0; i < n; i ++ ) {

			const a = Math.max( 0, i - 1 ), b = Math.min( n - 1, i + 1 );
			let dx = this.px[ b ] - this.px[ a ], dz = this.pz[ b ] - this.pz[ a ];
			const l = Math.hypot( dx, dz ) || 1;
			dx /= l; dz /= l;
			this.fx[ i ] = dx; this.fz[ i ] = dz;
			this.lx[ i ] = dz; this.lz[ i ] = - dx;

		}

		this.tags = {};
		for ( const k in tags ) this.tags[ k ] = tags[ k ];
		this.startS = this.tags.summit + START_INTO_SEGMENT;
		this.finishS = this.tags.finish + FINISH_INTO_SEGMENT;
		this.cooldownS = this.tags.cooldown + 60;

		// bounds
		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity, minY = Infinity, maxY = - Infinity;
		for ( let i = 0; i < n; i ++ ) {

			minX = Math.min( minX, this.px[ i ] ); maxX = Math.max( maxX, this.px[ i ] );
			minZ = Math.min( minZ, this.pz[ i ] ); maxZ = Math.max( maxZ, this.pz[ i ] );
			minY = Math.min( minY, this.py[ i ] ); maxY = Math.max( maxY, this.py[ i ] );

		}

		this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
		// Per-sample physics boundary on each side (widened where parking lots open up).
		this.wallL = new Float32Array( n ).fill( WALL_OFFSET );
		this.wallR = new Float32Array( n ).fill( WALL_OFFSET );
		this._buildGrid();

	}

	// Spatial hash of samples for nearest-road queries from arbitrary points.
	_buildGrid() {

		this.cell = 40;
		this.grid = new Map();
		for ( let i = 0; i < this.count; i ++ ) {

			const key = this._key( Math.floor( this.px[ i ] / this.cell ), Math.floor( this.pz[ i ] / this.cell ) );
			let arr = this.grid.get( key );
			if ( ! arr ) this.grid.set( key, arr = [] );
			arr.push( i );

		}

	}

	_key( cx, cz ) {

		return cx * 73856093 ^ cz * 19349663;

	}

	// Iterate sample indices within `radius` of (x, z).
	forEachNear( x, z, radius, fn ) {

		const c = this.cell;
		const x0 = Math.floor( ( x - radius ) / c ), x1 = Math.floor( ( x + radius ) / c );
		const z0 = Math.floor( ( z - radius ) / c ), z1 = Math.floor( ( z + radius ) / c );
		for ( let cx = x0; cx <= x1; cx ++ ) for ( let cz = z0; cz <= z1; cz ++ ) {

			const arr = this.grid.get( this._key( cx, cz ) );
			if ( arr ) for ( let k = 0; k < arr.length; k ++ ) fn( arr[ k ] );

		}

	}

	// Global nearest sample (used when no hint is available, e.g. terrain build).
	nearestIndex( x, z, radius = 120 ) {

		let best = - 1, bd = Infinity;
		this.forEachNear( x, z, radius, ( i ) => {

			const dx = this.px[ i ] - x, dz = this.pz[ i ] - z;
			const d = dx * dx + dz * dz;
			if ( d < bd ) {

				bd = d; best = i;

			}

		} );
		return best;

	}

	// Project a world XZ point onto the centerline near `hint` (sample index).
	// Fills `out` with s, lateral offset, road height at that lateral offset, etc.
	project( x, z, hint, out = {} ) {

		let i0;
		if ( hint == null || hint < 0 ) {

			i0 = this.nearestIndex( x, z, 200 );
			if ( i0 < 0 ) i0 = 0;

		} else {

			// local hill-climb search from the hint
			i0 = clamp( hint | 0, 0, this.count - 1 );
			let best = this._d2( i0, x, z );
			for ( let dir = - 1; dir <= 1; dir += 2 ) {

				let j = i0 + dir;
				while ( j >= 0 && j < this.count ) {

					const d = this._d2( j, x, z );
					if ( d < best ) {

						best = d; i0 = j; j += dir;

					} else break;

				}

			}

		}

		// choose segment [i, i+1] containing the projection
		let i = i0;
		if ( i >= this.count - 1 ) i = this.count - 2;
		const t0 = this._segT( i, x, z );
		if ( t0 < 0 && i > 0 ) i --;
		let t = clamp( this._segT( i, x, z ), 0, 1 );

		const ax = this.px[ i ], az = this.pz[ i ], bx = this.px[ i + 1 ], bz = this.pz[ i + 1 ];
		const cx = ax + ( bx - ax ) * t, cz = az + ( bz - az ) * t;
		const fx = this.fx[ i ] + ( this.fx[ i + 1 ] - this.fx[ i ] ) * t;
		const fz = this.fz[ i ] + ( this.fz[ i + 1 ] - this.fz[ i ] ) * t;
		const fl = Math.hypot( fx, fz ) || 1;
		const nfx = fx / fl, nfz = fz / fl;
		const lx = nfz, lz = - nfx;
		const lateral = ( x - cx ) * lx + ( z - cz ) * lz;
		const cy = this.py[ i ] + ( this.py[ i + 1 ] - this.py[ i ] ) * t;
		const bank = this.bank[ i ] + ( this.bank[ i + 1 ] - this.bank[ i ] ) * t;

		out.index = i;
		out.t = t;
		out.s = ( i + t ) * this.spacing;
		out.lateral = lateral;
		out.centerY = cy;
		out.y = this.surfaceY( cy, bank, lateral );
		out.bank = bank;
		out.fx = nfx; out.fz = nfz; out.lx = lx; out.lz = lz;
		out.curv = this.curv[ i ] + ( this.curv[ i + 1 ] - this.curv[ i ] ) * t;
		out.grade = this.grade[ i ];
		out.wallL = Math.min( this.wallL[ i ], this.wallL[ i + 1 ] );
		out.wallR = Math.min( this.wallR[ i ], this.wallR[ i + 1 ] );
		return out;

	}

	// Road surface height including camber and the gutter dip.
	surfaceY( centerY, bank, lateral ) {

		const a = Math.abs( lateral );
		let y = centerY - lateral * Math.tan( bank );
		// crown: slight drainage slope toward both edges
		y -= a * 0.012;
		const hw = this.halfWidth;
		if ( a > hw ) {

			const g = a - hw;
			if ( g < ROAD.gutterWidth ) {

				// U-shaped gutter profile
				const u = g / ROAD.gutterWidth;
				y -= Math.sin( u * Math.PI ) * ROAD.gutterDepth;

			}

		}

		return y;

	}

	_d2( i, x, z ) {

		const dx = this.px[ i ] - x, dz = this.pz[ i ] - z;
		return dx * dx + dz * dz;

	}

	_segT( i, x, z ) {

		const ax = this.px[ i ], az = this.pz[ i ];
		const dx = this.px[ i + 1 ] - ax, dz = this.pz[ i + 1 ] - az;
		const l2 = dx * dx + dz * dz || 1;
		return ( ( x - ax ) * dx + ( z - az ) * dz ) / l2;

	}

	// Point on the road at arc length s and lateral offset d.
	pointAt( s, d = 0, out = {} ) {

		const f = clamp( s / this.spacing, 0, this.count - 1.0001 );
		const i = Math.floor( f ), t = f - i;
		const lerpA = ( arr ) => arr[ i ] + ( arr[ i + 1 ] - arr[ i ] ) * t;
		const fx = lerpA( this.fx ), fz = lerpA( this.fz );
		const fl = Math.hypot( fx, fz ) || 1;
		out.fx = fx / fl; out.fz = fz / fl;
		out.lx = out.fz; out.lz = - out.fx;
		const cy = lerpA( this.py ), bank = lerpA( this.bank );
		out.x = lerpA( this.px ) + out.lx * d;
		out.z = lerpA( this.pz ) + out.lz * d;
		out.y = this.surfaceY( cy, bank, d );
		out.bank = bank;
		out.curv = lerpA( this.curv );
		out.heading = Math.atan2( - out.fz, out.fx );
		out.index = i;
		return out;

	}

	indexAt( s ) {

		return clamp( Math.round( s / this.spacing ), 0, this.count - 1 );

	}

	// Racing line (lateral offset per sample) and AI target speed profile.
	_buildRacingLine() {

		const n = this.count;
		const usable = this.halfWidth - 1.1;
		const raw = new Float32Array( n );
		// Look ahead/behind: apex the inside, swing wide on entry/exit.
		for ( let i = 0; i < n; i ++ ) {

			let acc = 0, wsum = 0;
			for ( let k = - 30; k <= 30; k ++ ) {

				const j = clamp( i + k, 0, n - 1 );
				const w = 1 - Math.abs( k ) / 31;
				acc += this.curv[ j ] * w;
				wsum += w;

			}

			const kAvg = acc / wsum;
			const kNow = this.curv[ i ];
			// inside at apex (current curvature), outside before (future curvature)
			let ahead = 0;
			for ( let k = 6; k <= 24; k ++ ) ahead += this.curv[ clamp( i + k, 0, n - 1 ) ];
			ahead /= 19;
			raw[ i ] = clamp( ( kNow * 1.0 - ( ahead - kNow ) * 1.4 + kAvg * 0.2 ) * 90, - 1, 1 ) * usable;

		}

		const line = boxSmooth( boxSmooth( Array.from( raw ), 7 ), 7 );
		this.racingLine = Float32Array.from( line );

		// curvature of the racing line path -> max cornering speed
		const vmax = new Float32Array( n );
		const mu = 0.97, g = 9.81;
		for ( let i = 0; i < n; i ++ ) {

			const a = Math.max( 0, i - 3 ), b = Math.min( n - 1, i + 3 );
			const ax = this.px[ a ] + this.lx[ a ] * line[ a ], az = this.pz[ a ] + this.lz[ a ] * line[ a ];
			const mx = this.px[ i ] + this.lx[ i ] * line[ i ], mz = this.pz[ i ] + this.lz[ i ] * line[ i ];
			const bx = this.px[ b ] + this.lx[ b ] * line[ b ], bz = this.pz[ b ] + this.lz[ b ] * line[ b ];
			const k = mengerCurvature( ax, az, mx, mz, bx, bz );
			vmax[ i ] = Math.min( 62, Math.sqrt( mu * g / Math.max( k, 1e-4 ) ) );

		}

		// backward pass: braking limit
		const brake = 7.5;
		for ( let i = n - 2; i >= 0; i -- ) {

			const ds = this.spacing;
			vmax[ i ] = Math.min( vmax[ i ], Math.sqrt( vmax[ i + 1 ] * vmax[ i + 1 ] + 2 * brake * ds ) );

		}

		this.speedProfile = vmax;

	}

	// Sections used by spotters/replay to label where something happened.
	sectionAt( s ) {

		let best = 'summit', bestS = - Infinity;
		for ( const [ k, idx ] of Object.entries( this.tags ) ) {

			if ( idx <= s && idx > bestS ) {

				best = k; bestS = idx;

			}

		}

		return best;

	}

	// Validation used by the offline check script.
	selfCheck( minClearance = 22 ) {

		const issues = [];
		const step = 4;
		for ( let i = 0; i < this.count; i += step ) {

			for ( let j = i + Math.ceil( 70 / this.spacing ); j < this.count; j += step ) {

				const d = Math.sqrt( this._d2( j, this.px[ i ], this.pz[ i ] ) );
				if ( d < minClearance ) issues.push( { s1: i * this.spacing, s2: j * this.spacing, d } );

			}

		}

		return issues;

	}

}

function boxSmooth( arr, radius ) {

	const n = arr.length, out = new Array( n );
	let acc = 0;
	const r = radius;
	// prefix sums with clamped edges
	const pre = new Float64Array( n + 1 );
	for ( let i = 0; i < n; i ++ ) pre[ i + 1 ] = pre[ i ] + arr[ i ];
	for ( let i = 0; i < n; i ++ ) {

		const a = Math.max( 0, i - r ), b = Math.min( n - 1, i + r );
		acc = pre[ b + 1 ] - pre[ a ];
		out[ i ] = acc / ( b - a + 1 );

	}

	return out;

}

function mengerCurvature( ax, az, bx, bz, cx, cz ) {

	const abx = bx - ax, abz = bz - az, bcx = cx - bx, bcz = cz - bz, cax = ax - cx, caz = az - cz;
	const cross = abx * ( cz - az ) - abz * ( cx - ax );
	const den = Math.hypot( abx, abz ) * Math.hypot( bcx, bcz ) * Math.hypot( cax, caz );
	return den > 1e-9 ? Math.abs( 2 * cross / den ) : 0;

}
