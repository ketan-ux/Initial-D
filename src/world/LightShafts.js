import * as THREE from 'three/webgpu';
import { uv, vec3, vec4, float, smoothstep, normalView, positionViewDirection, uniform, sin, positionWorld } from 'three/tsl';
import { uTime, uMoonDir } from '../render/toon.js';
import { mulberry32 } from '../core/math.js';

// High preset: stylised light shafts. Soft additive cones under the sodium
// street lamps and slanted moonbeams falling through the roadside sakura.
// Two instanced draw calls for the whole pass; edges fade with a view-space
// fresnel so they read as volume rather than geometry.
export function buildLightShafts( track, lamps, field ) {

	const group = new THREE.Group();
	group.name = 'lightShafts';

	const shaftMat = ( color, strength ) => {

		const mat = new THREE.MeshBasicNodeMaterial( {
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
		} );
		const ndv = normalView.dot( positionViewDirection ).abs();
		const edge = smoothstep( float( 0.05 ), float( 0.6 ), ndv );
		const along = smoothstep( float( 0.0 ), float( 0.25 ), uv().y ).mul( float( 1 ).sub( smoothstep( float( 0.75 ), float( 1.0 ), uv().y ) ) );
		// slow drifting dust shimmer
		const dust = sin( positionWorld.y.mul( 3.0 ).add( uTime.mul( 0.6 ) ).add( positionWorld.x ) ).mul( 0.15 ).add( 0.85 );
		const a = edge.mul( along ).mul( dust ).mul( uniform( strength ) );
		mat.colorNode = vec4( vec3( color.r, color.g, color.b ).mul( a ), a );
		mat.fog = true;
		return mat;

	};

	// lamp cones
	if ( lamps.length ) {

		const cone = new THREE.CylinderGeometry( 0.25, 3.4, 5.6, 16, 1, true );
		cone.translate( 0, - 2.8, 0 );
		const mesh = new THREE.InstancedMesh( cone, shaftMat( new THREE.Color( 1.0, 0.72, 0.42 ), 0.16 ), lamps.length );
		const m = new THREE.Matrix4();
		lamps.forEach( ( l, i ) => {

			m.makeTranslation( l.x, l.y, l.z );
			mesh.setMatrixAt( i, m );

		} );
		mesh.instanceMatrix.needsUpdate = true;
		mesh.frustumCulled = false;
		mesh.renderOrder = 8;
		group.add( mesh );

	}

	// moonbeams through blossoms beside the road
	const rng = mulberry32( 2024 );
	const beams = [];
	for ( let i = 30; i < track.count - 30; i += 26 ) {

		if ( rng() < 0.45 ) continue;
		const side = rng() < 0.5 ? 1 : - 1;
		const lat = side * ( track.wallOffset + 4 + rng() * 6 );
		const x = track.px[ i ] + track.lx[ i ] * lat, z = track.pz[ i ] + track.lz[ i ] * lat;
		beams.push( [ x, field.height( x, z ), z, 0.8 + rng() * 0.8 ] );

	}

	const quad = new THREE.PlaneGeometry( 1.6, 14 );
	quad.translate( 0, 7, 0 );
	const beamMesh = new THREE.InstancedMesh( quad, shaftMat( new THREE.Color( 0.82, 0.78, 1.0 ), 0.1 ), Math.max( 1, beams.length ) );
	const dir = uMoonDir.value.clone().normalize();
	const tilt = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir );
	const m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3();
	beams.forEach( ( b, i ) => {

		p.set( b[ 0 ], b[ 1 ], b[ 2 ] );
		s.set( b[ 3 ], 1, 1 );
		m.compose( p, tilt, s );
		beamMesh.setMatrixAt( i, m );

	} );
	beamMesh.count = beams.length;
	beamMesh.instanceMatrix.needsUpdate = true;
	beamMesh.frustumCulled = false;
	beamMesh.renderOrder = 8;
	group.add( beamMesh );
	return group;

}
