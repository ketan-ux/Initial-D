import { clamp, lerp, sign, wrapAngle, damp } from '../core/math.js';
import { torqueAt } from './carSpecs.js';
import { ROAD } from '../world/trackData.js';

const G = 9.81;

// Simplified Pacejka "magic formula" lateral curve: peaks near 7-8 degrees
// of slip and falls off afterwards, which is what makes drifting possible.
function magic( alpha, B = 9.5, C = 1.45, E = 0.2 ) {

	const x = B * alpha;
	return Math.sin( C * Math.atan( x - E * ( x - Math.atan( x ) ) ) );

}

/**
 * Arcade-sim rear-wheel-drive car on the track surface.
 * World frame: forward = (sin ψ, cos ψ) in XZ, left = (cos ψ, -sin ψ).
 * Lateral quantities are positive to the LEFT; yaw rate > 0 turns left.
 */
export class VehiclePhysics {

	constructor( spec, track ) {

		this.spec = spec;
		this.track = track;
		const wb = spec.wheelbase;
		this.a = wb * ( 1 - spec.weightFront ); // CG -> front axle
		this.b = wb * spec.weightFront; // CG -> rear axle
		this.mass = spec.mass;
		this.inertia = spec.mass * 1.5 * spec.inertiaScale;
		this.reset( 0, 0 );

	}

