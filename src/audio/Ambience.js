// Night-mountain ambience: wind through the cedars, frogs from the paddies
// in the valley, the odd owl. Purely synthesised; ducked during the race.
export class Ambience {

	constructor( audio ) {

		this.audio = audio;
		this.level = 1;
		this.started = false;
		this.timer = 0;
		this.owlTimer = 8;

	}

	start() {

		const a = this.audio;
		if ( ! a.ready || this.started ) return;
		const ctx = a.ctx;
		this.started = true;
		this.out = ctx.createGain();
		this.out.gain.value = 0;
		this.out.connect( a.buses.ambience );
		// wind bed with slow gusts
		const w = a.loopSource( a.pink, 0.6 );
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
		this.windGain = ctx.createGain(); this.windGain.gain.value = 0.35;
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
		const lfoG = ctx.createGain(); lfoG.gain.value = 0.2;
		lfo.connect( lfoG ).connect( this.windGain.gain );
		lfo.start();
		w.connect( lp ).connect( this.windGain ).connect( this.out );
		// leaves rustle
		const r = a.loopSource( a.noise, 0.9 );
		const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.7;
		const rg = ctx.createGain(); rg.gain.value = 0.02;
		r.connect( bp ).connect( rg ).connect( this.out );

	}

	setLevel( v ) {

		this.level = v;
		if ( this.out ) this.out.gain.setTargetAtTime( v, this.audio.time, 0.8 );

	}

	update( dt ) {

		const a = this.audio;
		if ( ! this.started || this.level < 0.05 ) return;
		const ctx = a.ctx;
		// frog chorus: short pulsed croaks from random directions
		this.timer -= dt;
		if ( this.timer <= 0 ) {

			this.timer = 0.25 + Math.random() * 0.9;
			const t = ctx.currentTime;
			const pan = ctx.createStereoPanner();
			pan.pan.value = Math.random() * 2 - 1;
			const g = ctx.createGain();
			g.gain.value = 0;
			const o = ctx.createOscillator();
			o.type = 'square';
			o.frequency.value = 300 + Math.random() * 180;
			const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 8;
			o.connect( f ).connect( g ).connect( pan ).connect( this.out );
			const pulses = 2 + ( Math.random() * 4 ) | 0;
			for ( let i = 0; i < pulses; i ++ ) {

				const s = t + i * 0.055;
				g.gain.setValueAtTime( 0, s );
				g.gain.linearRampToValueAtTime( 0.04, s + 0.012 );
				g.gain.linearRampToValueAtTime( 0, s + 0.04 );

			}

			o.start( t ); o.stop( t + pulses * 0.06 + 0.05 );

		}

		// distant owl
		this.owlTimer -= dt;
		if ( this.owlTimer <= 0 ) {

			this.owlTimer = 14 + Math.random() * 20;
			const t = ctx.currentTime;
			for ( const [ off, f0 ] of [ [ 0, 420 ], [ 0.45, 400 ], [ 0.75, 410 ] ] ) {

				const o = ctx.createOscillator(), g = ctx.createGain();
				o.frequency.setValueAtTime( f0, t + off );
				o.frequency.linearRampToValueAtTime( f0 * 0.9, t + off + 0.25 );
				g.gain.setValueAtTime( 0, t + off );
				g.gain.linearRampToValueAtTime( 0.03, t + off + 0.05 );
				g.gain.linearRampToValueAtTime( 0, t + off + 0.3 );
				o.connect( g ).connect( this.out );
				o.start( t + off ); o.stop( t + off + 0.35 );

			}

		}

	}

}
