import { Game } from './core/Game.js';

// Entry point. Everything (mountain, cars, textures, sounds) is generated
// procedurally at load time except the spotter voice lines.
const game = new Game( document.getElementById( 'app' ) );
game.init().catch( ( e ) => {

	console.error( e );
	const msg = document.querySelector( '.panel.loading .msg' );
	if ( msg ) msg.textContent = 'Something went wrong while building the mountain: ' + e.message;

} );
