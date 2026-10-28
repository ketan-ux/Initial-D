import * as THREE from 'three/webgpu';
import { Car } from '../vehicle/Car.js';
import { AIDriver } from '../vehicle/AIDriver.js';
import { CARS } from '../vehicle/carSpecs.js';
import { ReplayRecorder } from './Replay.js';
import { emissiveMaterial } from '../render/toon.js';
import { clamp, damp } from '../core/math.js';
import { settings, progress, saveProgress } from '../core/settings.js';
import { bus } from '../core/events.js';

const PHASES = [ 'staging', 'countdown', 'race', 'finish', 'cooldown' ];

// One downhill run: summit staging -> countdown -> battle/time attack ->
// finish -> AI-driven cooldown into the lot. Owns the cars and race logic;
// cameras, audio and UI are driven by Game from the state exposed here.
export class Race {

	constructor( world, scene, quality, opts ) {

		this.world = world;
		this.track = world.track;
		this.scene = scene;
		this.quality = quality;
		this.mode = opts.mode; // 'battle' | 'timeattack'
		this.radio = opts.radio;
		this.phase = 'staging';
		this.phaseTime = 0;
		this.raceTime = 0;
		this.cars = [];
		const playerSpec = CARS[ opts.carId ];
		const q = quality;
		this.player = new Car( playerSpec, opts.livery ?? 0, this.track, q, {
			isPlayer: true,
			spotlights: q.headlightSpots >= 2 ? 2 : 0,
			shadow: q.shadows === 'headlight' || q.shadows === 'csm'
		} );
		this.player.physics.assist = settings.steeringAssist;
		this.player.physics.autoShift = settings.transmission === 'auto';
		this.cars.push( this.player );
		if ( this.mode === 'battle' ) {

			const rivalId = opts.rivalId ?? ( opts.carId === 'ae86' ? 'fd3s' : 'ae86' );
			this.rival = new Car( CARS[ rivalId ], opts.rivalLivery ?? 0, this.track, q, {
				spotlights: q.headlightSpots >= 4 ? 2 : 0
			} );
			this.rival.physics.assist = 0.35;
			this.ai = new AIDriver( this.rival.physics, this.track, { skill: settings.rivalDifficulty } );
			this.cars.push( this.rival );

		}

		for ( const c of this.cars ) scene.add( c.root );
		// cooldown autopilot for the player after the finish line
		this.autopilot = new AIDriver( this.player.physics, this.track, { skill: 0.6, style: 'grip' } );
		this.recorder = new ReplayRecorder( this.cars );
		this._buildStartLights();
		this.stats = { topSpeed: 0, hooks: 0, wallHits: 0, maxDrift: 0, driftTime: 0 };
		// drift score: points flow while sliding, chained slides raise the multiplier
		this.drift = { score: 0, current: 0, mult: 1, active: false, chain: 0, idle: 0 };
		this.flags = {};
		this.closeTimer = 0;
		this.driftTimer = 0;
		this.lastPosition = 0;
		this.gapS = 0;
		this.finishTimes = new Map();
		this.respawnPrompt = 0;
		this.resetToStart();

	}

	_buildStartLights() {

		// three lamps + one green on the start gantry: a diegetic countdown
		const p = this.track.pointAt( this.track.startS );
		this.lights = [];
		const g = new THREE.Group();
		g.position.set( p.x, p.y + 6.75, p.z );
		g.rotation.y = Math.atan2( p.fx, p.fz );
		const geo = new THREE.SphereGeometry( 0.22, 12, 8 );
		for ( let i = 0; i < 4; i ++ ) {

			const m = new THREE.Mesh( geo, emissiveMaterial( i < 3 ? 0xff2a3a : 0x3dff7a, 0.15 ) );
			m.position.set( ( i - 1.5 ) * 0.7, 0, 0 );
			g.add( m );
			this.lights.push( m );

		}

		this.scene.add( g );
		this.lightGroup = g;

	}

	setLights( n, go = false ) {

		this.lights.forEach( ( m, i ) => {

			m.material.userData.strength.value = go ? ( i === 3 ? 3 : 0.1 ) : ( i < n ? 2.6 : 0.12 );

		} );

	}

