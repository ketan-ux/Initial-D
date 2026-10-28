import * as THREE from 'three/webgpu';
import { mulberry32 } from '../core/math.js';

// Hand-painted style textures generated on a 2D canvas at load time: no
// network fetches, tiny download, and every device gets identical art.

function canvas( w, h ) {

	const c = document.createElement( 'canvas' );
	c.width = w; c.height = h;
	return c;

}

function finish( c, opts = {} ) {

	const t = new THREE.CanvasTexture( c );
	t.colorSpace = THREE.NoColorSpace; // display-referred pipeline
	t.anisotropy = opts.anisotropy ?? 4;
	t.wrapS = opts.wrapS ?? THREE.ClampToEdgeWrapping;
	t.wrapT = opts.wrapT ?? THREE.ClampToEdgeWrapping;
	if ( opts.nearest ) t.magFilter = THREE.NearestFilter;
	t.needsUpdate = true;
	return t;

}

function speckle( ctx, x, y, w, h, count, colors, rng, size = [ 1, 3 ] ) {

	for ( let i = 0; i < count; i ++ ) {

		ctx.fillStyle = colors[ ( rng() * colors.length ) | 0 ];
		const s = size[ 0 ] + rng() * ( size[ 1 ] - size[ 0 ] );
		ctx.fillRect( x + rng() * w, y + rng() * h, s, s );

	}

}

function petalShape( ctx, x, y, r, rot ) {

	ctx.save();
	ctx.translate( x, y );
	ctx.rotate( rot );
	// notched sakura petal with a pale centre crease
	ctx.beginPath();
	ctx.moveTo( 0, r );
	ctx.bezierCurveTo( - r * 1.1, r * 0.3, - r * 0.7, - r * 0.9, - r * 0.3, - r );
	ctx.lineTo( 0, - r * 0.7 );
	ctx.lineTo( r * 0.3, - r );
	ctx.bezierCurveTo( r * 0.7, - r * 0.9, r * 1.1, r * 0.3, 0, r );
	ctx.fill();
	ctx.fillStyle = 'rgba(255,255,255,0.35)';
	ctx.fillRect( - 0.5, - r * 0.5, 1, r * 1.2 );
	ctx.restore();

}

// Road atlas, columns (u): asphalt [0, .5) | gutter [.5, .625) |
// retaining wall [.625, .875) | guardrail [.875, .98) | accent. Each column spans the
// full height so v can repeat along the road with a single material.
export const ATLAS = {
	asphalt: [ 0.0, 0.5 ],
	gutter: [ 0.5, 0.625 ],
	wall: [ 0.625, 0.875 ],
	rail: [ 0.875, 0.98 ],
	accent: [ 0.985, 1.0 ], // plain white: tinted per vertex (reflectors, lamps, paint)
	tileLength: 16 // metres of road per v repeat
};

