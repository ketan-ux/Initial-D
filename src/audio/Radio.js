import { LINES, SPEAKERS } from './radioScript.js';
import { bus } from '../core/events.js';

const BASE = ( import.meta.env?.BASE_URL ?? './' ) + 'audio/radio/';

// Walkie-talkie comms: band-limited, lightly overdriven voice with squelch
// tails and a static bed, scheduled so lines never overlap. Every line emits
// a caption event timed to the actual audio duration.
export class Radio {

	constructor( audio ) {

		this.audio = audio;
		this.buffers = new Map();
		this.failed = new Set();
		this.queue = [];
		this.playing = null;
		this.cooldowns = new Map();
		this.output = null; // optional PannerNode (VR: walkie-talkie on the passenger seat)
		this.enabled = true;

	}

	_chain() {

		const a = this.audio, ctx = a.ctx;
		const input = ctx.createGain();
		const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380; hp.Q.value = 0.8;
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3100; lp.Q.value = 1.1;
		const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1700; mid.gain.value = 5; mid.Q.value = 1;
		const drive = a.shaper( 3.2 );
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = - 24; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.15;
		const out = ctx.createGain(); out.gain.value = 0.9;
		input.connect( hp ).connect( lp ).connect( mid ).connect( drive ).connect( comp ).connect( out );
		out.connect( this.output || a.buses.radio );
		return { input, out };

	}

	async preload() {

		if ( ! this.audio.ready ) return;
		const files = [ ...new Set( Object.values( LINES ).map( ( l ) => l.file ).filter( Boolean ) ) ];
		await Promise.all( files.map( ( f ) => this._load( f ) ) );

	}

	async _load( file ) {

		if ( this.buffers.has( file ) || this.failed.has( file ) ) return this.buffers.get( file );
		try {

			const res = await fetch( BASE + file );
			if ( ! res.ok ) throw new Error( res.status );
			const arr = await res.arrayBuffer();
			const buf = await this.audio.ctx.decodeAudioData( arr );
			this.buffers.set( file, buf );
			return buf;

		} catch ( e ) {

			this.failed.add( file );
			return null;

		}

	}

	// Request a line. Lower-priority chatter is dropped when busy.
	say( id, { delay = 0, force = false } = {} ) {

		const line = LINES[ id ];
		if ( ! line || ! this.enabled ) return;
		const now = performance.now();
		if ( ! force && ( this.cooldowns.get( id ) || 0 ) > now ) return;
		this.cooldowns.set( id, now + 25000 );
		const item = { id, line, at: now + delay * 1000 };
		if ( this.playing || this.queue.length ) {

			if ( line.priority <= 1 && this.queue.length >= 1 ) return;
			this.queue.push( item );
			this.queue.sort( ( a, b ) => b.line.priority - a.line.priority || a.at - b.at );
			if ( this.queue.length > 3 ) this.queue.length = 3;

		} else this.queue.push( item );

	}

	clear() {

		this.queue.length = 0;
		if ( this.playing?.src ) {

			try {

				this.playing.src.stop();

			} catch ( e ) { /* ignore */ }

		}

		this.playing = null;
		bus.emit( 'caption', null );

	}

	update() {

		if ( ! this.audio.ready || this.playing ) return;
		const now = performance.now();
		const next = this.queue[ 0 ];
		if ( ! next || next.at > now ) return;
		this.queue.shift();
		this._play( next );

	}

	async _play( item ) {

		const a = this.audio, ctx = a.ctx;
		const { line } = item;
		this.playing = item;
		const buf = line.file ? await this._load( line.file ) : null;
		const t0 = ctx.currentTime + 0.05;
		const { input, out } = this._chain();
		// key-up squelch
		a.noiseBurst( { dur: 0.16, freq: 2500, q: 0.6, gain: 0.32, panner: out } );
		// static bed under the voice
		const st = ctx.createBufferSource();
		st.buffer = a.noise; st.loop = true;
		const stBp = ctx.createBiquadFilter(); stBp.type = 'bandpass'; stBp.frequency.value = 2200; stBp.Q.value = 0.5;
		const stG = ctx.createGain(); stG.gain.value = 0.028;
		st.connect( stBp ).connect( stG ).connect( out );
		st.start( t0 );

		let duration;
		if ( buf ) {

			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.connect( input );
			src.start( t0 + 0.12 );
			item.src = src;
			duration = buf.duration + 0.12;

		} else {

			duration = this._mumble( input, t0 + 0.12, line.text );

		}

		const sp = SPEAKERS[ line.speaker ];
		bus.emit( 'caption', { speaker: sp.name, color: sp.color, text: line.text, duration: duration + 0.35 } );
		bus.emit( 'radio', { id: item.id, duration } );
		const end = t0 + duration;
		st.stop( end + 0.25 );
		// un-key: squelch tail + roger beep
		setTimeout( () => {

			if ( ! a.ready ) return;
			a.noiseBurst( { dur: 0.22, freq: 2800, q: 0.5, gain: 0.3, panner: out } );
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.frequency.value = 1250; g.gain.value = 0.07;
			o.connect( g ).connect( out );
			o.start( ctx.currentTime ); o.stop( ctx.currentTime + 0.09 );
			setTimeout( () => {

				this.playing = null;
				bus.emit( 'caption-end', item.id );

			}, 600 );

		}, ( end - ctx.currentTime ) * 1000 );

	}

	// Fallback when no voice file exists: formant-filtered noise "chatter".
	_mumble( input, t0, text ) {

		const a = this.audio, ctx = a.ctx;
		const syll = Math.max( 4, Math.round( text.length / 4.5 ) );
		let t = t0;
		for ( let i = 0; i < syll; i ++ ) {

			const d = 0.08 + Math.random() * 0.12;
			const s = ctx.createBufferSource();
			s.buffer = a.noise;
			const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 1400; f.Q.value = 6;
			const g = ctx.createGain();
			g.gain.setValueAtTime( 0, t );
			g.gain.linearRampToValueAtTime( 0.9, t + 0.02 );
			g.gain.setTargetAtTime( 0, t + d, 0.03 );
			s.connect( f ).connect( g ).connect( input );
			s.start( t, Math.random() );
			s.stop( t + d + 0.2 );
			t += d + ( Math.random() < 0.2 ? 0.12 : 0.03 );

		}

		return t - t0;

	}

}
