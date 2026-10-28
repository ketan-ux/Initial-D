import * as THREE from 'three/webgpu';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { mulberry32, smoothstep, clamp, lerp } from '../core/math.js';

// Chunked mountain terrain with merged foliage. Each chunk is a THREE.LOD
// with two levels; terrain + trees share one vertex-coloured toon material,
// so each visible chunk costs exactly one draw call.

const C = ( hex ) => new THREE.Color( hex );
const PAL = {
	grass: C( 0x3a6a5e ), grassDark: C( 0x284d47 ), moss: C( 0x4f7d57 ),
	rock: C( 0x6f6283 ), dirt: C( 0x5d4a56 ), petals: C( 0xf2b3cf ),
	snow: C( 0xd9d4f0 ), peakRock: C( 0x5a4c78 ),
	trunk: C( 0x4a3238 ), sakura: [ C( 0xffb8d6 ), C( 0xff9cc6 ), C( 0xffd3e6 ), C( 0xf7a1c8 ) ],
	cedar: [ C( 0x1f4743 ), C( 0x24524b ), C( 0x1a3d3c ) ]
};

export class Terrain {

	constructor( track, field, material, quality, onProgress ) {

		this.track = track;
		this.field = field;
		this.material = material;
		this.quality = quality;
		this.group = new THREE.Group();
		this.group.name = 'terrain';
		this.chunkSize = 320;
		const b = track.bounds, margin = 420;
		this.minX = Math.floor( ( b.minX - margin ) / this.chunkSize ) * this.chunkSize;
		this.minZ = Math.floor( ( b.minZ - margin ) / this.chunkSize ) * this.chunkSize;
		this.nx = Math.ceil( ( b.maxX + margin - this.minX ) / this.chunkSize );
		this.nz = Math.ceil( ( b.maxZ + margin - this.minZ ) / this.chunkSize );
		this.onProgress = onProgress;
		this.rng = mulberry32( 1986 );
		this.treeGeos = makeTreeGeos();

	}

	async build() {

		const total = this.nx * this.nz;
		let done = 0;
		for ( let cz = 0; cz < this.nz; cz ++ ) {

			for ( let cx = 0; cx < this.nx; cx ++ ) {

				this.group.add( this._buildChunk( cx, cz ) );
				done ++;
				this.onProgress?.( done / total );
				// yield to keep the loading screen responsive
				if ( done % 3 === 0 ) await new Promise( ( r ) => setTimeout( r, 0 ) );

			}

		}

		this.group.add( this._buildBackdrop() );
		return this.group;

	}

	_colorAt( h, slope, dRoad, out ) {

		const W = this.track.wallOffset;
		out.copy( PAL.grass ).lerp( PAL.grassDark, smoothstep( 0.2, 0.6, slope ) * 0.7 );
		out.lerp( PAL.rock, smoothstep( 0.55, 1.1, slope ) );
		const peak = smoothstep( 420, 700, h );
		out.lerp( PAL.peakRock, peak * 0.8 );
		out.lerp( PAL.snow, smoothstep( 640, 760, h ) * ( 1 - smoothstep( 0.8, 1.3, slope ) ) );
		// petal carpet along the verge
		const carpet = ( 1 - smoothstep( W + 1, W + 9, dRoad ) ) * ( 1 - smoothstep( 0.6, 1.0, slope ) );
		out.lerp( PAL.petals, carpet * 0.16 ); // a faint blush only; real petals are decals
		return out;

	}

