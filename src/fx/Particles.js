import * as THREE from 'three/webgpu';
import {
	attribute, uniform, vec2, vec3, vec4, float, step, smoothstep, mix, texture, uv, positionLocal,
	cameraViewMatrix, cameraProjectionMatrix, normalize, pow, clamp as tclamp, sin, cos
} from 'three/tsl';
import { uTime, uAmbient } from '../render/toon.js';
import { createSmokeTexture, createSparkTexture, createGlowTexture } from '../render/textures.js';
import { LAYER_NO_MIRROR } from './Petals.js';

// Quad-billboard particle pool. CPU only writes newly emitted slots into a
// ring buffer; motion, growth, fading and billboarding run in the vertex
// shader, so hundreds of puffs cost one draw call and almost no CPU.
class BillboardPool {

	constructor( count, { kind, map, additive = false, gravity = 0 } ) {

		this.count = count;
		this.kind = kind;
		this.cursor = 0;
		const quad = new THREE.PlaneGeometry( 1, 1 );
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		this.a0 = new Float32Array( count * 4 ).fill( 0 ); // start xyz, birth
		this.a1 = new Float32Array( count * 4 ).fill( 0 ); // vel xyz, life
		this.a2 = new Float32Array( count * 4 ).fill( 0 ); // size0, size1, seed, brightness
		for ( let i = 0; i < count; i ++ ) this.a0[ i * 4 + 3 ] = - 1e4; // dead
		this.b0 = new THREE.InstancedBufferAttribute( this.a0, 4 ); this.b0.setUsage( THREE.DynamicDrawUsage );
		this.b1 = new THREE.InstancedBufferAttribute( this.a1, 4 ); this.b1.setUsage( THREE.DynamicDrawUsage );
		this.b2 = new THREE.InstancedBufferAttribute( this.a2, 4 ); this.b2.setUsage( THREE.DynamicDrawUsage );
		geo.setAttribute( 'p0', this.b0 );
		geo.setAttribute( 'p1', this.b1 );
		geo.setAttribute( 'p2', this.b2 );
		geo.instanceCount = count;

		const p0 = attribute( 'p0', 'vec4' ), p1 = attribute( 'p1', 'vec4' ), p2 = attribute( 'p2', 'vec4' );
		const age = uTime.sub( p0.w );
		const life = p1.w;
		const t = tclamp( age.div( life ), 0, 1 );
		const alive = step( float( 0 ), age ).mul( step( age, life ) );
		// smoke slows down as it billows; sparks fall under gravity
		const drag = kind === 'smoke' ? float( 1 ).sub( pow( float( 1 ).sub( t ), float( 2 ) ) ).mul( life ).mul( 0.5 ) : age;
		const pos = p0.xyz.add( p1.xyz.mul( drag ) ).add( vec3( 0, gravity, 0 ).mul( age ).mul( age ).mul( 0.5 ) );
		const size = mix( p2.x, p2.y, kind === 'smoke' ? pow( t, float( 0.6 ) ) : t ).mul( alive );
		const corner = positionLocal.xy;
		let clip;
		if ( kind === 'spark' ) {

			// stretch along screen-space velocity
			const vNow = cameraViewMatrix.mul( vec4( pos, 1 ) );
			const vPrev = cameraViewMatrix.mul( vec4( pos.sub( p1.xyz.add( vec3( 0, gravity, 0 ).mul( age ) ).mul( 0.035 ) ), 1 ) );
			const dir = normalize( vNow.xy.sub( vPrev.xy ).add( vec2( 0.0001, 0 ) ) );
			const side = vec2( dir.y.negate(), dir.x );
			const along = mix( vPrev.xyz, vNow.xyz, corner.y.add( 0.5 ) );
			const v = vec4( along.add( vec3( side.mul( corner.x ).mul( size ), 0 ) ), 1 );
			clip = cameraProjectionMatrix.mul( v );

		} else {

			const rot = p2.z.mul( 6.28 ).add( age.mul( p2.z.sub( 0.5 ) ).mul( 1.2 ) );
			const c = cos( rot ), s = sin( rot );
			const rc = vec2( corner.x.mul( c ).sub( corner.y.mul( s ) ), corner.x.mul( s ).add( corner.y.mul( c ) ) );
			const v = cameraViewMatrix.mul( vec4( pos, 1 ) ).add( vec4( rc.mul( size ), 0, 0 ) );
			clip = cameraProjectionMatrix.mul( v );

		}

		const mat = new THREE.MeshBasicNodeMaterial( {
			transparent: true, depthWrite: false, side: THREE.DoubleSide,
			blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
		} );
		mat.vertexNode = clip;
		const tex = texture( map, uv() );
		if ( kind === 'smoke' ) {

			// toon smoke: painted texture tinted by twilight ambient, stepped fade
			const fade = float( 1 ).sub( smoothstep( float( 0.45 ), float( 1.0 ), t ) ).mul( smoothstep( float( 0 ), float( 0.06 ), t ) );
			const tint = mix( vec3( 1.0, 0.96, 1.0 ), vec3( uAmbient ).mul( 1.8 ), t.mul( 0.6 ) );
			mat.colorNode = vec4( tex.rgb.mul( tint ).mul( p2.w ), tex.a.mul( fade ).mul( 0.85 ) );

		} else {

			const fade = float( 1 ).sub( t );
			mat.colorNode = vec4( tex.rgb.mul( p2.w ), tex.a.mul( fade ) );

		}

		mat.fog = kind === 'smoke';
		this.material = mat;
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = kind === 'smoke' ? 10 : 11;
		this.mesh.layers.set( LAYER_NO_MIRROR );
		this.mesh.name = kind;
		this._dirtyMin = Infinity; this._dirtyMax = - 1;

	}

