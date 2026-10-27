// Vector minimap of the pass, drawn into any 2D canvas context: used by the
// floating HUD, the windshield-mounted phone and the VR slate.
export class MiniMap {

	constructor( track ) {

		this.track = track;
		// decimated polyline
		this.pts = [];
		for ( let i = 0; i < track.count; i += 3 ) this.pts.push( [ track.px[ i ], track.pz[ i ] ] );
		const b = track.bounds;
		this.cx = ( b.minX + b.maxX ) / 2;
		this.cz = ( b.minZ + b.maxZ ) / 2;
		this.extent = Math.max( b.maxX - b.minX, b.maxZ - b.minZ ) * 0.55;

	}

	/**
	 * opts: { x, y, w, h, mode: 'overview'|'follow', zoom (m per half-width),
	 *         heading (rad), center: {x,z}, cars: [{x,z,heading,color,me}],
	 *         bg, line, glow, radius }
	 */
	draw( ctx, o ) {

		const { x, y, w, h } = o;
		ctx.save();
		ctx.beginPath();
		if ( o.radius ) {

			ctx.roundRect( x, y, w, h, o.radius );

		} else ctx.rect( x, y, w, h );

		ctx.clip();
		if ( o.bg ) {

			ctx.fillStyle = o.bg;
			ctx.fillRect( x, y, w, h );

		}

		const follow = o.mode === 'follow';
		const half = follow ? o.zoom ?? 220 : this.extent;
		const scale = Math.min( w, h ) / 2 / half;
		const ccx = follow ? o.center.x : this.cx, ccz = follow ? o.center.z : this.cz;
		const rot = follow ? o.heading : 0;
		ctx.translate( x + w / 2, y + h / 2 + ( follow ? h * 0.18 : 0 ) );
		ctx.scale( scale, scale );
		// world: heading 0 faces +z. Map so the car's forward is screen-up.
		ctx.rotate( rot );
		ctx.scale( - 1, - 1 );
		ctx.translate( - ccx, - ccz );

		const t = this.track;
		const lw = 12 / scale * ( follow ? 0.5 : 0.6 ) + 6;
		ctx.lineJoin = 'round'; ctx.lineCap = 'round';
		if ( o.glow ) {

			ctx.strokeStyle = o.glow;
			ctx.lineWidth = lw * 2.2;
			this._path( ctx );
			ctx.stroke();

		}

		ctx.strokeStyle = o.line ?? '#ffffff';
		ctx.lineWidth = lw;
		this._path( ctx );
		ctx.stroke();

		// start + finish ticks
		for ( const [ s, col ] of [ [ t.startS, '#7dffb0' ], [ t.finishS, '#ff5c8a' ] ] ) {

			const p = t.pointAt( s );
			ctx.fillStyle = col;
			ctx.beginPath(); ctx.arc( p.x, p.z, lw * 1.1, 0, Math.PI * 2 ); ctx.fill();

		}

		for ( const c of o.cars || [] ) {

			ctx.save();
			ctx.translate( c.x, c.z );
			ctx.rotate( - c.heading );
			const s = ( c.me ? 9 : 7 ) / scale * 2.2;
			ctx.fillStyle = c.color;
			ctx.strokeStyle = '#0d0a14';
			ctx.lineWidth = s * 0.25;
			ctx.beginPath();
			ctx.moveTo( 0, s * 1.2 ); ctx.lineTo( s * 0.75, - s * 0.8 ); ctx.lineTo( 0, - s * 0.35 ); ctx.lineTo( - s * 0.75, - s * 0.8 );
			ctx.closePath();
			ctx.fill(); ctx.stroke();
			ctx.restore();

		}

		ctx.restore();

	}

	_path( ctx ) {

		const pts = this.pts;
		ctx.beginPath();
		ctx.moveTo( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
		for ( let i = 1; i < pts.length; i ++ ) ctx.lineTo( pts[ i ][ 0 ], pts[ i ][ 1 ] );

	}

}