	_buildChunk( cx, cz ) {

		const q = this.quality;
		const size = this.chunkSize;
		const x0 = this.minX + cx * size, z0 = this.minZ + cz * size;
		const N = Math.max( 16, Math.round( 64 * q.terrainDetail / 4 ) * 4 );
		const step = size / N;
		const H = new Float32Array( ( N + 1 ) * ( N + 1 ) );
		const D = new Float32Array( ( N + 1 ) * ( N + 1 ) );
		for ( let j = 0; j <= N; j ++ ) for ( let i = 0; i <= N; i ++ ) {

			const s = this.field.sample( x0 + i * step, z0 + j * step );
			H[ j * ( N + 1 ) + i ] = s.h;
			D[ j * ( N + 1 ) + i ] = s.dRoad;

		}

		const heightAt = ( x, z ) => {

			const fi = clamp( ( x - x0 ) / step, 0, N - 0.001 ), fj = clamp( ( z - z0 ) / step, 0, N - 0.001 );
			const i = Math.floor( fi ), j = Math.floor( fj ), u = fi - i, v = fj - j;
			const a = H[ j * ( N + 1 ) + i ], b = H[ j * ( N + 1 ) + i + 1 ];
			const c = H[ ( j + 1 ) * ( N + 1 ) + i ], d = H[ ( j + 1 ) * ( N + 1 ) + i + 1 ];
			return lerp( lerp( a, b, u ), lerp( c, d, u ), v );

		};

		const dAt = ( x, z ) => {

			const i = clamp( Math.round( ( x - x0 ) / step ), 0, N ), j = clamp( Math.round( ( z - z0 ) / step ), 0, N );
			return D[ j * ( N + 1 ) + i ];

		};

		const trees = this._placeTrees( x0, z0, size, heightAt, dAt );

		const lod = new THREE.LOD();
		lod.name = `chunk_${cx}_${cz}`;
		const hi = this._chunkMesh( H, D, N, 1, x0, z0, step, trees, 0 );
		const lo = this._chunkMesh( H, D, N, 4, x0, z0, step, trees, 1 );
		lod.addLevel( hi, 0 );
		lod.addLevel( lo, 300 );
		// LOD distance is measured from the object's origin, so centre each
		// chunk's LOD on the chunk and offset the (world-space) meshes back.
		let hs = 0;
		for ( let k = 0; k < H.length; k ++ ) hs += H[ k ];
		lod.position.set( x0 + size / 2, hs / H.length, z0 + size / 2 );
		for ( const m of [ hi, lo ] ) {

			m.position.copy( lod.position ).negate();
			m.updateMatrix();

		}

		return lod;

	}

	_placeTrees( x0, z0, size, heightAt, dAt ) {

		const q = this.quality;
		const W = this.track.wallOffset;
		const rng = this.rng;
		const trees = [];
		const candidates = Math.round( 2600 * q.treeDensity );
		for ( let k = 0; k < candidates; k ++ ) {

			const x = x0 + rng() * size, z = z0 + rng() * size;
			const d = dAt( x, z );
			if ( d < W + 2.2 ) continue;
			const pSak = 0.75 * smoothstep( W + 2, W + 5, d ) * ( 1 - smoothstep( W + 22, W + 48, d ) );
			const pCed = 0.3 * smoothstep( W + 14, W + 40, d ) * ( 1 - smoothstep( 600, 900, d ) );
			const r = rng();
			let type = null;
			if ( r < pSak ) type = 'sakura';
			else if ( r < pSak + pCed ) type = 'cedar';
			if ( ! type ) continue;
			const y = heightAt( x, z );
			if ( y > 560 ) continue; // treeline
			// keep sakura off steep cut faces
			const slope = Math.abs( heightAt( x + 2, z ) - y ) + Math.abs( heightAt( x, z + 2 ) - y );
			if ( slope > 3.2 ) continue;
			trees.push( { type, x, y: y - 0.15, z, s: type === 'sakura' ? 0.8 + rng() * 0.6 : 0.8 + rng() * 0.7, rot: rng() * Math.PI * 2, c: ( rng() * 4 ) | 0, near: d < W + 30 } );

		}

		return trees;

	}

