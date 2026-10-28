// Manga speed lines: thin tapered streaks radiating from the screen edges
// toward a focus point, redrawn ~24x per second with fresh random angles so
// they flicker like hand-inked motion lines. 2D canvas overlay, flatscreen only.
export class SpeedLines {

	constructor( container ) {

		this.canvas = document.createElement( 'canvas' );
		this.canvas.className = 'speedlines';
		this.canvas.setAttribute( 'aria-hidden', 'true' );
		container.prepend( this.canvas );
		this.ctx = this.canvas.getContext( '2d' );
		this.intensity = 0;
		this.target = 0;
		this.timer = 0;
		this.focus = { x: 0.5, y: 0.45 };
		this.color = '255,255,255';
		this._resize();
		window.addEventListener( 'resize', () => this._resize() );

	}

	_resize() {

		const dpr = Math.min( window.devicePixelRatio || 1, 1.5 );
		this.canvas.width = Math.round( window.innerWidth * dpr );
		this.canvas.height = Math.round( window.innerHeight * dpr );

	}

	set( intensity, focusX = 0.5, focusY = 0.45 ) {

		this.target = Math.max( 0, Math.min( 1, intensity ) );
		this.focus.x = focusX; this.focus.y = focusY;

	}

	update( dt ) {

		this.intensity += ( this.target - this.intensity ) * Math.min( 1, dt * 5 );
		this.canvas.style.opacity = this.intensity > 0.02 ? Math.min( 1, this.intensity * 1.3 ).toFixed( 2 ) : '0';
		if ( this.intensity <= 0.02 ) return;
		this.timer -= dt;
		if ( this.timer > 0 ) return;
		this.timer = 1 / 24;
		const { ctx, canvas } = this;
		const W = canvas.width, H = canvas.height;
		ctx.clearRect( 0, 0, W, H );
		const cx = W * this.focus.x, cy = H * this.focus.y;
		const R = Math.hypot( Math.max( cx, W - cx ), Math.max( cy, H - cy ) );
		const n = Math.round( 40 + this.intensity * 110 );
		const inner = R * ( 0.78 - this.intensity * 0.3 );
		for ( let i = 0; i < n; i ++ ) {

			const a = Math.random() * Math.PI * 2;
			const r0 = inner + Math.random() * R * 0.25;
			const w = ( 1 + Math.random() * 3.5 ) * ( W / 1280 );
			const ca = Math.cos( a ), sa = Math.sin( a );
			const px = - sa, py = ca;
			const x0 = cx + ca * r0, y0 = cy + sa * r0;
			const x1 = cx + ca * R * 1.1, y1 = cy + sa * R * 1.1;
			const alpha = ( 0.25 + Math.random() * 0.55 ) * this.intensity;
			ctx.fillStyle = `rgba(${this.color},${alpha.toFixed( 3 )})`;
			ctx.beginPath();
			ctx.moveTo( x0, y0 );
			ctx.lineTo( x1 + px * w * 2, y1 + py * w * 2 );
			ctx.lineTo( x1 - px * w * 2, y1 - py * w * 2 );
			ctx.closePath();
			ctx.fill();

		}

	}

	clear() {

		this.target = 0;
		this.intensity = 0;
		this.canvas.style.opacity = '0';

	}

}