	emit( x, y, z, vx, vy, vz, life, s0, s1, bright = 1, birth = uTime.value ) {

		const i = this.cursor;
		this.cursor = ( this.cursor + 1 ) % this.count;
		const o = i * 4;
		this.a0[ o ] = x; this.a0[ o + 1 ] = y; this.a0[ o + 2 ] = z; this.a0[ o + 3 ] = birth;
		this.a1[ o ] = vx; this.a1[ o + 1 ] = vy; this.a1[ o + 2 ] = vz; this.a1[ o + 3 ] = life;
		this.a2[ o ] = s0; this.a2[ o + 1 ] = s1; this.a2[ o + 2 ] = Math.random(); this.a2[ o + 3 ] = bright;
		this._dirtyMin = Math.min( this._dirtyMin, i );
		this._dirtyMax = Math.max( this._dirtyMax, i );

	}

	flush() {

		if ( this._dirtyMax < 0 ) return;
		for ( const b of [ this.b0, this.b1, this.b2 ] ) {

			b.clearUpdateRanges();
			b.addUpdateRange( this._dirtyMin * 4, ( this._dirtyMax - this._dirtyMin + 1 ) * 4 );
			b.needsUpdate = true;

		}

		this._dirtyMin = Infinity; this._dirtyMax = - 1;

	}

	clear() {

		for ( let i = 0; i < this.count; i ++ ) this.a0[ i * 4 + 3 ] = - 1e4;
		this._dirtyMin = 0; this._dirtyMax = this.count - 1;
		this.flush();

	}

}

// Neon halos on tail lights, brake lights and open pop-ups.
class GlowSprites {

	constructor( max = 24 ) {

		this.max = max;
		const quad = new THREE.PlaneGeometry( 1, 1 );
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute( 'position', quad.attributes.position );
		geo.setAttribute( 'uv', quad.attributes.uv );
		this.a = new Float32Array( max * 4 );
		this.c = new Float32Array( max * 4 );
		this.ba = new THREE.InstancedBufferAttribute( this.a, 4 ); this.ba.setUsage( THREE.DynamicDrawUsage );
		this.bc = new THREE.InstancedBufferAttribute( this.c, 4 ); this.bc.setUsage( THREE.DynamicDrawUsage );
		geo.setAttribute( 'gp', this.ba );
		geo.setAttribute( 'gc', this.bc );
		geo.instanceCount = 0;
		const gp = attribute( 'gp', 'vec4' ), gc = attribute( 'gc', 'vec4' );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		const v = cameraViewMatrix.mul( vec4( gp.xyz, 1 ) ).add( vec4( positionLocal.xy.mul( gp.w ), 0.15, 0 ) );
		mat.vertexNode = cameraProjectionMatrix.mul( v );
		const tex = texture( createGlowTexture( 'rgba(255,255,255,1)' ), uv() );
		mat.colorNode = vec4( gc.rgb.mul( tex.rgb ).mul( gc.w ), tex.a.mul( gc.w.min( 1 ) ) );
		mat.fog = false;
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 12;
		this.mesh.name = 'glows';
		this.n = 0;

	}

	begin() {

		this.n = 0;

	}