	_chunkMesh( H, D, N, stride, x0, z0, step, trees, lodLevel ) {

		const b = new GeoBuilder( { color: true, sway: true } );
		const col = new THREE.Color();
		const M = N / stride;
		const st = step * stride;
		const rows = [];
		for ( let j = 0; j <= M; j ++ ) {

			const row = [];
			for ( let i = 0; i <= M; i ++ ) {

				const gi = i * stride, gj = j * stride;
				let h = H[ gj * ( N + 1 ) + gi ];
				// coarse LOD near the road: take the lowest fine sample around the
				// vertex so the 20 m grid never cuts through the asphalt
				if ( stride > 1 && D[ gj * ( N + 1 ) + gi ] < 70 ) {

					for ( let dj = - stride; dj <= stride; dj ++ ) for ( let di = - stride; di <= stride; di ++ ) {

						const ii = Math.min( N, Math.max( 0, gi + di ) ), jj = Math.min( N, Math.max( 0, gj + dj ) );
						h = Math.min( h, H[ jj * ( N + 1 ) + ii ] - 0.4 );

					}

				}
				const hx = H[ gj * ( N + 1 ) + Math.min( N, gi + stride ) ] - H[ gj * ( N + 1 ) + Math.max( 0, gi - stride ) ];
				const hz = H[ Math.min( N, gj + stride ) * ( N + 1 ) + gi ] - H[ Math.max( 0, gj - stride ) * ( N + 1 ) + gi ];
				const slope = Math.hypot( hx, hz ) / ( 2 * st );
				this._colorAt( h, slope, D[ gj * ( N + 1 ) + gi ], col );
				// baked AO: darken concave spots relative to neighbours
				const nAvg = ( H[ gj * ( N + 1 ) + Math.min( N, gi + stride ) ] + H[ gj * ( N + 1 ) + Math.max( 0, gi - stride ) ] +
					H[ Math.min( N, gj + stride ) * ( N + 1 ) + gi ] + H[ Math.max( 0, gj - stride ) * ( N + 1 ) + gi ] ) * 0.25;
				const ao = clamp( 1 - ( nAvg - h ) * 0.06, 0.62, 1.08 );
				col.multiplyScalar( ao );
				b.setColor( col ).setSway( 0 );
				row.push( b.vertex( x0 + gi * step, h, z0 + gj * step, 0, 0 ) );

			}

			rows.push( row );

		}

		for ( let j = 0; j < M; j ++ ) b.stripRows( rows[ j ], rows[ j + 1 ] );

		// skirts hide cracks against neighbouring chunks of a different LOD
		const skirt = ( idxs ) => {

			const down = idxs.map( ( vi ) => {

				const p = b.pos;
				b.setColor( 0x2a2440 );
				return b.vertex( p[ vi * 3 ], p[ vi * 3 + 1 ] - 25, p[ vi * 3 + 2 ] );

			} );
			b.stripRows( idxs, down );
			b.stripRows( down, idxs );

		};

		skirt( rows[ 0 ] ); skirt( rows[ M ] );
		skirt( rows.map( ( r ) => r[ 0 ] ) ); skirt( rows.map( ( r ) => r[ M ] ) );

		// foliage
		const g = this.treeGeos;
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
		const up = new THREE.Vector3( 0, 1, 0 );
		for ( let k = 0; k < trees.length; k ++ ) {

			const t = trees[ k ];
			if ( lodLevel === 1 && t.type === 'cedar' && ( k % 3 ) ) continue;
			if ( lodLevel === 1 && t.type === 'sakura' && ( k % 2 ) ) continue;
			q.setFromAxisAngle( up, t.rot );
			p.set( t.x, t.y, t.z );
			s.setScalar( t.s * ( lodLevel === 1 ? 1.15 : 1 ) );
			m.compose( p, q, s );
			if ( t.type === 'sakura' ) {

				const set = lodLevel === 0 ? g.sakuraHi : g.sakuraLo;
				b.setColor( PAL.trunk ).setSway( 0 );
				b.addGeometry( set.trunk, m, { swayFn: ( v ) => clamp( ( v.y - t.y ) / ( 4 * t.s ), 0, 0.4 ) } );
				const base = PAL.sakura[ t.c ];
				b.addGeometry( set.canopy, m, {
					colorFn: ( v ) => {

						// lighter on top, deeper pink underneath (painted look)
						const k2 = clamp( ( v.y - t.y - 3 * t.s ) / ( 3.5 * t.s ), 0, 1 );
						return col.copy( base ).multiplyScalar( 0.78 + k2 * 0.32 );

					},
					swayFn: () => 1
				} );

			} else {

				const set = lodLevel === 0 ? g.cedarHi : g.cedarLo;
				b.setColor( PAL.trunk ).setSway( 0 );
				b.addGeometry( set.trunk, m );
				b.setColor( PAL.cedar[ t.c % 3 ] );
				b.addGeometry( set.canopy, m, { swayFn: ( v ) => clamp( ( v.y - t.y ) / ( 14 * t.s ), 0, 1 ) * 0.4 } );

			}

		}

		const geo = b.build();
		const mesh = new THREE.Mesh( geo, this.material );
		mesh.receiveShadow = this.quality.shadows === 'csm';
		mesh.matrixAutoUpdate = false;
		mesh.updateMatrix();
		return mesh;

	}

