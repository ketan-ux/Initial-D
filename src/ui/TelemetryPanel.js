import * as THREE from 'three/webgpu';
import { KMH, MPH, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { fmtTime } from './HUD.js';
import { emissiveMaterial } from '../render/toon.js';
import { C, font, plate } from './theme.js';

// Canvas-texture telemetry used in 3D: the windshield-projected HUD and the
// curved, transparent VR slate floating 2 m away (HUD freedom toggle), plus
// the diegetic phone GPS on the dash.
export class TelemetryPanel {

	constructor( minimap ) {

		this.minimap = minimap;
		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 768; this.canvas.height = 288;
		this.ctx = this.canvas.getContext( '2d' );
		this.tex = new THREE.CanvasTexture( this.canvas );
		this.tex.colorSpace = THREE.NoColorSpace;
		this.timer = 0;
		// windshield projection: flat, additive cyan "HUD glass"
		const wmat = emissiveMaterial( 0xffffff, 1.1, { transparent: true, additive: true, depthWrite: false } );
		wmat.map = this.tex;
		this.windshield = new THREE.Mesh( new THREE.PlaneGeometry( 0.36, 0.135 ), wmat );
		this.windshield.renderOrder = 20;
		this.windshield.visible = false;
		// curved VR slate at 2 m
		const smat = emissiveMaterial( 0xffffff, 1.0, { transparent: true, additive: true, depthWrite: false, side: THREE.DoubleSide } );
		smat.map = this.tex;
		const arc = 0.62; // radians of the cylinder used
		const slateGeo = new THREE.CylinderGeometry( 2, 2, 0.62, 32, 1, true, - arc / 2, arc ); // centred on +z (car forward)
		// flip UVs horizontally so text reads from inside the cylinder
		const uv = slateGeo.attributes.uv;
		for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, 1 - uv.getX( i ) );
		this.slate = new THREE.Mesh( slateGeo, smat );
		this.slate.renderOrder = 20;
		this.slate.visible = false;

	}

	// Mount points: windshield sits in front of the driver, slate is 2 m ahead
	// of the eye and slightly below it (comfortable focal distance).
	mount( cockpit ) {

		const e = cockpit.eyePos;
		this.eye = e;
		cockpit.group.add( this.windshield );
		this.windshield.position.set( e.x, e.y - 0.07, e.z + 0.62 );
		this.windshield.rotation.set( 0.22, Math.PI, 0 );
		cockpit.group.add( this.slate );
		this.slate.position.set( e.x, e.y - 0.32, e.z );
		this.slate.rotation.set( 0, 0, 0 );

	}

	mountTo( parent, pos ) {

		parent.add( this.slate );
		this.slate.position.copy( pos );

	}

	// vr: the glass HUD floats further out over the hood, just above the dash
	// line and below the road sightline
	setMode( mode, vr = false ) {

		this.windshield.visible = mode === 'windshield';
		this.slate.visible = mode === 'slate';
		const e = this.eye;
		if ( ! e ) return;
		if ( vr ) {

			this.windshield.position.set( e.x, e.y - 0.045, e.z + 0.95 );
			this.windshield.rotation.set( 0.1, Math.PI, 0 );
			this.windshield.scale.setScalar( 1.3 );

		} else {

			this.windshield.position.set( e.x, e.y - 0.07, e.z + 0.62 );
			this.windshield.rotation.set( 0.22, Math.PI, 0 );
			this.windshield.scale.setScalar( 1 );

		}

	}

	update( dt, d ) {

		if ( ! this.windshield.visible && ! this.slate.visible ) return;
		this.timer -= dt;
		if ( this.timer > 0 ) return;
		this.timer = 1 / 15;
		const ctx = this.ctx, W = 768, H = 288;
		const tel = d.telemetry;
		ctx.clearRect( 0, 0, W, H );
		// additive "HUD glass": black is transparent, so everything is light on
		// nothing, in the same italic Kanit / slanted-plate language as the DOM HUD
		const cyan = C.cyan, pink = C.pink;
		if ( d.countdown ) {

			ctx.fillStyle = d.countdown === 'GO!' ? C.green : C.yellow;
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.font = font( 190, 900 );
			ctx.fillText( d.countdown, 280, H / 2 + 8 );

		} else {

			// rpm bar: slanted segments
			const maxR = Math.ceil( d.spec.engine.limiter / 1000 ) * 1000;
			const f = clamp( tel.rpm / maxR, 0, 1 );
			const red = d.spec.engine.redline / maxR;
			const segs = 22;
			for ( let i = 0; i < segs; i ++ ) {

				const on = i / segs < f;
				ctx.fillStyle = on ? ( i / segs > red ? '#ff4a5a' : i / segs > red - 0.15 ? C.yellow : cyan ) : 'rgba(127,243,255,0.13)';
				plate( ctx, 24 + i * 23.5, 20, 19, 32 ); ctx.fill();

			}

			const units = settings.units;
			const spd = Math.round( tel.speed * ( units === 'mph' ? MPH : KMH ) );
			ctx.fillStyle = cyan;
			ctx.font = font( 128, 900 );
			ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
			ctx.fillText( spd, 318, 192 );
			ctx.font = font( 30, 800 );
			ctx.textAlign = 'left';
			ctx.fillText( units === 'mph' ? 'MPH' : 'KM/H', 326, 192 );
			// gear in a slanted pink plate
			ctx.strokeStyle = pink; ctx.lineWidth = 5;
			plate( ctx, 420, 76, 118, 126 ); ctx.stroke();
			ctx.font = font( 120, 900 );
			ctx.fillStyle = pink;
			ctx.textAlign = 'center';
			ctx.fillText( tel.gear === - 1 ? 'R' : tel.gear === 0 ? 'N' : tel.gear, 479, 186 );

		}

		ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = '#ffffff';
		ctx.font = font( 40, 900 );
		const pos = d.position ?? 1;
		ctx.fillText( `${pos}${[ 'ST', 'ND', 'RD' ][ pos - 1 ] ?? 'TH'}/${d.total ?? 1}`, 24, 262 );
		ctx.fillStyle = cyan;
		ctx.font = font( 36, 800 );
		ctx.fillText( fmtTime( d.time ?? 0 ), 170, 262 );
		if ( d.gap != null ) {

			ctx.fillStyle = d.gap <= 0 ? C.green : '#ff8a9a';
			ctx.fillText( ( d.gap >= 0 ? '+' : '−' ) + Math.abs( d.gap ).toFixed( 1 ) + 's', 380, 262 );

		}

		// mini map on the right
		this.minimap.draw( ctx, {
			x: 560, y: 20, w: 190, h: 250, mode: 'follow', zoom: 240, heading: d.heading, center: d.center,
			cars: d.cars, line: cyan, glow: 'rgba(127,243,255,0.25)'
		} );
		this.tex.needsUpdate = true;

	}

}

