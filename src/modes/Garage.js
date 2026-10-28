import * as THREE from 'three/webgpu';
import { uniform, uv } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CarModel } from '../vehicle/CarModel.js';
import { CARS, CAR_IDS } from '../vehicle/carSpecs.js';
import { toonMaterial } from '../render/toon.js';
import { createSky, FOG_COLOR } from '../render/sky.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { Petals } from '../fx/Petals.js';
import { buildGarageSet, ROOM } from './GarageSet.js';
import { settings, setSetting, progress, saveProgress } from '../core/settings.js';

// Interactive showroom: a tuner garage with the roll-up door open onto a
// moonlit cherry tree. Mouse/touch orbit on flatscreens; 1:1 room-scale
// walkaround in VR (the car sits at the local-floor origin so you can
// physically walk around it).
export class Garage {

	constructor( renderSystem, quality ) {

		this.rs = renderSystem;
		this.quality = quality;
		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2( FOG_COLOR.getHex(), 0.012 );
		this.scene.background = FOG_COLOR.clone();
		this.camera = new THREE.PerspectiveCamera( 46, window.innerWidth / window.innerHeight, 0.05, 600 );
		this.camera.position.set( 4.2, 1.3, 5.3 );
		this.rig = new THREE.Group();
		this.rig.add( this.camera );
		this.scene.add( this.rig );
		this.turntable = new THREE.Group();
		this.scene.add( this.turntable );
		this.spin = true;
		this.inspect = false;
		this.headlights = true; // the showroom shot: pop-ups up, beams on
		this._build();
		this.setCar( settings.car, settings.livery[ settings.car ] ?? 0 );

	}

	_build() {

		const s = this.scene, q = this.quality;
		this.sky = createSky();
		s.add( this.sky );
		const set = buildGarageSet( q );
		s.add( set.group );
		this.set = set;
		// turntable plate (rotates with the car); the glowing ring stays put
		const plate = new GeoBuilder( { color: true } );
		plate.setColor( 0x3a3846 );
		plate.addGeometry( new THREE.CylinderGeometry( 2.95, 2.98, 0.08, 64 ), new THREE.Matrix4().makeTranslation( 0, 0.04, 0 ) );
		plate.setColor( 0x2c2a35 );
		for ( let i = 0; i < 12; i ++ ) {

			const a = ( i / 12 ) * Math.PI * 2;
			plate.addGeometry( new THREE.BoxGeometry( 0.02, 0.005, 2.9 ).translate( 0, 0.082, 1.45 ), new THREE.Matrix4().makeRotationY( a ) );

		}

		plate.addGeometry( new THREE.RingGeometry( 1.2, 1.24, 48 ).rotateX( - Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0.083, 0 ) );
		const plateMesh = new THREE.Mesh( plate.build(), toonMaterial( { vertexColors: true, rim: 0.2 } ) );
		plateMesh.receiveShadow = true;
		this.turntable.add( plateMesh );

		// a few petals drift in through the open door
		this.petals = new Petals( Math.round( q.petals * 0.25 ) );
		this.petals.uSize.value.set( 22, 10, 22 );
		s.add( this.petals.mesh );

		this.controls = new OrbitControls( this.camera, this.rs.renderer.domElement );
		this.controls.target.set( 0, 0.6, 0 );
		this.controls.enableDamping = true;
		this.controls.minDistance = 3.2;
		this.controls.maxDistance = ROOM.w - 1.2; // stay inside the garage
		this.controls.maxPolarAngle = Math.PI * 0.49;
		this.controls.enablePan = false;
		this.controls.addEventListener( 'start', () => {

			this.spin = false;

		} );
		this.controls.enabled = false;

	}

	setCar( id, liveryIndex = 0 ) {

		if ( this.car ) {

			this.turntable.remove( this.car.root );
			this.car.dispose();

		}

		this.carId = id;
		this.liveryIndex = liveryIndex;
		this.car = new CarModel( CARS[ id ], liveryIndex, this.quality );
		this.car.root.position.y = 0.085; // on the turntable plate
		this.turntable.add( this.car.root );
		this.car.setHeadlights( this.headlights );
		this._addBeams();
		this.applyWear();
		setSetting( 'car', id );

	}

