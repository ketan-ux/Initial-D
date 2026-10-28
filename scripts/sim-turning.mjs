// Steady-state turning circle at constant speed with full keyboard steer,
// walls removed, versus the tyre grip limit R = v^2 / (mu * g).
import { Track } from '../src/world/Track.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { CARS } from '../src/vehicle/carSpecs.js';
const track = new Track();
track.wallL.fill( 400 ); track.wallR.fill( 400 );
const id = process.argv[ 2 ] || 'ae86';
const assist = +( process.argv[ 3 ] ?? 0.5 );
const dt = 1 / 120;
console.log( `${id}, assist ${assist}` );
for ( const kmh of [ 20, 40, 60, 80, 100 ] ) {

	const v = kmh / 3.6;
	const p = new VehiclePhysics( CARS[ id ], track );
	p.reset( track.tags.longStraight + 20, 0, v );
	p.assist = assist;
	let h0 = 0, t = 0;
	for ( let k = 0; k < 6 / dt; k ++ ) {

		const vL = p.vx * Math.sin( p.heading ) + p.vz * Math.cos( p.heading );
		// hold speed with a simple throttle/brake loop, full left steer
		Object.assign( p.controls, { throttle: vL < v ? 0.6 : 0, brake: vL > v + 1 ? 0.3 : 0, steer: 1, handbrake: 0, steerIsAbsolute: false } );
		p.step( dt ); p.events.length = 0;
		if ( k === Math.round( 3 / dt ) ) h0 = p.heading;
		if ( k > 3 / dt ) t += dt;

	}

	let dh = p.heading - h0; dh = Math.atan2( Math.sin( dh ), Math.cos( dh ) );
	const yaw = p.yawRate, sp = p.speed;
	const R = sp / Math.max( 1e-3, Math.abs( yaw ) );
	const Rgrip = sp * sp / ( CARS[ id ].grip * 9.81 );
	console.log( `${String( kmh ).padStart( 3 )} km/h: speed ${( sp * 3.6 ).toFixed( 0 ).padStart( 3 )} km/h  turn radius ${R.toFixed( 1 ).padStart( 6 )} m  grip-limit radius ${Rgrip.toFixed( 1 ).padStart( 5 )} m  steer ${( p.steerAngle * 57.3 ).toFixed( 1 )}°  slip ${( p.slipAngle * 57.3 ).toFixed( 1 )}°` );

}
