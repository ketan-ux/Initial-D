import * as THREE from 'three/webgpu';

// Livery atlas layout (1024 x 1024 canvas, texture v is flipped vs canvas y):
//   v 0.75..1.00 : LEFT side view   (car front on the left)
//   v 0.50..0.75 : RIGHT side view  (car front on the right)
//   v 0.06..0.50 : TOP view         (front on the left, car's left side at the top)
//   v 0.00..0.05 : utility row: number plate + flat trim swatches, so trim,
//                  pods and plates share the body material (fewer draw calls).
export const LIVERY_SIZE = 1024;
export const SIDE_Y0 = 0.15, SIDE_Y1 = 1.35; // body heights mapped into the side bands
export const TOP_V0 = 0.06, TOP_V1 = 0.5;
export const PLATE_UV = { u0: 0.0, u1: 0.12, v0: 0.0, v1: 0.05 };
export const SWATCH = {
	black: [ 0.17, 0.025 ], chrome: [ 0.25, 0.025 ], rubber: [ 0.33, 0.025 ],
	grey: [ 0.41, 0.025 ], grille: [ 0.49, 0.025 ], amber: [ 0.57, 0.025 ], interior: [ 0.65, 0.025 ]
};
const SWATCH_COLORS = {
	black: '#16141b', chrome: '#c9ccd8', rubber: '#0b0a0e', grey: '#3a3744',
	grille: '#0f0e13', amber: '#ff9d1c', interior: '#2a2630'
};

const JP_FONT = '"Noto Sans JP", "Hiragino Mincho ProN", "Yu Mincho", "Hiragino Sans", serif';
const JP_BRUSH = '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif';

