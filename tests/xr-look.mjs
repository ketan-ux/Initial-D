// Visual XR check under IWER: enter VR from the title, snapshot the stereo
// framebuffer in the garage and in the cockpit (what the headset shows).
// Usage: node tests/xr-look.mjs <outPrefix> [query]
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire( import.meta.url );
const { chromium } = require( 'playwright' );
const [ out = '/tmp/xrlook', q = '' ] = process.argv.slice( 2 );
const browser = await chromium.launch( { args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1000, height: 500 } } );
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( m ) => m.type() === 'error' && errors.push( m.text().slice( 0, 200 ) ) );
await page.goto( 'http://localhost:5173/tests/xr-test.html?preset=quest&noadapt' + q );
await page.waitForFunction( () => window.__game && window.__game.state !== 'loading', null, { timeout: 240000 } );
const snap = async ( name ) => {

	const url = await page.evaluate( () => window.__xrSnap() );
	if ( url ) writeFileSync( `${out}-${name}.png`, Buffer.from( url.split( ',' )[ 1 ], 'base64' ) );
	console.log( 'snap', name, !! url );

};

await page.click( '.title [data-act="vr"]' );
await page.waitForTimeout( 5000 );
await snap( 'garage' );
await page.evaluate( () => window.__game.startRace() );
await page.waitForTimeout( 6000 );
await snap( 'cockpit' );
if ( process.env.XRSTEPS ) for ( const step of process.env.XRSTEPS.split( '|' ) ) {

	const k = step.slice( 0, step.indexOf( '=' ) ), v = step.slice( step.indexOf( '=' ) + 1 );
	if ( k === 'eval' ) console.log( 'eval', JSON.stringify( await page.evaluate( v ) ) );
	else if ( k === 'wait' ) await page.waitForTimeout( +v );
	else if ( k === 'snap' ) await snap( v );

}

console.log( 'errors', errors.length, [ ...new Set( errors ) ].slice( 0, 6 ) );
await browser.close();
