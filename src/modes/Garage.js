import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CarModel } from '../vehicle/CarModel.js';
import { CARS, CAR_IDS } from '../vehicle/carSpecs.js';
import { toonMaterial, emissiveMaterial, uMoonDir } from '../render/toon.js';
import { createSky, FOG_COLOR } from '../render/sky.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { Petals } from '../fx/Petals.js';
import { mulberry32 } from '../core/math.js';
import { settings, setSetting, progress, saveProgress } from '../core/settings.js';

// Interactive showroom under a moonlit cherry blossom tree. Mouse/touch orbit
// on flatscreens; 1:1 room-scale walkaround in VR (the car sits at the
// local-floor origin so you can physically walk around it).
export class Garage {

	constructor( renderSystem, quality ) {

		this.rs = renderSystem;
		this.quality = quality;
		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2( FOG_COLOR.getHex(), 0.012 );
		this.scene.background = FOG_COLOR.clone();
		this.camera = new THREE.PerspectiveCamera( 42, window.innerWidth / window.innerHeight, 0.05, 600 );
		this.camera.position.set( 4.6, 1.7, 5.2 );
		this.rig = new THREE.Group();
		this.rig.add( this.camera );
		this.scene.add( this.rig );
		this.turntable = new THREE.Group();
		this.scene.add( this.turntable );
		this.spin = true;
		this.inspect = false;
		this._build();
		this.setCar( settings.car, settings.livery[ settings.car ] ?? 0 );

	}

