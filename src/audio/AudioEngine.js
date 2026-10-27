import { clamp, mulberry32 } from '../core/math.js';
import { settings } from '../core/settings.js';

// Web Audio backbone: buses, listener sync, positional voices and shared
// procedural buffers. Every sound in the game is synthesised here (or is a
// radio voice line), so the download stays tiny and nothing needs licensing.

export class AudioEngine {

	constructor() {

		this.ctx = null;
		this.ready = false;
		this.hrtf = false;

	}

	// Must be called from a user gesture (browser autoplay policy).
	async init( { hrtf = false } = {} ) {

		if ( this.ctx ) {

			if ( this.ctx.state === 'suspended' ) await this.ctx.resume();
			return;

		}

		const AC = window.AudioContext || window.webkitAudioContext;
		if ( ! AC ) return;
		this.ctx = new AC( { latencyHint: 'interactive' } );
		const ctx = this.ctx;
		this.hrtf = hrtf;
		this.master = ctx.createGain();
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = - 14; comp.knee.value = 10; comp.ratio.value = 4;
		comp.attack.value = 0.004; comp.release.value = 0.2;
		this.master.connect( comp ).connect( ctx.destination );
		const bus = () => {

			const g = ctx.createGain(); g.connect( this.master ); return g;

		};

		this.buses = { engine: bus(), sfx: bus(), radio: bus(), ambience: bus(), ui: bus() };
		this.applyVolumes();
		this.noise = this._noiseBuffer( 2 );
		this.pink = this._pinkBuffer( 3 );
		this.ready = true;
		if ( ctx.state === 'suspended' ) await ctx.resume();

	}

	applyVolumes() {

		if ( ! this.ctx ) return;
		const t = this.ctx.currentTime;
		this.master.gain.setTargetAtTime( settings.masterVolume, t, 0.05 );
		this.buses.engine.gain.setTargetAtTime( settings.engineVolume, t, 0.05 );
		this.buses.sfx.gain.setTargetAtTime( settings.sfxVolume, t, 0.05 );
		this.buses.radio.gain.setTargetAtTime( settings.radioVolume, t, 0.05 );
		this.buses.ambience.gain.setTargetAtTime( settings.ambienceVolume, t, 0.05 );
		this.buses.ui.gain.setTargetAtTime( Math.min( 1, settings.sfxVolume + 0.2 ), t, 0.05 );

	}

	setHRTF( on ) {

		this.hrtf = on;

	}

	suspend() {

		this.ctx?.suspend();

	}

	resume() {

		this.ctx?.resume();

	}

	get time() {

		return this.ctx ? this.ctx.currentTime : 0;

	}

	// Listener follows the active camera (or the VR head).
	setListener( pos, fwd, up ) {

		const L = this.ctx?.listener;
		if ( ! L ) return;
		const t = this.ctx.currentTime;
		if ( L.positionX ) {

			L.positionX.setTargetAtTime( pos.x, t, 0.015 ); L.positionY.setTargetAtTime( pos.y, t, 0.015 ); L.positionZ.setTargetAtTime( pos.z, t, 0.015 );
			L.forwardX.setTargetAtTime( fwd.x, t, 0.015 ); L.forwardY.setTargetAtTime( fwd.y, t, 0.015 ); L.forwardZ.setTargetAtTime( fwd.z, t, 0.015 );
			L.upX.setTargetAtTime( up.x, t, 0.015 ); L.upY.setTargetAtTime( up.y, t, 0.015 ); L.upZ.setTargetAtTime( up.z, t, 0.015 );

		} else {

			L.setPosition( pos.x, pos.y, pos.z );
			L.setOrientation( fwd.x, fwd.y, fwd.z, up.x, up.y, up.z );

		}

	}

	panner( { ref = 2, rolloff = 1, max = 400 } = {} ) {

		const p = this.ctx.createPanner();
		p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
		p.distanceModel = 'inverse';
		p.refDistance = ref;
		p.rolloffFactor = rolloff;
		p.maxDistance = max;
		return p;

	}

	setPannerPos( p, v ) {

		const t = this.ctx.currentTime;
		if ( p.positionX ) {

			p.positionX.setTargetAtTime( v.x, t, 0.02 ); p.positionY.setTargetAtTime( v.y, t, 0.02 ); p.positionZ.setTargetAtTime( v.z, t, 0.02 );

		} else p.setPosition( v.x, v.y, v.z );

	}

	loopSource( buffer, rate = 1 ) {

		const s = this.ctx.createBufferSource();
		s.buffer = buffer;
		s.loop = true;
		s.playbackRate.value = rate;
		s.start();
		return s;

	}

	_noiseBuffer( seconds ) {

		const ctx = this.ctx;
		const b = ctx.createBuffer( 1, ctx.sampleRate * seconds, ctx.sampleRate );
		const d = b.getChannelData( 0 );
		const r = mulberry32( 99 );
		for ( let i = 0; i < d.length; i ++ ) d[ i ] = r() * 2 - 1;
		return b;

	}

	_pinkBuffer( seconds ) {

		const ctx = this.ctx;
		const b = ctx.createBuffer( 1, ctx.sampleRate * seconds, ctx.sampleRate );
		const d = b.getChannelData( 0 );
		const r = mulberry32( 7 );
		let b0 = 0, b1 = 0, b2 = 0;
		for ( let i = 0; i < d.length; i ++ ) {

			const w = r() * 2 - 1;
			b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
			d[ i ] = ( b0 + b1 + b2 + w * 0.1848 ) * 0.22;

		}

		return b;

	}

