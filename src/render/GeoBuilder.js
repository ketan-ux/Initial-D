import * as THREE from 'three/webgpu';

// Accumulates vertices for merged, single-draw-call meshes (road chunks,
// terrain + foliage, car bodies). Attributes: position, uv, color, glow, sway.
export class GeoBuilder {

	constructor( { color = true, glow = false, sway = false } = {} ) {

		this.pos = []; this.uv = []; this.col = []; this.glow = []; this.sway = []; this.idx = [];
		this.nrm = []; this.hasNrm = []; // explicit normals from merged geometries
		this.useColor = color; this.useGlow = glow; this.useSway = sway;
		this.vcount = 0;
		this.cr = 1; this.cg = 1; this.cb = 1; this.cglow = 0; this.csway = 0;

	}

	setColor( c, g = 1, b = 1 ) {

		if ( typeof c === 'number' ) {

			this.cr = ( ( c >> 16 ) & 255 ) / 255; this.cg = ( ( c >> 8 ) & 255 ) / 255; this.cb = ( c & 255 ) / 255;

		} else if ( c && c.isColor ) {

			this.cr = c.r; this.cg = c.g; this.cb = c.b;

		} else {

			this.cr = c; this.cg = g; this.cb = b;

		}

		return this;

	}

	setGlow( g ) {

		this.cglow = g; return this;

	}

	setSway( s ) {

		this.csway = s; return this;

	}

	vertex( x, y, z, u = 0, v = 0 ) {

		this.pos.push( x, y, z );
		this.uv.push( u, v );
		this.nrm.push( 0, 0, 0 );
		this.hasNrm.push( 0 );
		if ( this.useColor ) this.col.push( this.cr, this.cg, this.cb );
		if ( this.useGlow ) this.glow.push( this.cglow );
		if ( this.useSway ) this.sway.push( this.csway );
		return this.vcount ++;

	}

	// Vertex with an explicit normal (kept as-is by build()).
	vertexN( x, y, z, u, v, nx, ny, nz ) {

		const i = this.vertex( x, y, z, u, v );
		this.nrm[ i * 3 ] = nx; this.nrm[ i * 3 + 1 ] = ny; this.nrm[ i * 3 + 2 ] = nz;
		this.hasNrm[ i ] = 1;
		return i;

	}

	tri( a, b, c ) {

		this.idx.push( a, b, c );

	}

	quad( a, b, c, d ) {

		// a-b-c-d counter-clockwise
		this.idx.push( a, b, c, a, c, d );

	}

	// Connect two rows of equal length into a strip of quads.
	stripRows( rowA, rowB, flip = false ) {

		for ( let k = 0; k < rowA.length - 1; k ++ ) {

			if ( flip ) this.quad( rowA[ k ], rowA[ k + 1 ], rowB[ k + 1 ], rowB[ k ] );
			else this.quad( rowA[ k ], rowB[ k ], rowB[ k + 1 ], rowA[ k + 1 ] );

		}

	}

	// Append a THREE.BufferGeometry transformed by matrix (for props/details).
	addGeometry( geo, matrix, opts = {} ) {

		const g = geo.index ? geo : geo;
		const p = g.attributes.position, uvA = g.attributes.uv, nA = g.attributes.normal;
		const base = this.vcount;
		const v = new THREE.Vector3(), n = new THREE.Vector3();
		const nm = matrix ? new THREE.Matrix3().getNormalMatrix( matrix ) : null;
		for ( let i = 0; i < p.count; i ++ ) {

			v.fromBufferAttribute( p, i );
			if ( matrix ) v.applyMatrix4( matrix );
			let u = 0, w = 0;
			if ( uvA ) {

				u = uvA.getX( i ); w = uvA.getY( i );
				if ( opts.uvRemap ) [ u, w ] = opts.uvRemap( u, w );

			} else if ( opts.uv ) {

				u = opts.uv[ 0 ]; w = opts.uv[ 1 ];

			}

			if ( opts.colorFn ) {

				const c = opts.colorFn( v, i );
				if ( c !== undefined ) this.setColor( c );

			}

			if ( opts.swayFn ) this.csway = opts.swayFn( v, i );
			const vi = this.vertex( v.x, v.y, v.z, u, w );
			if ( nA && ! opts.recomputeNormals ) {

				n.fromBufferAttribute( nA, i );
				if ( nm ) n.applyMatrix3( nm ).normalize();
				this.nrm[ vi * 3 ] = n.x; this.nrm[ vi * 3 + 1 ] = n.y; this.nrm[ vi * 3 + 2 ] = n.z;
				this.hasNrm[ vi ] = 1;

			}

		}

		if ( g.index ) {

			const ia = g.index.array;
			for ( let i = 0; i < ia.length; i ++ ) this.idx.push( base + ia[ i ] );

		} else {

			for ( let i = 0; i < p.count; i ++ ) this.idx.push( base + i );

		}

	}

	get empty() {

		return this.vcount === 0;

	}

	build( { normals = true } = {} ) {

		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		if ( this.useColor ) geo.setAttribute( 'color', new THREE.Float32BufferAttribute( this.col, 3 ) );
		if ( this.useGlow ) geo.setAttribute( 'glow', new THREE.Float32BufferAttribute( this.glow, 1 ) );
		if ( this.useSway ) geo.setAttribute( 'sway', new THREE.Float32BufferAttribute( this.sway, 1 ) );
		const IndexArray = this.vcount > 65535 ? Uint32Array : Uint16Array;
		geo.setIndex( new THREE.BufferAttribute( new IndexArray( this.idx ), 1 ) );
		if ( normals ) {

			geo.computeVertexNormals();
			const na = geo.attributes.normal.array;
			for ( let i = 0; i < this.vcount; i ++ ) {

				if ( this.hasNrm[ i ] ) {

					na[ i * 3 ] = this.nrm[ i * 3 ]; na[ i * 3 + 1 ] = this.nrm[ i * 3 + 1 ]; na[ i * 3 + 2 ] = this.nrm[ i * 3 + 2 ];

				}

			}

		}
		geo.computeBoundingSphere();
		geo.computeBoundingBox();
		return geo;

	}

}

// Box helper producing 24 verts with face normals (hard edges).
export function boxGeo( w, h, d ) {

	return new THREE.BoxGeometry( w, h, d );

}