	resetToStart() {

		const t = this.track;
		const s0 = t.startS - 6;
		if ( this.rival ) {

			// side by side on the summit line; the challenger starts on the left
			this.player.reset( s0, 1.9 );
			this.rival.reset( s0, - 1.9 );

		} else this.player.reset( s0, 0 );

		for ( const c of this.cars ) {

			c.setHeadlights( true );
			c.physics.controls.handbrake = 1;

		}

		this.phase = 'staging';
		this.phaseTime = 0;
		this.raceTime = 0;
		this.setLights( 0 );
		this.finishTimes.clear();
		this.flags = {};

	}

	get phaseIndex() {

		return PHASES.indexOf( this.phase );

	}

	// Player readied up (or the staging timer ran out).
	beginCountdown() {

		if ( this.phase !== 'staging' ) return;
		this.phase = 'countdown';
		this.phaseTime = 0;
		this.radio?.say( 'countdown', { force: true } );
		this.countdownValue = 4;

	}

	_setPhase( p ) {

		this.phase = p;
		this.phaseTime = 0;
		bus.emit( 'race-phase', p );

	}

	// --- per fixed physics step ------------------------------------------------
	step( dt, controls ) {

		const pp = this.player.physics;
		// player input (or autopilot after the finish)
		if ( this.phase === 'race' ) {

			Object.assign( pp.controls, controls );
			pp.assist = settings.steeringAssist;

		} else if ( this.phase === 'staging' || this.phase === 'countdown' ) {

			pp.controls.throttle = controls.throttle; // let them rev at the line
			pp.controls.brake = 0; pp.controls.steer = 0; pp.controls.handbrake = 1;
			if ( pp.gear > 1 ) pp.gear = 1;

		} else {

			this.autopilot.update( dt, { raceActive: false } );

		}

		if ( this.ai ) {

			const rp = this.rival.physics;
			if ( this.phase === 'race' || this.phase === 'finish' || this.phase === 'cooldown' ) {

				this.ai.update( dt, {
					playerS: this.phase === 'race' ? pp.s : null,
					raceActive: this.phase === 'race',
					other: { s: pp.s, lateral: pp.lateral }
				} );

			} else {

				rp.controls.throttle = this.phase === 'countdown' ? 0.25 + Math.sin( this.phaseTime * 9 ) * 0.2 : 0;
				rp.controls.brake = 0; rp.controls.steer = 0; rp.controls.handbrake = 1;

			}

		}

		for ( const c of this.cars ) {

			c.physics.applyAutoReverseControls();
			c.physics.step( dt );

		}

		if ( this.rival ) this._collide( dt );

	}

	// Simple two-circle-per-car contact between the battling cars.
	_collide( dt ) {

		const a = this.player.physics, b = this.rival.physics;
		const circles = ( p ) => {

			const off = p.spec.length * 0.27;
			const fx = Math.sin( p.heading ), fz = Math.cos( p.heading );
			return [ [ p.x + fx * off, p.z + fz * off ], [ p.x - fx * off, p.z - fz * off ] ];

		};

		const R = 0.92;
		for ( const ca of circles( a ) ) for ( const cb of circles( b ) ) {

			const dx = cb[ 0 ] - ca[ 0 ], dz = cb[ 1 ] - ca[ 1 ];
			const d = Math.hypot( dx, dz );
			if ( d < R * 2 && d > 1e-4 ) {

				const nx = dx / d, nz = dz / d;
				const pen = R * 2 - d;
				const ma = a.mass, mb = b.mass, tot = ma + mb;
				a.x -= nx * pen * ( mb / tot ); a.z -= nz * pen * ( mb / tot );
				b.x += nx * pen * ( ma / tot ); b.z += nz * pen * ( ma / tot );
				const rv = ( b.vx - a.vx ) * nx + ( b.vz - a.vz ) * nz;
				if ( rv < 0 ) {

					const j = - ( 1 + 0.25 ) * rv / ( 1 / ma + 1 / mb );
					a.vx -= ( j / ma ) * nx; a.vz -= ( j / ma ) * nz;
					b.vx += ( j / mb ) * nx; b.vz += ( j / mb ) * nz;
					a.yawRate += ( Math.random() - 0.5 ) * Math.abs( rv ) * 0.06;
					b.yawRate += ( Math.random() - 0.5 ) * Math.abs( rv ) * 0.06;
					if ( Math.abs( rv ) > 1.5 ) bus.emit( 'car-contact', Math.abs( rv ) );

				}

			}

		}

	}