export function paintLivery( spec, index ) {

	const S = LIVERY_SIZE;
	const c = document.createElement( 'canvas' );
	c.width = c.height = S;
	const ctx = c.getContext( '2d' );
	const L = spec.length;
	const style = spec.liveries[ index ]?.draw ?? spec.liveries[ 0 ].draw;

	// helpers mapping car-space (f metres from front, y metres) to canvas px
	const side = ( which ) => {

		const y0 = which === 'left' ? 0 : 256;
		return {
			x: ( f ) => ( which === 'left' ? f / L : 1 - f / L ) * S,
			y: ( h ) => y0 + ( 1 - ( h - SIDE_Y0 ) / ( SIDE_Y1 - SIDE_Y0 ) ) * 256,
			y0, which
		};

	};

	const top = {
		x: ( f ) => ( f / L ) * S,
		// lateral x (left positive) -> canvas y in the top band
		y: ( lat ) => ( 1 - ( TOP_V0 + ( lat + 1 ) / 2 * ( TOP_V1 - TOP_V0 ) ) ) * S
	};

	const P = PAINTERS[ style ] || PAINTERS.panda;
	P( ctx, { S, L, side, top, spec } );

	// panel lines, door handles, fuel lid: shared details on both sides
	for ( const w of [ 'left', 'right' ] ) {

		const sd = side( w );
		ctx.strokeStyle = 'rgba(10,8,16,0.55)';
		ctx.lineWidth = 2;
		const doorF0 = spec.glass.side[ 0 ] + 0.05, doorF1 = spec.glass.pillars[ 1 ] ? spec.glass.pillars[ 1 ][ 1 ] + 0.05 : 2.75;
		ctx.beginPath();
		ctx.moveTo( sd.x( doorF0 ), sd.y( 0.3 ) ); ctx.lineTo( sd.x( doorF0 ), sd.y( 0.8 ) );
		ctx.moveTo( sd.x( doorF1 ), sd.y( 0.3 ) ); ctx.lineTo( sd.x( doorF1 ), sd.y( 0.8 ) );
		ctx.stroke();
		ctx.fillStyle = 'rgba(20,18,26,0.8)';
		const hx = sd.x( doorF1 - 0.18 );
		ctx.fillRect( Math.min( hx, hx + ( w === 'left' ? - 22 : 0 ) ), sd.y( 0.7 ), 22, 5 );

	}

	drawPlate( ctx, spec );
	for ( const [ k, [ u ] ] of Object.entries( SWATCH ) ) {

		ctx.fillStyle = SWATCH_COLORS[ k ];
		ctx.fillRect( ( u - 0.035 ) * S, S * ( 1 - 0.05 ), 0.07 * S, 0.05 * S );

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.NoColorSpace;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;

}

function drawPlate( ctx, spec ) {

	// Japanese private plate: white with green characters (fictional region).
	const S = LIVERY_SIZE;
	const x = PLATE_UV.u0 * S, w = ( PLATE_UV.u1 - PLATE_UV.u0 ) * S;
	const y = ( 1 - PLATE_UV.v1 ) * S, h = ( PLATE_UV.v1 - PLATE_UV.v0 ) * S;
	ctx.fillStyle = '#f4f6ef';
	ctx.fillRect( x, y, w, h );
	ctx.strokeStyle = '#2f6b3a';
	ctx.lineWidth = 2;
	ctx.strokeRect( x + 2, y + 2, w - 4, h - 4 );
	ctx.fillStyle = '#1f5a2c';
	ctx.textAlign = 'center';
	ctx.font = `700 ${h * 0.3}px ${JP_FONT}`;
	ctx.fillText( spec.id === 'ae86' ? '峠 503 と' : '峠 300 な', x + w / 2, y + h * 0.36 );
	ctx.font = `800 ${h * 0.46}px ${JP_FONT}`;
	ctx.fillText( spec.id === 'ae86' ? '86-01' : '7-77', x + w / 2, y + h * 0.84 );

}

function fill( ctx, color, x, y, w, h ) {

	ctx.fillStyle = color;
	ctx.fillRect( x, y, w, h );

}

// Two-tone helper: paints both side bands and the top band.
function twoTone( ctx, o, upper, lower, splitY ) {

	for ( const w of [ 'left', 'right' ] ) {

		const sd = o.side( w );
		fill( ctx, upper, 0, sd.y0, o.S, 256 );
		fill( ctx, lower, 0, sd.y( splitY ), o.S, sd.y0 + 256 - sd.y( splitY ) );

	}

	fill( ctx, upper, 0, 512, o.S, ( 1 - TOP_V0 ) * o.S - 512 );

}

function sideText( ctx, o, text, f, h, size, color, opts = {} ) {

	for ( const w of [ 'left', 'right' ] ) {

		const sd = o.side( w );
		ctx.save();
		ctx.fillStyle = color;
		ctx.font = `${opts.weight ?? 800} ${size}px ${opts.font ?? JP_FONT}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if ( opts.stroke ) {

			ctx.strokeStyle = opts.stroke;
			ctx.lineWidth = opts.strokeWidth ?? 4;
			ctx.strokeText( text, sd.x( f ), sd.y( h ) );

		}

		ctx.fillText( text, sd.x( f ), sd.y( h ) );
		ctx.restore();

	}

}

function sideStripe( ctx, o, f0, f1, y0, y1, color, slant = 0 ) {

	for ( const w of [ 'left', 'right' ] ) {

		const sd = o.side( w );
		const dir = w === 'left' ? 1 : - 1;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo( sd.x( f0 ), sd.y( y0 ) );
		ctx.lineTo( sd.x( f1 ), sd.y( y0 ) );
		ctx.lineTo( sd.x( f1 ) + slant * dir, sd.y( y1 ) );
		ctx.lineTo( sd.x( f0 ) + slant * dir, sd.y( y1 ) );
		ctx.closePath();
		ctx.fill();

	}

}

function petals( ctx, o, count, colors, region = 'sides', seed = 3 ) {

	let s = seed;
	const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
	for ( let i = 0; i < count; i ++ ) {

		const isTop = region === 'all' && rnd() < 0.35;
		const x = rnd() * o.S;
		const y = isTop ? 512 + rnd() * 440 : rnd() * 512;
		const r = 5 + rnd() * 12;
		ctx.save();
		ctx.translate( x, y );
		ctx.rotate( rnd() * 6.28 );
		ctx.fillStyle = colors[ ( rnd() * colors.length ) | 0 ];
		for ( let k = 0; k < 5; k ++ ) {

			ctx.rotate( Math.PI * 2 / 5 );
			ctx.beginPath();
			ctx.ellipse( 0, - r * 0.6, r * 0.38, r * 0.6, 0, 0, Math.PI * 2 );
			ctx.fill();

		}

		ctx.restore();

	}

}

const PAINTERS = {

	panda( ctx, o ) {

		twoTone( ctx, o, '#f3f1ea', '#17151c', 0.52 );
		// thin pinstripe along the split
		for ( const w of [ 'left', 'right' ] ) {

			const sd = o.side( w );
			fill( ctx, '#c7c3b8', 0, sd.y( 0.535 ), o.S, 3 );

		}

		// tofu-shop door script (fictional shop name)
		sideText( ctx, o, '白峰とうふ店', 2.25, 0.66, 30, '#141218', { font: JP_BRUSH, weight: 700 } );
		sideText( ctx, o, '（自家用）', 2.25, 0.6, 17, '#141218', { font: JP_BRUSH, weight: 600 } );
		sideText( ctx, o, 'TRUENO', 3.75, 0.66, 18, '#23202a', { weight: 900, font: 'Arial Black, sans-serif' } );
		sideText( ctx, o, 'GT-APEX', 0.55, 0.42, 14, '#d9d6cc', { weight: 800, font: 'Arial, sans-serif' } );

	},

	sakuraNight( ctx, o ) {

		twoTone( ctx, o, '#3c1f52', '#24122f', 0.4 );
		petals( ctx, o, 160, [ '#ffb7d5', '#ff8fc0', '#ffe0ee' ], 'all', 11 );
		sideStripe( ctx, o, 0.2, 4.0, 0.56, 0.585, '#ff8fc0', 0 );
		sideText( ctx, o, '桜', 2.2, 0.55, 78, '#fff2f8', { font: JP_BRUSH, weight: 900, stroke: '#c2427d', strokeWidth: 5 } );
		sideText( ctx, o, 'YOZAKURA', 3.5, 0.45, 16, '#ffd1e6', { weight: 800, font: 'Arial, sans-serif' } );

	},

	kanjo( ctx, o ) {

		twoTone( ctx, o, '#111016', '#0a090e', 0.32 );
		sideStripe( ctx, o, 0.1, 4.1, 0.48, 0.5, '#d4282e', 0 );
		sideText( ctx, o, '峠', 2.25, 0.6, 82, '#e8c15a', { font: JP_BRUSH, weight: 900, stroke: '#6b4e12', strokeWidth: 4 } );
		sideText( ctx, o, '86', 3.55, 0.6, 46, '#f2f2f2', { weight: 900, font: 'Arial Black, sans-serif' } );
		// gold hood band on the top view
		fill( ctx, '#e8c15a', o.top.x( 0.2 ), o.top.y( 0.1 ), o.top.x( 1.4 ) - o.top.x( 0.2 ), 10 );

	},

	yellowMica( ctx, o ) {

		twoTone( ctx, o, '#f6c41c', '#e2ae12', 0.3 );
		sideStripe( ctx, o, 0.5, 4.0, 0.36, 0.4, '#1a1820', 0 );
		sideText( ctx, o, '疾風 RACING', 2.35, 0.6, 30, '#18161d', { weight: 900 } );
		sideText( ctx, o, 'TYPE R', 3.8, 0.66, 16, '#18161d', { weight: 900, font: 'Arial Black, sans-serif' } );
		// hood vent: a few thin dark slats
		ctx.fillStyle = 'rgba(40,30,8,0.45)';
		for ( let k = 0; k < 4; k ++ ) ctx.fillRect( o.top.x( 0.62 + k * 0.06 ), o.top.y( 0.16 ), 5, o.top.y( - 0.16 ) - o.top.y( 0.16 ) );

	},

	raiden( ctx, o ) {

		twoTone( ctx, o, '#f1f1f6', '#dcdce6', 0.3 );
		for ( const w of [ 'left', 'right' ] ) {

			const sd = o.side( w );
			ctx.strokeStyle = '#2a5bd7';
			ctx.lineWidth = 12;
			ctx.lineJoin = 'miter';
			ctx.beginPath();
			const pts = [ [ 0.3, 0.5 ], [ 1.2, 0.62 ], [ 1.5, 0.45 ], [ 2.6, 0.64 ], [ 2.9, 0.44 ], [ 4.1, 0.6 ] ];
			pts.forEach( ( [ f, h ], i ) => ( i ? ctx.lineTo( sd.x( f ), sd.y( h ) ) : ctx.moveTo( sd.x( f ), sd.y( h ) ) ) );
			ctx.stroke();

		}

		sideText( ctx, o, '雷電', 2.25, 0.4, 34, '#1d3f9e', { font: JP_BRUSH, weight: 900 } );
		fill( ctx, '#2a5bd7', 0, o.top.y( 0.08 ), o.S, o.top.y( - 0.08 ) - o.top.y( 0.08 ) );

	},

	gekko( ctx, o ) {

		twoTone( ctx, o, '#2a1b4a', '#1c1233', 0.34 );
		sideStripe( ctx, o, 0.3, 4.1, 0.55, 0.57, '#e2b857', 0 );
		sideText( ctx, o, '月光', 2.3, 0.45, 40, '#e9c46a', { font: JP_BRUSH, weight: 900 } );
		// crescent moon on the hood
		const cx = o.top.x( 0.7 ), cy = o.top.y( 0 );
		ctx.fillStyle = '#f0d58a';
		ctx.beginPath(); ctx.arc( cx, cy, 52, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = '#2a1b4a';
		ctx.beginPath(); ctx.arc( cx + 20, cy - 12, 48, 0, Math.PI * 2 ); ctx.fill();

	}

};
