// Headless physics validation: let the AI drive both cars down the pass.
import { Track } from '../src/world/Track.js';
import { defineLotsNode } from './lots-node.mjs';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { AIDriver } from '../src/vehicle/AIDriver.js';
import { CARS } from '../src/vehicle/carSpecs.js';
const track = new Track();
defineLotsNode( track );
for ( const id of [ 'ae86', 'fd3s' ] ) {

	const p = new VehiclePhysics( CARS[ id ], track );
	p.reset( track.startS, 0, 0 );
	p.assist = 0.3;
	const ai = new AIDriver( p, track, { skill: +( process.argv[ 2 ] || 0.85 ) } );
	const dt = 1 / 120;
	let t = 0, maxV = 0, hits = 0, maxSlip = 0, respawns = 0, last = 0;
	const log = [];
	while ( p.s < track.finishS && t < 400 ) {

		ai.update( dt, { raceActive: true } );
		p.applyAutoReverseControls();
		p.step( dt );
		for ( const e of p.events ) if ( e.type === 'wallHit' ) hits ++;
		p.events.length = 0;
		if ( ai.needsRespawn ) {

			respawns ++; p.reset( p.s + 5, 0, 5 ); ai.stuckTimer = 0;

		}

		maxV = Math.max( maxV, p.speed );
		maxSlip = Math.max( maxSlip, Math.abs( p.slipAngle ) );
		if ( t - last > 10 ) {

			last = t; log.push( `t${t.toFixed( 0 )} s${p.s.toFixed( 0 )} v${( p.speed * 3.6 ).toFixed( 0 )} g${p.gear} rpm${p.rpm.toFixed( 0 )} lat${p.lateral.toFixed( 1 )}` );

		}

		t += dt;

	}

	console.log( id, 'time', t.toFixed( 1 ), 's  finished', p.s >= track.finishS, ' vmax km/h', ( maxV * 3.6 ).toFixed( 0 ), ' wallHits', hits, ' maxSlip', maxSlip.toFixed( 2 ), ' respawns', respawns );
	console.log( '  ' + log.join( '\n  ' ) );

}
