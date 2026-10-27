import * as THREE from 'three/webgpu';
import { clamp, lerp, damp } from '../core/math.js';

const RATE = 30;
const STRIDE = 30;
// frame layout per car
const F = {
	x: 0, y: 1, z: 2, qx: 3, qy: 4, qz: 5, qw: 6, pitch: 7, roll: 8, cy: 9,
	steer: 10, spin: 11, rpm: 12, thr: 13, brk: 14, rs: 15, fs: 16, vx: 17, vz: 18, gear: 19,
	ws: 20, hb: 21, head: 22, scrape: 23, wall: 24, disc: 25, g0: 26, g1: 27, g2: 28, g3: 29
};

// Records every car at 30 Hz during the run.
export class ReplayRecorder {

	constructor( cars ) {

		this.cars = cars;
		this.frames = 0;
		this.capacity = 30 * 60 * 4;
		this.data = cars.map( () => new Float32Array( this.capacity * STRIDE ) );
		this.acc = 0;
		this.events = [];
		this.recording = false;

	}

	start() {

		this.frames = 0;
		this.acc = 0;
		this.events.length = 0;
		this.recording = true;

	}

	stop() {

		this.recording = false;

	}

	get duration() {

		return Math.max( 0, ( this.frames - 1 ) / RATE );

	}

	update( dt ) {

		if ( ! this.recording ) return;
		this.acc += dt;
		while ( this.acc >= 1 / RATE ) {

			this.acc -= 1 / RATE;
			this._capture();

		}

	}

	mark( type, data = {} ) {

		this.events.push( { t: this.duration, type, ...data } );

	}

	_capture() {

		if ( this.frames >= this.capacity ) {

			this.capacity *= 2;
			this.data = this.data.map( ( d ) => {

				const n = new Float32Array( this.capacity * STRIDE ); n.set( d ); return n;

			} );

		}

		this.cars.forEach( ( car, ci ) => {

			const d = this.data[ ci ], o = this.frames * STRIDE;
			const p = car.physics, r = car.root, m = car.model;
			d[ o + F.x ] = r.position.x; d[ o + F.y ] = r.position.y; d[ o + F.z ] = r.position.z;
			d[ o + F.qx ] = r.quaternion.x; d[ o + F.qy ] = r.quaternion.y; d[ o + F.qz ] = r.quaternion.z; d[ o + F.qw ] = r.quaternion.w;
			d[ o + F.pitch ] = m.chassis.rotation.x; d[ o + F.roll ] = m.chassis.rotation.z; d[ o + F.cy ] = m.chassis.position.y;
			d[ o + F.steer ] = p.steerAngle; d[ o + F.spin ] = p.wheelSpin; d[ o + F.rpm ] = p.rpm;
			d[ o + F.thr ] = p.controls.throttle; d[ o + F.brk ] = p.controls.brake;
			d[ o + F.rs ] = p.rearSlip; d[ o + F.fs ] = p.frontSlip; d[ o + F.vx ] = p.vx; d[ o + F.vz ] = p.vz;
			d[ o + F.gear ] = p.gear; d[ o + F.ws ] = p.wheelspinAmt; d[ o + F.hb ] = p.controls.handbrake;
			d[ o + F.head ] = m.popupAngle; d[ o + F.scrape ] = p.scrape; d[ o + F.wall ] = p.wallImpact; d[ o + F.disc ] = p.discHeat;
			for ( let k = 0; k < 4; k ++ ) d[ o + F.g0 + k ] = m.wheelDrop[ k ];

		} );
		this.frames ++;

	}

}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

// Plays a recording back onto the same Car objects (physics is bypassed;
// fields that audio/FX read are filled in so they keep working).
export class ReplayPlayer {

	constructor( recorder, cars, track, field ) {

		this.rec = recorder;
		this.cars = cars;
		this.track = track;
		this.time = 0;
		this.speed = 1;
		this.playing = true;
		this.slowmo = 1;
		this.focus = 0;
		this.camMode = 'director';
		this.director = new Director( track, field );
		this.loop = true;

	}

	get duration() {

		return this.rec.duration;

	}

	seek( t ) {

		this.time = clamp( t, 0, this.duration );

	}

	update( dt ) {

		const scale = this.playing ? this.speed * this.slowmo : 0;
		this.time += dt * scale;
		if ( this.time >= this.duration ) {

			if ( this.loop ) this.time = 0;
			else {

				this.time = this.duration; this.playing = false;

			}

		}

		this.apply( this.time );
		return scale;

	}

