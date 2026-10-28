import * as THREE from 'three/webgpu';
import { Car } from '../vehicle/Car.js';
import { AIDriver } from '../vehicle/AIDriver.js';
import { CARS } from '../vehicle/carSpecs.js';
import { clamp, damp } from '../core/math.js';

const STEP = 1 / 120;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Attract mode behind the title menu: the AE86 and the FD3S battle through
// the hairpins on the real mountain while a cinematic camera cuts between
// a low tracking shot from ahead, a low rear three-quarter, a roadside
// spotter and a helicopter pass. Cars are composed right of centre so the
// menu on the left never covers them.
export class TitleDemo {

	constructor( world, scene, quality ) {

		this.track = world.track;
		this.field = world.field;
		this.scene = scene;
		const q = quality;
		this.cars = [
			new Car( CARS.ae86, 0, this.track, q, { spotlights: q.headlightSpots >= 2 ? 2 : 0 } ),
			new Car( CARS.fd3s, 0, this.track, q, { spotlights: 0 } )
		];
		this.ais = this.cars.map( ( c, i ) => new AIDriver( c.physics, this.track, { skill: i ? 0.97 : 1, style: 'drift' } ) );
		for ( const c of this.cars ) {

			c.physics.assist = 0.35;
			c.setHeadlights( true );

		}

		const tg = this.track.tags;
		// entry points ~130 m before the best corners
		this.segments = [ tg.hairpin1, tg.carousel, tg.hairpin2, tg.fiveHairpins, tg.fiveHairpins + 260 ]
			.filter( ( s ) => s != null ).map( ( s ) => s - 130 );
		this.seg = 0;
		this.acc = 0;
		this.active = false;
		this.shot = 'front';
		this.shotTimer = 0;
		this.shotIndex = 0;
		this.camPos = new THREE.Vector3();
		this.look = new THREE.Vector3();
		this.fov = 40;
		this.cut = true;
		this.stuck = 0;

	}

	start() {

		if ( this.active ) return;
		this.active = true;
		for ( const c of this.cars ) this.scene.add( c.root );
		this._reset( this.seg );

	}

	stop() {

		if ( ! this.active ) return;
		this.active = false;
		for ( const c of this.cars ) this.scene.remove( c.root );

	}

	_reset( k ) {

		this.seg = k % this.segments.length;
		const s = this.segments[ this.seg ];
		const t = this.track;
		const lat = t.racingLine[ t.indexAt( s ) ];
		const v = Math.min( 24, t.speedProfile[ t.indexAt( s ) ] * 0.9 );
		this.cars[ 0 ].reset( s, lat, v );
		this.cars[ 1 ].reset( s - 11, lat - 1.2, v );
		this.segStart = s;
		this.stuck = 0;
		this.shotTimer = 0; // force a fresh shot on every reset
		this.cut = true;

	}

	update( dt, camera ) {

		if ( ! this.active ) return 0;
		const [ lead, chaser ] = this.cars;
		this.acc += dt;
		let n = 0;
		while ( this.acc >= STEP && n < 8 ) {

			this.ais[ 0 ].update( STEP, { raceActive: true, other: { s: chaser.physics.s, lateral: chaser.physics.lateral } } );
			this.ais[ 1 ].update( STEP, { raceActive: true, playerS: lead.physics.s, other: { s: lead.physics.s, lateral: lead.physics.lateral } } );
			for ( const c of this.cars ) {

				c.physics.applyAutoReverseControls();
				c.physics.step( STEP );
				c.physics.events.length = 0;

			}

			this.acc -= STEP;
			n ++;

		}

		if ( n >= 8 ) this.acc = 0;
		for ( const c of this.cars ) c.sync( dt );

		// loop the battle through the next corner sequence
		const sLead = Math.max( lead.physics.s, chaser.physics.s );
		this.stuck = lead.physics.speed < 3 || chaser.physics.speed < 3 ? this.stuck + dt : 0;
		if ( sLead - this.segStart > 430 || this.stuck > 2 || sLead > this.track.finishS - 30 ) this._reset( this.seg + 1 );

		this._camera( dt, camera );
		return Math.max( lead.telemetry.drift, chaser.telemetry.drift );

	}

