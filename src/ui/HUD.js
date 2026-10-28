import { KMH, MPH, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';

const ORD = ( n ) => ( n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th' );

// Arcade HUD in the style of the reference frames:
//  top-left  : big "1st / 2" + course timeline with both cars
//  top-right : race time, gap, DRIFT score with chain multiplier
//  bot-left  : vector course map with car arrows
//  bot-right : orange→red arc tachometer, huge gear digit, speed, turbo gauge
// In the cockpit (class .fpp) it collapses to a compact needle tach.
export class HUD {

	constructor( container, minimap ) {

		this.minimap = minimap;
		const el = document.createElement( 'div' );
		el.className = 'hud';
		el.innerHTML = `
			<div class="hud-pos" aria-live="polite">
				<span class="big"><span class="pos-n">1</span><sup class="pos-o">st</sup></span><span class="of">/ <span class="pos-t">2</span></span>
				<div class="timeline"><div class="track"></div><div class="done"></div><div class="ticks"></div><div class="car rival"></div><div class="car me"></div><div class="lbl">TIMELINE</div></div>
				<div class="hud-section"></div>
			</div>
			<div class="hud-time">
				<div class="t-main">0:00.00</div>
				<div class="t-gap"></div>
				<div class="drift"><div class="d-lbl">DRIFT</div><div class="d-pts">0 pts</div><div class="d-mult">x1.0</div></div>
			</div>
			<div class="hud-map"><canvas width="420" height="340"></canvas></div>
			<div class="hud-tach">
				<svg viewBox="0 0 280 240" aria-hidden="true">
					<defs><linearGradient id="tachGrad" x1="0" y1="1" x2="1" y2="0">
						<stop offset="0" stop-color="#ffd23f"/><stop offset="0.6" stop-color="#ff9a1a"/><stop offset="1" stop-color="#ff3b3b"/>
					</linearGradient></defs>
					<path class="tach-bg" d="" />
					<path class="tach-fill" d="" stroke="url(#tachGrad)" />
					<path class="tach-red" d="" />
					<path class="tach-ring" d="" />
					<g class="tach-ticks"></g>
				</svg>
				<div class="tach-gear">N</div>
				<div class="tach-redline"></div>
				<div class="tach-speed"><span class="spd">0</span><span class="unit">km/h</span></div>
				<div class="tach-flags"><span class="flag-tm">AT</span><span class="flag-hb">HB</span><span class="flag-gut">GUTTER</span></div>
				<div class="boost"><svg viewBox="0 0 96 74"><path d="M10 64 A 38 38 0 0 1 86 64" fill="none" stroke="rgba(13,10,18,0.8)" stroke-width="12"/><path d="M10 64 A 38 38 0 0 1 86 64" fill="none" stroke="#7ff3ff" stroke-width="4"/><path d="M72 30 A 38 38 0 0 1 86 64" fill="none" stroke="#ff3b3b" stroke-width="5"/><line class="b-needle" x1="48" y1="64" x2="20" y2="56" stroke="#ff3b3b" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="64" r="6" fill="#0d0a12" stroke="#fff" stroke-width="2"/><text x="10" y="74" fill="#fff" font-size="11" font-weight="800" font-style="italic" font-family="Kanit, sans-serif" paint-order="stroke" stroke="#0d0a12" stroke-width="3">TURBO</text></svg></div>
			</div>
			<div class="hud-mini">
				<svg viewBox="0 0 150 150" aria-hidden="true">
					<circle cx="75" cy="75" r="70" fill="rgba(13,10,18,0.82)" stroke="#fff" stroke-width="4"/>
					<g class="mini-ticks"></g>
					<line class="mini-needle" x1="75" y1="75" x2="75" y2="18" stroke="#ff5a00" stroke-width="5" stroke-linecap="round"/>
					<circle cx="75" cy="75" r="7" fill="#fff" stroke="#0d0a12" stroke-width="2"/>
					<text x="75" y="112" text-anchor="middle" fill="#fff" font-size="10" font-weight="800" font-family="Kanit, sans-serif" letter-spacing="1">TACHOMETER</text>
				</svg>
				<div class="mg">0</div>
			</div>
			<div class="hud-countdown"></div>
			<div class="hud-toast"></div>
			<div class="hud-debug"></div>`;
		container.appendChild( el );
		this.el = el;
		this.q = ( s ) => el.querySelector( s );
		this.mapCtx = this.q( '.hud-map canvas' ).getContext( '2d' );
		this.visible = true;
		this.mapTimer = 0;
		this.toastTimer = 0;
		this.lastMult = 1;
		this.a0 = Math.PI * 0.9; this.a1 = Math.PI * 2.08; // arc from left, over the top, down the right
		this.cx = 170; this.cy = 150; this.r = 100;

	}

	_arc( cx, cy, r, a0, a1 ) {

		const p0 = [ cx + r * Math.cos( a0 ), cy + r * Math.sin( a0 ) ];
		const p1 = [ cx + r * Math.cos( a1 ), cy + r * Math.sin( a1 ) ];
		const large = a1 - a0 > Math.PI ? 1 : 0;
		return `M ${p0[ 0 ].toFixed( 2 )} ${p0[ 1 ].toFixed( 2 )} A ${r} ${r} 0 ${large} 1 ${p1[ 0 ].toFixed( 2 )} ${p1[ 1 ].toFixed( 2 )}`;

	}

	setSpec( spec, track ) {

		this.spec = spec;
		this.track = track;
		const maxRpm = Math.ceil( spec.engine.limiter / 1000 ) * 1000 + 1000;
		this.maxRpm = maxRpm;
		const { cx, cy, r, a0, a1 } = this;
		this.q( '.tach-bg' ).setAttribute( 'd', this._arc( cx, cy, r, a0, a1 ) );
		this.q( '.tach-ring' ).setAttribute( 'd', this._arc( cx, cy, r + 16, a0, a1 ) );
		const red = a0 + ( a1 - a0 ) * ( spec.engine.redline / maxRpm );
		this.q( '.tach-red' ).setAttribute( 'd', this._arc( cx, cy, r + 13, red, a1 ) );
		let html = '';
		for ( let k = 0; k <= maxRpm / 1000; k ++ ) {

			const a = a0 + ( a1 - a0 ) * ( k * 1000 / maxRpm );
			const c = Math.cos( a ), s = Math.sin( a );
			html += `<line x1="${cx + c * ( r - 22 )}" y1="${cy + s * ( r - 22 )}" x2="${cx + c * ( r - 12 )}" y2="${cy + s * ( r - 12 )}" />`;
			if ( k > 0 ) html += `<text x="${cx + c * ( r - 36 )}" y="${cy + s * ( r - 36 ) + 5}">${k}</text>`;

		}

		this.q( '.tach-ticks' ).innerHTML = html;
		const rl = this.q( '.tach-redline' );
		rl.innerHTML = `${Math.round( spec.engine.redline / 1000 )}<br>redline`;
		this.q( '.boost' ).classList.toggle( 'hidden', ! spec.engine.turbo );
		// compact cockpit tach ticks
		let mt = '';
		for ( let k = 0; k <= maxRpm / 1000; k ++ ) {

			const a = Math.PI * 0.75 + Math.PI * 1.5 * ( k * 1000 / maxRpm );
			const c = Math.cos( a ), s = Math.sin( a );
			const redZone = k * 1000 >= spec.engine.redline;
			mt += `<line x1="${75 + c * 52}" y1="${75 + s * 52}" x2="${75 + c * 64}" y2="${75 + s * 64}" stroke="${redZone ? '#ff3b3b' : '#fff'}" stroke-width="3"/>`;
			mt += `<text x="${75 + c * 41}" y="${75 + s * 41 + 4}" text-anchor="middle" fill="${redZone ? '#ff5a5a' : '#fff'}" font-size="12" font-weight="800" font-style="italic" font-family="Kanit, sans-serif">${k}</text>`;

		}

		this.q( '.mini-ticks' ).innerHTML = mt;
		// course timeline section ticks
		const ticks = this.q( '.ticks' );
		ticks.innerHTML = '';
		if ( track ) {

			for ( const tag of [ 'hairpin1', 'carousel', 'hairpin2', 'fiveHairpins', 'finalSection' ] ) {

				const f = clamp( ( track.tags[ tag ] - track.startS ) / ( track.finishS - track.startS ), 0, 1 );
				ticks.insertAdjacentHTML( 'beforeend', `<div class="tick" style="left:${( f * 100 ).toFixed( 1 )}%"></div>` );

			}

		}

	}

	show( v ) {

		this.visible = v;
		this.el.classList.toggle( 'hidden', ! v );

	}

	setCockpit( fpp ) {

		this.el.classList.toggle( 'fpp', fpp );

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
		const gear = tel.gear === - 1 ? 'R' : tel.gear === 0 ? 'N' : String( tel.gear );
		this.q( '.spd' ).textContent = spd;
		this.q( '.unit' ).textContent = units === 'mph' ? 'mph' : 'km/h';
		this.q( '.tach-gear' ).textContent = gear;
		this.q( '.mg' ).textContent = gear;
		const f = clamp( tel.rpm / this.maxRpm, 0, 1 );
		const { cx, cy, r, a0, a1 } = this;
		this.q( '.tach-fill' ).setAttribute( 'd', this._arc( cx, cy, r, a0, a0 + ( a1 - a0 ) * Math.max( 0.003, f ) ) );
		const na = Math.PI * 0.75 + Math.PI * 1.5 * f;
		const needle = this.q( '.mini-needle' );
		needle.setAttribute( 'x2', ( 75 + Math.cos( na ) * 58 ).toFixed( 1 ) );
		needle.setAttribute( 'y2', ( 75 + Math.sin( na ) * 58 ).toFixed( 1 ) );
		const shift = tel.rpm > this.spec.engine.redline * 0.96;
		this.el.classList.toggle( 'shift-light', shift && ( performance.now() % 160 < 80 ) );
		this.q( '.flag-tm' ).textContent = d.autoShift ? 'AT' : 'MT';
		this.q( '.flag-hb' ).classList.toggle( 'on', d.handbrake > 0.1 );
		this.q( '.flag-gut' ).classList.toggle( 'on', tel.hook > 0.5 );
		if ( this.spec.engine.turbo ) {

			const boost = clamp( tel.throttle * clamp( ( tel.rpm - 2800 ) / 3500, 0, 1 ), 0, 1 );
			const ba = Math.PI + Math.PI * boost;
			const bn = this.q( '.b-needle' );
			bn.setAttribute( 'x2', ( 48 + Math.cos( ba ) * 32 ).toFixed( 1 ) );
			bn.setAttribute( 'y2', ( 64 + Math.sin( ba ) * 32 ).toFixed( 1 ) );

		}

		// position / timeline
		const pos = d.position ?? 1;
		this.q( '.pos-n' ).textContent = pos;
		this.q( '.pos-o' ).textContent = ORD( pos );
		this.q( '.pos-t' ).textContent = d.total ?? 1;
		const prog = clamp( d.progress ?? 0, 0, 1 );
		this.q( '.timeline .done' ).style.width = `${( prog * 100 ).toFixed( 1 )}%`;
		this.q( '.timeline .me' ).style.left = `${( prog * 100 ).toFixed( 1 )}%`;
		const rv = this.q( '.timeline .rival' );
		rv.style.display = d.rivalProgress == null ? 'none' : '';
		if ( d.rivalProgress != null ) rv.style.left = `${( clamp( d.rivalProgress, 0, 1 ) * 100 ).toFixed( 1 )}%`;
		this.q( '.hud-section' ).textContent = d.section ?? '';

		// time / gap / drift
		this.q( '.t-main' ).textContent = fmtTime( d.time ?? 0, true );
		const gap = this.q( '.t-gap' );
		if ( d.gap != null ) {

			gap.textContent = ( d.gap >= 0 ? '+' : '−' ) + Math.abs( d.gap ).toFixed( 1 ) + 's';
			gap.className = 't-gap ' + ( d.gap <= 0 ? 'ahead' : 'behind' );

		} else gap.textContent = '';

		if ( d.drift ) {

			const dr = this.q( '.drift' );
			dr.classList.toggle( 'on', d.drift.active );
			this.q( '.d-pts' ).textContent = `${Math.round( d.drift.score + d.drift.current ).toLocaleString( 'en-US' )} pts`;
			this.q( '.d-mult' ).textContent = `x${d.drift.mult.toFixed( 1 )}`;
			if ( d.drift.mult > this.lastMult ) {

				dr.classList.remove( 'pop' ); void dr.offsetWidth; dr.classList.add( 'pop' );

			}

			this.lastMult = d.drift.mult;

		}

		// course map at 15 Hz (whole course, like the reference)
		this.mapTimer -= dt;
		if ( this.mapTimer <= 0 && ! this.el.classList.contains( 'fpp' ) ) {

			this.mapTimer = 1 / 15;
			const ctx = this.mapCtx;
			ctx.clearRect( 0, 0, 420, 340 );
			this.minimap.draw( ctx, {
				x: 0, y: 0, w: 420, h: 340, mode: 'overview', cars: d.cars,
				line: '#ffffff', outline: '#0d0a12', lineScale: 1.6
			} );

		}

	}

}

export function fmtTime( t, pad = false ) {

	if ( ! isFinite( t ) ) return '--:--.--';
	const m = Math.floor( t / 60 ), s = t - m * 60;
	return `${pad && m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed( 2 )}`;

}
