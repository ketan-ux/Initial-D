// Offline sanity check for the procedural pass: length, elevation, clearance.
import { Track } from '../src/world/Track.js';
const t = new Track();
console.log( 'length m', t.length.toFixed( 0 ), 'samples', t.count );
console.log( 'bounds', JSON.stringify( Object.fromEntries( Object.entries( t.bounds ).map( ( [ k, v ] ) => [ k, +v.toFixed( 1 ) ] ) ) ) );
console.log( 'tags', JSON.stringify( t.tags ), 'start', t.startS, 'finish', t.finishS );
const issues = t.selfCheck( +( process.argv[ 2 ] || 22 ) );
console.log( 'clearance issues', issues.length );
const seen = new Set();
for ( const i of issues ) {

	const k = Math.round( i.s1 / 50 ) + ':' + Math.round( i.s2 / 50 );
	if ( seen.has( k ) ) continue; seen.add( k );
	console.log( '  s1', i.s1, 's2', i.s2, 'd', i.d.toFixed( 1 ), 'sec', t.sectionAt( i.s1 ), '/', t.sectionAt( i.s2 ) );

}
let vmin = 1e9, vmax = 0;
for ( const v of t.speedProfile ) { vmin = Math.min( vmin, v ); vmax = Math.max( vmax, v ); }
console.log( 'AI speed km/h min', ( vmin * 3.6 ).toFixed( 0 ), 'max', ( vmax * 3.6 ).toFixed( 0 ) );
let time = 0; for ( let i = 0; i < t.count - 1; i ++ ) time += t.spacing / Math.max( 5, t.speedProfile[ i ] * 0.85 );
console.log( 'est lap s', time.toFixed( 0 ) );
