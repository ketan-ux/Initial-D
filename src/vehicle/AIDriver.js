import { clamp, damp, lerp } from '../core/math.js';

// Rival driver: pure-pursuit steering on the precomputed racing line, a
// braking-aware speed profile, handbrake flicks into hairpins for style,
// and gentle rubber-banding so the battle stays close at any skill level.
export class AIDriver {

	constructor( physics, track, { skill = 0.8, style = 'drift' } = {} ) {

		this.p = physics;
		this.track = track;
		this.skill = skill;
		this.style = style;
		this.laneBias = 0;
		this.hbTimer = 0;
		this.stuckTimer = 0;
		this.mistakeTimer = 6 + Math.random() * 10;
		this.mistake = 0;
		this.enabled = true;
		this.targetLateral = null; // set for scripted moves (parking)
		this.targetSpeedOverride = null;

	}

	update( dt, ctx = {} ) {

		const p = this.p, t = this.track, c = p.controls;
		if ( ! this.enabled ) return;
		const speed = p.speed;
		const s = p.s;

		// --- target point -----------------------------------------------------
		const look = clamp( 7 + speed * 0.5, 8, 30 );
		const sT = s + look;
		const iT = t.indexAt( sT );
		let lat = this.targetLateral ?? t.racingLine[ iT ] + this.laneBias;
		const wall = Math.min( t.wallL[ iT ], t.wallR[ iT ] ) - 1.3;
		if ( this.targetLateral == null ) lat = clamp( lat, - wall, wall );
		const pt = t.pointAt( sT, lat );
		const dx = pt.x - p.x, dz = pt.z - p.z;
		const sinH = Math.sin( p.heading ), cosH = Math.cos( p.heading );
		const tf = dx * sinH + dz * cosH;
		const tl = dx * cosH - dz * sinH;
		const ang = Math.atan2( tl, Math.max( 0.1, tf ) );
		// pure pursuit curvature -> steering angle; slip angle feeds countersteer naturally
		const curvCmd = 2 * Math.sin( ang ) / look;
		let steerAng = Math.atan( curvCmd * p.spec.wheelbase ) + p.slipAngle * 0.6;
		c.steer = clamp( steerAng / p.spec.steerLock, - 1, 1 );
		c.steerIsAbsolute = true;

		// --- target speed ----------------------------------------------------
		let vT = Infinity;
		for ( let k = 0; k < 6; k ++ ) vT = Math.min( vT, t.speedProfile[ t.indexAt( s + k * 4 ) ] );
		let band = 1;
		if ( ctx.playerS != null ) {

			// rubber band: ease off when far ahead, push when behind
			const gap = s - ctx.playerS;
			band = clamp( 1 - gap / 600, 0.88, 1.08 );

		}

		const skillF = lerp( 0.8, 0.99, this.skill );
		vT = vT * skillF * band;
		if ( this.mistake > 0 ) {

			vT *= 0.93;
			this.mistake -= dt;

		}

		if ( this.targetSpeedOverride != null ) vT = Math.min( vT, this.targetSpeedOverride );

		const err = vT - speed;
		if ( err > 0 ) {

			c.throttle = clamp( err * 0.35 + 0.35, 0, 1 );
			c.brake = 0;

		} else {

			c.throttle = err > - 1.5 ? 0.15 : 0;
			c.brake = clamp( - err * 0.16, 0, 1 );

		}

		// traction control-ish: lift when the rear is stepping out too far
		if ( Math.abs( p.slipAngle ) > 0.42 ) c.throttle *= 0.4;

		// --- style: handbrake flick at hairpin entry --------------------------
		const kAhead = Math.abs( t.curv[ t.indexAt( s + 16 ) ] );
		if ( this.style === 'drift' && kAhead > 1 / 24 && speed > 15 && this.hbTimer <= 0 && Math.abs( t.curv[ t.indexAt( s ) ] ) < 1 / 30 ) {

			this.hbTimer = 0.17;

		}

		if ( this.hbTimer > 0 ) {

			this.hbTimer -= dt;
			c.handbrake = 1;
			c.throttle = Math.max( c.throttle, 0.3 );
			if ( this.hbTimer <= 0 ) this.hbTimer = - 1.8; // cooldown

		} else {

			c.handbrake = 0;
			if ( this.hbTimer < 0 ) this.hbTimer = Math.min( 0, this.hbTimer + dt );

		}

		// --- racecraft: move over when a car is close beside / ahead ---------------
		let bias = 0;
		if ( ctx.other ) {

			const ds = ctx.other.s - s;
			if ( Math.abs( ds ) < 14 ) {

				const dl = ctx.other.lateral - p.lateral;
				if ( Math.abs( dl ) < 2.6 ) bias = - Math.sign( dl || 1 ) * ( 2.6 - Math.abs( dl ) ) * 0.9;

			}

		}

		this.laneBias = damp( this.laneBias, bias, 1.8, dt );

		// occasional small mistake keeps it human
		this.mistakeTimer -= dt;
		if ( this.mistakeTimer <= 0 ) {

			this.mistakeTimer = 10 + Math.random() * 18;
			if ( Math.random() > this.skill ) this.mistake = 1.2;

		}

		// --- stuck recovery ---------------------------------------------------
		if ( ctx.raceActive && speed < 1.2 ) this.stuckTimer += dt;
		else this.stuckTimer = 0;
		this.needsRespawn = this.stuckTimer > 3;

	}

}
