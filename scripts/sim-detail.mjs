import { Track } from '../src/world/Track.js';
import { defineLotsNode } from './lots-node.mjs';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { AIDriver } from '../src/vehicle/AIDriver.js';
import { CARS } from '../src/vehicle/carSpecs.js';
const track = new Track(); defineLotsNode( track );
const id = process.argv[ 2 ] || 'ae86';
const p = new VehiclePhysics( CARS[ id ], track ); p.reset( track.startS, 0, 0 ); p.assist = 0.3;
const ai = new AIDriver( p, track, { skill: 0.85 } );
const dt = 1 / 120; let t = 0, lastSlipLog = -10;
while ( p.s < track.finishS && t < 400 ) {

	ai.update( dt, { raceActive: true } ); p.applyAutoReverseControls(); p.step( dt );
	for ( const e of p.events ) if ( e.type === 'wallHit' ) console.log( 'HIT t', t.toFixed( 1 ), 's', p.s.toFixed( 0 ), track.sectionAt( p.s ), 'impact', e.impact.toFixed( 1 ), 'v', ( p.speed * 3.6 ).toFixed( 0 ), 'curv', track.curv[ track.indexAt( p.s ) ].toFixed( 3 ), 'hb', p.controls.handbrake );
	p.events.length = 0;
	if ( Math.abs( p.slipAngle ) > 0.5 && t - lastSlipLog > 1 ) {

		lastSlipLog = t; console.log( 'SLIP t', t.toFixed( 1 ), 's', p.s.toFixed( 0 ), 'slip', p.slipAngle.toFixed( 2 ), 'v', ( p.speed * 3.6 ).toFixed( 0 ), 'curv', track.curv[ track.indexAt( p.s ) ].toFixed( 3 ), 'hb', p.controls.handbrake, 'thr', p.controls.throttle.toFixed( 2 ) );

	}

	t += dt;

}
