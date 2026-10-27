// Node-side copy of the lot widening (Locations.js imports three/webgpu).
export function defineLotsNode( track ) {

	const W = track.wallOffset;
	const lots = [ { s0: 0, s1: 150, side: 1, depth: 20 }, { s0: track.cooldownS - 70, s1: track.cooldownS + 90, side: - 1, depth: 26 } ];
	for ( const lot of lots ) {

		const i0 = track.indexAt( lot.s0 ), i1 = track.indexAt( lot.s1 );
		const arr = lot.side > 0 ? track.wallL : track.wallR;
		for ( let i = i0; i <= i1; i ++ ) arr[ i ] = W + lot.depth * Math.max( 0, Math.min( 1, ( i - i0 ) / 6, ( i1 - i ) / 6 ) );

	}

}
