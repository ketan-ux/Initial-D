// One visual language for every UI surface. The DOM UI reads these values
// as CSS custom properties (styles.css :root); the canvas-painted surfaces
// (VR menu, controller legends, windshield HUD, VR captions) import them
// here, so a VR panel looks like the flatscreen menu it stands in for:
// heavy italic Kanit, slanted paper plates with ink outlines and hard drop
// shadows, an orange-to-yellow "selected" bar with a cyan focus ring.

export const C = {
	ink: '#0d0a12',
	paper: '#f7f4ee',
	bg: '#141024',
	panel: '#120d1c',
	orange: '#ff9a1a',
	orangeHot: '#ff5a00',
	yellow: '#ffd23f',
	pink: '#ff8fc0',
	cyan: '#7ff3ff',
	red: '#ff3b3b',
	green: '#7dffa6',
	muted: '#c9c3dc'
};

export const FONT = '"Kanit", "Arial Black", Arial, sans-serif';
export const JP = '"Noto Sans JP", "Hiragino Sans", sans-serif';
export const SKEW = Math.tan( 12 * Math.PI / 180 ); // CSS --skew: -12deg

export const font = ( size, weight = 800, italic = true ) => `${italic ? 'italic ' : ''}${weight} ${Math.round( size )}px ${FONT}`;

// Canvas text is drawn with whatever font is loaded at that moment; resolve
// once Kanit is in so painters can redraw with the real typeface.
let _fonts = null;
export function fontsReady() {

	if ( ! _fonts ) {

		const want = [ 'italic 900 40px Kanit', 'italic 800 40px Kanit', 'italic 700 40px Kanit', '600 40px Kanit' ];
		_fonts = document.fonts?.load ? Promise.all( want.map( ( f ) => document.fonts.load( f ) ) ).catch( () => {} ) : Promise.resolve();

	}

	return _fonts;

}

// Slanted parallelogram path, like the CSS skewX(-12deg) plates.
export function plate( ctx, x, y, w, h ) {

	const s = h * SKEW;
	ctx.beginPath();
	ctx.moveTo( x + s, y );
	ctx.lineTo( x + w, y );
	ctx.lineTo( x + w - s, y + h );
	ctx.lineTo( x, y + h );
	ctx.closePath();

}

// A button plate: hard ink drop shadow, ink border, paper or "selected"
// orange gradient fill, optional cyan focus ring. Scale = canvas px per CSS px.
export function drawPlate( ctx, x, y, w, h, { selected = false, focus = false, fill = null, scale = 2 } = {} ) {

	const sh = 5 * scale, bw = 3 * scale;
	ctx.fillStyle = C.ink;
	plate( ctx, x + sh, y + sh, w, h ); ctx.fill();
	if ( selected ) {

		const g = ctx.createLinearGradient( x, 0, x + w, 0 );
		g.addColorStop( 0, C.orangeHot ); g.addColorStop( 0.55, C.orange ); g.addColorStop( 1, C.yellow );
		ctx.fillStyle = g;

	} else ctx.fillStyle = fill ?? C.paper;
	plate( ctx, x, y, w, h ); ctx.fill();
	ctx.lineWidth = bw; ctx.strokeStyle = C.ink; ctx.lineJoin = 'miter';
	ctx.stroke();
	if ( focus ) {

		ctx.lineWidth = bw; ctx.strokeStyle = C.cyan;
		plate( ctx, x - bw * 2, y - bw * 2, w + bw * 4, h + bw * 4 ); ctx.stroke();

	}

}

// Outlined display text (CSS .h-display / --ink-stroke).
export function inkText( ctx, text, x, y, size, { weight = 900, color = '#fff', stroke = C.ink, maxW = Infinity, align = 'left', upper = true } = {} ) {

	const t = upper ? text.toUpperCase() : text;
	let s = size;
	do ctx.font = font( s, weight ); while ( ctx.measureText( t ).width > maxW && -- s > 10 );
	ctx.textAlign = align;
	ctx.lineJoin = 'round';
	ctx.lineWidth = Math.max( 3, s * 0.16 );
	ctx.strokeStyle = stroke;
	ctx.fillStyle = 'rgba(0,0,0,0.5)';
	ctx.fillText( t, x + s * 0.06, y + s * 0.09 );
	ctx.strokeText( t, x, y );
	ctx.fillStyle = color;
	ctx.fillText( t, x, y );
	return s;

}

// Plain (no outline) text that shrinks to fit.
export function fitText( ctx, text, x, y, maxW, size, weight = 700, italic = true ) {

	let s = size;
	do ctx.font = font( s, weight, italic ); while ( ctx.measureText( text ).width > maxW && -- s > 10 );
	ctx.fillText( text, x, y );
	return s;

}

// Comic card background: dark ink panel, halftone dots, paper border and a
// hard shadow (CSS .pause / .settings cards).
export function drawCard( ctx, W, H, { pad = 6, border = 6 } = {} ) {

	ctx.clearRect( 0, 0, W, H );
	ctx.fillStyle = 'rgba(0,0,0,0.55)';
	ctx.fillRect( pad + 10, pad + 10, W - pad * 2 - 10, H - pad * 2 - 10 );
	ctx.fillStyle = C.panel;
	ctx.fillRect( pad, pad, W - pad * 2 - 10, H - pad * 2 - 10 );
	ctx.save();
	ctx.beginPath(); ctx.rect( pad, pad, W - pad * 2 - 10, H - pad * 2 - 10 ); ctx.clip();
	ctx.fillStyle = 'rgba(255,255,255,0.06)';
	for ( let y = pad; y < H; y += 14 ) for ( let x = pad + ( ( y / 14 ) % 2 ) * 7; x < W; x += 14 ) ctx.fillRect( x, y, 2.4, 2.4 );
	ctx.restore();
	ctx.lineWidth = border; ctx.strokeStyle = C.paper;
	ctx.strokeRect( pad + border / 2, pad + border / 2, W - pad * 2 - 10 - border, H - pad * 2 - 10 - border );

}

// Key-cap chip (CSS kbd): small slanted paper plate with an ink border.
export function drawKey( ctx, label, x, y, h, { fill = C.paper, color = C.ink, minW = 0 } = {} ) {

	ctx.font = font( h * 0.58, 900 );
	const w = Math.max( minW, ctx.measureText( label ).width + h * 0.9 );
	ctx.fillStyle = C.ink;
	plate( ctx, x + 3, y + 3, w, h ); ctx.fill();
	ctx.fillStyle = fill;
	plate( ctx, x, y, w, h ); ctx.fill();
	ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
	ctx.fillStyle = color;
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	ctx.fillText( label, x + w / 2, y + h / 2 + 1 );
	return w;

}
