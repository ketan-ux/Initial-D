import * as THREE from 'three/webgpu';
import { CarModel } from './CarModel.js';
import { VehiclePhysics } from './VehiclePhysics.js';
import { createLightPool } from '../render/textures.js';
import { clamp } from '../core/math.js';

let poolTex = null;
const _up = new THREE.Vector3( 0, 1, 0 );
const _T = new THREE.Vector3(), _L = new THREE.Vector3(), _N = new THREE.Vector3();
const _qt = new THREE.Quaternion(), _qy = new THREE.Quaternion();

// A car = procedural model + physics + lights. Rendering state is synced
// from physics once per rendered frame (physics runs at a fixed 120 Hz).
export class Car {

	constructor( spec, liveryIndex, track, quality, { isPlayer = false, spotlights = 0, shadow = false } = {} ) {

		this.spec = spec;
		this.track = track;
		this.quality = quality;
		this.isPlayer = isPlayer;
		this.model = new CarModel( spec, liveryIndex, quality );
		this.physics = new VehiclePhysics( spec, track );
		this.root = this.model.root;
		this.headlightsOn = true;
		this.spots = [];
		this._buildHeadlights( spotlights, shadow );

	}

	_buildHeadlights( count, shadow ) {

		const m = this.model;
		const zFront = m.zOf( 0 );
		if ( count > 0 ) {

			for ( let i = 0; i < count; i ++ ) {

				const side = i === 0 ? 1 : - 1;
				const spot = new THREE.SpotLight( 0xfff0d2, 0, 95, 0.44, 0.55, 1.15 );
				spot.position.set( side * this.spec.popup.x * 0.9, 0.7, zFront - 0.35 );
				spot.target.position.set( side * 0.6, 0.0, zFront + 26 );
				if ( shadow && i === 0 ) {

					spot.castShadow = true;
					spot.shadow.mapSize.set( this.quality.shadowMapSize || 512, this.quality.shadowMapSize || 512 );
					spot.shadow.camera.near = 0.5;
					spot.shadow.camera.far = 60;
					spot.shadow.bias = - 0.0008;

				}

				m.chassis.add( spot, spot.target );
				this.spots.push( spot );

			}

		}

		// Additive "light pool" decal: the only headlight cue on the Low preset
		// (unlit toon) and the rival's cheap headlights elsewhere.
		if ( count === 0 ) {

			poolTex = poolTex || createLightPool();
			const mat = new THREE.MeshBasicNodeMaterial( {
				map: poolTex, color: 0xffe9bd, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0
			} );
			mat.fog = true;
			const geo = new THREE.PlaneGeometry( 8, 26 );
			geo.rotateX( - Math.PI / 2 );
			geo.translate( 0, 0.07, zFront + 12.5 );
			this.pool = new THREE.Mesh( geo, mat );
			this.pool.renderOrder = 3;
			this.pool.name = 'lightPool';
			this.root.add( this.pool );

		}

	}

	setHeadlights( on ) {

		this.headlightsOn = on;
		this.model.setHeadlights( on );

	}

	reset( s, lateral = 0, speed = 0 ) {

		this.physics.reset( s, lateral, speed );
		this.sync( 0 );

	}

	// Place the visual car on the road surface: yaw + road normal + body roll/pitch.
	sync( dt ) {

		const p = this.physics, pr = p.proj;
		this.root.position.set( p.x, p.y, p.z );
		_T.set( pr.fx, pr.grade, pr.fz ).normalize();
		_L.set( pr.lx, - Math.tan( pr.bank ), pr.lz ).normalize();
		_N.crossVectors( _T, _L ).normalize();
		_qt.setFromUnitVectors( _up, _N );
		_qy.setFromAxisAngle( _up, p.heading );
		this.root.quaternion.copy( _qt ).multiply( _qy );

		// gutter drop: wheels in the U-gutter sit lower and the body leans in
		const m = this.model;
		const drop = p.inGutter.map( ( g ) => ( g ? 0.12 : 0 ) );
		for ( let i = 0; i < 4; i ++ ) m.wheelDrop[ i ] += ( drop[ i ] - m.wheelDrop[ i ] ) * Math.min( 1, dt * 18 );
		const leftDrop = ( m.wheelDrop[ 0 ] + m.wheelDrop[ 2 ] ) * 0.5, rightDrop = ( m.wheelDrop[ 1 ] + m.wheelDrop[ 3 ] ) * 0.5;
		const gutterRoll = ( rightDrop - leftDrop ) / this.spec.track; // left down -> negative roll about z
		m.chassis.rotation.set( p.pitch, 0, p.roll + gutterRoll * 0.8, 'YXZ' );
		m.chassis.position.y = - ( leftDrop + rightDrop ) * 0.25 + Math.sin( p.odometer * 2.1 ) * 0.004 * clamp( p.speed / 30, 0, 1 );

		m.update( dt, {
			steerAngle: p.steerAngle, wheelSpin: p.wheelSpin, brake: p.controls.brake,
			reversing: p.gear === - 1, discHeat: p.discHeat
		} );

		const head = m.uniforms.head.value;
		for ( const s of this.spots ) s.intensity = head * 110;
		if ( this.pool ) this.pool.material.opacity = head * 0.55;

	}

	get telemetry() {

		return this.physics.telemetry;

	}

}