	add( p, size, r, g, b, intensity ) {

		if ( this.n >= this.max || intensity <= 0.01 ) return;
		const o = this.n * 4;
		this.a[ o ] = p.x; this.a[ o + 1 ] = p.y; this.a[ o + 2 ] = p.z; this.a[ o + 3 ] = size;
		this.c[ o ] = r; this.c[ o + 1 ] = g; this.c[ o + 2 ] = b; this.c[ o + 3 ] = intensity;
		this.n ++;

	}

	end() {

		this.mesh.geometry.instanceCount = this.n;
		this.ba.needsUpdate = true;
		this.bc.needsUpdate = true;

	}

}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Tyre smoke, guardrail sparks and lamp halos for all cars.
export class FX {

	constructor( scene, quality ) {

		this.quality = quality;
		this.smoke = new BillboardPool( quality.smokeParticles, { kind: 'smoke', map: createSmokeTexture() } );
		this.sparks = new BillboardPool( quality.sparkParticles, { kind: 'spark', map: createSparkTexture(), additive: true, gravity: - 9.8 } );
		this.glows = new GlowSprites( 24 );
		scene.add( this.smoke.mesh, this.sparks.mesh, this.glows.mesh );
		this._smokeAcc = new Map();

	}

	// Emit from a car based on its physics state.
	emitForCar( car, dt, { skipHeadGlow = false } = {} ) {

		const p = car.physics, tel = car.telemetry, m = car.model;
		const intensity = Math.max( tel.drift, tel.wheelspin * 0.8, p.controls.handbrake > 0.5 && p.speed > 6 ? 0.6 : 0 );
		let acc = ( this._smokeAcc.get( car ) || 0 ) + dt * intensity * ( this.quality.smokeParticles / 6 );
		const root = car.root;
		while ( acc > 1 ) {

			acc -= 1;
			for ( const wi of [ 2, 3 ] ) {

				_v.copy( m.wheelPos[ wi ] );
				_v.y = 0.15;
				root.localToWorld( _v );
				const spread = 0.8 + Math.random() * 1.2;
				this.smoke.emit(
					_v.x + ( Math.random() - 0.5 ) * 0.3, _v.y, _v.z + ( Math.random() - 0.5 ) * 0.3,
					p.vx * 0.25 + ( Math.random() - 0.5 ) * spread, 0.9 + Math.random() * 0.8, p.vz * 0.25 + ( Math.random() - 0.5 ) * spread,
					1.8 + Math.random() * 1.2, 0.6, 3.2 + intensity * 2.5, 0.85 + Math.random() * 0.15
				);

			}

		}

		this._smokeAcc.set( car, acc );

		// sparks while scraping a guardrail / wall
		if ( p.scrape > 0.05 || p.wallImpact > 1.5 ) {

			const n = Math.ceil( ( p.scrape * 3 + p.wallImpact * 0.6 ) * dt * 60 );
			const side = p.wallContact || 1;
			for ( let k = 0; k < n; k ++ ) {

				_v.set( side * car.spec.width * 0.5, 0.4 + Math.random() * 0.3, ( Math.random() - 0.5 ) * car.spec.length * 0.8 );
				root.localToWorld( _v );
				_w.set( - p.vx * 0.15 + ( Math.random() - 0.5 ) * 4, 1.5 + Math.random() * 3, - p.vz * 0.15 + ( Math.random() - 0.5 ) * 4 );
				this.sparks.emit( _v.x, _v.y, _v.z, _w.x, _w.y, _w.z, 0.35 + Math.random() * 0.35, 0.05, 0.02, 2.4 );

			}

		}

		// neon halos: tail/brake lights + headlight lenses
		const brake = m.uniforms.brake.value, tail = m.uniforms.tail.value, head = m.uniforms.head.value;
		const zR = m.zOf( car.spec.length ) - 0.05;
		for ( const s of [ 1, - 1 ] ) {

			_v.set( s * 0.48, car.spec.tail.y, zR );
			m.chassis.localToWorld( _v );
			this.glows.add( _v, 0.5 + brake * 0.7, 1.0, 0.18, 0.22, tail * 0.35 + brake * 1.3 );

		}

		if ( head > 0.05 && ! skipHeadGlow ) {

			for ( const a of m.headAnchors ) {

				a.getWorldPosition( _v );
				this.glows.add( _v, 0.55, 1.0, 0.92, 0.75, head * 0.8 );

			}

		}

	}

	beginFrame() {

		this.glows.begin();

	}

	endFrame() {

		this.smoke.flush();
		this.sparks.flush();
		this.glows.end();

	}

	clear() {

		this.smoke.clear();
		this.sparks.clear();

	}

}
