// Headless control check: drive forward, stop, reverse, and steer while
// reversing, logging speed along the heading and the heading itself.
import { Track } from '../src/world/Track.js';
import { defineLotsNode } from './lots-node.mjs';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { CARS } from '../src/vehicle/carSpecs.js';
const track = new Track();
defineLotsNode( track );
const p = new VehiclePhysics( CARS[ process.argv[ 2 ] || 'ae86' ], track );
p.reset( track.tags.longStraight + 40, 0, 0 );
p.assist = 0.5;
const dt = 1 / 120;
const phases = process.argv[ 3 ] === 'turn' ? [
	[ 'creep 2s', 2, { throttle: 0.35 } ],
	[ 'creep + full left 3s', 3, { throttle: 0.35, steer: 1 } ],
	[ 'accelerate 3s', 3, { throttle: 1 } ],
	[ 'full left at speed 1.5s', 1.5, { throttle: 0.5, steer: 1 } ],
	[ 'brake to stop', 3, { brake: 1 } ]
] : [
	[ 'throttle 3s', 3, { throttle: 1 } ],
	[ 'brake (hold S) 4s', 4, { brake: 1 } ],
	[ 'reverse: keep holding S 3s', 3, { brake: 1 } ],
	[ 'reverse + steer left 2s', 2, { brake: 1, steer: 1 } ],
	[ 'throttle again 2s', 2, { throttle: 1 } ]
];
const deg = ( r ) => ( r * 57.3 ).toFixed( 0 );
let t = 0;
for ( const [ name, dur, ctl ] of phases ) {

	const h0 = p.heading;
	for ( let k = 0; k < dur / dt; k ++ ) {

		Object.assign( p.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerIsAbsolute: false }, ctl );
		p.applyAutoReverseControls();
		p.step( dt );
		p.events.length = 0;
		t += dt;

	}

	const vLong = p.vx * Math.sin( p.heading ) + p.vz * Math.cos( p.heading );
	const yr = p.yawRate, R = Math.abs( yr ) > 0.01 ? Math.abs( vLong / yr ) : Infinity;
	console.log( `${name.padEnd( 28 )} gear ${String( p.gear ).padStart( 2 )}  vLong ${vLong.toFixed( 2 ).padStart( 6 )} m/s  heading change ${deg( p.heading - h0 ).padStart( 4 )}°  turn radius ${isFinite( R ) ? R.toFixed( 1 ) + ' m' : '—'}` );

}
