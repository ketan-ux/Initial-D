// Usage: node tests/shot.mjs <url> <out.png> [waitForGlobal] [timeoutMs]
import { createRequire } from 'module';
const require = createRequire( import.meta.url );
const { chromium } = require( 'playwright' );
const [ url, out, flag = '__done', timeout = '120000' ] = process.argv.slice( 2 );
const browser = await chromium.launch( { args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 720 } } );
page.on( 'console', ( m ) => console.log( '[console.' + m.type() + ']', m.text().slice( 0, 400 ) ) );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', e.message, e.stack?.split( '\n' ).slice( 0, 4 ).join( ' | ' ) ) );
await page.goto( url );
try {

	await page.waitForFunction( ( f ) => window[ f ], flag, { timeout: +timeout } );

} catch ( e ) {

	console.log( 'TIMEOUT waiting for', flag );

}

await page.screenshot( { path: out } );
await browser.close();
