import * as THREE from 'three/webgpu';
import { KMH, MPH, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';
import { fmtTime } from './HUD.js';
import { emissiveMaterial } from '../render/toon.js';

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

	setMode( mode ) {

		this.windshield.visible = mode === 'windshield';
		this.slate.visible = mode === 'slate';

	}

	update( dt, d ) {

		if ( ! this.windshield.visible && ! this.slate.visible ) return;
		this.timer -= dt;
		if ( this.timer > 0 ) return;
		this.timer = 1 / 15;
		const ctx = this.ctx, W = 768, H = 288;
		const tel = d.telemetry;
		ctx.clearRect( 0, 0, W, H );
		const cyan = '#7ff3ff', pink = '#ff8fc8';
		ctx.fillStyle = 'rgba(0,0,0,0)';
		// rpm bar
		const maxR = Math.ceil( d.spec.engine.limiter / 1000 ) * 1000;
		const f = clamp( tel.rpm / maxR, 0, 1 );
		const red = d.spec.engine.redline / maxR;
		const segs = 24;
		for ( let i = 0; i < segs; i ++ ) {

			const on = i / segs < f;
			ctx.fillStyle = on ? ( i / segs > red ? '#ff4a5a' : i / segs > red - 0.15 ? '#ffd15c' : cyan ) : 'rgba(127,243,255,0.12)';
			ctx.fillRect( 24 + i * 22, 22, 17, 30 );

		}

		const units = settings.units;
		const spd = Math.round( tel.speed * ( units === 'mph' ? MPH : KMH ) );
		ctx.fillStyle = cyan;
		ctx.font = '800 120px "Arial Narrow", Arial, sans-serif';
		ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
		ctx.fillText( spd, 330, 190 );
		ctx.font = '700 30px Arial';
		ctx.textAlign = 'left';
		ctx.fillText( units === 'mph' ? 'mph' : 'km/h', 338, 190 );
		ctx.font = '900 130px "Arial Narrow", Arial, sans-serif';
		ctx.fillStyle = pink;
		ctx.textAlign = 'center';
		ctx.fillText( tel.gear === - 1 ? 'R' : tel.gear === 0 ? 'N' : tel.gear, 480, 200 );
		ctx.font = '700 34px Arial';
		ctx.fillStyle = cyan;
		ctx.textAlign = 'left';
		ctx.fillText( `P${d.position ?? 1}/${d.total ?? 1}`, 24, 260 );
		ctx.fillText( fmtTime( d.time ?? 0 ), 160, 260 );
		if ( d.gap != null ) {

			ctx.fillStyle = d.gap <= 0 ? '#8affb5' : '#ff8a9a';
			ctx.fillText( ( d.gap >= 0 ? '+' : '−' ) + Math.abs( d.gap ).toFixed( 1 ) + 's', 360, 260 );

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
			ctx.fillStyle = 'rgba(10,8,20,0.75)';
			ctx.fillRect( 0, 0, W, 26 );
			ctx.fillStyle = '#ffffff';
			ctx.font = '600 18px Arial';
			ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			const remain = Math.max( 0, ( d.finishS - d.s ) );
			ctx.fillText( `${( remain / 1000 ).toFixed( 1 )} km`, 8, 13 );
			ctx.textAlign = 'right';
			ctx.fillText( d.section ?? '', W - 8, 13 );

		}

		this.cockpit.phoneTex.needsUpdate = true;

	}

}