	apply( t ) {

		const f = clamp( t * RATE, 0, Math.max( 0, this.rec.frames - 1.001 ) );
		const i = Math.floor( f ), a = f - i;
		this.cars.forEach( ( car, ci ) => {

			const d = this.rec.data[ ci ];
			const o0 = i * STRIDE, o1 = Math.min( this.rec.frames - 1, i + 1 ) * STRIDE;
			const L = ( k ) => lerp( d[ o0 + k ], d[ o1 + k ], a );
			const r = car.root, m = car.model, p = car.physics;
			r.position.set( L( F.x ), L( F.y ), L( F.z ) );
			_qa.set( d[ o0 + F.qx ], d[ o0 + F.qy ], d[ o0 + F.qz ], d[ o0 + F.qw ] );
			_qb.set( d[ o1 + F.qx ], d[ o1 + F.qy ], d[ o1 + F.qz ], d[ o1 + F.qw ] );
			r.quaternion.slerpQuaternions( _qa, _qb, a );
			m.chassis.rotation.set( L( F.pitch ), 0, L( F.roll ), 'YXZ' );
			m.chassis.position.y = L( F.cy );
			for ( let k = 0; k < 4; k ++ ) m.wheelDrop[ k ] = L( F.g0 + k );
			// feed audio / FX-facing state
			p.x = r.position.x; p.y = r.position.y; p.z = r.position.z;
			p.steerAngle = L( F.steer ); p.wheelSpin = L( F.spin ); p.rpm = L( F.rpm );
			p.controls.throttle = L( F.thr ); p.controls.brake = L( F.brk ); p.controls.handbrake = L( F.hb );
			p.rearSlip = L( F.rs ); p.frontSlip = L( F.fs ); p.vx = L( F.vx ); p.vz = L( F.vz );
			p.gear = Math.round( d[ o0 + F.gear ] ); p.wheelspinAmt = L( F.ws ); p.scrape = L( F.scrape ); p.wallImpact = L( F.wall );
			p.discHeat = L( F.disc );
			p.heading = Math.atan2( 2 * ( r.quaternion.w * r.quaternion.y + r.quaternion.x * r.quaternion.z ), 1 - 2 * ( r.quaternion.y ** 2 + r.quaternion.z ** 2 ) );
			p.slipAngle = 0;
			p.inGutter = [ 0, 1, 2, 3 ].map( ( k ) => m.wheelDrop[ k ] > 0.06 );
			const pr = this.track.project( p.x, p.z, p.trackHint, p.proj );
			p.trackHint = pr.index; p.s = pr.s; p.lateral = pr.lateral;
			m.popupTarget = m.popupAngle = L( F.head );
			m.update( 0, { steerAngle: p.steerAngle, wheelSpin: p.wheelSpin, brake: p.controls.brake, reversing: p.gear === - 1, discHeat: p.discHeat } );
			const head = m.uniforms.head.value;
			for ( const s of car.spots ) s.intensity = head * 42;
			if ( car.pool ) car.pool.material.opacity = head * 0.55;

		} );

	}

	// Camera for the current frame.
	updateCamera( camera, dt, cockpitEye ) {

		const car = this.cars[ this.focus ];
		const res = this.director.update( camera, dt, car, this.camMode, this.time, cockpitEye );
		this.slowmo = res.slowmo;
		return res;

	}

}

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

// Cinematic camera director: drone tracking, roadside spotter angles, chase,
// onboard, and slow-motion apex captures in auto mode.
class Director {

	constructor( track, field ) {

		this.track = track;
		this.field = field;
		this.spots = [];
		// roadside camera positions on the outside of corners (and a few on straights)
		for ( let i = 20; i < track.count - 20; i += 18 ) {

			const k = track.curv[ i ];
			const side = Math.abs( k ) > 0.004 ? - Math.sign( k ) : ( i % 36 ? 1 : - 1 );
			const wall = side > 0 ? track.wallL[ i ] : track.wallR[ i ];
			const lat = side * ( wall + 1.8 );
			const p = track.pointAt( i * track.spacing, 0 );
			const x = p.x + p.lx * lat, z = p.z + p.lz * lat;
			// never inside a cut: stand on the bank if the ground is higher than the road
			const ground = field ? field.height( x, z ) : p.y;
			const y = Math.max( p.y + 1.4 + ( i % 3 ) * 0.9, ground + 1.6 );
			this.spots.push( { s: i * track.spacing, pos: new THREE.Vector3( x, y, z ), apex: Math.abs( k ) > 1 / 30 } );

		}

		this.mode = 'drone';
		this.modeTimer = 0;
		this.spot = null;
		this.dronePos = new THREE.Vector3();
		this.droneAng = 0;
		this.camPos = new THREE.Vector3();
		this.look = new THREE.Vector3();
		this.slowmo = 1;
		this.slowTimer = 0;
		this.lastSlowS = - 1e9;
		this.initialized = false;

	}