export function createRoadAtlas() {

	const W = 1024, H = 1024;
	const c = canvas( W, H ), ctx = c.getContext( '2d' );
	const rng = mulberry32( 86 );

	// --- asphalt ---------------------------------------------------------
	const aw = W * 0.5;
	ctx.fillStyle = '#3a3a48';
	ctx.fillRect( 0, 0, aw, H );
	// painterly tonal blotches
	for ( let i = 0; i < 260; i ++ ) {

		ctx.fillStyle = rng() < 0.5 ? 'rgba(25,25,38,0.25)' : 'rgba(80,78,98,0.18)';
		ctx.beginPath();
		ctx.ellipse( rng() * aw, rng() * H, 10 + rng() * 40, 6 + rng() * 26, rng() * 3, 0, Math.PI * 2 );
		ctx.fill();

	}

	speckle( ctx, 0, 0, aw, H, 9000, [ '#2b2b37', '#4d4c5e', '#55546a', '#30303d' ], rng, [ 1, 2.5 ] );
	// tyre wear lines along each lane
	ctx.fillStyle = 'rgba(20,20,28,0.35)';
	for ( const lane of [ 0.12, 0.36 ] ) for ( const off of [ - 0.035, 0.035 ] ) ctx.fillRect( aw * ( lane + off ) - 7, 0, 14, H );
	// tar seams / cracks
	ctx.strokeStyle = 'rgba(18,18,24,0.7)';
	ctx.lineWidth = 2;
	for ( let i = 0; i < 18; i ++ ) {

		ctx.beginPath();
		let x = rng() * aw, y = rng() * H;
		ctx.moveTo( x, y );
		for ( let k = 0; k < 6; k ++ ) {

			x += ( rng() - 0.5 ) * 40; y += ( rng() - 0.3 ) * 50;
			ctx.lineTo( x, y );

		}

		ctx.stroke();

	}

	// painted lines: solid white edges, solid yellow centre (Japanese
	// no-overtaking line, as on every mountain pass)
	const ppm = H / ATLAS.tileLength;
	ctx.fillStyle = '#e9e6ef';
	ctx.fillRect( aw * 0.025, 0, aw * 0.018, H );
	ctx.fillRect( aw * ( 1 - 0.043 ), 0, aw * 0.018, H );
	ctx.fillStyle = '#f5b82a';
	ctx.fillRect( aw * 0.5 - aw * 0.012, 0, aw * 0.024, H );
	// wear on the paint
	speckle( ctx, 0, 0, aw, H, 1400, [ '#3a3a48', '#46465a' ], rng, [ 1, 3 ] );
	// fallen sakura petals collect toward the edges
	for ( let i = 0; i < 520; i ++ ) {

		const edge = rng() < 0.5 ? rng() * 0.14 : 1 - rng() * 0.14;
		const x = edge * aw, y = rng() * H;
		ctx.fillStyle = [ '#ffc2da', '#ffd9e8', '#f7a8c8', '#fff0f6' ][ ( rng() * 4 ) | 0 ];
		petalShape( ctx, x, y, 2 + rng() * 3, rng() * 6 );

	}

	for ( let i = 0; i < 70; i ++ ) {

		ctx.fillStyle = 'rgba(255,200,225,0.8)';
		petalShape( ctx, rng() * aw, rng() * H, 2 + rng() * 2, rng() * 6 );

	}

	// --- gutter (concrete U channel with grate seams) ---------------------
	const gx = W * ATLAS.gutter[ 0 ], gw = W * ( ATLAS.gutter[ 1 ] - ATLAS.gutter[ 0 ] );
	const gg = ctx.createLinearGradient( gx, 0, gx + gw, 0 );
	gg.addColorStop( 0, '#9a98a8' ); gg.addColorStop( 0.5, '#6d6b7c' ); gg.addColorStop( 1, '#a3a1b0' );
	ctx.fillStyle = gg;
	ctx.fillRect( gx, 0, gw, H );
	speckle( ctx, gx, 0, gw, H, 1600, [ '#7b798a', '#b5b3c1', '#5d5b6b' ], rng );
	ctx.fillStyle = 'rgba(40,38,50,0.8)';
	for ( let m = 0; m < ATLAS.tileLength; m += 2 ) ctx.fillRect( gx, m * ppm, gw, 3 );
	for ( let i = 0; i < 60; i ++ ) {

		ctx.fillStyle = '#ffc6dc';
		petalShape( ctx, gx + gw * ( 0.3 + rng() * 0.4 ), rng() * H, 2 + rng() * 2, rng() * 6 );

	}

	// --- retaining wall: stacked concrete blocks + moss + rope netting ------
	const wx = W * ATLAS.wall[ 0 ], ww = W * ( ATLAS.wall[ 1 ] - ATLAS.wall[ 0 ] );
	ctx.fillStyle = '#8e8a99';
	ctx.fillRect( wx, 0, ww, H );
	const rows = 6, bh = H / 16;
	for ( let yb = 0; yb < H; yb += bh ) {

		for ( let r = 0; r < rows; r ++ ) {

			const shade = 120 + ( ( rng() * 30 ) | 0 );
			ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 12})`;
			ctx.fillRect( wx + r * ( ww / rows ) + 2, yb + 2, ww / rows - 4, bh - 4 );

		}

	}

	speckle( ctx, wx, 0, ww, H, 2200, [ '#6f6b7c', '#a9a5b6', '#5f8a5a', '#4f7a4b' ], rng );
	ctx.strokeStyle = 'rgba(60,70,58,0.55)';
	ctx.lineWidth = 2;
	for ( let i = - 8; i < 16; i ++ ) {

		ctx.beginPath(); ctx.moveTo( wx, i * 64 ); ctx.lineTo( wx + ww, i * 64 + ww ); ctx.stroke();
		ctx.beginPath(); ctx.moveTo( wx + ww, i * 64 ); ctx.lineTo( wx, i * 64 + ww ); ctx.stroke();

	}

	// --- guardrail: galvanised W-beam with orange delineators -------------
	const rx = W * ATLAS.rail[ 0 ], rw = W * ( ATLAS.rail[ 1 ] - ATLAS.rail[ 0 ] );
	const rg = ctx.createLinearGradient( rx, 0, rx + rw, 0 );
	rg.addColorStop( 0, '#d9dbe6' ); rg.addColorStop( 0.25, '#f6f7ff' ); rg.addColorStop( 0.5, '#9fa2b3' );
	rg.addColorStop( 0.75, '#eceefa' ); rg.addColorStop( 1, '#b6b9c8' );
	ctx.fillStyle = rg;
	ctx.fillRect( rx, 0, rw, H );
	ctx.fillStyle = 'rgba(70,70,90,0.6)';
	for ( let m = 0; m < ATLAS.tileLength; m += 4 ) ctx.fillRect( rx, m * ppm, rw, 4 );
	speckle( ctx, rx, 0, rw, H, 500, [ 'rgba(140,110,90,0.5)', 'rgba(255,255,255,0.6)' ], rng );
	ctx.fillStyle = '#ffffff';
	ctx.fillRect( W * 0.98, 0, W * 0.02, H );

	return finish( c, { wrapT: THREE.RepeatWrapping, anisotropy: 8 } );

}

export function createBlobShadow() {

	const c = canvas( 128, 128 ), ctx = c.getContext( '2d' );
	const g = ctx.createRadialGradient( 64, 64, 8, 64, 64, 62 );
	g.addColorStop( 0, 'rgba(10,6,20,0.85)' );
	g.addColorStop( 0.6, 'rgba(10,6,20,0.5)' );
	g.addColorStop( 1, 'rgba(10,6,20,0)' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, 128, 128 );
	return finish( c );

}

// Elongated pool of light for faked headlights on Low / rival cars.
export function createLightPool() {

	const c = canvas( 128, 256 ), ctx = c.getContext( '2d' );
	ctx.fillStyle = '#000';
	ctx.fillRect( 0, 0, 128, 256 );
	for ( let i = 0; i < 4; i ++ ) {

		// stepped toon bands
		const a = [ 0.18, 0.32, 0.5, 0.75 ][ i ];
		const s = 1 - i * 0.22;
		ctx.fillStyle = `rgba(255,236,190,${a})`;
		ctx.beginPath();
		ctx.moveTo( 64 - 10 * s, 250 );
		ctx.quadraticCurveTo( 64 - 70 * s, 120 * s + 30, 64, 10 + ( 1 - s ) * 120 );
		ctx.quadraticCurveTo( 64 + 70 * s, 120 * s + 30, 64 + 10 * s, 250 );
		ctx.fill();

	}

	return finish( c );

}

export function createPetalTexture() {

	const c = canvas( 64, 64 ), ctx = c.getContext( '2d' );
	ctx.clearRect( 0, 0, 64, 64 );
	const g = ctx.createLinearGradient( 0, 0, 0, 64 );
	g.addColorStop( 0, '#fff4f9' ); g.addColorStop( 0.6, '#ffc1da' ); g.addColorStop( 1, '#f48ab6' );
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.moveTo( 32, 60 );
	ctx.bezierCurveTo( 4, 44, 6, 10, 24, 6 );
	ctx.lineTo( 32, 14 ); // the notch at the tip of a sakura petal
	ctx.lineTo( 40, 6 );
	ctx.bezierCurveTo( 58, 10, 60, 44, 32, 60 );
	ctx.fill();
	ctx.strokeStyle = 'rgba(200,80,130,0.35)';
	ctx.lineWidth = 2;
	ctx.beginPath(); ctx.moveTo( 32, 56 ); ctx.lineTo( 32, 22 ); ctx.stroke();
	return finish( c );

}

// Stylised billowy smoke puff with stepped (cel) shading.
export function createSmokeTexture() {

	const c = canvas( 128, 128 ), ctx = c.getContext( '2d' );
	const rng = mulberry32( 7 );
	const blobs = [];
	for ( let i = 0; i < 9; i ++ ) blobs.push( [ 64 + ( rng() - 0.5 ) * 50, 64 + ( rng() - 0.5 ) * 40, 18 + rng() * 18 ] );
	const layers = [ [ '#8f8aa3', 1.0, 3 ], [ '#c9c4d8', 0.82, - 2 ], [ '#f2effa', 0.58, - 7 ] ];
	for ( const [ col, sc, dy ] of layers ) {

		ctx.fillStyle = col;
		for ( const [ x, y, r ] of blobs ) {

			ctx.beginPath();
			ctx.arc( x, y + dy, r * sc, 0, Math.PI * 2 );
			ctx.fill();

		}

	}

	// soft alpha falloff at the rim
	ctx.globalCompositeOperation = 'destination-in';
	const g = ctx.createRadialGradient( 64, 64, 30, 64, 64, 64 );
	g.addColorStop( 0, 'rgba(0,0,0,1)' ); g.addColorStop( 1, 'rgba(0,0,0,0)' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, 128, 128 );
	return finish( c );

}

export function createSparkTexture() {

	const c = canvas( 32, 128 ), ctx = c.getContext( '2d' );
	const g = ctx.createLinearGradient( 0, 0, 0, 128 );
	g.addColorStop( 0, 'rgba(255,255,230,0)' );
	g.addColorStop( 0.3, 'rgba(255,240,180,1)' );
	g.addColorStop( 1, 'rgba(255,140,40,0)' );
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.ellipse( 16, 64, 6, 62, 0, 0, Math.PI * 2 );
	ctx.fill();
	return finish( c );

}

export function createGlowTexture( inner = 'rgba(255,220,170,1)' ) {

	const c = canvas( 64, 64 ), ctx = c.getContext( '2d' );
	const g = ctx.createRadialGradient( 32, 32, 0, 32, 32, 32 );
	g.addColorStop( 0, inner );
	g.addColorStop( 0.25, inner.replace( /,1\)$/, ',0.55)' ) );
	g.addColorStop( 1, 'rgba(0,0,0,0)' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, 64, 64 );
	return finish( c );

}

export function createTireTexture( wear = 0 ) {

	const c = canvas( 256, 64 ), ctx = c.getContext( '2d' );
	ctx.fillStyle = '#1d1b22';
	ctx.fillRect( 0, 0, 256, 64 );
	const depth = 1 - wear;
	ctx.fillStyle = `rgba(8,8,10,${0.9 * depth})`;
	for ( let x = 0; x < 256; x += 16 ) {

		ctx.fillRect( x, 8, 6, 48 );
		ctx.fillRect( x + 8, 24, 8, 16 );

	}

	if ( wear > 0.3 ) {

		ctx.fillStyle = `rgba(90,80,100,${( wear - 0.3 ) * 0.9})`;
		ctx.fillRect( 0, 20, 256, 24 );

	}

	return finish( c, { wrapS: THREE.RepeatWrapping } );

}

// Tiny text texture helper for signs, plates, captions in VR.
export function createTextTexture( lines, opts = {} ) {

	const w = opts.width ?? 512, h = opts.height ?? 128;
	const c = canvas( w, h ), ctx = c.getContext( '2d' );
	ctx.fillStyle = opts.bg ?? '#ffffff';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = opts.color ?? '#111';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const size = opts.size ?? 48;
	ctx.font = `${opts.weight ?? 800} ${size}px ${opts.font ?? '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'}`;
	const arr = Array.isArray( lines ) ? lines : [ lines ];
	arr.forEach( ( l, i ) => ctx.fillText( l, w / 2, h / 2 + ( i - ( arr.length - 1 ) / 2 ) * size * 1.1 ) );
	return finish( c );

}

export { canvas as makeCanvas, finish as canvasToTexture };
