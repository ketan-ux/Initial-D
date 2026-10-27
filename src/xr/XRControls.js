import * as THREE from 'three/webgpu';
import { clamp, wrapAngle } from '../core/math.js';
import { toonMaterial } from '../render/toon.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

// Meta Quest Touch (Plus) cockpit interactions:
//  - physics-style steering wheel: grab the rim with either grip, one- or
//    two-handed; hand-over-hand works because each hand applies its own
//    angular delta; kinematic angular damping + self-aligning torque
//  - handbrake lever, sequential or H-pattern shifter (grab or slap)
//  - press the pop-up headlight / hazard / HUD switches, tap the phone GPS
//  - analog triggers = throttle (right) and brake (left)
//  - haptics: asphalt grain, gutter clips, oversteer rumble, impacts
export class XRControls {

	constructor( renderer, input ) {

		this.renderer = renderer;
		this.input = input;
		this.state = { active: false, throttle: 0, brake: 0, steer: 0, handbrake: 0 };
		input.xr = this.state;
		this.hands = [];
		for ( let i = 0; i < 2; i ++ ) {

			const grip = renderer.xr.getControllerGrip( i );
			const ray = renderer.xr.getController( i );
			const hand = {
				index: i, grip, ray, source: null, handedness: 'none', glove: makeGlove(),
				squeeze: 0, trigger: 0, wasSqueeze: false, prevButtons: [],
				grabbing: null, grabAngle: 0, grabStart: new THREE.Vector3(), lastPos: new THREE.Vector3(), vel: new THREE.Vector3(),
				shiftArmed: true, pressCooldown: 0, laser: makeLaser()
			};
			grip.add( hand.glove );
			ray.add( hand.laser );
			grip.addEventListener( 'connected', ( e ) => {

				hand.source = e.data;
				hand.handedness = e.data.handedness;
				hand.glove.scale.x = hand.handedness === 'left' ? - 1 : 1;

			} );
			grip.addEventListener( 'disconnected', () => {

				hand.source = null;

			} );
			this.hands.push( hand );

		}

		this.wheelAngle = 0;
		this.wheelVel = 0;
		this.wheelRange = Math.PI * 1.5; // ±270° of wheel rotation = full lock
		this.cockpit = null;
		this.physics = null;
		this.hapticClock = 0;
		this.pointerMode = false; // menus: laser pointers instead of cabin interactions
		this.onSelect = null;

	}

	attach( rig ) {

		for ( const h of this.hands ) rig.add( h.grip, h.ray );

	}

	setCockpit( cockpit, physics ) {

		this.cockpit = cockpit;
		this.physics = physics;
		this.wheelAngle = 0;
		this.wheelVel = 0;

	}

	setPointerMode( on ) {

		this.pointerMode = on;
		for ( const h of this.hands ) h.laser.visible = on;

	}

	_gp( h ) {

		return h.source?.gamepad;

	}