	_pickSpot( s ) {

		// the next roadside camera ahead of the car
		let best = null;
		for ( const sp of this.spots ) {

			if ( sp.s > s + 8 && sp.s < s + 160 && ( ! best || sp.s < best.s ) ) best = sp;

		}

		return best;

	}

	update( camera, dt, car, requested, time, cockpitEye ) {

		const p = car.physics, root = car.root;
		const s = p.s;
		let mode = requested;
		if ( requested === 'director' ) {

			this.modeTimer -= dt;
			const k = Math.abs( this.track.curv[ this.track.indexAt( s + 30 ) ] );
			if ( this.modeTimer <= 0 ) {

				const r = Math.random();
				this.mode = k > 1 / 40 ? ( r < 0.6 ? 'spotter' : 'drone' ) : ( r < 0.35 ? 'chase' : r < 0.7 ? 'drone' : 'spotter' );
				if ( r > 0.9 ) this.mode = 'onboard';
				this.modeTimer = 4 + Math.random() * 3;
				this.spot = null;

			}

			mode = this.mode;
			// slow-motion apex capture: big slip in a tight corner
			const kNow = Math.abs( this.track.curv[ this.track.indexAt( s ) ] );
			if ( this.slowTimer <= 0 && kNow > 1 / 30 && Math.abs( p.rearSlip ) > 0.18 && s - this.lastSlowS > 250 ) {

				this.slowTimer = 1.8;
				this.lastSlowS = s;
				this.mode = mode = 'spotter';
				this.spot = this._nearestSpot( s );
				this.modeTimer = 3;

			}

		}

		if ( this.slowTimer > 0 ) {

			this.slowTimer -= dt;
			this.slowmo = damp( this.slowmo, 0.3, 6, dt );

		} else this.slowmo = damp( this.slowmo, 1, 4, dt );
		if ( requested !== 'director' ) this.slowmo = 1;

		_t.set( 0, 0.7, 0 );
		root.localToWorld( _t );
		const heading = p.heading;
		const fwd = _v.set( Math.sin( heading ), 0, Math.cos( heading ) );
		let fov = 55;
		if ( mode === 'chase' ) {

			const want = _t.clone().addScaledVector( fwd, - 6.5 ).add( new THREE.Vector3( 0, 2.2, 0 ) );
			this.camPos.lerp( want, this.initialized ? Math.min( 1, dt * 5 ) : 1 );
			this.look.copy( _t ).addScaledVector( fwd, 3 );

		} else if ( mode === 'drone' ) {

			this.droneAng += dt * 0.25;
			const off = new THREE.Vector3( Math.sin( heading + Math.PI + Math.sin( this.droneAng ) * 0.9 ) * 13, 7.5, Math.cos( heading + Math.PI + Math.sin( this.droneAng ) * 0.9 ) * 13 );
			const want = _t.clone().add( off );
			if ( this.field ) want.y = Math.max( want.y, this.field.height( want.x, want.z ) + 3 );
			this.camPos.lerp( want, this.initialized ? Math.min( 1, dt * 2 ) : 1 );
			this.look.lerp( _t, this.initialized ? Math.min( 1, dt * 6 ) : 1 );
			fov = 48;

		} else if ( mode === 'spotter' ) {

			if ( ! this.spot || this.spot.s < s - 25 ) this.spot = this._pickSpot( s ) || this._nearestSpot( s );
			this.camPos.copy( this.spot.pos );
			this.look.lerp( _t, this.initialized ? Math.min( 1, dt * 8 ) : 1 );
			const dist = this.camPos.distanceTo( _t );
			fov = clamp( 2 * Math.atan( 5.5 / dist ) * 180 / Math.PI, 10, 60 );

		} else {

			// onboard
			if ( cockpitEye ) cockpitEye.getWorldPosition( this.camPos );
			this.look.copy( this.camPos ).addScaledVector( fwd, 10 );
			fov = 70;

		}

		this.initialized = true;
		camera.position.copy( this.camPos );
		camera.lookAt( this.look );
		if ( Math.abs( camera.fov - fov ) > 0.1 ) {

			camera.fov = damp( camera.fov, fov, 6, dt );
			camera.updateProjectionMatrix();

		}

		return { mode, slowmo: this.slowmo };

	}

	_nearestSpot( s ) {

		let best = this.spots[ 0 ];
		for ( const sp of this.spots ) if ( Math.abs( sp.s - s ) < Math.abs( best.s - s ) ) best = sp;
		return best;

	}

}