	reset( s, lateral = 0, speed = 0 ) {

		const p = this.track.pointAt( s, lateral );
		this.x = p.x; this.z = p.z; this.y = p.y;
		this.heading = Math.atan2( p.fx, p.fz );
		this.vx = p.fx * speed; this.vz = p.fz * speed;
		this.yawRate = 0;
		this.steerAngle = 0;
		this.rpm = this.spec.engine.idle;
		this.gear = 1; // 0 = neutral, -1 = reverse
		this.shiftTimer = 0;
		this.ax = 0; this.ay = 0;
		this.axS = 0; this.ayS = 0;
		this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
		this.wheelSpin = 0;
		this.wheelspinAmt = 0;
		this.slipAngle = 0;
		this.frontSlip = 0; this.rearSlip = 0;
		this.discHeat = 0;
		this.trackHint = p.index;
		this.proj = this.track.project( this.x, this.z, this.trackHint );
		this.s = this.proj.s;
		this.lateral = this.proj.lateral;
		this.inGutter = [ false, false, false, false ];
		this.gutterHook = 0;
		this.wallContact = 0;
		this.wallImpact = 0;
		this.scrape = 0;
		this.limiterHit = false;
		this.reverseTimer = 0;
		this.distance = 0;
		this.odometer = 0;
		this.airborne = 0;
		this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerIsAbsolute: false };
		this.assist = 0.5;
		this.autoShift = true;
		this.events = [];

	}

	get speed() {

		return Math.hypot( this.vx, this.vz );

	}

	get forwardSpeed() {

		return this.vx * Math.sin( this.heading ) + this.vz * Math.cos( this.heading );

	}

	shiftUp() {

		if ( this.shiftTimer > 0 ) return;
		if ( this.gear < this.spec.gears.length ) {

			this.gear = this.gear === - 1 ? 0 : this.gear + 1;
			this.shiftTimer = 0.14;
			this.events.push( { type: 'shift', dir: 1, gear: this.gear } );

		}

	}

	shiftDown() {

		if ( this.shiftTimer > 0 ) return;
		if ( this.gear > - 1 ) {

			// refuse money-shifts that would over-rev badly (rev-match otherwise)
			if ( this.gear > 1 ) {

				const r = this._rpmForGear( this.gear - 1 );
				if ( r > this.spec.engine.limiter * 1.06 ) {

					this.events.push( { type: 'shiftDenied' } );
					return;

				}

			}

			this.gear = this.gear === 0 ? - 1 : this.gear - 1;
			if ( this.gear === 0 && this.speed > 3 ) this.gear = 1; // skip neutral when rolling
			this.shiftTimer = 0.14;
			this.events.push( { type: 'shift', dir: - 1, gear: this.gear } );

		}

	}

	setGear( g ) {

		if ( g === this.gear ) return;
		if ( g > 0 && this._rpmForGear( g ) > this.spec.engine.limiter * 1.06 ) {

			this.events.push( { type: 'shiftDenied' } );
			return;

		}

		const dir = g > this.gear ? 1 : - 1;
		this.gear = g;
		this.shiftTimer = 0.14;
		this.events.push( { type: 'shift', dir, gear: g } );

	}

	_ratio( g ) {

		if ( g === - 1 ) return this.spec.reverse * this.spec.finalDrive;
		if ( g <= 0 ) return 0;
		return this.spec.gears[ g - 1 ] * this.spec.finalDrive;

	}

	_rpmForGear( g ) {

		const wheelRps = Math.abs( this.forwardSpeed ) / ( 2 * Math.PI * this.spec.wheelRadius );
		return wheelRps * this._ratio( g ) * 60;

	}

	step( dt ) {

		const spec = this.spec, eng = spec.engine, c = this.controls;
		const sinH = Math.sin( this.heading ), cosH = Math.cos( this.heading );
		let vLong = this.vx * sinH + this.vz * cosH;
		let vLat = this.vx * cosH - this.vz * sinH;
		const speed = Math.hypot( vLong, vLat );

		// --- track surface -------------------------------------------------
		const pr = this.track.project( this.x, this.z, this.trackHint, this.proj );
		this.trackHint = pr.index;
		const prevS = this.s;
		this.s = pr.s;
		this.lateral = pr.lateral;
		this.distance += Math.max( - 5, Math.min( 5, this.s - prevS ) );

		// gutter detection per wheel (FL, FR, RL, RR)
		const hw = ROAD.halfWidth, gw = ROAD.gutterWidth;
		const tw = spec.track / 2;
		const leftDot = cosH * pr.lx - sinH * pr.lz; // car-left · track-left (approx cos of relative heading)
		const wheelLats = [ tw, - tw, tw, - tw ];
		let gutterInside = 0;
		for ( let i = 0; i < 4; i ++ ) {

			const d = pr.lateral + wheelLats[ i ] * leftDot;
			const g = Math.abs( d ) - hw;
			const inG = g > 0.05 && g < gw + 0.1;
			if ( inG && ! this.inGutter[ i ] && speed > 8 ) this.events.push( { type: 'gutterClip', wheel: i, speed } );
			this.inGutter[ i ] = inG;
			// inside of the corner = same side as curvature sign
			if ( inG && Math.sign( d ) === Math.sign( pr.curv ) && Math.abs( pr.curv ) > 0.008 ) gutterInside ++;

		}

		const hooking = gutterInside >= 2 && speed > 10;
		if ( hooking && this.gutterHook < 0.5 ) this.events.push( { type: 'gutterHook', speed } );
		this.gutterHook = damp( this.gutterHook, hooking ? 1 : 0, 10, dt );

		// --- steering ---------------------------------------------------------
		let lock = spec.steerLock;
		let steerTarget;
		if ( c.steerIsAbsolute ) {

			steerTarget = clamp( c.steer, - 1, 1 ) * lock; // wheel / analog stick drives the rack directly

		} else {

			// digital input: speed-sensitive lock for stability
			lock = lock / ( 1 + Math.max( 0, speed - 8 ) / 22 );
			steerTarget = clamp( c.steer, - 1, 1 ) * lock;

		}

		// countersteer assist: steer toward the direction of travel when sliding
		const beta = speed > 3 ? Math.atan2( vLat, Math.abs( vLong ) ) : 0;
		this.slipAngle = beta;
		if ( this.assist > 0 && speed > 6 && vLong > 0 ) {

			const assistAmt = this.assist * clamp( ( Math.abs( beta ) - 0.05 ) * 3, 0, 1 );
			steerTarget = lerp( steerTarget, clamp( beta * 1.1 + c.steer * lock * 0.35, - spec.steerLock, spec.steerLock ), assistAmt * ( c.steerIsAbsolute ? 0.35 : 0.85 ) );

		}

		const steerRate = c.steerIsAbsolute ? 14 : 4.2;
		this.steerAngle += clamp( steerTarget - this.steerAngle, - steerRate * dt, steerRate * dt );
		const delta = this.steerAngle;

		// --- loads ----------------------------------------------------------
		const m = this.mass, L = spec.wheelbase, h = spec.cgHeight;
		const dFz = m * this.axS * h / L;
		const FzF = Math.max( 400, m * G * this.b / L - dFz );
		const FzR = Math.max( 400, m * G * this.a / L + dFz );
		const mu = spec.grip * ( 1 + this.gutterHook * 0.32 );

		// --- engine & drivetrain ---------------------------------------------
		this.shiftTimer = Math.max( 0, this.shiftTimer - dt );
		const ratio = this._ratio( this.gear );
		const wheelRpm = Math.abs( vLong ) / ( 2 * Math.PI * spec.wheelRadius ) * 60;
		let engineRpm = wheelRpm * ratio;
		const throttle = clamp( c.throttle, 0, 1 );
		// clutch slip at launch keeps revs up
		const launchRpm = eng.idle + ( eng.redline - eng.idle ) * 0.45;
		if ( this.gear !== 0 && engineRpm < launchRpm ) engineRpm = lerp( Math.max( engineRpm, eng.idle ), launchRpm, throttle * clamp( 1 - wheelRpm * ratio / launchRpm, 0, 1 ) );
		if ( this.gear === 0 ) engineRpm = lerp( this.rpm, eng.idle + throttle * ( eng.limiter - eng.idle ), 1 - Math.exp( - dt * ( throttle > 0.1 ? 6 : 3 ) ) );

		// wheelspin raises revs above road speed
		engineRpm *= 1 + this.wheelspinAmt * 0.35;
		engineRpm = Math.max( eng.idle * 0.95, engineRpm );
		this.limiterHit = engineRpm >= eng.limiter;
		let torque = torqueAt( eng, Math.min( engineRpm, eng.limiter ) ) * throttle;
		if ( this.limiterHit ) torque = ( Math.random() < 0.5 ) ? 0 : torque * 0.3;
		if ( this.shiftTimer > 0 || this.gear === 0 ) torque = 0;
		// engine braking off-throttle
		const engineBrake = this.gear !== 0 && this.shiftTimer === 0 ? ( 1 - throttle ) * ( engineRpm / eng.redline ) * 26 : 0;
		const driveDir = this.gear === - 1 ? - 1 : 1;
		let Fdrive = ( torque * ratio * 0.88 ) / spec.wheelRadius * driveDir;
		Fdrive -= sign( vLong ) * engineBrake * ratio / spec.wheelRadius * ( Math.abs( vLong ) > 0.5 ? 1 : 0 );
		this.rpm = lerp( this.rpm, engineRpm, 1 - Math.exp( - dt * 18 ) );

		// --- longitudinal forces -----------------------------------------------
		const brake = clamp( c.brake, 0, 1 );
		const hb = clamp( c.handbrake, 0, 1 );
		const brakeF = spec.brakeForce * brake;
		const movingSign = Math.abs( vLong ) > 0.3 ? sign( vLong ) : 0;
		let FxF = - movingSign * Math.min( brakeF * 0.64, mu * FzF * 1.0 );
		let FxR = Fdrive - movingSign * brakeF * 0.36;
		if ( hb > 0 ) FxR -= movingSign * mu * FzR * 0.85 * hb;
		// friction circle at the rear: excess drive becomes wheelspin
		const rearCap = mu * FzR;
		let spin = 0;
		if ( Math.abs( FxR ) > rearCap ) {

			spin = ( Math.abs( FxR ) - rearCap ) / rearCap;
			FxR = sign( FxR ) * rearCap * ( 1 - Math.min( 0.25, spin * 0.2 ) );

		}

		this.wheelspinAmt = damp( this.wheelspinAmt, clamp( spin, 0, 1.5 ) * ( throttle > 0.2 ? 1 : 0 ), 8, dt );
		this.discHeat = clamp( this.discHeat + ( brake * Math.min( speed, 30 ) / 30 * 0.6 - 0.12 ) * dt, 0, 1 );

		// --- lateral tyre forces ----------------------------------------------
		let FyF = 0, FyR = 0;
		const lowSpeed = Math.abs( vLong ) < 2.5;
		if ( ! lowSpeed ) {

			const vl = Math.abs( vLong );
			const alphaF = Math.atan2( vLat + this.a * this.yawRate, vl ) - delta * sign( vLong );
			const alphaR = Math.atan2( vLat - this.b * this.yawRate, vl );
			this.frontSlip = alphaF; this.rearSlip = alphaR;
			const capF = Math.sqrt( Math.max( 0, ( mu * FzF ) ** 2 - FxF * FxF ) );
			let capR = Math.sqrt( Math.max( 0, ( rearCap ) ** 2 - FxR * FxR ) );
			capR = Math.max( capR, rearCap * 0.22 );
			if ( hb > 0 ) capR *= 1 - 0.62 * hb;
			FyF = - capF * magic( alphaF, 10, 1.5 );
			FyR = - capR * magic( alphaR, 9, 1.42 );

		} else {

			this.frontSlip = this.rearSlip = 0;

		}

		// --- aero, rolling, gravity on the grade -------------------------------
		const drag = 0.5 * 1.2 * spec.dragCoef * 1.9 * speed;
		const roll = 12 * m * 0.0012;
		const fLongWorld = - drag * vLong - roll * sign( vLong ) * ( Math.abs( vLong ) > 0.2 ? 1 : 0 );
		const fLatWorld = - drag * vLat;
		// gravity along the slope (downhill pulls forward) and toward the low side of the camber
		const trackFwdDotCar = pr.fx * sinH + pr.fz * cosH;
		const trackFwdDotLeft = pr.fx * cosH - pr.fz * sinH;
		const gSlope = - m * G * pr.grade;
		const gBank = m * G * Math.tan( pr.bank ) * 0.6;
		const trackLeftDotCar = pr.lx * sinH + pr.lz * cosH;
		const trackLeftDotLeft = pr.lx * cosH - pr.lz * sinH;

		let Flong = FxR + FxF * Math.cos( delta ) - FyF * Math.sin( delta ) + fLongWorld + gSlope * trackFwdDotCar + gBank * trackLeftDotCar;
		let Flat = FyR + FyF * Math.cos( delta ) + FxF * Math.sin( delta ) + fLatWorld + gSlope * trackFwdDotLeft + gBank * trackLeftDotLeft;

		// --- integrate ------------------------------------------------------
		if ( lowSpeed ) {

			// kinematic bicycle at walking pace (avoids slip-angle singularities)
			const targetYaw = vLong * Math.tan( delta ) / L;
			this.yawRate = damp( this.yawRate, targetYaw, 12, dt );
			Flat = - vLat * m * 6; // scrub lateral motion
			if ( Math.abs( vLong ) < 0.4 && throttle < 0.05 && brake > 0.05 ) Flong = - vLong * m * 8;

		} else {

			const torqueZ = this.a * ( FyF * Math.cos( delta ) + FxF * Math.sin( delta ) ) - this.b * FyR;
			this.yawRate += ( torqueZ / this.inertia ) * dt;
			// a touch of yaw damping for stability (more with assist)
			this.yawRate *= 1 - dt * ( 0.4 + this.assist * 0.8 );

		}

		const axLocal = Flong / m, ayLocal = Flat / m;
		vLong += ( axLocal + vLat * this.yawRate ) * dt;
		vLat += ( ayLocal - vLong * this.yawRate ) * dt;
		if ( lowSpeed && brake > 0.05 && Math.abs( vLong ) < 0.35 && throttle < 0.05 ) vLong = 0;
		this.heading = wrapAngle( this.heading + this.yawRate * dt );

		const sH = Math.sin( this.heading ), cH = Math.cos( this.heading );
		this.vx = vLong * sH + vLat * cH;
		this.vz = vLong * cH - vLat * sH;
		this.x += this.vx * dt;
		this.z += this.vz * dt;
		this.odometer += speed * dt;

		this.ax = axLocal; this.ay = ayLocal;
		this.axS = damp( this.axS, axLocal, 6, dt );
		this.ayS = damp( this.ayS, ayLocal, 6, dt );
		this.wheelSpin += ( vLong / spec.wheelRadius ) * dt * ( 1 + this.wheelspinAmt * 0.8 ) * ( hb > 0.5 ? 0.05 : 1 );

		// --- automatic gearbox and reverse logic ----------------------------
		this._autoGear( dt, throttle, brake, vLong );

		// --- walls: guardrails / retaining walls --------------------------
		this._walls( dt );

		// --- body motion (spring-damped pitch & roll from accelerations) ------
		const kP = 60, cP = 9;
		const pitchTarget = clamp( - this.axS * 0.0105, - 0.07, 0.07 );
		const rollTarget = clamp( - this.ayS * 0.0095, - 0.085, 0.085 );
		this.pitchV += ( ( pitchTarget - this.pitch ) * kP - this.pitchV * cP ) * dt;
		this.rollV += ( ( rollTarget - this.roll ) * kP - this.rollV * cP ) * dt;
		this.pitch += this.pitchV * dt;
		this.roll += this.rollV * dt;

		// --- height on the surface ---------------------------------------
		const pr2 = this.track.project( this.x, this.z, this.trackHint, this.proj );
		this.y = pr2.y;

	}

	_autoGear( dt, throttle, brake, vLong ) {

		const eng = this.spec.engine;
		if ( this.autoShift ) {

			if ( this.gear >= 1 && this.shiftTimer === 0 ) {

				const up = eng.redline * 0.93, down = eng.redline * ( throttle > 0.6 ? 0.55 : 0.42 );
				if ( this.rpm > up && this.gear < this.spec.gears.length && this.wheelspinAmt < 0.6 ) this.shiftUp();
				else if ( this.gear > 1 && this._rpmForGear( this.gear ) < down && this._rpmForGear( this.gear - 1 ) < eng.redline * 0.88 ) this.shiftDown();

			}

			// hold brake at a standstill to reverse; throttle to go forward again
			if ( Math.abs( vLong ) < 0.8 && brake > 0.6 && throttle < 0.1 ) {

				this.reverseTimer += dt;
				if ( this.reverseTimer > 0.45 && this.gear !== - 1 ) {

					this.gear = - 1; this.events.push( { type: 'shift', dir: - 1, gear: - 1 } );

				}

			} else this.reverseTimer = 0;

		}

		if ( this.gear === - 1 && this.autoShift ) {

			// controls are swapped while reversing (see applyAutoReverseControls), so
			// `brake` here is the player's accelerator: nearly stopped -> back to 1st
			if ( brake > 0.1 && vLong > - 0.8 ) {

				this.gear = 1; this.events.push( { type: 'shift', dir: 1, gear: 1 } );

			}

		}

	}

	// Swap throttle/brake while reversing in auto mode (called before step).
	applyAutoReverseControls() {

		if ( this.autoShift && this.gear === - 1 ) {

			const c = this.controls;
			const t = c.brake;
			c.brake = c.throttle;
			c.throttle = t;

		}

	}

	_walls( dt ) {

		const pr = this.track.project( this.x, this.z, this.trackHint, this.proj );
		const spec = this.spec;
		const sinH = Math.sin( this.heading ), cosH = Math.cos( this.heading );
		// car corners in car-local (left, forward)
		const hwC = spec.width * 0.48, hl = spec.length * 0.48;
		let maxPen = 0, side = 0, hitF = 0;
		const relLeftDot = cosH * pr.lx - sinH * pr.lz;
		const relFwdDot = sinH * pr.lx + cosH * pr.lz;
		for ( const [ cl, cf ] of [ [ hwC, hl ], [ - hwC, hl ], [ hwC, - hl ], [ - hwC, - hl ] ] ) {

			const d = pr.lateral + cl * relLeftDot + cf * relFwdDot;
			const penL = d - ( pr.wallL - 0.18 );
			const penR = - d - ( pr.wallR - 0.18 );
			if ( penL > maxPen ) {

				maxPen = penL; side = 1; hitF = cf;

			}

			if ( penR > maxPen ) {

				maxPen = penR; side = - 1; hitF = cf;

			}

		}

		this.wallImpact = 0;
		if ( maxPen > 0 ) {

			// push back along the track normal
			this.x -= pr.lx * side * maxPen;
			this.z -= pr.lz * side * maxPen;
			const vn = ( this.vx * pr.lx + this.vz * pr.lz ) * side; // + = into the wall
			const vt = this.vx * pr.fx + this.vz * pr.fz;
			if ( vn > 0 ) {

				const newVn = - vn * 0.22;
				const scrub = clamp( vn * 0.06, 0, 0.35 );
				const newVt = vt * ( 1 - scrub );
				this.vx = pr.fx * newVt + pr.lx * side * newVn;
				this.vz = pr.fz * newVt + pr.lz * side * newVn;
				// glancing hit rotates the car away from the wall
				this.yawRate += - side * sign( hitF ) * vn * 0.09;
				this.yawRate *= 0.8;
				this.wallImpact = vn;
				if ( vn > 1.2 ) this.events.push( { type: 'wallHit', side, impact: vn, front: hitF > 0 } );

			}

			const spd = Math.hypot( this.vx, this.vz );
			this.scrape = spd > 4 ? clamp( spd / 30, 0, 1 ) : 0;
			// scraping costs speed
			const f = 1 - dt * 0.6 * this.scrape;
			this.vx *= f; this.vz *= f;
			this.wallContact = side;

		} else {

			this.scrape = Math.max( 0, this.scrape - dt * 4 );
			this.wallContact = 0;

		}

	}

	// Snapshot for HUD, audio, replay and visuals.
	get telemetry() {

		const sp = this.speed;
		return {
			speed: sp, rpm: this.rpm, gear: this.gear, throttle: this.controls.throttle, brake: this.controls.brake,
			steerAngle: this.steerAngle, wheelSpin: this.wheelSpin, slip: this.slipAngle,
			drift: sp > 7 ? clamp( ( Math.abs( this.rearSlip ) - 0.08 ) * 2.6, 0, 1 ) : 0,
			wheelspin: this.wheelspinAmt, discHeat: this.discHeat, gutter: this.inGutter, hook: this.gutterHook,
			scrape: this.scrape, limiter: this.limiterHit, reversing: this.gear === - 1
		};

	}

}