	pulse( hand, intensity, ms ) {

		if ( ! settings.haptics || ! hand?.source?.gamepad ) return;
		const gp = hand.source.gamepad;
		const act = gp.hapticActuators?.[ 0 ];
		try {

			if ( act?.pulse ) act.pulse( clamp( intensity, 0, 1 ), ms );
			else if ( gp.vibrationActuator?.playEffect ) gp.vibrationActuator.playEffect( 'dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity * 0.5 } );

		} catch ( e ) { /* ignore */ }

	}

	pulseAll( intensity, ms, onlyWheel = false ) {

		for ( const h of this.hands ) if ( ! onlyWheel || h.grabbing === 'wheel' ) this.pulse( h, intensity, ms );

	}

	update( dt ) {

		const presenting = this.renderer.xr.isPresenting;
		this.state.active = presenting && ! this.pointerMode;
		if ( ! presenting ) return;

		let right = null, left = null;
		for ( const h of this.hands ) {

			const gp = this._gp( h );
			h.squeeze = gp?.buttons[ 1 ]?.value ?? 0;
			h.trigger = gp?.buttons[ 0 ]?.value ?? 0;
			h.grip.getWorldPosition( _v );
			h.vel.subVectors( _v, h.lastPos ).divideScalar( Math.max( dt, 1e-3 ) );
			h.lastPos.copy( _v );
			h.pressCooldown = Math.max( 0, h.pressCooldown - dt );
			if ( h.handedness === 'right' ) right = h; else if ( h.handedness === 'left' ) left = h;
			// glove pose: curl fingers with grip/trigger
			const curl = Math.max( h.squeeze, h.trigger * 0.6 );
			h.glove.userData.fingers.rotation.x = curl * 1.3;

		}

		// buttons (edge-triggered)
		for ( const h of this.hands ) {

			const gp = this._gp( h );
			if ( ! gp ) continue;
			const edge = ( i ) => {

				const p = !! gp.buttons[ i ]?.pressed;
				const e = p && ! h.prevButtons[ i ];
				h.prevButtons[ i ] = p;
				return e;

			};

			if ( this.pointerMode ) {

				if ( edge( 0 ) ) this.onSelect?.( h );
				edge( 4 ); edge( 5 );
				if ( h.handedness === 'left' && gp.buttons[ 5 ]?.pressed ) this.input.emit( 'pause' );
				continue;

			}

			if ( h.handedness === 'right' ) {

				if ( edge( 4 ) ) this.input.emit( 'shiftUp' ); // A
				edge( 5 ); // B is held for handbrake (read below)
				if ( edge( 3 ) ) this.input.emit( 'headlights' ); // stick click

			} else {

				if ( edge( 4 ) ) this.input.emit( 'shiftDown' ); // X
				if ( edge( 5 ) ) this.input.emit( 'pause' ); // Y
				if ( edge( 3 ) ) bus.emit( 'xr-recenter' ); // stick click

			}

		}

		if ( this.pointerMode || ! this.cockpit ) {

			this.state.throttle = 0; this.state.brake = 0;
			return;

		}

		// analog pedals
		this.state.throttle = right ? right.trigger : 0;
		this.state.brake = left ? left.trigger : 0;

		this._interact( dt );
		this._wheel( dt );
		this._haptics( dt );

	}

	_interact( dt ) {

		const ck = this.cockpit;
		let hb = 0;
		for ( const h of this.hands ) {

			h.grip.getWorldPosition( _v );
			const pressing = h.squeeze > 0.55;
			if ( pressing && ! h.wasSqueeze ) {

				// grab priority: wheel rim, shifter knob, handbrake grip
				const wl = ck.wheel.worldToLocal( _v.clone() );
				const radial = Math.abs( Math.hypot( wl.x, wl.y ) - ck.wheelRadius );
				const knob = ck.shifter.localToWorld( ck.shifterKnobLocal.clone() );
				const hbGrip = ck.handbrake.localToWorld( ck.handbrakeGripLocal.clone() );
				if ( radial < 0.1 && Math.abs( wl.z ) < 0.13 ) {

					h.grabbing = 'wheel';
					h.grabAngle = Math.atan2( wl.y, wl.x );
					this.pulse( h, 0.3, 25 );

				} else if ( _v.distanceTo( knob ) < 0.11 ) {

					h.grabbing = 'shifter';
					h.grabStart.copy( ck.shifter.worldToLocal( _v.clone() ) );
					h.shiftArmed = true;
					this.pulse( h, 0.25, 20 );

				} else if ( _v.distanceTo( hbGrip ) < 0.13 ) {

					h.grabbing = 'handbrake';
					h.grabStart.copy( _v );
					this.pulse( h, 0.25, 20 );

				}

			} else if ( ! pressing && h.wasSqueeze ) {

				if ( h.grabbing === 'shifter' ) ck.shifterOffset.set( 0, 0 );
				h.grabbing = null;

			}

			h.wasSqueeze = pressing;

			if ( h.grabbing === 'handbrake' ) {

				const pull = clamp( ( _v.y - h.grabStart.y ) / 0.14, 0, 1 );
				hb = Math.max( hb, pull );

			}

			if ( h.grabbing === 'shifter' ) this._shifter( h, _v );
			else this._slap( h, _v );

			// fingertip presses on dash switches + phone
			if ( ! h.grabbing && h.pressCooldown <= 0 ) {

				_w.set( 0, - 0.02, - 0.07 ).applyQuaternion( h.grip.getWorldQuaternion( _q ) ).add( _v );
				for ( const [ name, btn ] of Object.entries( ck.buttons ) ) {

					const cap = btn.getWorldPosition( new THREE.Vector3() );
					if ( cap.distanceTo( _w ) < 0.04 ) {

						h.pressCooldown = 0.5;
						ck.pressButton( name );
						this.pulse( h, 0.6, 35 );
						bus.emit( 'cockpit-button', name );

					}

				}

				const ph = ck.phoneScreen.worldToLocal( _w.clone() );
				if ( Math.abs( ph.x ) < 0.08 && Math.abs( ph.y ) < 0.045 && Math.abs( ph.z ) < 0.03 ) {

					h.pressCooldown = 0.6;
					this.pulse( h, 0.35, 20 );
					bus.emit( 'phone-tap' );

				}

			}

		}

		// B button = handbrake fallback
		const right = this.hands.find( ( h ) => h.handedness === 'right' );
		if ( right?.source?.gamepad?.buttons[ 5 ]?.pressed ) hb = 1;
		ck.handbrakePull += ( hb - ck.handbrakePull ) * Math.min( 1, dt * ( hb > ck.handbrakePull ? 30 : 12 ) );
		this.state.handbrake = ck.handbrakePull > 0.15 ? clamp( ck.handbrakePull * 1.2, 0, 1 ) : 0;

	}

	_shifter( h, worldPos ) {

		const ck = this.cockpit, p = this.physics;
		const local = ck.shifter.worldToLocal( worldPos.clone() );
		const dx = local.x - h.grabStart.x, dz = local.z - h.grabStart.z;
		if ( settings.vrShifter === 'hpattern' ) {

			// 5-speed + reverse gate
			const cols = [ 0.045, 0, - 0.045 ];
			const col = cols.reduce( ( a, c ) => ( Math.abs( dx - c ) < Math.abs( dx - a ) ? c : a ), 0 );
			const ox = clamp( dx, - 0.05, 0.05 ), oz = clamp( dz, - 0.05, 0.05 );
			ck.shifterOffset.set( - ox / 0.05, oz / 0.05 );
			if ( Math.abs( dz ) > 0.035 && Math.abs( dx - col ) < 0.02 ) {

				const ci = cols.indexOf( col );
				const g = dz > 0 ? [ 1, 3, 5 ][ ci ] : [ 2, 4, - 1 ][ ci ];
				if ( p.gear !== g ) {

					p.autoShift = false;
					p.setGear( g );
					this.pulse( h, 0.5, 40 );

				}

			}

		} else {

			ck.shifterOffset.set( 0, clamp( dz / 0.05, - 1, 1 ) );
			if ( h.shiftArmed && Math.abs( dz ) > 0.045 ) {

				h.shiftArmed = false;
				// pull back = upshift, push forward = downshift (rally sequential)
				this.input.emit( dz < 0 ? 'shiftUp' : 'shiftDown' );
				this.pulse( h, 0.55, 40 );

			} else if ( Math.abs( dz ) < 0.015 ) h.shiftArmed = true;

		}

	}

	// Open-hand "slap" of the sequential lever, no grab needed.
	_slap( h, worldPos ) {

		const ck = this.cockpit;
		if ( settings.vrShifter !== 'sequential' || h.pressCooldown > 0 ) return;
		const knob = ck.shifter.localToWorld( ck.shifterKnobLocal.clone() );
		if ( worldPos.distanceTo( knob ) > 0.1 ) return;
		const chassis = ck.model.chassis;
		const fwd = new THREE.Vector3( 0, 0, 1 ).transformDirection( chassis.matrixWorld );
		const v = h.vel.dot( fwd );
		if ( Math.abs( v ) > 1.1 ) {

			h.pressCooldown = 0.35;
			this.input.emit( v < 0 ? 'shiftUp' : 'shiftDown' );
			ck.shifterOffset.set( 0, v < 0 ? - 1 : 1 );
			setTimeout( () => ck.shifterOffset.set( 0, 0 ), 140 );
			this.pulse( h, 0.6, 35 );

		}

	}

	_wheel( dt ) {

		const ck = this.cockpit, p = this.physics;
		const range = this.wheelRange / Math.max( 0.3, settings.vrSteerRatio );
		let sum = 0, n = 0;
		for ( const h of this.hands ) {

			if ( h.grabbing !== 'wheel' ) continue;
			h.grip.getWorldPosition( _v );
			const wl = ck.wheel.worldToLocal( _v.clone() );
			const ang = Math.atan2( wl.y, wl.x );
			sum += wrapAngle( ang - h.grabAngle );
			h.grabAngle = ang;
			n ++;

		}

		if ( n > 0 ) {

			// hands drive the wheel; averaging lets both hands share the load,
			// and hand-over-hand works since each hand applies its own delta.
			const delta = - sum / n; // wheel local angle grows clockwise from the driver
			const target = clamp( this.wheelAngle + delta, - range, range );
			const v = ( target - this.wheelAngle ) / Math.max( dt, 1e-3 );
			// kinematic angular damping: limit angular velocity, smooth jitter
			this.wheelVel += ( clamp( v, - 18, 18 ) - this.wheelVel ) * Math.min( 1, dt * 40 );
			this.wheelAngle = clamp( this.wheelAngle + this.wheelVel * dt, - range, range );

		} else {

			// released: self-aligning torque returns the wheel toward the
			// direction of travel (it spins into countersteer during slides)
			const right = this.hands.find( ( h ) => h.handedness === 'right' );
			const stick = right?.source?.gamepad?.axes[ 2 ] ?? 0;
			let target;
			if ( Math.abs( stick ) > 0.15 ) target = - stick * range * 0.8;
			else {

				const speedF = clamp( p.speed / 20, 0, 1 );
				target = ( p.slipAngle / p.spec.steerLock ) * range * speedF;

			}

			const k = Math.abs( stick ) > 0.15 ? 10 : 2 + clamp( p.speed / 10, 0, 6 );
			this.wheelVel += ( ( target - this.wheelAngle ) * k * k * 0.25 - this.wheelVel * k ) * dt;
			this.wheelAngle = clamp( this.wheelAngle + this.wheelVel * dt, - range, range );

		}

		ck.wheelAngle = this.wheelAngle;
		this.state.steer = clamp( this.wheelAngle / range, - 1, 1 );

	}

	_haptics( dt ) {

		const p = this.physics;
		this.hapticClock += dt;
		const onWheel = this.hands.some( ( h ) => h.grabbing === 'wheel' );
		// asphalt granularity: light high-frequency buzz scaled by speed
		if ( this.hapticClock > 0.05 ) {

			this.hapticClock = 0;
			const spd = clamp( p.speed / 45, 0, 1 );
			if ( spd > 0.05 ) this.pulseAll( 0.04 + spd * 0.1 + Math.random() * 0.03, 45, onWheel );
			// oversteer: deep rumble while the rear is sliding
			const drift = clamp( ( Math.abs( p.rearSlip ) - 0.1 ) * 3, 0, 1 );
			if ( drift > 0.05 ) this.pulseAll( 0.35 + drift * 0.6, 60, onWheel );
			if ( p.scrape > 0.1 ) this.pulseAll( 0.5 + p.scrape * 0.5, 50 );
			if ( p.inGutter.some( ( g ) => g ) ) this.pulseAll( 0.45, 40, onWheel );

		}

	}

	// Sharp one-off pulses for physics events.
	onPhysicsEvent( e ) {

		if ( ! this.renderer.xr.isPresenting ) return;
		if ( e.type === 'gutterClip' ) {

			// pulse the hand on the side of the clip
			const leftSide = e.wheel === 0 || e.wheel === 2;
			for ( const h of this.hands ) if ( ( h.handedness === 'left' ) === leftSide ) this.pulse( h, 0.95, 70 );

		} else if ( e.type === 'wallHit' ) this.pulseAll( clamp( e.impact / 8, 0.5, 1 ), 140 );
		else if ( e.type === 'shift' ) this.pulseAll( 0.3, 25 );

	}

	setVisible( v ) {

		for ( const h of this.hands ) h.glove.visible = v;

	}

}

// Stylised toon racing glove (palm + curling fingers + thumb).
function makeGlove() {

	const g = new THREE.Group();
	const mat = toonMaterial( { color: 0x23212b, rim: 0.5 } );
	const accent = toonMaterial( { color: 0xd8354f, rim: 0.3 } );
	const palm = new THREE.Mesh( new THREE.BoxGeometry( 0.075, 0.03, 0.09 ), mat );
	palm.position.set( 0, - 0.01, 0.02 );
	const cuff = new THREE.Mesh( new THREE.CylinderGeometry( 0.035, 0.04, 0.05, 10 ).rotateX( Math.PI / 2 ), accent );
	cuff.position.set( 0, - 0.01, 0.085 );
	const fingers = new THREE.Group();
	fingers.position.set( 0, - 0.01, - 0.025 );
	for ( let i = 0; i < 4; i ++ ) {

		const f = new THREE.Mesh( new THREE.BoxGeometry( 0.016, 0.02, 0.06 ), mat );
		f.position.set( - 0.027 + i * 0.018, 0, - 0.03 );
		fingers.add( f );

	}

	const thumb = new THREE.Mesh( new THREE.BoxGeometry( 0.018, 0.02, 0.05 ), mat );
	thumb.position.set( 0.045, - 0.005, 0.0 );
	thumb.rotation.y = - 0.6;
	g.add( palm, cuff, fingers, thumb );
	g.userData.fingers = fingers;
	return g;

}

function makeLaser() {

	const geo = new THREE.CylinderGeometry( 0.002, 0.002, 1, 6 );
	geo.rotateX( - Math.PI / 2 );
	geo.translate( 0, 0, - 0.5 );
	const mat = new THREE.MeshBasicNodeMaterial( { color: 0xff8fc0, transparent: true, opacity: 0.8 } );
	const m = new THREE.Mesh( geo, mat );
	m.scale.z = 3;
	m.visible = false;
	return m;

}