	_build() {

		const s = this.scene, q = this.quality;
		this.sky = createSky();
		s.add( this.sky );
		const moon = new THREE.DirectionalLight( 0xd6d0ff, q.toon === 'unlit' ? 0 : 1.6 );
		moon.position.copy( uMoonDir.value ).multiplyScalar( 30 );
		s.add( moon );
		if ( q.toon !== 'unlit' ) s.add( new THREE.HemisphereLight( 0xa08ce8, 0x3a2a48, 1.3 ) );
		// key light from the lantern side
		if ( q.toon !== 'unlit' ) {

			const key = new THREE.SpotLight( 0xffd2a8, 60, 30, 0.6, 0.6, 1.2 );
			key.position.set( - 4, 6, 3 );
			key.target.position.set( 0, 0.5, 0 );
			s.add( key, key.target );

		}

		// display platform: stone disc + gravel ring + petal carpet
		const b = new GeoBuilder( { color: true, sway: true } );
		const rng = mulberry32( 7 );
		const disc = new THREE.CylinderGeometry( 4.2, 4.4, 0.18, 48 );
		b.setColor( 0x6d6584 );
		b.addGeometry( disc, new THREE.Matrix4().makeTranslation( 0, 0.09, 0 ) );
		const ground = new THREE.CircleGeometry( 60, 64 ).rotateX( - Math.PI / 2 );
		b.setColor( 0x2f4e4a );
		b.addGeometry( ground, null );
		for ( let i = 0; i < 380; i ++ ) {

			const a = rng() * Math.PI * 2, r = 4.5 + rng() * 9;
			b.setColor( [ 0xf2b3cf, 0xffd3e6, 0xf7a1c8 ][ ( rng() * 3 ) | 0 ] );
			const petal = new THREE.CircleGeometry( 0.08 + rng() * 0.1, 5 ).rotateX( - Math.PI / 2 );
			b.addGeometry( petal, new THREE.Matrix4().makeTranslation( Math.cos( a ) * r, 0.01 + rng() * 0.01, Math.sin( a ) * r ) );

		}

		// the big sakura tree behind the platform
		const tree = new THREE.Matrix4().makeTranslation( - 6.5, 0, - 5 );
		b.setColor( 0x3d2a30 );
		const trunk = new THREE.CylinderGeometry( 0.35, 0.65, 5.5, 8 ).translate( 0, 2.75, 0 );
		b.addGeometry( trunk, tree );
		for ( let i = 0; i < 6; i ++ ) {

			const br = new THREE.CylinderGeometry( 0.12, 0.25, 4, 6 ).translate( 0, 2, 0 );
			const m = new THREE.Matrix4().makeTranslation( - 6.5, 4.2, - 5 ).multiply( new THREE.Matrix4().makeRotationY( i * 1.05 ) ).multiply( new THREE.Matrix4().makeRotationZ( 0.9 ) );
			b.addGeometry( br, m );

		}

		for ( let i = 0; i < 22; i ++ ) {

			const a = rng() * Math.PI * 2, r = rng() * 4.2;
			const puff = new THREE.IcosahedronGeometry( 1.5 + rng() * 1.1, 1 );
			b.setColor( [ 0xffb8d6, 0xff9cc6, 0xffd3e6, 0xf7a1c8 ][ ( rng() * 4 ) | 0 ] );
			b.setSway( 1 );
			b.addGeometry( puff, new THREE.Matrix4().makeTranslation( - 6.5 + Math.cos( a ) * r, 6 + rng() * 2.5, - 5 + Math.sin( a ) * r ).multiply( new THREE.Matrix4().makeScale( 1, 0.75, 1 ) ) );
			b.setSway( 0 );

		}

		// stone lanterns (toro)
		for ( const [ x, z ] of [ [ 3.8, - 3.6 ], [ - 4.4, 3.2 ] ] ) {

			b.setColor( 0x8a8496 );
			const m = new THREE.Matrix4().makeTranslation( x, 0, z );
			b.addGeometry( new THREE.CylinderGeometry( 0.35, 0.45, 0.3, 6 ).translate( 0, 0.15, 0 ), m );
			b.addGeometry( new THREE.CylinderGeometry( 0.12, 0.14, 0.9, 6 ).translate( 0, 0.75, 0 ), m );
			b.addGeometry( new THREE.BoxGeometry( 0.55, 0.45, 0.55 ).translate( 0, 1.4, 0 ), m );
			b.addGeometry( new THREE.ConeGeometry( 0.55, 0.4, 6 ).translate( 0, 1.85, 0 ), m );

		}

		// distant torii
		b.setColor( 0xe8462e );
		const tm = new THREE.Matrix4().makeTranslation( 4, 0, - 14 ).multiply( new THREE.Matrix4().makeRotationY( - 0.4 ) );
		for ( const x of [ - 1.8, 1.8 ] ) b.addGeometry( new THREE.CylinderGeometry( 0.2, 0.24, 4.6, 8 ).translate( x, 2.3, 0 ), tm );
		b.addGeometry( new THREE.BoxGeometry( 5.2, 0.28, 0.4 ).translate( 0, 3.9, 0 ), tm );
		b.setColor( 0x1b1420 );
		b.addGeometry( new THREE.BoxGeometry( 6, 0.32, 0.5 ).translate( 0, 4.7, 0 ), tm );
		const env = new THREE.Mesh( b.build(), toonMaterial( { vertexColors: true, sway: true, rim: 0.3 } ) );
		env.name = 'garageEnv';
		s.add( env );

		// lantern glows
		for ( const [ x, z ] of [ [ 3.8, - 3.6 ], [ - 4.4, 3.2 ] ] ) {

			const g = new THREE.Mesh( new THREE.BoxGeometry( 0.4, 0.3, 0.4 ), emissiveMaterial( 0xffb35a, 2.2 ) );
			g.position.set( x, 1.4, z );
			s.add( g );

		}

		this.petals = new Petals( Math.round( q.petals * 0.4 ) );
		this.petals.uSize.value.set( 26, 14, 26 );
		s.add( this.petals.mesh );

		this.controls = new OrbitControls( this.camera, this.rs.renderer.domElement );
		this.controls.target.set( 0, 0.6, 0 );
		this.controls.enableDamping = true;
		this.controls.minDistance = 3.2;
		this.controls.maxDistance = 11;
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
		this.car.root.position.y = 0.18;
		this.turntable.add( this.car.root );
		this.car.setHeadlights( this.headlights ?? false );
		this.applyWear();
		setSetting( 'car', id );

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
		this.car.update( dt, { steerAngle: this.inspect ? 0.45 : 0.25, wheelSpin: 0, brake: 0, discHeat: 0 } );
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
		this.camera.position.set( 4.6, 1.7, 5.2 );
		this.controls.target.set( 0, 0.6, 0 );

	}

}

export function carStats( id ) {

	const c = CARS[ id ];
	const peak = c.engine.torque.reduce( ( m, [ rpm, t ] ) => Math.max( m, ( t * rpm ) / 7127 ), 0 );
	return {
		name: c.name, code: c.code, years: c.years, blurb: c.blurb,
		power: Math.round( peak ), mass: c.mass, layout: 'FR · RHD · Pop-ups',
		engine: c.engine.type === 'rotary' ? '13B-REW twin-turbo rotary' : '4A-GE 1.6 twin-cam I4',
		redline: c.engine.redline
	};

}
