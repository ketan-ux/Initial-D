import * as THREE from 'three/webgpu';
import {
	uniform, attribute, vec3, vec4, float, sin, cos, mod, dot, length, cross, smoothstep, max,
	positionLocal, texture, uv, mix
} from 'three/tsl';
import { uTime } from '../render/toon.js';
import { createPetalTexture } from '../render/textures.js';

// Instanced sakura petals, simulated entirely on the GPU.
// Each petal is a pure function of (seed, time, camera, car positions):
//  - a wrapping box of petals follows the camera (infinite field, zero CPU)
//  - wind drift + flutter + tumbling rotation
//  - slipstream vortices: petals in a car's wake are spun around the wake
//    axis, dragged along and lifted, so drifting cars leave swirling trails.

const MAX_CARS = 2;
// Layers 1 and 2 are reserved by the XR manager for per-eye rendering.
export const LAYER_NO_MIRROR = 5;

export class Petals {

	constructor( count ) {

		this.count = count;
		const quad = new THREE.PlaneGeometry( 0.07, 0.07 );
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		geo.setAttribute( 'normal', quad.attributes.normal );
		const seeds = new Float32Array( count * 4 );
		for ( let i = 0; i < count * 4; i ++ ) seeds[ i ] = Math.random();
		geo.setAttribute( 'seed', new THREE.InstancedBufferAttribute( seeds, 4 ) );
		geo.instanceCount = count;

		this.uCenter = uniform( new THREE.Vector3() );
		this.uSize = uniform( new THREE.Vector3( 64, 26, 64 ) );
		this.uWind = uniform( new THREE.Vector3( 0.9, 0, 0.5 ) );
		this.cars = [];
		for ( let i = 0; i < MAX_CARS; i ++ ) {

			this.cars.push( { pos: uniform( new THREE.Vector3( 0, - 999, 0 ) ), dir: uniform( new THREE.Vector3( 0, 0, 1 ) ), str: uniform( 0 ) } );

		}

		const seed = attribute( 'seed', 'vec4' );
		const t = uTime;
		const S = this.uSize;
		// drifting base position
		const fall = seed.w.mul( 0.45 ).add( 0.35 );
		let p = seed.xyz.mul( S )
			.add( this.uWind.mul( t ) )
			.add( vec3( 0, fall.mul( t ).negate(), 0 ) )
			.add( vec3( sin( t.mul( 1.7 ).add( seed.w.mul( 20 ) ) ).mul( 0.7 ), 0, cos( t.mul( 1.3 ).add( seed.x.mul( 20 ) ) ).mul( 0.7 ) ) );
		// wrap into the box around the camera
		p = mod( p.sub( this.uCenter ).add( S.mul( 0.5 ) ), S ).sub( S.mul( 0.5 ) ).add( this.uCenter );

		for ( const car of this.cars ) {

			const back = car.dir.negate();
			const d = p.sub( car.pos );
			const along = dot( d, back );
			const perp = d.sub( back.mul( along ) );
			const r = length( perp );
			const w = smoothstep( float( 0.5 ), float( 3.0 ), along )
				.mul( float( 1 ).sub( smoothstep( float( 10 ), float( 28 ), along ) ) )
				.mul( float( 1 ).sub( smoothstep( float( 1.2 ), float( 5.0 ), r ) ) )
				.mul( car.str );
			const ang = w.mul( 4.0 ).add( along.mul( 0.35 ).mul( w ) );
			const perpRot = perp.mul( cos( ang ) ).add( cross( car.dir, perp ).mul( sin( ang ) ) );
			const swirl = car.pos.add( back.mul( along ) ).add( perpRot.mul( float( 1 ).sub( w.mul( 0.35 ) ) ) )
				.add( car.dir.mul( w.mul( 2.2 ) ) ).add( vec3( 0, w.mul( 1.1 ), 0 ) );
			p = mix( p, swirl, smoothstep( float( 0 ), float( 0.05 ), w ) );

		}

		// tumbling local quad
		const ang = t.mul( seed.y.mul( 2.5 ).add( 1.0 ) ).add( seed.z.mul( 6.28 ) );
		const ca = cos( ang ), sa = sin( ang );
		const cb = cos( ang.mul( 0.7 ).add( 1.0 ) ), sb = sin( ang.mul( 0.7 ).add( 1.0 ) );
		const lp = positionLocal;
		// rotate about Y then X
		const ry = vec3( lp.x.mul( ca ).add( lp.z.mul( sa ) ), lp.y, lp.z.mul( ca ).sub( lp.x.mul( sa ) ) );
		const rx = vec3( ry.x, ry.y.mul( cb ).sub( ry.z.mul( sb ) ), ry.y.mul( sb ).add( ry.z.mul( cb ) ) );
		const scale = seed.x.mul( 0.6 ).add( 0.7 );

		const tex = createPetalTexture();
		const mat = new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide, alphaTest: 0.5, transparent: false } );
		mat.positionNode = p.add( rx.mul( scale ) );
		const col = texture( tex, uv() );
		const shade = seed.y.mul( 0.25 ).add( 0.85 );
		mat.colorNode = vec4( col.rgb.mul( shade ).mul( vec3( 1.0, 0.92, 0.97 ) ), col.a );
		mat.fog = true;
		this.material = mat;

		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.frustumCulled = false;
		this.mesh.name = 'petals';
		this.mesh.layers.set( LAYER_NO_MIRROR ); // excluded from mirror renders
		void max; void texture;

	}

	setVisibleCount( n ) {

		this.mesh.geometry.instanceCount = Math.min( this.count, n );

	}

	// cars: [{ x, y, z, vx, vz, speed, drift }]
	update( center, cars ) {

		this.uCenter.value.copy( center );
		for ( let i = 0; i < MAX_CARS; i ++ ) {

			const u = this.cars[ i ], c = cars[ i ];
			if ( ! c ) {

				u.str.value = 0; continue;

			}

			u.pos.value.set( c.x, c.y + 0.6, c.z );
			const sp = Math.hypot( c.vx, c.vz );
			if ( sp > 0.5 ) u.dir.value.set( c.vx / sp, 0, c.vz / sp );
			// stronger vortex at speed and when sliding sideways
			u.str.value = Math.min( 1, sp / 25 ) * ( 0.55 + 0.45 * ( c.drift || 0 ) );

		}

	}

}
