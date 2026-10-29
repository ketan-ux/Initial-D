import { settings } from '../core/settings.js';
import { clamp } from '../core/math.js';
import { Emitter } from '../core/events.js';

// Unified driving controls from keyboard, gamepad and touch. VR controllers
// write into `xr` from XRControls. Whichever device was used last drives.
const KEYMAP = {
	throttle: [ 'KeyW', 'ArrowUp' ],
	brake: [ 'KeyS', 'ArrowDown' ],
	left: [ 'KeyA', 'ArrowLeft' ],
	right: [ 'KeyD', 'ArrowRight' ],
	handbrake: [ 'Space' ]
};
const ACTIONS = {
	KeyE: 'shiftUp', ShiftLeft: 'shiftUp', ShiftRight: 'shiftUp',
	KeyQ: 'shiftDown', ControlLeft: 'shiftDown', ControlRight: 'shiftDown',
	KeyC: 'camera', KeyH: 'headlights', KeyR: 'reset', Escape: 'pause', KeyP: 'pause',
	KeyU: 'hud', KeyV: 'vignette', F3: 'debug', KeyL: 'lookBack', Enter: 'confirm'
};

const PAD_ACTIONS = [
	[ 5, [ 'shiftUp' ] ], [ 4, [ 'shiftDown' ] ], [ 3, [ 'camera' ] ], [ 9, [ 'pause' ] ], [ 8, [ 'hud' ] ],
	[ 12, [ 'headlights', 'menuUp' ] ], [ 13, [ 'lookBackToggle', 'menuDown' ] ], [ 2, [ 'reset' ] ],
	[ 0, [ 'menuOk' ] ], [ 1, [ 'menuBack' ] ]
];

export class Input extends Emitter {

	constructor() {

		super();
		this.keys = new Set();
		this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerIsAbsolute: false };
		this.device = 'keyboard';
		this.kbSteer = 0;
		this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0, active: false, tilt: false };
		this.xr = null; // set by XRControls while presenting
		this.prevPad = [];
		this.enabled = true;
		this.lookBack = false;
		window.addEventListener( 'keydown', ( e ) => this._key( e, true ) );
		window.addEventListener( 'keyup', ( e ) => this._key( e, false ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

	}

	_key( e, down ) {

		if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ) ) return;
		const code = e.code;
		if ( down ) this.keys.add( code ); else this.keys.delete( code );
		const drivingKey = Object.values( KEYMAP ).some( ( arr ) => arr.includes( code ) );
		if ( drivingKey ) {

			this.device = 'keyboard';
			if ( code.startsWith( 'Arrow' ) || code === 'Space' ) e.preventDefault();

		}

		if ( code === 'KeyL' ) this.lookBack = down;
		if ( down && ! e.repeat && ACTIONS[ code ] ) {

			this.device = drivingKey ? this.device : this.device;
			this.emit( ACTIONS[ code ] );
			if ( code === 'Tab' || code === 'F3' ) e.preventDefault();

		}

	}

	_held( name ) {

		return KEYMAP[ name ].some( ( k ) => this.keys.has( k ) );

	}

	_pad() {

		const pads = navigator.getGamepads ? navigator.getGamepads() : [];
		for ( const p of pads ) {

			if ( p && p.connected && p.mapping === 'standard' ) return p;

		}

		for ( const p of pads ) if ( p && p.connected ) return p;
		return null;

	}

	update( dt ) {

		const s = this.state;
		// --- gamepad ---
		const pad = this._pad();
		let padActive = false;
		if ( pad ) {

			const ax = pad.axes[ 0 ] || 0;
			const dz = 0.08;
			const steer = Math.abs( ax ) < dz ? 0 : Math.sign( ax ) * ( ( Math.abs( ax ) - dz ) / ( 1 - dz ) ) ** 1.6;
			const rt = pad.buttons[ 7 ]?.value || 0, lt = pad.buttons[ 6 ]?.value || 0;
			const hb = pad.buttons[ 0 ]?.pressed || pad.buttons[ 1 ]?.pressed ? 1 : 0;
			padActive = Math.abs( steer ) > 0.02 || rt > 0.05 || lt > 0.05 || hb;
			if ( padActive ) this.device = 'gamepad';
			if ( this.device === 'gamepad' ) {

				s.steer = - steer; // left stick left => steer left (+)
				s.throttle = rt; s.brake = lt; s.handbrake = hb;
				s.steerIsAbsolute = true;

			}

			// rising edges; menu actions share buttons with driving ones and
			// Game only listens to whichever applies in the current state
			for ( const [ i, actions ] of PAD_ACTIONS ) {

				const pressed = !! pad.buttons[ i ]?.pressed;
				if ( pressed && ! this.prevPad[ i ] ) for ( const a of actions ) this.emit( a );
				this.prevPad[ i ] = pressed;

			}

			// left stick flicks also move menu focus
			const ay = pad.axes[ 1 ] || 0;
			const flick = ay > 0.6 ? 1 : ay < - 0.6 ? - 1 : 0;
			if ( flick && flick !== this.prevFlick ) this.emit( flick > 0 ? 'menuDown' : 'menuUp' );
			this.prevFlick = flick;

		}

		// --- touch ---
		if ( this.touch.active ) {

			this.device = 'touch';
			s.throttle = this.touch.throttle; s.brake = this.touch.brake; s.handbrake = this.touch.handbrake;
			s.steer = this.touch.steer;
			s.steerIsAbsolute = false; // pad and gyro both use the grip-limited lock

		}

		// --- keyboard (digital steering ramps for smoothness) ---
		if ( this.device === 'keyboard' ) {

			const target = ( this._held( 'left' ) ? 1 : 0 ) - ( this._held( 'right' ) ? 1 : 0 );
			const rate = target === 0 ? 7 : ( Math.sign( target ) !== Math.sign( this.kbSteer ) && this.kbSteer !== 0 ? 10 : 5 );
			this.kbSteer += clamp( target - this.kbSteer, - rate * dt, rate * dt );
			s.steer = this.kbSteer;
			s.throttle = this._held( 'throttle' ) ? 1 : 0;
			s.brake = this._held( 'brake' ) ? 1 : 0;
			s.handbrake = this._held( 'handbrake' ) ? 1 : 0;
			s.steerIsAbsolute = false;

		}

		// --- VR controllers override everything while presenting ---
		if ( this.xr && this.xr.active ) {

			this.device = 'xr';
			s.throttle = this.xr.throttle; s.brake = this.xr.brake; s.handbrake = this.xr.handbrake;
			s.steer = this.xr.steer; s.steerIsAbsolute = true;

		}

		if ( ! this.enabled ) {

			s.throttle = 0; s.brake = 0; s.steer = 0; s.handbrake = 0;

		}

		return s;

	}

}