	_camera( dt, camera ) {

		const SHOTS = [ 'front', 'spotter', 'rear', 'heli', 'front', 'side' ];
		this.shotTimer -= dt;
		if ( this.shotTimer <= 0 ) {

			this.shot = SHOTS[ this.shotIndex ++ % SHOTS.length ];
			this.shotTimer = this.shot === 'spotter' ? 4.2 : 5;
			this.cut = true;
			this.spot = null;

		}

		const t = this.track;
		const [ lead, chaser ] = this.cars;
		const front = lead.physics.s >= chaser.physics.s ? lead : chaser;
		const back = front === lead ? chaser : lead;
		// look between both cars, biased to the leader
		front.root.getWorldPosition( _a );
		back.root.getWorldPosition( _b );
		const mid = _c.copy( _a ).lerp( _b, 0.35 );
		mid.y += 0.7;
		const pf = front.physics;
		const fwd = new THREE.Vector3( Math.sin( pf.heading ), 0, Math.cos( pf.heading ) );
		const pr = t.pointAt( pf.s );
		const lx = pr.lx, lz = pr.lz;
		const k = t.curv[ t.indexAt( pf.s + 20 ) ];
		const outside = k > 0 ? - 1 : 1; // stand on the outside of the coming bend
		let want = new THREE.Vector3(), fov = 40, lerpK = 4;

		if ( this.shot === 'front' ) {

			// low tracking shot from ahead, cars drifting toward the lens
			const p = t.pointAt( pf.s + 15, pf.lateral + outside * 2.2 );
			want.set( p.x, p.y + 0.85, p.z );
			fov = 38; lerpK = 3;

		} else if ( this.shot === 'rear' ) {

			want.copy( _a ).addScaledVector( fwd, - 7.5 );
			want.x += lx * outside * 2.4; want.z += lz * outside * 2.4;
			want.y += 1.15;
			fov = 46; lerpK = 5;

		} else if ( this.shot === 'side' ) {

			const p = t.pointAt( pf.s - 2, outside * ( Math.max( t.wallL[ t.indexAt( pf.s ) ], 4 ) + 4 ) );
			want.set( p.x, p.y + 1.3, p.z );
			fov = 34; lerpK = 2.5;

		} else if ( this.shot === 'heli' ) {

			const p = t.pointAt( pf.s + 4, outside * 16 );
			want.set( p.x, p.y + 11, p.z );
			fov = 42; lerpK = 2;

		} else {

			// roadside spotter on the outside of the next corner, long lens
			if ( ! this.spot ) {

				const s = pf.s + 55;
				const ii = t.indexAt( s );
				const side = t.curv[ ii ] > 0 ? - 1 : 1;
				const wall = side > 0 ? t.wallL[ ii ] : t.wallR[ ii ];
				const p = t.pointAt( s, side * ( wall + 2 ) );
				const ground = this.field ? this.field.height( p.x, p.z ) : p.y;
				this.spot = new THREE.Vector3( p.x, Math.max( p.y + 1.6, ground + 1.7 ), p.z );

			}

			want.copy( this.spot );
			fov = clamp( 2 * Math.atan( 6.5 / Math.max( 1, want.distanceTo( mid ) ) ) * 57.3, 12, 50 );
			lerpK = 100;

		}

		if ( this.field && this.shot !== 'spotter' ) want.y = Math.max( want.y, this.field.height( want.x, want.z ) + 0.6 );
		if ( this.cut ) {

			this.camPos.copy( want );
			this.look.copy( mid );
			this.fov = fov;
			this.cut = false;

		} else {

			this.camPos.lerp( want, 1 - Math.exp( - dt * lerpK ) );
			this.look.lerp( mid, 1 - Math.exp( - dt * 8 ) );
			this.fov = damp( this.fov, fov, 3, dt );

		}

		camera.position.copy( this.camPos );
		camera.lookAt( this.look );
		// frame the action right of centre (the menu sits on the left)
		const aspect = camera.aspect || 1.6;
		if ( aspect > 1.1 ) camera.rotateY( THREE.MathUtils.degToRad( this.fov * aspect * 0.16 ) );
		if ( Math.abs( camera.fov - this.fov ) > 0.05 ) {

			camera.fov = this.fov;
			camera.updateProjectionMatrix();

		}

	}

}
