// Drive the real game in headless Chromium and take screenshots.
// Usage: node tests/game-shot.mjs <query> <outPrefix> <script>
// script: comma list of steps: wait:<ms> | shot:<name> | click:<selector> | key:<code> | eval:<js>
import { createRequire } from 'module';
const require = createRequire( import.meta.url );
const { chromium } = require( 'playwright' );
const [ query = '', prefix = '/tmp/shot', script = 'wait:1000,shot:a' ] = process.argv.slice( 2 );
const browser = await chromium.launch( { args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 720 } } );
const errors = [];
page.on( 'console', ( m ) => {

	const t = m.text();
	if ( m.type() === 'error' || m.type() === 'warning' ) errors.push( m.type() + ': ' + t.slice( 0, 300 ) );
	if ( m.type() === 'log' ) console.log( '[log]', t.slice( 0, 200 ) );

} );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message + ' ' + ( e.stack || '' ).split( '\n' ).slice( 0, 3 ).join( ' | ' ) ) );
await page.goto( 'http://localhost:5173/' + query );
await page.waitForFunction( () => window.__game && window.__game.state !== 'loading', null, { timeout: 240000 } ).catch( () => console.log( 'TIMEOUT loading' ) );
for ( const step of script.split( ',' ) ) {

	const [ k, ...rest ] = step.split( ':' );
	const v = rest.join( ':' );
	if ( k === 'wait' ) await page.waitForTimeout( +v );
	else if ( k === 'shot' ) {

		await page.screenshot( { path: `${prefix}-${v}.png` } );
		console.log( 'shot', v );

	} else if ( k === 'click' ) await page.click( v ).catch( ( e ) => console.log( 'click fail', v, e.message ) );
	else if ( k === 'key' ) await page.keyboard.press( v );
	else if ( k === 'eval' ) console.log( 'eval', JSON.stringify( await page.evaluate( v ) ) );

}

console.log( 'ERRORS', errors.length );
for ( const e of [ ...new Set( errors ) ].slice( 0, 25 ) ) console.log( '  ', e );
await browser.close();
