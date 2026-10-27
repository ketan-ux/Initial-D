import { KMH, MPH, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';

// Floating flatscreen HUD (third-person, or first-person when the player
// opts in): peripheral arc tachometer, big gear readout, vector minimap,
// race status. Pure DOM/SVG/canvas so it is crisp at any DPI and costs no
// draw calls in the 3D scene.
export class HUD {

	constructor( container, minimap ) {

		this.minimap = minimap;
		const el = document.createElement( 'div' );
		el.className = 'hud';
		el.innerHTML = `
			<div class="hud-top">
				<div class="hud-pos" aria-live="polite"><span class="pos-n">1</span><span class="pos-of">/2</span></div>
				<div class="hud-time"><span class="t-main">0:00.00</span><span class="t-gap"></span></div>
				<div class="hud-section"></div>
			</div>
			<div class="hud-map"><canvas width="220" height="220"></canvas></div>
			<div class="hud-tach">
				<svg viewBox="0 0 200 200" aria-hidden="true">
					<path class="tach-bg" d="" />
					<path class="tach-red" d="" />
					<path class="tach-fill" d="" />
					<g class="tach-ticks"></g>
				</svg>
				<div class="tach-gear">N</div>
				<div class="tach-speed"><span class="spd">0</span><span class="unit">km/h</span></div>
				<div class="tach-rpm">0</div>
				<div class="tach-flags"><span class="flag-tm">AT</span><span class="flag-hb">HB</span><span class="flag-gut">GUTTER</span></div>
			</div>
			<div class="hud-countdown"></div>
			<div class="hud-toast"></div>
			<div class="hud-debug"></div>`;
		container.appendChild( el );
		this.el = el;
		this.q = ( s ) => el.querySelector( s );
		this.mapCtx = this.q( '.hud-map canvas' ).getContext( '2d' );
		this._buildTach();
		this.visible = true;
		this.mapTimer = 0;
		this.toastTimer = 0;

	}

	_arc( cx, cy, r, a0, a1 ) {

		const p0 = [ cx + r * Math.cos( a0 ), cy + r * Math.sin( a0 ) ];
		const p1 = [ cx + r * Math.cos( a1 ), cy + r * Math.sin( a1 ) ];
		const large = a1 - a0 > Math.PI ? 1 : 0;
		return `M ${p0[ 0 ].toFixed( 2 )} ${p0[ 1 ].toFixed( 2 )} A ${r} ${r} 0 ${large} 1 ${p1[ 0 ].toFixed( 2 )} ${p1[ 1 ].toFixed( 2 )}`;

	}

	_buildTach() {

		this.a0 = Math.PI * 0.75; this.a1 = Math.PI * 2.1;
		this.q( '.tach-bg' ).setAttribute( 'd', this._arc( 100, 100, 82, this.a0, this.a1 ) );

	}

	setSpec( spec ) {

		this.spec = spec;
		const maxRpm = Math.ceil( spec.engine.limiter / 1000 ) * 1000;
		this.maxRpm = maxRpm;
		const red = this.a0 + ( this.a1 - this.a0 ) * ( spec.engine.redline / maxRpm );
		this.q( '.tach-red' ).setAttribute( 'd', this._arc( 100, 100, 82, red, this.a1 ) );
		const g = this.q( '.tach-ticks' );
		let html = '';
		for ( let k = 0; k <= maxRpm / 1000; k ++ ) {

			const a = this.a0 + ( this.a1 - this.a0 ) * ( k * 1000 / maxRpm );
			const x0 = 100 + Math.cos( a ) * 66, y0 = 100 + Math.sin( a ) * 66;
			const x1 = 100 + Math.cos( a ) * 74, y1 = 100 + Math.sin( a ) * 74;
			const tx = 100 + Math.cos( a ) * 55, ty = 100 + Math.sin( a ) * 55;
			html += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" />`;
			html += `<text x="${tx}" y="${ty + 4}">${k}</text>`;

		}

		g.innerHTML = html;

	}

	show( v ) {

		this.visible = v;
		this.el.classList.toggle( 'hidden', ! v );

	}

	showGauges( v ) {

		this.q( '.hud-tach' ).classList.toggle( 'hidden', ! v );
		this.q( '.hud-map' ).classList.toggle( 'hidden', ! v );
		this.q( '.hud-top' ).classList.toggle( 'hidden', ! v );

	}

	countdown( text, cls = '' ) {

		const c = this.q( '.hud-countdown' );
		c.textContent = text || '';
		c.className = 'hud-countdown ' + cls + ( text ? ' show' : '' );

	}

	toast( text, secs = 1.6 ) {

		const t = this.q( '.hud-toast' );
		t.textContent = text;
		t.classList.add( 'show' );
		this.toastTimer = secs;

	}

	debug( text ) {

		const d = this.q( '.hud-debug' );
		d.textContent = text || '';
		d.style.display = text ? '' : 'none';

	}

	update( dt, d ) {

		if ( this.toastTimer > 0 ) {

			this.toastTimer -= dt;
			if ( this.toastTimer <= 0 ) this.q( '.hud-toast' ).classList.remove( 'show' );

		}

		if ( ! this.visible || ! d ) return;
		const tel = d.telemetry;
		const units = settings.units;
		const spd = Math.round( tel.speed * ( units === 'mph' ? MPH : KMH ) );
		this.q( '.spd' ).textContent = spd;
		this.q( '.unit' ).textContent = units === 'mph' ? 'mph' : 'km/h';
		this.q( '.tach-gear' ).textContent = tel.gear === - 1 ? 'R' : tel.gear === 0 ? 'N' : tel.gear;
		this.q( '.tach-rpm' ).textContent = Math.round( tel.rpm / 10 ) * 10;
		const f = clamp( tel.rpm / this.maxRpm, 0, 1 );
		const aEnd = this.a0 + ( this.a1 - this.a0 ) * Math.max( 0.002, f );
		this.q( '.tach-fill' ).setAttribute( 'd', this._arc( 100, 100, 82, this.a0, aEnd ) );
		const shift = tel.rpm > this.spec.engine.redline * 0.96;
		this.el.classList.toggle( 'shift-light', shift && ( performance.now() % 160 < 80 ) );
		this.q( '.flag-tm' ).textContent = d.autoShift ? 'AT' : 'MT';
		this.q( '.flag-hb' ).classList.toggle( 'on', tel.throttle !== undefined && d.handbrake > 0.1 );
		this.q( '.flag-gut' ).classList.toggle( 'on', tel.hook > 0.5 );

		// race info
		this.q( '.pos-n' ).textContent = d.position ?? 1;
		this.q( '.pos-of' ).textContent = '/' + ( d.total ?? 1 );
		this.q( '.t-main' ).textContent = fmtTime( d.time ?? 0 );
		const gap = this.q( '.t-gap' );
		if ( d.gap != null ) {

			gap.textContent = ( d.gap >= 0 ? '+' : '−' ) + Math.abs( d.gap ).toFixed( 1 ) + 's';
			gap.className = 't-gap ' + ( d.gap <= 0 ? 'ahead' : 'behind' );

		} else gap.textContent = '';

		this.q( '.hud-section' ).textContent = d.section ?? '';

		// minimap at 15 Hz
		this.mapTimer -= dt;
		if ( this.mapTimer <= 0 ) {

			this.mapTimer = 1 / 15;
			const ctx = this.mapCtx;
			ctx.clearRect( 0, 0, 220, 220 );
			this.minimap.draw( ctx, {
				x: 0, y: 0, w: 220, h: 220, mode: 'follow', zoom: 260, heading: d.heading, center: d.center,
				cars: d.cars, bg: 'rgba(14,10,26,0.55)', line: '#f4f0ff', glow: 'rgba(255,120,190,0.35)', radius: 24
			} );

		}

	}

}

export function fmtTime( t ) {

	if ( ! isFinite( t ) ) return '--:--.--';
	const m = Math.floor( t / 60 ), s = t - m * 60;
	return `${m}:${s < 10 ? '0' : ''}${s.toFixed( 2 )}`;

}