// On-screen controls for phones/tablets: steering pad (drag) or tilt,
// throttle & brake pedals, handbrake, shift paddles, camera, pause.
export class TouchControls {

	constructor( input, container ) {

		this.input = input;
		const el = document.createElement( 'div' );
		el.className = 'touch-controls';
		el.innerHTML = `
			<div class="tc-steer" aria-label="Steering pad"><div class="tc-knob"></div></div>
			<button class="tc-btn tc-hb" aria-label="Handbrake">HB</button>
			<button class="tc-btn tc-brake" aria-label="Brake">BRAKE</button>
			<button class="tc-btn tc-gas" aria-label="Throttle">GAS</button>
			<div class="tc-top">
				<button class="tc-mini" data-act="shiftDown" aria-label="Shift down">−</button>
				<button class="tc-mini" data-act="shiftUp" aria-label="Shift up">+</button>
				<button class="tc-mini" data-act="camera" aria-label="Switch camera">CAM</button>
				<button class="tc-mini" data-act="pause" aria-label="Pause">II</button>
				<button class="tc-mini tc-fs" data-act="fullscreen" aria-label="Toggle fullscreen">⛶</button>
			</div>`;
		container.appendChild( el );
		this.el = el;
		const t = input.touch;
		const hold = ( sel, key ) => {

			const b = el.querySelector( sel );
			const on = ( e ) => {

				e.preventDefault(); t[ key ] = 1; t.active = true; b.classList.add( 'down' );

			};

			const off = ( e ) => {

				e.preventDefault(); t[ key ] = 0; b.classList.remove( 'down' );

			};

			b.addEventListener( 'pointerdown', on );
			b.addEventListener( 'pointerup', off );
			b.addEventListener( 'pointercancel', off );
			b.addEventListener( 'pointerleave', off );

		};

		hold( '.tc-gas', 'throttle' );
		hold( '.tc-brake', 'brake' );
		hold( '.tc-hb', 'handbrake' );
		el.querySelectorAll( '.tc-mini' ).forEach( ( b ) => b.addEventListener( 'pointerdown', ( e ) => {

			e.preventDefault();
			const act = b.dataset.act;
			input.emit( act );

		} ) );

		// steering pad: horizontal drag maps to steering
		const pad = el.querySelector( '.tc-steer' ), knob = el.querySelector( '.tc-knob' );
		let pid = null, cx = 0;
		pad.addEventListener( 'pointerdown', ( e ) => {

			pid = e.pointerId; pad.setPointerCapture( pid );
			const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2;
			t.active = true;
			move( e );

		} );
		const move = ( e ) => {

			if ( e.pointerId !== pid || t.tilt ) return;
			const r = pad.getBoundingClientRect();
			const x = clamp( ( e.clientX - cx ) / ( r.width * 0.42 ), - 1, 1 );
			t.steer = - x;
			knob.style.transform = `translateX(${x * r.width * 0.36}px)`;

		};

		pad.addEventListener( 'pointermove', move );
		const end = ( e ) => {

			if ( e.pointerId !== pid ) return;
			pid = null; if ( ! t.tilt ) t.steer = 0; knob.style.transform = '';

		};

		pad.addEventListener( 'pointerup', end );
		pad.addEventListener( 'pointercancel', end );
		// Gyro steering: tilt the phone like a wheel. Roll comes from beta in
		// landscape (sign flips between the two landscape directions) and gamma
		// in portrait, zeroed at the angle the phone is held when the race view
		// opens. 2° deadzone, full turn at 30° / sensitivity, gentle curve,
		// smoothing, capped at 80%. The car treats it like the drag pad: full
		// tilt asks for the tightest turn the tyres can hold at this speed
		// (grip-limited lock), never a snap to opposite lock.
		this.gyroOK = typeof DeviceOrientationEvent !== 'undefined';
		this._onTilt = ( e ) => {

			if ( ! t.tilt || e.gamma == null || e.beta == null ) return;
			const o = screen.orientation?.angle ?? window.orientation ?? 0;
			const ang = Math.abs( o ) === 90 || o === 270 ? e.beta * ( o === 90 ? 1 : - 1 ) : e.gamma;
			if ( this.tiltZero == null ) this.tiltZero = ang;
			let d = ang - this.tiltZero;
			if ( Math.abs( d ) > 75 ) return; // phone flipped over: ignore, don't wrap to opposite lock
			d = Math.sign( d ) * Math.max( 0, Math.abs( d ) - 2 );
			const x = clamp( - d * ( settings.gyroSensitivity ?? 1 ) / 30, - 1, 1 );
			const target = Math.sign( x ) * Math.pow( Math.abs( x ), 1.3 ) * 0.8;
			t.steer += ( target - t.steer ) * 0.45;
			t.active = true;

		};
		// iOS only grants motion access from a tap: ask on the first touch
		el.addEventListener( 'pointerdown', () => this._askMotion(), { capture: true } );
		this.setMode( settings.touchSteer );

	}

