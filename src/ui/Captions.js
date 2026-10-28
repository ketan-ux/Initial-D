import * as THREE from 'three/webgpu';
import { bus } from '../core/events.js';
import { settings } from '../core/settings.js';
import { emissiveMaterial } from '../render/toon.js';
import { C, font, drawCard, drawKey, inkText } from './theme.js';

// Closed captions for radio comms. Shown exactly while the line plays,
// placed in the lower band of the screen below the road sightline (flat) or
// on a small panel resting on the dashboard top (VR) — never head-locked.
export class Captions {

	constructor( container ) {

		const el = document.createElement( 'div' );
		el.className = 'captions';
		el.setAttribute( 'role', 'status' );
		el.setAttribute( 'aria-live', 'polite' );
		container.appendChild( el );
		this.el = el;
		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 1024; this.canvas.height = 160;
		this.tex = new THREE.CanvasTexture( this.canvas );
		this.tex.colorSpace = THREE.NoColorSpace;
		const mat = emissiveMaterial( 0xffffff, 1.0, { transparent: true, depthWrite: false } );
		mat.map = this.tex;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( 0.5, 0.078 ), mat );
		this.mesh.renderOrder = 30;
		this.mesh.visible = false;
		this.timer = 0;
		bus.on( 'caption', ( c ) => this.show( c ) );

	}

	// VR: rest on the dash, under the windshield horizon, angled to the eye.
	mount( cockpit ) {

		const e = cockpit.eyePos;
		cockpit.group.add( this.mesh );
		this.mesh.position.set( e.x * 0.5, cockpit.dashTopY + 0.07, cockpit.dashZ - 0.3 );
		this.mesh.rotation.set( - 0.5, Math.PI, 0 );

	}

	mountTo( parent, pos, rot ) {

		parent.add( this.mesh );
		this.mesh.position.copy( pos );
		if ( rot ) this.mesh.rotation.copy( rot );

	}

	show( c ) {

		if ( ! c || ! settings.captions ) {

			this.el.classList.remove( 'show' );
			this.mesh.visible = false;
			this.timer = 0;
			return;

		}

		this.el.className = 'captions show size-' + settings.captionSize;
		// manga radio caption: RADIO: "line" — the speaker tag stays for clarity
		this.el.innerHTML = `<span class="cc-tag" title="Closed caption">[CC]</span> <span class="cc-who" style="color:${c.color}">RADIO</span><span class="cc-sp"></span>: <span class="cc-text"></span>`;
		this.el.querySelector( '.cc-sp' ).textContent = ` · ${c.speaker}`;
		this.el.querySelector( '.cc-text' ).textContent = `“${c.text}”`;
		this.timer = c.duration;
		this._draw( c );

	}

	_draw( c ) {

		const ctx = this.canvas.getContext( '2d' );
		const W = 1024, H = 160;
		// same look as the flatscreen captions: [CC] chip, ink-outlined RADIO
		// tag, white subtitle text on a dark comic card
		drawCard( ctx, W, H, { pad: 2, border: 4 } );
		ctx.textBaseline = 'middle';
		const kw = drawKey( ctx, 'CC', 22, 14, 30 );
		ctx.textBaseline = 'alphabetic';
		inkText( ctx, 'Radio', 22 + kw + 16, 40, 28, { color: c.color } );
		const tw = ctx.measureText( 'RADIO' ).width; // inkText leaves its font set
		ctx.font = font( 24, 600, false );
		ctx.fillStyle = C.muted; ctx.textAlign = 'left';
		ctx.fillText( c.speaker, 22 + kw + 16 + tw + 14, 40 );
		ctx.fillStyle = '#ffffff';
		ctx.font = font( 32, 600, false );
		ctx.textBaseline = 'top';
		// wrap text into two lines max
		const words = `“${c.text}”`.split( ' ' );
		let line = '', y = 58;
		for ( const w of words ) {

			const test = line ? line + ' ' + w : w;
			if ( ctx.measureText( test ).width > W - 52 ) {

				ctx.fillText( line, 26, y ); y += 44; line = w;

			} else line = test;

		}

		ctx.fillText( line, 26, y );
		this.tex.needsUpdate = true;
		this.mesh.visible = this.vrActive === true;

	}

	setVR( on ) {

		this.vrActive = on;
		if ( ! on ) this.mesh.visible = false;

	}

	update( dt ) {

		if ( this.timer > 0 ) {

			this.timer -= dt;
			if ( this.timer <= 0 ) {

				this.el.classList.remove( 'show' );
				this.mesh.visible = false;

			}

		}

	}

}
