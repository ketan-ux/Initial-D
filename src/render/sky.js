import * as THREE from 'three/webgpu';
import {
	positionLocal, vec2, vec3, float, mix, smoothstep, exp, abs, max, pow, sin, fract, floor,
	dot, atan, length, uniform, step
} from 'three/tsl';
import { uTime, uMoonDir } from './toon.js';

// Vibrant twilight sky dome: indigo zenith, magenta-to-tangerine horizon on
// the sunset side, twinkling stars, a big anime moon and two layers of
// distant mountain silhouettes. One draw call, no textures.

export const FOG_COLOR = new THREE.Color( 0x4d3a78 );

const hash21 = ( p ) => fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) );

export function createSky() {

	const geo = new THREE.SphereGeometry( 1, 48, 24 );
	const mat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide, depthWrite: false } );
	mat.fog = false;

	const uSunset = uniform( new THREE.Vector3( 0.55, 0, 0.83 ).normalize() );
	const dir = positionLocal.normalize();
	const y = dir.y;
	const ang = atan( dir.z, dir.x );
	const horiz = vec2( dir.x, dir.z ).normalize();
	const warm = smoothstep( float( - 0.3 ), float( 1.0 ), dot( horiz, vec2( uSunset.x, uSunset.z ) ) );

	// base gradient
	const horizonCol = mix( vec3( 0.42, 0.26, 0.58 ), vec3( 1.0, 0.56, 0.47 ), warm );
	const midCol = mix( vec3( 0.25, 0.17, 0.46 ), vec3( 0.47, 0.24, 0.52 ), warm.mul( 0.6 ) );
	const zenith = vec3( 0.05, 0.04, 0.16 );
	const tLow = smoothstep( float( - 0.02 ), float( 0.22 ), y );
	const tHigh = smoothstep( float( 0.18 ), float( 0.85 ), y );
	let col = mix( mix( horizonCol, midCol, tLow ), zenith, tHigh );

	// thin hot band right above the horizon (the sun just set)
	const glow = exp( abs( y.sub( 0.015 ) ).mul( - 22 ) ).mul( warm ).mul( 0.55 );
	col = col.add( vec3( 1.0, 0.62, 0.42 ).mul( glow ) );

	// streaky anime clouds lit pink from below
	const cloudBand = smoothstep( float( 0.06 ), float( 0.12 ), y ).mul( smoothstep( float( 0.34 ), float( 0.2 ), y ) );
	const streak = smoothstep( float( 0.55 ), float( 0.8 ), sin( ang.mul( 3.0 ).add( y.mul( 38.0 ) ).add( sin( ang.mul( 11.0 ) ).mul( 0.8 ) ) ) );
	const cloud = cloudBand.mul( streak ).mul( 0.35 );
	col = mix( col, mix( vec3( 0.55, 0.36, 0.66 ), vec3( 1.0, 0.7, 0.75 ), warm ), cloud );

	// stars
	const grid = vec2( ang.mul( 110.0 ), y.mul( 190.0 ) );
	const cell = floor( grid );
	const h = hash21( cell );
	const local = fract( grid ).sub( 0.5 );
	const starShape = float( 1 ).sub( smoothstep( float( 0.04 ), float( 0.22 ), length( local ) ) );
	const twinkle = sin( uTime.mul( h.mul( 3.0 ).add( 1.0 ) ).add( h.mul( 40.0 ) ) ).mul( 0.35 ).add( 0.65 );
	const stars = step( float( 0.986 ), h ).mul( starShape ).mul( twinkle ).mul( smoothstep( float( 0.08 ), float( 0.4 ), y ) ).mul( float( 1 ).sub( cloud.mul( 2.5 ) ).max( 0 ) );
	col = col.add( vec3( 1.0, 0.95, 1.0 ).mul( stars ).mul( 0.9 ) );

	// moon with stepped halo
	const md = max( dot( dir, uMoonDir ), 0 );
	// big anime moon (~3° radius) with two soft crater blotches
	const disc = smoothstep( float( 0.99858 ), float( 0.99878 ), md );
	const crater = smoothstep( float( 0.99955 ), float( 0.99985 ), dot( dir, uMoonDir.add( vec3( 0.012, 0.008, 0 ) ).normalize() ) ).mul( 0.1 )
		.add( smoothstep( float( 0.99975 ), float( 0.99992 ), dot( dir, uMoonDir.add( vec3( - 0.016, - 0.01, 0.004 ) ).normalize() ) ).mul( 0.08 ) );
	const halo = pow( md, float( 420 ) ).mul( 0.38 ).add( pow( md, float( 40 ) ).mul( 0.14 ) );
	col = mix( col, vec3( 1.0, 0.97, 0.88 ).sub( crater ), disc ).add( vec3( 0.75, 0.7, 1.0 ).mul( halo ) );

	// distant mountain silhouettes (far layer, then near layer)
	const ridgeFar = float( 0.045 ).add( sin( ang.mul( 3.0 ).add( 1.1 ) ).mul( 0.03 ) )
		.add( sin( ang.mul( 7.0 ).add( 2.3 ) ).mul( 0.018 ) ).add( sin( ang.mul( 19.0 ) ).mul( 0.006 ) );
	const ridgeNear = float( 0.015 ).add( sin( ang.mul( 2.0 ).add( 4.0 ) ).mul( 0.028 ) )
		.add( sin( ang.mul( 9.0 ).add( 0.7 ) ).mul( 0.012 ) ).add( sin( ang.mul( 27.0 ).add( 3.0 ) ).mul( 0.004 ) );
	const farMask = step( y, ridgeFar );
	const nearMask = step( y, ridgeNear );
	const farCol = mix( vec3( FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b ).mul( 1.1 ), vec3( 0.62, 0.38, 0.55 ), warm.mul( 0.5 ) );
	const nearCol = vec3( FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b ).mul( 0.92 );
	col = mix( col, farCol, farMask );
	col = mix( col, nearCol, nearMask );
	// below horizon fades to fog colour so terrain fog blends seamlessly
	col = mix( col, vec3( FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b ), smoothstep( float( 0.0 ), float( - 0.08 ), y ) );

	mat.colorNode = col;

	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'sky';
	mesh.frustumCulled = false;
	mesh.renderOrder = 1000; // draw after opaque geometry so early-Z rejects hidden sky pixels
	mesh.matrixAutoUpdate = true;
	mesh.userData.follow = true;
	return mesh;

}
