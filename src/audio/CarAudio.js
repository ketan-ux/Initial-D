import * as THREE from 'three/webgpu';
import { clamp, damp } from '../core/math.js';

const _p = new THREE.Vector3();

// Per-car sound: two-layer procedural engine (on/off throttle), intake roar
// through the firewall, straight-cut gear whine under the shifter, turbo
// whistle + blow-off (turbo cars), tyre squeal, and for the player car: wind,
// floor-pan rumble, gravel pings and guardrail scrape. Each source sits on
// its own PannerNode at the physical spot in the car (HRTF in VR).
export class CarAudio {

	constructor( audio, car, { isPlayer = false } = {} ) {

		this.audio = audio;
		this.car = car;
		this.isPlayer = isPlayer;
		this.ok = !! audio.ready;
		if ( ! this.ok ) return;
		const ctx = audio.ctx;
		const spec = car.spec, snd = spec.engine.sound;
		this.rotary = spec.engine.type === 'rotary';
		this.turbocharged = !! spec.engine.turbo;
		const m = car.model;
		// anchor points in chassis space
		this.anchors = {
			engine: new THREE.Vector3( 0, 0.55, m.zOf( 0.6 ) ),
			firewall: new THREE.Vector3( 0, 0.75, m.zOf( spec.glass.windshield[ 0 ] - 0.1 ) ),
			shifter: new THREE.Vector3( - 0.0, 0.4, m.zOf( spec.glass.side[ 0 ] + 0.65 ) ),
			floor: new THREE.Vector3( - 0.2, 0.15, m.zOf( spec.glass.side[ 0 ] + 0.8 ) ),
			exhaust: new THREE.Vector3( - 0.45, 0.3, m.zOf( spec.length ) ),
			rear: new THREE.Vector3( 0, 0.2, m.zOf( spec.frontAxleF + spec.wheelbase ) )
		};

		const bus = audio.buses.engine;
		// --- engine ---
		this.onSrc = audio.loopSource( audio.engineBuffer( 'on', snd ) );
		this.offSrc = audio.loopSource( audio.engineBuffer( 'off', snd ) );
		this.onGain = ctx.createGain(); this.offGain = ctx.createGain();
		this.onGain.gain.value = 0; this.offGain.gain.value = 0;
		const shaper = audio.shaper( 1.6 + snd.rasp );
		this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.9;
		// fixed exhaust resonance (does not move with rpm, which sells the realism)
		const res = ctx.createBiquadFilter(); res.type = 'peaking'; res.frequency.value = this.rotary ? 220 : 160; res.Q.value = 1.4; res.gain.value = 7;
		this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
		this.onSrc.connect( this.onGain ); this.offSrc.connect( this.offGain );
		this.onGain.connect( shaper ); this.offGain.connect( shaper );
		shaper.connect( res ).connect( this.lp ).connect( this.engGain );
		this.engPan = audio.panner( { ref: isPlayer ? 1.5 : 4, rolloff: 1.1 } );
		this.engGain.connect( this.engPan ).connect( bus );
		// exhaust (player: behind you; rival: same source position)
		if ( isPlayer ) {

			this.exGain = ctx.createGain(); this.exGain.gain.value = 0;
			this.exPan = audio.panner( { ref: 1.5 } );
			const exLp = ctx.createBiquadFilter(); exLp.type = 'lowpass'; exLp.frequency.value = 900;
			shaper.connect( exLp ).connect( this.exGain ).connect( this.exPan ).connect( bus );

		}

		// --- intake roar through the firewall ---
		const nz = audio.loopSource( audio.noise, 1 );
		this.intakeBp = ctx.createBiquadFilter(); this.intakeBp.type = 'bandpass'; this.intakeBp.Q.value = 2.5;
		this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
		this.intakePan = audio.panner( { ref: 1.2 } );
		nz.connect( this.intakeBp ).connect( this.intakeGain ).connect( this.intakePan ).connect( bus );
		this.sources = [ this.onSrc, this.offSrc, nz ];

		// --- tyre squeal (tonal stick-slip + hiss) ---
		this.sqGain = ctx.createGain(); this.sqGain.gain.value = 0;
		this.sqPan = audio.panner( { ref: isPlayer ? 2 : 5 } );
		this.sqOsc = [ 960, 1380, 2050 ].map( ( f, i ) => {

			const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = f;
			const g = ctx.createGain(); g.gain.value = [ 0.5, 0.3, 0.12 ][ i ];
			o.connect( g ).connect( this.sqGain ); o.start();
			this.sources.push( o );
			return o;

		} );
		const sqN = audio.loopSource( audio.noise, 0.8 );
		const sqBp = ctx.createBiquadFilter(); sqBp.type = 'bandpass'; sqBp.frequency.value = 1700; sqBp.Q.value = 3;
		const sqNg = ctx.createGain(); sqNg.gain.value = 0.35;
		sqN.connect( sqBp ).connect( sqNg ).connect( this.sqGain );
		this.sqGain.connect( this.sqPan ).connect( audio.buses.sfx );
		this.sources.push( sqN );
		this.sqPhase = 0;

		// --- turbo whistle (FD rotary, S13 SR20DET) ---
		if ( this.turbocharged ) {

			this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 2400;
			this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
			this.turbo.connect( this.turboGain ).connect( this.engPan );
			this.turbo.start();
			this.sources.push( this.turbo );
			this.boost = 0;

		}

		if ( isPlayer ) {

			// gear whine right under the shifter
			this.whine = ctx.createOscillator(); this.whine.type = 'sine';
			this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
			this.whinePan = audio.panner( { ref: 0.6, rolloff: 1.4 } );
			this.whine.connect( this.whineGain ).connect( this.whinePan ).connect( audio.buses.sfx );
			this.whine.start();
			// wind + floor rumble
			const w = audio.loopSource( audio.pink, 1 );
			this.windLp = ctx.createBiquadFilter(); this.windLp.type = 'lowpass'; this.windLp.frequency.value = 800;
			this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
			w.connect( this.windLp ).connect( this.windGain ).connect( audio.buses.sfx );
			const r = audio.loopSource( audio.pink, 0.5 );
			const rLp = ctx.createBiquadFilter(); rLp.type = 'lowpass'; rLp.frequency.value = 130;
			this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
			this.floorPan = audio.panner( { ref: 0.8 } );
			r.connect( rLp ).connect( this.rumbleGain ).connect( this.floorPan ).connect( audio.buses.sfx );
			// guardrail scrape
			const sc = audio.loopSource( audio.noise, 1.3 );
			const scBp = ctx.createBiquadFilter(); scBp.type = 'bandpass'; scBp.frequency.value = 2400; scBp.Q.value = 1.2;
			this.scrapeGain = ctx.createGain(); this.scrapeGain.gain.value = 0;
			this.scrapePan = audio.panner( { ref: 1 } );
			sc.connect( scBp ).connect( audio.shaper( 3 ) ).connect( this.scrapeGain ).connect( this.scrapePan ).connect( audio.buses.sfx );
			this.sources.push( this.whine, w, r, sc );
			this.pingTimer = 0;

		}

		this.prevThrottle = 0;
		this.lastGear = car.physics.gear;
		this._lastPos = new THREE.Vector3();
		this._vel = new THREE.Vector3();

	}