	// --- per rendered frame -------------------------------------------------
	update( dt ) {

		this.phaseTime += dt;
		const t = this.track, pp = this.player.physics;
		for ( const c of this.cars ) c.sync( dt );
		this.recorder.update( dt );

		switch ( this.phase ) {

			case 'staging': {

				if ( ! this.flags.stagingRadio && this.phaseTime > 1.2 ) {

					this.flags.stagingRadio = true;
					if ( this.rival ) {

						this.radio?.say( 'summit_staging', { force: true } );
						this.radio?.say( 'road_clear', { force: true, delay: 0.3 } );

					} else this.radio?.say( 'solo_run', { force: true } );

				}

				break;

			}

			case 'countdown': {

				// radio line (~3 s) then three lamps, one per second, then GO
				const ct = this.phaseTime - 3.2;
				let n = 0;
				if ( ct >= 0 ) n = Math.min( 3, Math.floor( ct ) + 1 );
				if ( n !== this.lastLamp ) {

					this.lastLamp = n;
					if ( n > 0 ) {

						this.setLights( n );
						bus.emit( 'countdown', 4 - n );

					}

				}

				if ( ct >= 3 ) {

					this.setLights( 0, true );
					bus.emit( 'countdown', 0 );
					this._setPhase( 'race' );
					for ( const c of this.cars ) c.physics.controls.handbrake = 0;
					this.raceTime = 0;
					this.recorder.start();
					this.lastLamp = - 1;

				}

				break;

			}

			case 'race': {

				this.raceTime += dt;
				if ( this.phaseTime > 4 ) this.setLights( 0 );
				this._raceLogic( dt );
				break;

			}

			case 'finish': {

				this.raceTime += dt;
				if ( this.rival && ! this.finishTimes.has( this.rival ) && this.rival.physics.s >= t.finishS ) this.finishTimes.set( this.rival, this.raceTime );
				// steer both cars into the cooldown lot and park
				this._parkingAI( dt );
				if ( this.phaseTime > 9 || ( pp.speed < 0.6 && this.phaseTime > 4 ) ) {

					this._setPhase( 'cooldown' );
					this.recorder.stop();
					this.radio?.say( 'cooldown' );
					this._saveResults();

				}

				break;

			}

			case 'cooldown': {

				this._parkingAI( dt );
				break;

			}

		}

		// stats
		this.stats.topSpeed = Math.max( this.stats.topSpeed, pp.speed );

	}

