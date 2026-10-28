// Enter VR via IWER, start a race, grab the wheel with both hands and turn it.
import { createRequire } from 'module';
const require = createRequire( import.meta.url );
const { chromium } = require( 'playwright' );
const out = process.argv[ 2 ] || '/tmp/xr';
const browser = await chromium.launch( { args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1000, height: 500 } } );
page.setDefaultTimeout( 180000 );
const errors = [];
page.on( 'console', ( m ) => {

	if ( m.type() === 'error' || m.type() === 'warning' ) errors.push( m.type() + ': ' + m.text().slice( 0, 300 ) );
	if ( m.type() === 'log' ) console.log( '[log]', m.text().slice( 0, 200 ) );

} );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message + ' ' + ( e.stack || '' ).split( '\n' ).slice( 0, 3 ).join( ' | ' ) ) );
await page.goto( 'http://localhost:5173/tests/xr-test.html?preset=quest&noadapt' + ( process.env.XRQ || '' ) + '' );
await page.waitForFunction( () => window.__game && window.__game.state !== 'loading', null, { timeout: 240000 } );
console.log( 'vrSupported', await page.evaluate( () => window.__game.vrSupported ) );
await page.click( '.title [data-act="vr"]' );
await page.waitForTimeout( 4000 );
console.log( 'garage xr', JSON.stringify( await page.evaluate( () => ( { presenting: window.__game.xrSession.presenting, state: window.__game.state, menu: window.__game.vrMenu.mesh.visible, info: window.__game.xrInfo } ) ) ) );
await page.screenshot( { path: out + '-garage.png' } );
// start the race from the VR menu action
await page.evaluate( () => window.__game.startRace() );
await page.waitForTimeout( 5000 );
const eye = await page.evaluate( () => {

	const g = window.__game;
	const T = g.camera.position.constructor;
	const cam = new T(), eye = new T();
	g.renderer = g.rs.renderer;
	g.camera.getWorldPosition( cam );
	g.cockpit.eye.getWorldPosition( eye );
	return { cam: cam.toArray().map( ( v ) => +v.toFixed( 2 ) ), eye: eye.toArray().map( ( v ) => +v.toFixed( 2 ) ), dist: +cam.distanceTo( eye ).toFixed( 3 ), phase: g.race.phase };

} );
console.log( 'head vs cockpit eye', JSON.stringify( eye ) );
await page.screenshot( { path: out + '-cockpit.png' } );
// close the staging menu (Ready), then put both controllers on the wheel rim
await page.evaluate( () => {

	const g = window.__game;
	g.race.beginCountdown(); g.vrMenu.show( false ); g.xrControls.setPointerMode( false );

} );
await page.waitForTimeout( 800 );
const grab = await page.evaluate( async () => {

	const g = window.__game, dev = window.__xrdev, ck = g.cockpit;
	const T = g.camera.position.constructor;
	const place = ( ctrl, angle ) => {

		const p = new T( Math.cos( angle ) * ck.wheelRadius, Math.sin( angle ) * ck.wheelRadius, 0 );
		ck.wheel.localToWorld( p );
		g.rig.worldToLocal( p ); // reference-space coordinates
		ctrl.position.set( p.x, p.y, p.z );

	};

	place( dev.controllers.left, 0 ); // car-left = driver's 9 o'clock
	place( dev.controllers.right, Math.PI );
	await new Promise( ( r ) => setTimeout( r, 600 ) );
	dev.controllers.left.updateButtonValue( 'squeeze', 1 );
	dev.controllers.right.updateButtonValue( 'squeeze', 1 );
	await new Promise( ( r ) => setTimeout( r, 600 ) );
	const grabbing = g.xrControls.hands.map( ( h ) => h.handedness + ':' + h.grabbing );
	// rotate both hands 60 degrees counter-clockwise (driver view) = steer left
	for ( let k = 1; k <= 12; k ++ ) {

		place( dev.controllers.left, - k * Math.PI / 36 );
		place( dev.controllers.right, Math.PI - k * Math.PI / 36 );
		await new Promise( ( r ) => setTimeout( r, 120 ) );

	}

	await new Promise( ( r ) => setTimeout( r, 500 ) );
	return { grabbing, wheelAngle: +g.xrControls.wheelAngle.toFixed( 3 ), steer: +g.xrControls.state.steer.toFixed( 3 ), inputSteer: +g.input.state.steer.toFixed( 3 ), xrActive: g.xrControls.state.active };

} );
console.log( 'wheel grab', JSON.stringify( grab ) );
// throttle via right trigger once racing
for ( let i = 0; i < 9; i ++ ) {

	await page.waitForTimeout( 1000 );
	console.log( 'tick', i, JSON.stringify( await page.evaluate( () => ( { state: window.__game.state, race: !! window.__game.race, phase: window.__game.race?.phase, paused: window.__game.paused } ) ) ) );

}
const drive = await page.evaluate( async () => {

	const g = window.__game, dev = window.__xrdev;
	dev.controllers.right.updateButtonValue( 'trigger', 1 );
	await new Promise( ( r ) => setTimeout( r, 3000 ) );
	const p = g.race.player.physics;
	return { phase: g.race.phase, throttle: g.input.state.throttle, speed: +( p.speed * 3.6 ).toFixed( 1 ), steer: +p.steerAngle.toFixed( 3 ), vignette: +g.vignette.level.toFixed( 2 ), dc: g.rs.renderer.info.render.drawCalls };

} );
console.log( 'driving', JSON.stringify( drive ) );
await page.screenshot( { path: out + '-driving.png' } );
console.log( 'ERRORS', errors.length );
for ( const e of [ ...new Set( errors ) ].slice( 0, 20 ) ) console.log( '  ', e );
await browser.close();
