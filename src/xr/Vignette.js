import * as THREE from 'three/webgpu';
import { uniform, positionLocal, vec3, vec4, float, smoothstep, dot, mix, normalize } from 'three/tsl';
import { clamp } from '../core/math.js';

// Dynamic comfort vignette. A sphere around the head at 1.6 m, drawn with
// depth testing: the cabin (all closer than ~1.2 m) stays fully visible as a
// stable anchor, while the fast-moving world outside the windows is masked
// at the periphery during high yaw-rate slides and spins.
export class ComfortVignette {

	constructor() {

		this.uIntensity = uniform( 0 );
		const mat = new THREE.MeshBasicNodeMaterial( {
			side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true
		} );
		const dir = normalize( positionLocal );
		const c = dot( dir, vec3( 0, 0, - 1 ) ); // 1 straight ahead
		// inner edge closes from ~75 deg to ~30 deg as intensity rises
		const inner = mix( float( 0.26 ), float( 0.87 ), this.uIntensity );
		const a = smoothstep( inner, inner.sub( 0.3 ), c ).mul( this.uIntensity.mul( 1.4 ).min( 0.96 ) );
		mat.colorNode = vec4( vec3( 0.04, 0.02, 0.07 ), a );
		mat.fog = false;
		this.mesh = new THREE.Mesh( new THREE.SphereGeometry( 1.6, 32, 16 ), mat );
		this.mesh.renderOrder = 900;
		this.mesh.frustumCulled = false;
		this.mesh.name = 'vignette';
		this.level = 0;

	}

	// yawRate (rad/s), slip angle (rad), strength 0..1
	update( dt, yawRate, slip, strength, enabled ) {

		let target = 0;
		if ( enabled ) target = clamp( ( Math.abs( yawRate ) - 0.3 ) * 0.85 + Math.max( 0, Math.abs( slip ) - 0.12 ) * 1.1, 0, 1 ) * strength;
		const rate = target > this.level ? 7 : 1.6; // fast attack, gentle release
		this.level += ( target - this.level ) * Math.min( 1, dt * rate );
		this.uIntensity.value = this.level;
		this.mesh.visible = this.level > 0.01;

	}

}