	_raceLogic( dt ) {

		const t = this.track, pp = this.player.physics, tel = this.player.telemetry;
		// tyre wear: slip energy, rears suffer when drifting
		const w = progress.tireWear[ this.player.spec.id ] || ( progress.tireWear[ this.player.spec.id ] = [ 0, 0, 0, 0 ] );
		const spd = pp.speed;
		const front = Math.abs( pp.frontSlip ) * spd * dt * 0.00009, rear = ( Math.abs( pp.rearSlip ) * spd + pp.wheelspinAmt * 30 ) * dt * 0.00012;
		w[ 0 ] = clamp( w[ 0 ] + front, 0, 1 ); w[ 1 ] = clamp( w[ 1 ] + front, 0, 1 );
		w[ 2 ] = clamp( w[ 2 ] + rear, 0, 1 ); w[ 3 ] = clamp( w[ 3 ] + rear, 0, 1 );
		this.player.model.uniforms.wear.value = Math.max( ...w );

		if ( tel.drift > 0.5 ) {

			this.stats.driftTime += dt;
			this.stats.maxDrift = Math.max( this.stats.maxDrift, Math.abs( pp.slipAngle ) );

		}

		this._scoreDrift( dt, tel, pp );

		// --- spotter radio ---
		const say = ( id, o ) => this.radio?.say( id, o );
		const lead = this.rival ? Math.max( pp.s, this.rival.physics.s ) : pp.s;
		if ( this.phaseTime > 1.4 && ! this.flags.launch ) {

			this.flags.launch = true;
			if ( this.rival ) say( 'launch' );

		}

		if ( ! this.flags.hp1 && lead > t.tags.hairpin1 - 40 ) {

			this.flags.hp1 = true;
			say( this.player.spec.id === 'ae86' && pp.s >= ( this.rival?.physics.s ?? 0 ) ? 'hairpin_86' : 'hairpin_generic' );

		}

		if ( ! this.flags.final && lead > t.tags.fiveHairpins - 140 ) {

			this.flags.final = true;
			say( 'final_section' );

		}

		if ( tel.drift > 0.75 && spd > 16 ) this.driftTimer += dt; else this.driftTimer = 0;
		if ( this.driftTimer > 1.3 ) {

			say( 'drift' ); this.driftTimer = - 20;

		}

		if ( Math.abs( pp.slipAngle ) > 1.25 && spd > 6 ) say( 'spin' );

		for ( const e of pp.events ) {

			if ( e.type === 'gutterHook' ) {

				this.stats.hooks ++;
				say( 'gutter' );
				this.recorder.mark( 'hook' );

			} else if ( e.type === 'wallHit' ) {

				this.stats.wallHits ++;
				// a hit wipes the unbanked slide and resets the chain
				if ( e.impact > 2 ) {

					this.drift.current = 0; this.drift.mult = 1; this.drift.chain = 0;

				}
				if ( e.impact > 4 ) say( 'guardrail' );

			}

		}

		if ( this.rival ) {

			const rp = this.rival.physics;
			const ahead = pp.s >= rp.s;
			const position = ahead ? 1 : 2;
			if ( this.lastPosition === 2 && position === 1 && this.phaseTime > 6 ) {

				say( 'pass_player' );
				this.recorder.mark( 'overtake' );

			}

			this.lastPosition = position;
			const ds = rp.s - pp.s;
			this.gapS = damp( this.gapS, ds / Math.max( 8, ( pp.speed + rp.speed ) * 0.5 ), 3, dt );
			if ( Math.abs( this.gapS ) < 0.45 ) this.closeTimer += dt; else this.closeTimer = 0;
			if ( this.closeTimer > 6 ) {

				say( 'close_battle' ); this.closeTimer = - 30;

			}

			if ( this.gapS > 2.5 ) say( 'rival_ahead' );
			if ( this.ai.needsRespawn ) {

				this.rival.reset( rp.s + 4, 0, 6 );
				this.ai.stuckTimer = 0;

			}

		}

		// (physics events are cleared by Game after audio/haptics consume them)

		// stuck / wrong-way prompt
		const fwdDot = Math.sin( pp.heading ) * pp.proj.fx + Math.cos( pp.heading ) * pp.proj.fz;
		this.respawnPrompt = ( spd < 1.5 && this.phaseTime > 5 ) || fwdDot < - 0.3 ? this.respawnPrompt + dt : 0;

		// finish
		if ( pp.s >= t.finishS ) {

			this.finishTimes.set( this.player, this.raceTime );
			if ( this.rival && this.rival.physics.s >= t.finishS && ! this.finishTimes.has( this.rival ) ) this.finishTimes.set( this.rival, this.raceTime - 0.01 );
			this.won = ! this.rival || ! this.finishTimes.has( this.rival ) || this.finishTimes.get( this.rival ) > this.raceTime;
			this.playerTime = this.raceTime;
			this._setPhase( 'finish' );
			const best = progress.bestTimes[ this.player.spec.id ];
			this.newRecord = ! best || this.raceTime < best;
			say( this.rival ? ( this.won ? 'finish_win' : 'finish_lose' ) : 'finish_solo', { force: true } );
			if ( this.newRecord ) say( 'new_record', { force: true, delay: 0.5 } );
			this.recorder.mark( 'finish' );

		}

		if ( this.rival && ! this.finishTimes.has( this.rival ) && this.rival.physics.s >= t.finishS ) this.finishTimes.set( this.rival, this.raceTime );

	}

	_scoreDrift( dt, tel, pp ) {

		const d = this.drift;
		const slipDeg = Math.abs( pp.slipAngle ) * 57.3;
		const sliding = tel.drift > 0.3 && pp.speed > 8 && slipDeg > 8;
		if ( sliding ) {

			d.active = true;
			d.idle = 0;
			d.chain += dt;
			// angle x speed, scaled by the chain multiplier
			d.current += dt * slipDeg * ( pp.speed * 3.6 / 50 ) * d.mult * 2.2;
			if ( d.chain > 1.6 && d.mult < 5 ) {

				d.mult = Math.min( 5, d.mult + 0.5 );
				d.chain = 0;

			}

		} else {

			d.active = false;
			d.idle += dt;
			if ( d.current > 0 && d.idle > 0.6 ) {

				d.score += d.current;
				d.current = 0;

			}

			if ( d.idle > 2.5 ) d.mult = 1;

		}

	}