	async _askMotion() {

		if ( this._motionAsked || ! this.input.touch.tilt ) return;
		this._motionAsked = true;
		const D = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
		if ( D?.requestPermission ) {

			try {

				if ( await D.requestPermission() !== 'granted' ) this.input.emit( 'toast', 'Motion access denied — using drag steering' );

			} catch ( e ) { /* not from a gesture */ this._motionAsked = false; }

		}

	}

	// 'gyro': brake + handbrake on the left, gas on the right, tilt steers.
	// 'drag': steering pad on the left, all pedals on the right.
	setMode( mode ) {

		const t = this.input.touch;
		const gyro = mode !== 'drag' && this.gyroOK;
		t.tilt = gyro;
		t.steer = 0;
		this.tiltZero = null;
		this.el.classList.toggle( 'gyro', gyro );
		document.body.classList.toggle( 'touch-gyro', gyro );
		window.removeEventListener( 'deviceorientation', this._onTilt );
		if ( gyro ) window.addEventListener( 'deviceorientation', this._onTilt );

	}

	recenter() {

		this.tiltZero = null;

	}

	show( v ) {

		this.el.style.display = v ? '' : 'none';
		if ( v ) this.recenter(); // centre the gyro on how the phone is held now
		// the touch bar carries its own fullscreen button while driving
		document.body.classList.toggle( 'touch-race', v );

	}

}