	// Showroom-only headlight beams: soft additive cones out of each lamp plus
	// one forward spot (lit presets) that throws a warm pool onto the floor.
	_addBeams() {

		const car = this.car, spec = CARS[ this.carId ];
		const lamp = spec.popup ?? spec.headlamps;
		const head = car.uniforms.head;
		if ( ! this.beamMat ) {

			const m = new THREE.MeshBasicNodeMaterial( { color: 0xffe2a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
			m.fog = false;
			this.beamHead = uniform( 0 );
			m.opacityNode = uv().y.pow( 3 ).mul( this.beamHead ).mul( 0.13 );
			this.beamMat = m;

		}

		const len = 3.4;
		const geo = new THREE.ConeGeometry( 0.85, len, 20, 1, true ).translate( 0, - len / 2, 0 ).rotateX( - Math.PI / 2 );
		const y = spec.popup ? car.popups.position.y + 0.06 : car.headAnchors[ 0 ].position.y;
		const z = car.zOf( spec.popup ? spec.popup.f + spec.popup.d * 0.4 : 0.04 );
		for ( const sx of [ 1, - 1 ] ) {

			const beam = new THREE.Mesh( geo, this.beamMat );
			beam.position.set( sx * lamp.x, y, z );
			beam.rotation.x = 0.13; // aimed slightly down at the floor
			beam.renderOrder = 2;
			car.chassis.add( beam );

		}

		if ( this.quality.toon !== 'unlit' ) {

			const spot = new THREE.SpotLight( 0xffe0b0, 0, 14, 0.55, 0.6, 1.2 );
			spot.position.set( 0, y, z );
			spot.target.position.set( 0, 0, z + 6 );
			car.chassis.add( spot, spot.target );
			this.headSpot = spot;

		}

		this._head = head;

	}

	nextCar( dir = 1 ) {

		const i = CAR_IDS.indexOf( this.carId );
		const id = CAR_IDS[ ( i + dir + CAR_IDS.length ) % CAR_IDS.length ];
		this.setCar( id, settings.livery[ id ] ?? 0 );
		return id;

	}

	setLivery( i ) {

		this.liveryIndex = i;
		this.car.setLivery( i );
		settings.livery = { ...settings.livery, [ this.carId ]: i };
		setSetting( 'livery', settings.livery );

	}

	toggleHeadlights() {

		this.headlights = ! this.headlights;
		this.car.setHeadlights( this.headlights );
		return this.headlights;

	}

	applyWear() {

		const w = progress.tireWear[ this.carId ] || [ 0, 0, 0, 0 ];
		this.car.uniforms.wear.value = Math.max( ...w );

	}

	replaceTires() {

		progress.tireWear[ this.carId ] = [ 0, 0, 0, 0 ];
		saveProgress();
		this.applyWear();

	}

	setInspect( on ) {

		this.inspect = on;
		this.spin = ! on && this.spin;

	}

	enter() {

		this.controls.enabled = ! this.rs.xrPresenting;
		this.rs.setCamera( this.camera );

	}

	leave() {

		this.controls.enabled = false;

	}

	update( dt ) {

		if ( this.spin && ! this.inspect ) this.turntable.rotation.y += dt * 0.25;
		if ( this.inspect ) {

			// glide to a low three-quarter view of the front-left tyre
			const target = new THREE.Vector3( 2.2, 0.55, 2.6 );
			this.turntable.rotation.y += ( - 0.5 - this.turntable.rotation.y ) * Math.min( 1, dt * 3 );
			this.camera.position.lerp( target, Math.min( 1, dt * 2.5 ) );
			this.controls.target.lerp( new THREE.Vector3( 0.8, 0.35, 1.0 ), Math.min( 1, dt * 2.5 ) );

		}

		if ( ! this.rs.xrPresenting ) this.controls.update();
		// compose the car right of centre, clear of the vehicle-select column
		const off = ! this.rs.xrPresenting && this.camera.aspect > 1.2 ? - 5 : 0;
		if ( this.camera.filmOffset !== off ) {

			this.camera.filmOffset = off;
			this.camera.updateProjectionMatrix();

		}

		this.car.update( dt, { steerAngle: this.inspect ? 0.45 : 0.25, wheelSpin: 0, brake: 0, discHeat: 0 } );
		const head = this.car.uniforms.head.value;
		this.beamHead.value = head;
		if ( this.headSpot ) this.headSpot.intensity = head * 14;
		const camPos = new THREE.Vector3();
		this.camera.getWorldPosition( camPos );
		this.sky.position.copy( camPos );
		this.sky.scale.setScalar( 500 );
		this.petals.update( camPos, [] );

	}

	// VR: car at the floor origin; the player starts 2.6 m away, facing it.
	enterVR() {

		this.turntable.rotation.y = 0.6;
		this.spin = false;
		this.rig.position.set( 0, 0, 2.8 );
		this.rig.rotation.set( 0, 0, 0 );
		this.camera.position.set( 0, 0, 0 );
		this.camera.rotation.set( 0, 0, 0 );

	}

	exitVR() {

		this.rig.position.set( 0, 0, 0 );
		this.camera.position.set( 4.2, 1.3, 5.3 );
		this.controls.target.set( 0, 0.6, 0 );

	}

}

export function carStats( id ) {

	const c = CARS[ id ];
	const peak = c.engine.torque.reduce( ( m, [ rpm, t ] ) => Math.max( m, ( t * rpm ) / 7127 ), 0 );
	const clamp01 = ( v ) => Math.max( 0.05, Math.min( 1, v ) );
	return {
		name: c.name, code: c.code, years: c.years, blurb: c.blurb,
		power: Math.round( peak ), mass: c.mass, layout: `FR · RHD · ${c.popup ? 'Pop-ups' : 'Projectors'}`,
		engine: c.engine.label, redline: c.engine.redline,
		// 0..1 bars for the vehicle-select spec panel
		powerBar: clamp01( peak / 300 ), weightBar: clamp01( c.mass / 1400 ),
		driftBar: clamp01( c.ratings?.drift ?? 0.7 ), gripBar: clamp01( c.ratings?.grip ?? 0.7 )
	};

}