	_parkingAI() {

		const lot = this.track.lots?.find( ( l ) => l.name === 'cooldown' );
		if ( ! lot ) return;
		const drivers = [ [ this.autopilot, this.player ] ];
		if ( this.ai ) drivers.push( [ this.ai, this.rival ] );
		drivers.forEach( ( [ ai, car ], k ) => {

			const p = car.physics;
			const parkS = lot.parkS + k * 7;
			const remain = parkS - p.s;
			ai.targetLateral = p.s > lot.s0 + 20 ? lot.parkLateral + ( k ? 0 : 0 ) : null;
			ai.targetSpeedOverride = clamp( remain * 0.4, 0, 14 ); // roll into the lot at ~50 km/h
			if ( remain < 1.5 ) {

				ai.targetSpeedOverride = 0;
				p.controls.throttle = 0;
				p.controls.brake = 1;
				p.controls.handbrake = p.speed < 0.5 ? 1 : 0;

			}

		} );

	}

	respawn() {

		const pp = this.player.physics;
		this.player.reset( pp.s + 2, 0, 4 );
		this.respawnPrompt = 0;

	}

	_saveResults() {

		progress.races = ( progress.races || 0 ) + 1;
		if ( this.won && this.rival ) progress.wins = ( progress.wins || 0 ) + 1;
		const id = this.player.spec.id;
		if ( this.playerTime && ( ! progress.bestTimes[ id ] || this.playerTime < progress.bestTimes[ id ] ) ) progress.bestTimes[ id ] = this.playerTime;
		saveProgress();

	}

	// HUD / phone / slate data.
	hudData() {

		const pp = this.player.physics;
		const cars = this.cars.map( ( c ) => ( {
			x: c.physics.x, z: c.physics.z, heading: c.physics.heading, color: c === this.player ? '#ff9a1a' : '#ffd23f', me: c === this.player
		} ) );
		const span = this.track.finishS - this.track.startS;
		const position = this.rival ? ( pp.s >= this.rival.physics.s ? 1 : 2 ) : 1;
		return {
			telemetry: this.player.telemetry, spec: this.player.spec,
			position, total: this.cars.length, time: this.phase === 'race' || this.phase === 'finish' ? this.raceTime : 0,
			gap: this.rival && this.phase === 'race' ? this.gapS : null,
			heading: pp.heading, center: { x: pp.x, z: pp.z }, cars,
			section: SECTION_NAMES[ this.track.sectionAt( pp.s ) ] ?? '',
			s: pp.s, finishS: this.track.finishS, autoShift: pp.autoShift, handbrake: pp.controls.handbrake,
			progress: ( pp.s - this.track.startS ) / span,
			rivalProgress: this.rival ? ( this.rival.physics.s - this.track.startS ) / span : null,
			drift: this.drift
		};

	}

	results() {

		const rivalTime = this.rival ? this.finishTimes.get( this.rival ) : null;
		return {
			mode: this.mode, won: this.won, time: this.playerTime, rivalTime, newRecord: this.newRecord,
			best: progress.bestTimes[ this.player.spec.id ], topSpeed: this.stats.topSpeed, hooks: this.stats.hooks,
			wallHits: this.stats.wallHits, driftTime: this.stats.driftTime, maxDrift: this.stats.maxDrift,
			driftScore: Math.round( this.drift.score + this.drift.current ),
			car: this.player.spec
		};

	}

	dispose() {

		for ( const c of this.cars ) {

			this.scene.remove( c.root );
			c.model.dispose();

		}

		this.scene.remove( this.lightGroup );

	}

}

export const SECTION_NAMES = {
	summit: 'Summit', esses: 'Esses', fast: 'Fast section', hairpin1: '1st Hairpin', carousel: 'Carousel',
	longStraight: 'Long straight', hairpin2: '2nd Hairpin', fiveHairpins: 'Five Hairpins', finalSection: 'Final section',
	finish: 'Finish', cooldown: 'Cooldown lot'
};