	// One giant low-res ring of mountains beyond the detailed chunks.
	_buildBackdrop() {

		const b = new GeoBuilder( { color: true, sway: true } );
		const cx = this.minX + this.nx * this.chunkSize * 0.5, cz = this.minZ + this.nz * this.chunkSize * 0.5;
		const ext = 5200, N = 56, st = ( ext * 2 ) / N;
		const col = new THREE.Color();
		const rows = [];
		const inner = ( x, z ) => x > this.minX + 1 && x < this.minX + this.nx * this.chunkSize - 1 && z > this.minZ + 1 && z < this.minZ + this.nz * this.chunkSize - 1;
		const hs = [];
		for ( let j = 0; j <= N; j ++ ) {

			const row = [];
			for ( let i = 0; i <= N; i ++ ) {

				const x = cx - ext + i * st, z = cz - ext + j * st;
				let h = this.field.height( x, z );
				if ( inner( x, z ) ) h -= 30; // tucked under detailed chunks
				hs.push( h );
				col.copy( PAL.grassDark ).lerp( PAL.peakRock, smoothstep( 300, 650, h ) ).lerp( PAL.snow, smoothstep( 640, 820, h ) * 0.8 );
				b.setColor( col ).setSway( 0 );
				row.push( b.vertex( x, h, z ) );

			}

			rows.push( row );

		}

		for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) {

			const x = cx - ext + ( i + 0.5 ) * st, z = cz - ext + ( j + 0.5 ) * st;
			if ( inner( x, z ) ) continue;
			b.quad( rows[ j + 1 ][ i ], rows[ j + 1 ][ i + 1 ], rows[ j ][ i + 1 ], rows[ j ][ i ] );

		}

		const mesh = new THREE.Mesh( b.build(), this.material );
		mesh.name = 'backdrop';
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = false;
		return mesh;

	}

}

// Low-poly stylised trees. Sakura: dark trunk + clustered blossom puffs.
// Cedar (sugi): stacked dark cones, the classic Japanese mountain forest.
function makeTreeGeos() {

	const sak = ( detail, puffs ) => {

		const trunk = new THREE.CylinderGeometry( 0.16, 0.3, 4.2, 5, 1 );
		trunk.translate( 0, 2.1, 0 );
		// a forked branch
		const br = new THREE.CylinderGeometry( 0.08, 0.14, 2.4, 4 );
		br.rotateZ( 0.7 ); br.translate( 0.7, 3.6, 0 );
		const br2 = br.clone(); br2.rotateY( 2.4 );
		const trunkAll = mergeSimple( [ trunk, br, br2 ] );
		const parts = [];
		const rng = mulberry32( detail * 31 + puffs );
		for ( let i = 0; i < puffs; i ++ ) {

			const r = 1.5 + rng() * 0.9;
			const sp = new THREE.IcosahedronGeometry( r, detail );
			// squash + jitter for an organic painted silhouette
			const pa = sp.attributes.position;
			for ( let k = 0; k < pa.count; k ++ ) {

				const j = 1 + ( rng() - 0.5 ) * 0.22;
				pa.setXYZ( k, pa.getX( k ) * j, pa.getY( k ) * 0.78 * j, pa.getZ( k ) * j );

			}

			const a = ( i / puffs ) * Math.PI * 2 + rng();
			const rad = i === 0 ? 0 : 1.3 + rng() * 0.6;
			sp.translate( Math.cos( a ) * rad, 4.6 + rng() * 1.3 + ( i === 0 ? 0.9 : 0 ), Math.sin( a ) * rad );
			parts.push( sp );

		}

		const canopy = mergeSimple( parts );
		canopy.computeVertexNormals();
		return { trunk: trunkAll, canopy };

	};

	const ced = ( sides, tiers ) => {

		const trunk = new THREE.CylinderGeometry( 0.15, 0.25, 3, 4 );
		trunk.translate( 0, 1.5, 0 );
		const parts = [];
		for ( let i = 0; i < tiers; i ++ ) {

			const h = 6.5 - i * 1.4, r = 2.4 - i * 0.6;
			const cone = new THREE.ConeGeometry( r, h, sides, 1 );
			cone.translate( 0, 3.2 + i * 3.2 + h * 0.5, 0 );
			parts.push( cone );

		}

		return { trunk, canopy: mergeSimple( parts ) };

	};

	return {
		sakuraHi: sak( 1, 4 ),
		sakuraLo: sak( 0, 3 ),
		cedarHi: ced( 6, 3 ),
		cedarLo: ced( 4, 2 )
	};

}

function mergeSimple( geos ) {

	const b = new GeoBuilder( { color: false } );
	for ( const g of geos ) b.addGeometry( g.index ? g : g, null );
	const out = b.build();
	return out;

}
