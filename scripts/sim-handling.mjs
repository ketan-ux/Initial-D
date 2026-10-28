// Handling probe (walls removed): coast-down drag, and how far the rear
// slides with a gentle 30% steer at a steady throttle — unintended drifting.
import { Track } from '../src/world/Track.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { CARS } from '../src/vehicle/carSpecs.js';
const track = new Track();
track.wallL.fill( 400 ); track.wallR.fill( 400 );
const dt = 1 / 120;
const vlong = ( p ) => p.vx * Math.sin( p.heading ) + p.vz * Math.cos( p.heading );
for ( const id of [ 'ae86', 'fd3s', 's13' ] ) {

	// coast from 100 km/h for 3 s in neutral-ish (no throttle, no brake)
	let p = new VehiclePhysics( CARS[ id ], track );
	p.reset( track.tags.longStraight + 20, 0, 100 / 3.6 ); p.assist = 0.5; p.gear = 3;
	for ( let k = 0; k < 3 / dt; k ++ ) { Object.assign( p.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 0 } ); p.step( dt ); }
	const coast = ( 100 - vlong( p ) * 3.6 ) / 3;
	const out = [ `${id}: coast decel ${coast.toFixed( 1 )} km/h per s` ];
	for ( const [ kmh, steer, thr ] of [ [ 50, 0.3, 0.5 ], [ 80, 0.3, 0.5 ], [ 80, 0.3, 1 ], [ 80, 0.6, 0 ] ] ) {

		p = new VehiclePhysics( CARS[ id ], track );
		p.reset( track.tags.longStraight + 20, 0, kmh / 3.6 ); p.assist = 0.5; p.gear = kmh > 60 ? 3 : 2;
		let maxSlip = 0;
		for ( let k = 0; k < 2.5 / dt; k ++ ) {

			Object.assign( p.controls, { throttle: thr, brake: 0, steer, handbrake: 0, steerIsAbsolute: false } );
			p.step( dt ); p.events.length = 0;
			maxSlip = Math.max( maxSlip, Math.abs( p.slipAngle ) );

		}

		out.push( `${kmh}km/h steer ${steer} thr ${thr}: max slip ${( maxSlip * 57.3 ).toFixed( 0 )}°, end ${( vlong( p ) * 3.6 ).toFixed( 0 )} km/h` );

	}

	console.log( out.join( '\n   ' ) );

}
