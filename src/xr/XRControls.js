import * as THREE from 'three/webgpu';
import { clamp, wrapAngle } from '../core/math.js';
import { toonMaterial } from '../render/toon.js';
import { settings } from '../core/settings.js';
import { bus } from '../core/events.js';
import { VR_PANEL_ORDER, VR_HAND_ORDER } from '../ui/VRMenu.js';
import { C, fontsReady, drawCard, drawKey, inkText, fitText } from '../ui/theme.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4(), _up = new THREE.Vector3( 0, 1, 0 );

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
				shiftArmed: true, pressCooldown: 0, laser: makeLaser(), card: new HelpCard()
			};
			grip.add( hand.glove );
			ray.add( hand.laser );
			grip.addEventListener( 'connected', ( e ) => {

				hand.source = e.data;
				hand.handedness = e.data.handedness;
				// grip space: the back of the right hand faces +X, the left -X
				hand.glove.scale.x = hand.handedness === 'left' ? - 1 : 1;
				this._drawHelp();

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
		this.pointerDrive = false; // staging: pointers AND pedals/wheel at once
		this.onSelect = null;
		this.onPrimary = null; // A button while a menu is up = its first option
		this.helpMode = null; // 'drive' | 'menu' | null: floating button legends
		this.helpTime = 0;
		this.hintClock = 0;

	}

	attach( rig ) {

		for ( const h of this.hands ) rig.add( h.grip, h.ray, h.card.mesh );

	}

	// Floating legends above each controller naming what every button does.
	// seconds = how long to keep them up (Infinity = until changed).
	showHelp( mode, seconds = Infinity ) {

		this.helpTime = mode ? seconds : 0;
		if ( mode === this.helpMode ) return;
		this.helpMode = mode;
		this._drawHelp();

	}

	_drawHelp() {

		for ( const h of this.hands ) h.card.draw( h.handedness, this.helpMode, settings.vrShifter );

	}

	setCockpit( cockpit, physics ) {

		this.cockpit = cockpit;
		this.physics = physics;
		this.wheelAngle = 0;
		this.wheelVel = 0;

	}

	setPointerMode( on, drive = false ) {

		this.pointerMode = on;
		this.pointerDrive = on && drive;
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
		this.state.active = presenting && ( ! this.pointerMode || this.pointerDrive );
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
			// glove pose: index follows the trigger, the other fingers the grip
			const holding = h.grabbing ? 1 : h.squeeze;
			h.glove.userData.pose( 0.25 + Math.max( h.trigger, holding * 0.6 ) * 0.75, 0.55 + holding * 0.45 );

		}

		// buttons (edge-triggered). xr-standard mapping: 0 trigger, 1 grip,
		// 3 stick click, 4 A/X, 5 B/Y
		for ( const h of this.hands ) {

			const gp = this._gp( h );
			if ( ! gp ) continue;
			const e = {};
			for ( const i of [ 0, 3, 4, 5 ] ) {

				const p = !! gp.buttons[ i ]?.pressed;
				e[ i ] = p && ! h.prevButtons[ i ];
				h.prevButtons[ i ] = p;

			}

			if ( this.pointerMode && e[ 0 ] ) this.onSelect?.( h );
			if ( h.handedness === 'right' ) {

				if ( e[ 4 ] ) {

					if ( this.pointerMode ) this.onPrimary?.(); else this.input.emit( 'shiftUp' ); // A

				}

				// B is held for the handbrake (read in _interact)
				if ( e[ 3 ] && ! this.pointerMode ) this.input.emit( 'headlights' ); // stick click

			} else {

				if ( e[ 4 ] && ! this.pointerMode ) this.input.emit( 'shiftDown' ); // X
				if ( e[ 5 ] ) this.input.emit( 'pause' ); // Y
				if ( e[ 3 ] ) bus.emit( 'xr-recenter' ); // stick click

			}

		}

		this._updateHelp( dt );

		if ( ( this.pointerMode && ! this.pointerDrive ) || ! this.cockpit ) {

			this.state.throttle = 0; this.state.brake = 0;
			if ( this.cockpit ) for ( const k of [ 'wheel', 'shifter', 'handbrake' ] ) this.cockpit.setGrabHint( k, 0 );
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
		// signifiers: whatever a free hand could grab right now glows (pulsing)
		this.hintClock += dt;
		const near = { wheel: 0, shifter: 0, handbrake: 0 };
		for ( const h of this.hands ) {

			h.grip.getWorldPosition( _v );
			const pressing = h.squeeze > 0.55;
			// grab targets: wheel rim, shifter knob, handbrake grip
			const wl = ck.wheel.worldToLocal( _v.clone() );
			const radial = Math.abs( Math.hypot( wl.x, wl.y ) - ck.wheelRadius );
			const knob = ck.shifter.localToWorld( ck.shifterKnobLocal.clone() );
			const hbGrip = ck.handbrake.localToWorld( ck.handbrakeGripLocal.clone() );
			const onRim = radial < 0.1 && Math.abs( wl.z ) < 0.13;
			const onKnob = _v.distanceTo( knob ) < 0.11, onHb = _v.distanceTo( hbGrip ) < 0.13;
			if ( ! h.grabbing && h.source ) {

				if ( onRim ) near.wheel = 1;
				else if ( onKnob ) near.shifter = 1;
				else if ( onHb ) near.handbrake = 1;

			}

			if ( pressing && ! h.wasSqueeze ) {

				// grab priority: wheel rim, shifter knob, handbrake grip
				if ( onRim ) {

					h.grabbing = 'wheel';
					h.grabAngle = Math.atan2( wl.y, wl.x );
					this.pulse( h, 0.3, 25 );

				} else if ( onKnob ) {

					h.grabbing = 'shifter';
					h.grabStart.copy( ck.shifter.worldToLocal( _v.clone() ) );
					h.shiftArmed = true;
					this.pulse( h, 0.25, 20 );

				} else if ( onHb ) {

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
				const half = ck.phoneHalf ?? { x: 0.08, y: 0.045 };
				if ( Math.abs( ph.x ) < half.x && Math.abs( ph.y ) < half.y && Math.abs( ph.z ) < 0.03 ) {

					h.pressCooldown = 0.6;
					this.pulse( h, 0.35, 20 );
					bus.emit( 'phone-tap' );

				}

			}

		}

		// nobody on the wheel yet (staging, or let go): a slow glow invites a grab
		const free = ! this.hands.some( ( h ) => h.grabbing === 'wheel' );
		const pulse = 0.55 + 0.45 * Math.sin( this.hintClock * 5 );
		ck.setGrabHint( 'wheel', near.wheel ? pulse : ( free && this.helpMode === 'drive' ? 0.6 * pulse : 0 ) );
		ck.setGrabHint( 'shifter', near.shifter * pulse );
		ck.setGrabHint( 'handbrake', near.handbrake * pulse );

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
			// either thumbstick steers while no hand holds the wheel
			let stick = 0;
			for ( const h of this.hands ) {

				const ax = h.source?.gamepad?.axes[ 2 ] ?? 0;
				if ( Math.abs( ax ) > Math.abs( stick ) ) stick = ax;

			}

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

	// A legend pops up beside a controller only while you look at it (within
	// ~30° of gaze, under 0.9 m away), offset to the outside of the hand so it
	// never covers it, turned to face the head.
	_updateHelp( dt ) {

		if ( this.helpMode && this.helpTime !== Infinity ) {

			this.helpTime -= dt;
			if ( this.helpTime <= 0 ) this.showHelp( null );

		}

		const cam = this.renderer.xr.getCamera();
		cam.matrixWorld.decompose( _w, _q, _s );
		const fwd = _d.set( 0, 0, - 1 ).applyQuaternion( _q );
		const right = _p.set( 1, 0, 0 ).applyQuaternion( _q ).setY( 0 ).normalize();
		for ( const h of this.hands ) {

			const card = h.card.mesh;
			let want = false;
			if ( this.helpMode && h.source && h.card.rows && h.glove.visible && card.parent ) {

				h.grip.getWorldPosition( _v );
				const to = _v.clone().sub( _w );
				const dist = to.length();
				want = dist < 0.9 && to.dot( fwd ) / Math.max( dist, 1e-3 ) > 0.86;

			}

			h.card.show = clamp( h.card.show + ( want ? dt : - dt ) * 7, 0, 1 );
			card.visible = h.card.show > 0.01;
			if ( ! card.visible ) continue;
			const side = h.handedness === 'left' ? - 1 : 1;
			h.grip.getWorldPosition( _v ).addScaledVector( right, side * 0.15 );
			_v.y += 0.05;
			card.position.copy( card.parent.worldToLocal( _v ) );
			card.lookAt( _w );
			card.scale.setScalar( 0.6 + h.card.show * 0.4 );

		}

	}

	setVisible( v ) {

		for ( const h of this.hands ) h.glove.visible = v;

	}

}

// Stylised toon racing glove, modelled in WebXR grip space (right hand;
// the left is mirrored with scale.x = -1): the fist wraps a rod along Z with
// the thumb at -Z, the back of the hand faces +X and the wrist sits toward
// +Y. Fingers are one InstancedMesh of capsule phalanges re-posed each frame,
// so a hand costs three draw calls.
const FINGERS = [ // z of the knuckle, phalanx lengths
	{ z: - 0.029, len: [ 0.036, 0.026, 0.021 ] }, // index (trigger)
	{ z: - 0.01, len: [ 0.038, 0.028, 0.022 ] },
	{ z: 0.009, len: [ 0.036, 0.026, 0.021 ] },
	{ z: 0.027, len: [ 0.03, 0.022, 0.018 ] } // pinky
];
const PHALANX_R = 0.0092;
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3();

export function makeGlove() {

	const g = new THREE.Group();
	const mat = toonMaterial( { color: 0x2a2833, rim: 0.5 } );
	const accent = toonMaterial( { color: 0xd8354f, rim: 0.3 } );
	// back of the hand + padded palm heel behind the rod
	const back = new THREE.SphereGeometry( 1, 14, 10 ).scale( 0.016, 0.045, 0.047 ).translate( 0.03, 0.03, 0 );
	const heel = new THREE.SphereGeometry( 1, 12, 8 ).scale( 0.024, 0.03, 0.04 ).translate( 0.01, 0.05, 0.004 );
	const knuckles = new THREE.CapsuleGeometry( 0.012, 0.056, 3, 8 ).rotateX( Math.PI / 2 ).translate( 0.031, - 0.004, - 0.001 );
	const palm = new THREE.Mesh( mergeGeos( [ back, heel, knuckles ] ), mat );
	// slim red band at the wrist (the forearm leaves toward +Y, a little +Z)
	const cuff = new THREE.Mesh( new THREE.CylinderGeometry( 0.024, 0.026, 0.016, 12 ).scale( 0.8, 1, 1.25 ).translate( 0.018, 0.078, 0.006 ), accent );
	// 4 fingers x 3 phalanges + 2 thumb segments
	const seg = new THREE.CapsuleGeometry( PHALANX_R, 0.01, 3, 6 ); // along Y
	const fingers = new THREE.InstancedMesh( seg, mat, FINGERS.length * 3 + 2 );
	fingers.frustumCulled = false;
	g.add( palm, cuff, fingers );
	for ( const m of g.children ) m.renderOrder = VR_HAND_ORDER; // in front of VR panels

	const put = ( k, from, dir, len ) => {

		_p.copy( from ).addScaledVector( dir, len / 2 );
		_q.setFromUnitVectors( _up, dir );
		_s.set( 1, len / ( 0.01 + PHALANX_R * 2 ), 1 );
		fingers.setMatrixAt( k, _m4.compose( _p, _q, _s ) );
		from.addScaledVector( dir, len );

	};

	// index = 0 open … 1 fully curled; rest = the other three fingers
	g.userData.pose = ( index, rest ) => {

		let k = 0;
		FINGERS.forEach( ( f, fi ) => {

			const c = fi === 0 ? index : rest;
			// a chain wrapping a ~3 cm circle: per-joint bend grows with the curl
			const bend = 0.3 + c * 0.75;
			let a = - 0.26 - bend / 2; // direction angle: (sin a, -cos a) in XY
			const from = _w.set( 0.031, - 0.006, f.z );
			for ( const len of f.len ) {

				put( k ++, from, _d.set( Math.sin( a ), - Math.cos( a ), 0 ), len );
				a -= bend;

			}

		} );
		// thumb: from the palm side over the top of the fist, onto the stick
		const from = _w.set( 0.0, 0.02, - 0.036 );
		put( k ++, from, _d.set( - 0.55, - 0.35, - 0.76 ).normalize(), 0.03 );
		put( k ++, from, _d.set( - 0.25, - 0.65, - 0.72 ).normalize(), 0.024 );
		fingers.instanceMatrix.needsUpdate = true;

	};

	g.userData.pose( 0.3, 0.6 );
	return g;

}

function mergeGeos( geos ) {

	// tiny non-indexed merge (position/normal/uv) for the static glove parts
	const parts = geos.map( ( geo ) => ( geo.index ? geo.toNonIndexed() : geo ) );
	const out = new THREE.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv' ] ) {

		const size = parts[ 0 ].attributes[ name ].itemSize;
		const arr = new Float32Array( parts.reduce( ( n, p ) => n + p.attributes[ name ].array.length, 0 ) );
		let o = 0;
		for ( const p of parts ) {

			arr.set( p.attributes[ name ].array, o ); o += p.attributes[ name ].array.length;

		}

		out.setAttribute( name, new THREE.BufferAttribute( arr, size ) );

	}

	return out;

}

// Small billboard legend that floats above a controller and lists what each
// physical button does in the current context.
const HELP = {
	drive: {
		right: [ [ 'TRIGGER', 'gas' ], [ 'GRIP', 'grab wheel / lever' ], [ 'A', 'shift up' ], [ 'B', 'handbrake' ], [ 'STICK', 'steer (hands off wheel)' ] ],
		left: [ [ 'TRIGGER', 'brake / reverse' ], [ 'GRIP', 'grab wheel / lever' ], [ 'X', 'shift down' ], [ 'Y', 'pause' ], [ 'STICK', 'steer · click: recenter' ] ]
	},
	menu: {
		right: [ [ 'POINT', 'aim at the panel' ], [ 'TRIGGER', 'select' ], [ 'A', 'top option' ] ],
		left: [ [ 'POINT', 'aim at the panel' ], [ 'TRIGGER', 'select' ], [ 'Y', 'pause / resume' ], [ 'STICK', 'click: recenter' ] ]
	}
};

class HelpCard {

	constructor() {

		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 512; this.canvas.height = 288;
		this.tex = new THREE.CanvasTexture( this.canvas );
		this.tex.colorSpace = THREE.NoColorSpace;
		// same draw rules as the menu panel: never hidden by the cabin, but the
		// hands draw over it
		const mat = new THREE.MeshBasicNodeMaterial( { map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide } );
		mat.depthFunc = THREE.AlwaysDepth;
		mat.fog = false;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( 0.2, 0.1125 ), mat );
		this.mesh.renderOrder = VR_PANEL_ORDER + 0.25;
		this.mesh.visible = false;
		this.show = 0; // 0…1 pop-in
		fontsReady().then( () => this.args && this.draw( ...this.args ) );

	}

	draw( handedness, mode, shifter ) {

		const rows = HELP[ mode ]?.[ handedness ];
		this.rows = rows;
		if ( ! rows ) return;
		this.args = [ handedness, mode, shifter ];
		const c = this.canvas, ctx = c.getContext( '2d' ), W = c.width, H = c.height;
		drawCard( ctx, W, H, { pad: 4, border: 5 } );
		ctx.textBaseline = 'alphabetic';
		inkText( ctx, handedness === 'left' ? 'Left controller' : 'Right controller', 22, 44, 28, { color: C.yellow, maxW: W - 60 } );
		const top = 60, rh = ( H - top - 20 ) / rows.length;
		rows.forEach( ( [ key, what ], i ) => {

			const y = top + rh * i;
			const kh = Math.min( rh * 0.78, 36 );
			drawKey( ctx, key, 22, y + ( rh - kh ) / 2, kh, { minW: 130, fill: key === 'TRIGGER' || key === 'GRIP' ? C.paper : C.yellow } );
			const label = key === 'GRIP' && shifter === 'hpattern' ? 'grab wheel / H-shifter' : what;
			ctx.fillStyle = '#fff';
			ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			fitText( ctx, label, 176, y + rh / 2 + 1, W - 200, Math.min( rh * 0.55, 32 ), 700 );

		} );
		this.tex.needsUpdate = true;

	}

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
