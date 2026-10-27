// Small numeric helpers shared across systems. Kept dependency-free so the
// track generator and physics can also run in Node for offline validation.

export const clamp = ( v, lo, hi ) => ( v < lo ? lo : v > hi ? hi : v );
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const invLerp = ( a, b, v ) => clamp( ( v - a ) / ( b - a ), 0, 1 );
export const smoothstep = ( a, b, v ) => {

	const t = invLerp( a, b, v );
	return t * t * ( 3 - 2 * t );

};

// Frame-rate independent exponential smoothing toward a target.
export const damp = ( current, target, lambda, dt ) => lerp( current, target, 1 - Math.exp( - lambda * dt ) );

export const wrapAngle = ( a ) => {

	while ( a > Math.PI ) a -= Math.PI * 2;
	while ( a < - Math.PI ) a += Math.PI * 2;
	return a;

};

export const sign = ( v ) => ( v < 0 ? - 1 : 1 );

// Deterministic PRNG so the mountain, trees and liveries are identical on every device.
export function mulberry32( seed ) {

	let a = seed >>> 0;
	return function () {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// Cheap 2D value noise + fBm used for terrain relief.
function hash2( x, y ) {

	let h = Math.imul( x | 0, 374761393 ) + Math.imul( y | 0, 668265263 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;

}

export function valueNoise2( x, y ) {

	const xi = Math.floor( x ), yi = Math.floor( y );
	const xf = x - xi, yf = y - yi;
	const u = xf * xf * ( 3 - 2 * xf ), v = yf * yf * ( 3 - 2 * yf );
	const a = hash2( xi, yi ), b = hash2( xi + 1, yi );
	const c = hash2( xi, yi + 1 ), d = hash2( xi + 1, yi + 1 );
	return lerp( lerp( a, b, u ), lerp( c, d, u ), v ) * 2 - 1;

}

export function fbm2( x, y, octaves = 4 ) {

	let amp = 0.5, freq = 1, sum = 0;
	for ( let i = 0; i < octaves; i ++ ) {

		sum += amp * valueNoise2( x * freq, y * freq );
		freq *= 2.03;
		amp *= 0.5;

	}

	return sum;

}

export const KMH = 3.6;
export const MPH = 2.236936;