	// Procedural engine "pulse train": one buffer of firing events at a base
	// firing frequency, looped and pitched by playbackRate = rpm / baseRpm.
	engineBuffer( kind, character ) {

		const key = kind + ':' + JSON.stringify( character );
		this._engCache = this._engCache || new Map();
		if ( this._engCache.has( key ) ) return this._engCache.get( key );
		const ctx = this.ctx, sr = ctx.sampleRate;
		const baseFire = 100; // Hz (= 3000 rpm for 2 firings per revolution)
		const cycles = 96;
		const per = Math.round( sr / baseFire );
		const buf = ctx.createBuffer( 1, per * cycles, sr );
		const d = buf.getChannelData( 0 );
		const rng = mulberry32( kind === 'on' ? 11 : 23 );
		const rotary = character.lope > 0;
		const rasp = character.rasp;
		for ( let c = 0; c < cycles; c ++ ) {

			const amp = ( kind === 'on' ? 1 : 0.55 ) * ( 0.82 + rng() * 0.36 );
			const jitter = Math.round( ( rng() - 0.5 ) * per * 0.06 );
			const start = c * per + jitter;
			const decay = rotary ? 14 + rng() * 4 : ( kind === 'on' ? 26 : 34 );
			const f1 = ( rotary ? 340 : 420 ) * ( 0.95 + rng() * 0.1 );
			const f2 = f1 * ( rotary ? 2.03 : 2.6 );
			const f3 = f1 * 5.1;
			for ( let i = 0; i < per * 1.6; i ++ ) {

				const idx = start + i;
				if ( idx < 0 || idx >= d.length ) continue;
				const t = i / sr;
				const env = Math.exp( - t * decay * 60 ) * ( 1 - Math.exp( - t * 4000 ) );
				let v = Math.sin( 2 * Math.PI * f1 * t ) + 0.55 * Math.sin( 2 * Math.PI * f2 * t + 1 ) + rasp * 0.35 * Math.sin( 2 * Math.PI * f3 * t );
				v += ( rng() * 2 - 1 ) * ( kind === 'on' ? 0.35 + rasp * 0.3 : 0.25 );
				d[ idx ] += v * env * amp;

			}

			// overrun crackle on the off-throttle layer
			if ( kind === 'off' && rng() < 0.05 ) {

				const p = start + Math.round( rng() * per );
				for ( let i = 0; i < 260 && p + i < d.length; i ++ ) d[ p + i ] += ( rng() * 2 - 1 ) * Math.exp( - i / 50 ) * 1.4;

			}

		}

		// normalise
		let peak = 0;
		for ( let i = 0; i < d.length; i ++ ) peak = Math.max( peak, Math.abs( d[ i ] ) );
		for ( let i = 0; i < d.length; i ++ ) d[ i ] /= peak || 1;
		this._engCache.set( key, buf );
		return buf;

	}

	shaper( amount = 2.5 ) {

		const ws = this.ctx.createWaveShaper();
		const n = 1024, curve = new Float32Array( n );
		for ( let i = 0; i < n; i ++ ) {

			const x = ( i / ( n - 1 ) ) * 2 - 1;
			curve[ i ] = Math.tanh( x * amount ) / Math.tanh( amount );

		}

		ws.curve = curve;
		ws.oversample = '2x';
		return ws;

	}

	// --- one-shots ---------------------------------------------------------

	beep( freq = 880, dur = 0.12, gain = 0.25, bus = 'ui', type = 'sine' ) {

		if ( ! this.ready ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type; o.frequency.value = freq;
		g.gain.setValueAtTime( 0, t );
		g.gain.linearRampToValueAtTime( gain, t + 0.008 );
		g.gain.setTargetAtTime( 0, t + dur, 0.03 );
		o.connect( g ).connect( this.buses[ bus ] );
		o.start( t ); o.stop( t + dur + 0.3 );

	}

	click() {

		this.beep( 1800, 0.025, 0.12, 'ui', 'square' );

	}

	noiseBurst( { dur = 0.2, freq = 2000, q = 1, gain = 0.4, bus = 'sfx', panner = null, type = 'bandpass', at = 0 } = {} ) {

		if ( ! this.ready ) return;
		const ctx = this.ctx, t = ctx.currentTime + at;
		const s = ctx.createBufferSource();
		s.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = type; f.frequency.value = freq; f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime( gain, t );
		g.gain.exponentialRampToValueAtTime( 0.0005, t + dur );
		s.connect( f ).connect( g );
		if ( panner ) g.connect( panner ); else g.connect( this.buses[ bus ] );
		s.start( t, Math.random() * 1.5 );
		s.stop( t + dur + 0.05 );

	}

	thud( gain = 0.6, freq = 70 ) {

		if ( ! this.ready ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = 'sine';
		o.frequency.setValueAtTime( freq * 1.8, t );
		o.frequency.exponentialRampToValueAtTime( freq * 0.6, t + 0.25 );
		g.gain.setValueAtTime( gain, t );
		g.gain.exponentialRampToValueAtTime( 0.001, t + 0.35 );
		o.connect( g ).connect( this.buses.sfx );
		o.start( t ); o.stop( t + 0.4 );
		this.noiseBurst( { dur: 0.18, freq: 900, q: 0.7, gain: gain * 0.6 } );

	}

}

export const audio = new AudioEngine();

export { clamp };