// Diegetic phone on the dash: navigation map, or telemetry after a tap.
export class PhoneGPS {

	constructor( cockpit, minimap ) {

		this.cockpit = cockpit;
		this.minimap = minimap;
		this.mode = 0; // 0 = nav map, 1 = overview, 2 = lap info
		this.timer = 0;

	}

	cycle() {

		this.mode = ( this.mode + 1 ) % 3;
		this.timer = 0;

	}

	update( dt, d ) {

		this.timer -= dt;
		if ( this.timer > 0 ) return;
		this.timer = 1 / 12;
		const c = this.cockpit.phoneCanvas, ctx = c.getContext( '2d' );
		const W = c.width, H = c.height;
		ctx.fillStyle = '#0b0a14';
		ctx.fillRect( 0, 0, W, H );
		if ( d.countdown ) {

			ctx.fillStyle = d.countdown === 'GO!' ? '#6dff9c' : '#ff5a6e';
			ctx.font = '900 96px Arial';
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText( d.countdown, W / 2, H / 2 + 4 );
			this.cockpit.phoneTex.needsUpdate = true;
			return;

		}

		if ( this.mode === 2 ) {

			ctx.fillStyle = '#ffb35a';
			ctx.font = '700 22px Arial';
			ctx.textAlign = 'left'; ctx.textBaseline = 'top';
			ctx.fillText( 'TOUGE NAVI', 14, 10 );
			ctx.font = '800 40px Arial';
			ctx.fillStyle = '#ffffff';
			ctx.fillText( fmtTime( d.time ?? 0 ), 14, 44 );
			ctx.font = '600 22px Arial';
			ctx.fillStyle = '#9fe8ff';
			const remain = Math.max( 0, ( d.finishS - d.s ) );
			ctx.fillText( `${( remain / 1000 ).toFixed( 2 )} km to goal`, 14, 96 );
			if ( d.gap != null ) ctx.fillText( `gap ${d.gap >= 0 ? '+' : '−'}${Math.abs( d.gap ).toFixed( 1 )}s`, 14, 124 );

		} else {

			this.minimap.draw( ctx, {
				x: 0, y: 0, w: W, h: H, mode: this.mode === 0 ? 'follow' : 'overview', zoom: 180,
				heading: d.heading, center: d.center, cars: d.cars, bg: '#14122a', line: '#ffffff', glow: 'rgba(80,170,255,0.4)'
			} );
			// status bar + next-section banner (portrait phone: two rows)
			const narrow = W < 240;
			ctx.fillStyle = 'rgba(10,8,20,0.8)';
			ctx.fillRect( 0, 0, W, narrow ? 52 : 26 );
			ctx.fillStyle = '#ffffff';
			ctx.font = `600 ${narrow ? 20 : 18}px Arial`;
			ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			const remain = Math.max( 0, ( d.finishS - d.s ) );
			ctx.fillText( `${( remain / 1000 ).toFixed( 1 )} km`, 8, 13 );
			ctx.textAlign = narrow ? 'left' : 'right';
			ctx.fillStyle = narrow ? '#9fe8ff' : '#ffffff';
			ctx.fillText( d.section ?? '', narrow ? 8 : W - 8, narrow ? 38 : 13 );

		}

		this.cockpit.phoneTex.needsUpdate = true;

	}

}