	_pos( name ) {

		_p.copy( this.anchors[ name ] );
		return this.car.model.chassis.localToWorld( _p );

	}

	update( dt, listenerPos, timeScale = 1 ) {

		if ( ! this.ok ) return;
		const a = this.audio, ctx = a.ctx, t = ctx.currentTime;
		const p = this.car.physics, tel = this.car.telemetry, spec = this.car.spec;
		const rpm = tel.rpm;
		const rpmN = clamp( ( rpm - spec.engine.idle ) / ( spec.engine.redline - spec.engine.idle ), 0, 1.1 );
		const load = clamp( tel.throttle, 0, 1 );
		const k = 0.03;

		// pseudo-Doppler for other cars (Web Audio removed native Doppler)
		let doppler = 1;
		if ( ! this.isPlayer && listenerPos ) {

			const ep = this._pos( 'engine' );
			if ( dt > 0 ) this._vel.subVectors( ep, this._lastPos ).divideScalar( Math.max( dt, 1e-3 ) );
			this._lastPos.copy( ep );
			const toL = listenerPos.clone().sub( ep );
			const dist = toL.length() || 1;
			const vr = this._vel.dot( toL ) / dist;
			doppler = clamp( 343 / ( 343 - clamp( vr, - 80, 80 ) ), 0.8, 1.25 );

		}

		const rate = clamp( rpm / 3000, 0.2, 3.2 ) * doppler * ( timeScale < 1 ? 0.75 + timeScale * 0.25 : 1 );
		this.onSrc.playbackRate.setTargetAtTime( rate, t, k );
		this.offSrc.playbackRate.setTargetAtTime( rate, t, k );
		const lope = spec.engine.sound.lope > 0 && rpm < 1600 ? 0.75 + 0.25 * Math.sin( t * 9.5 ) : 1;
		this.onGain.gain.setTargetAtTime( ( 0.25 + load * 0.75 ) * lope, t, k );
		this.offGain.gain.setTargetAtTime( ( 1 - load ) * 0.7 * lope, t, k );
		this.lp.frequency.setTargetAtTime( 450 + rpmN * 4200 * ( 0.35 + 0.65 * load ) + ( this.isPlayer ? 0 : 400 ), t, k );
		this.engGain.gain.setTargetAtTime( this.isPlayer ? 0.32 + load * 0.2 : 0.55 + load * 0.25, t, k );
		a.setPannerPos( this.engPan, this._pos( 'engine' ) );
		if ( this.exGain ) {

			this.exGain.gain.setTargetAtTime( 0.12 + load * 0.25 * rpmN, t, k );
			a.setPannerPos( this.exPan, this._pos( 'exhaust' ) );

		}

		// intake roar
		this.intakeBp.frequency.setTargetAtTime( 180 + rpmN * 900, t, k );
		this.intakeGain.gain.setTargetAtTime( load * rpmN * ( this.isPlayer ? 0.22 : 0.12 ) * ( spec.engine.sound.rasp + 0.3 ), t, k );
		a.setPannerPos( this.intakePan, this._pos( 'firewall' ) );

		// tyre squeal
		const slip = Math.max( 0, Math.abs( p.rearSlip ) - 0.07 ) * 2.6 + Math.max( 0, Math.abs( p.frontSlip ) - 0.12 ) * 1.5;
		const sq = clamp( slip + tel.wheelspin * 0.5 + ( p.controls.handbrake > 0.5 && p.speed > 5 ? 0.5 : 0 ), 0, 1 ) * clamp( p.speed / 8, 0, 1 );
		this.sqPhase += dt * ( 6 + Math.random() * 8 );
		const wob = Math.sin( this.sqPhase ) * 60 + ( Math.random() - 0.5 ) * 90;
		this.sqOsc.forEach( ( o, i ) => o.frequency.setTargetAtTime( [ 960, 1380, 2050 ][ i ] + wob * ( i + 1 ) * 0.6 - sq * 80, t, 0.02 ) );
		this.sqGain.gain.setTargetAtTime( sq * sq * ( this.isPlayer ? 0.32 : 0.45 ), t, 0.04 );
		a.setPannerPos( this.sqPan, this._pos( 'rear' ) );

		// turbo + blow-off valve
		if ( this.turbocharged ) {

			this.boost = damp( this.boost, load * clamp( ( rpm - 2800 ) / 3500, 0, 1 ), 3, dt );
			this.turbo.frequency.setTargetAtTime( 1800 + this.boost * 3600, t, 0.05 );
			this.turboGain.gain.setTargetAtTime( this.boost * 0.05, t, 0.05 );
			if ( this.prevThrottle > 0.7 && load < 0.2 && this.boost > 0.45 ) {

				a.noiseBurst( { dur: 0.45, freq: 3800, q: 0.8, gain: 0.22 * this.boost, panner: this.engPan } );
				this.boost *= 0.3;

			}

		}

		// lift-off pops (backfire) on the high-revving 4A-GE
		if ( ! this.turbocharged && this.prevThrottle > 0.8 && load < 0.15 && rpmN > 0.7 && Math.random() < 0.6 ) {

			for ( let i = 0; i < 3; i ++ ) a.noiseBurst( { dur: 0.06, freq: 500 + Math.random() * 400, q: 0.8, gain: 0.35, panner: this.exPan || this.engPan, at: i * 0.07 + Math.random() * 0.04 } );

		}

		this.prevThrottle = load;

		if ( this.isPlayer ) {

			const spd = p.speed;
			this.whine.frequency.setTargetAtTime( Math.max( 40, rpm / 60 * ( 7 + Math.max( 0, p.gear ) * 0.6 ) ), t, k );
			this.whineGain.gain.setTargetAtTime( clamp( spd / 40, 0, 1 ) * ( 0.012 + load * 0.02 ), t, k );
			a.setPannerPos( this.whinePan, this._pos( 'shifter' ) );
			this.windLp.frequency.setTargetAtTime( 300 + spd * 28, t, 0.1 );
			this.windGain.gain.setTargetAtTime( clamp( ( spd / 45 ) ** 2, 0, 1 ) * 0.22, t, 0.1 );
			const gutter = p.inGutter.some( ( g ) => g );
			this.rumbleGain.gain.setTargetAtTime( clamp( spd / 40, 0, 1 ) * ( gutter ? 0.9 : 0.22 ), t, 0.05 );
			a.setPannerPos( this.floorPan, this._pos( 'floor' ) );
			this.scrapeGain.gain.setTargetAtTime( p.scrape * 0.4, t, 0.03 );
			if ( p.wallContact ) {

				_p.set( p.wallContact * spec.width * 0.5, 0.5, 0 );
				a.setPannerPos( this.scrapePan, this.car.model.chassis.localToWorld( _p ) );

			}

			// gravel / grit pinging off the floor pan
			this.pingTimer -= dt;
			const rate = ( gutter ? 18 : 1.2 ) * clamp( spd / 25, 0, 1.5 ) + p.scrape * 10;
			if ( rate > 0.05 && this.pingTimer <= 0 ) {

				this.pingTimer = ( 0.4 + Math.random() ) / rate;
				const pan = a.panner( { ref: 0.6 } );
				pan.connect( a.buses.sfx );
				_p.set( ( Math.random() - 0.5 ) * 1.2, 0.12, this.anchors.floor.z + ( Math.random() - 0.5 ) * 1.6 );
				a.setPannerPos( pan, this.car.model.chassis.localToWorld( _p ) );
				a.noiseBurst( { dur: 0.04 + Math.random() * 0.04, freq: 3000 + Math.random() * 4000, q: 9, gain: 0.25 + Math.random() * 0.25, panner: pan } );

			}

			// shift clunk
			if ( p.gear !== this.lastGear ) {

				a.noiseBurst( { dur: 0.08, freq: 600, q: 1.5, gain: 0.25, panner: this.whinePan } );
				this.lastGear = p.gear;

			}

		}

	}

	stop() {

		if ( ! this.ok ) return;
		for ( const s of this.sources ) {

			try {

				s.stop();

			} catch ( e ) { /* already stopped */ }

		}

		this.engPan.disconnect();
		this.ok = false;

	}

}
