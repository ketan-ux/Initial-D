import * as THREE from 'three/webgpu';
import { liveCanvasTexture } from '../render/textures.js';
import { emissiveMaterial } from '../render/toon.js';
import { C, SKEW, font, fontsReady, drawCard, drawPlate, drawKey, inkText, fitText } from './theme.js';

// Draw order for VR overlays: panels after the world, hands after panels.
export const VR_PANEL_ORDER = 100; // menu; legends at +0.25, cursor at +0.5
export const VR_HAND_ORDER = 101;

const _ray = new THREE.Raycaster();
const _m = new THREE.Matrix4();
const _hit = new THREE.Vector3();
// true when this ray currently hits the panel (pick() filled _hit)
const _hitValid = ( rayObj, mesh ) => {

	_m.identity().extractRotation( rayObj.matrixWorld );
	_ray.ray.origin.setFromMatrixPosition( rayObj.matrixWorld );
	_ray.ray.direction.set( 0, 0, - 1 ).applyMatrix4( _m );
	const h = _ray.intersectObject( mesh, false )[ 0 ];
	if ( h ) _hit.copy( h.point );
	return !! h;

};

// World-anchored canvas menu for VR, operated with controller laser
// pointers (trigger = select). Large targets, high contrast, one column.
export class VRMenu {

	constructor( { width = 1.1 } = {} ) {

		// a square canvas; the panel shows only the rows a menu needs (texture
		// repeat/offset crop + matching plane height), so short and long menus
		// both get full-size buttons
		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 1024; this.canvas.height = 1024;
		this.width = width;
		this.usedH = 0;
		this.tex = liveCanvasTexture( this.canvas );
		// Opaque panel (alpha-tested corners) drawn after the cabin with an
		// always-passing depth test, so the dashboard or a pillar can never hide
		// it. It still writes depth (a disabled depth test would not), so glass,
		// mist and petals stay behind it, and the gloves (VR_HAND_ORDER, drawn
		// later) correctly cover it when a hand is in front.
		const mat = new THREE.MeshBasicNodeMaterial( { map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide } );
		mat.depthFunc = THREE.AlwaysDepth;
		mat.fog = false;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( width, width * 0.6 ), mat );
		this.mesh.renderOrder = VR_PANEL_ORDER;
		this.mesh.visible = false;
		// pointer cursor: where the laser meets the panel
		this.cursor = new THREE.Mesh( new THREE.RingGeometry( 0.008, 0.016, 20 ), emissiveMaterial( 0xff8fc0, 1.6, { side: THREE.DoubleSide, depthWrite: false } ) );
		this.cursor.material.fog = false;
		this.cursor.position.z = 0.003;
		this.cursor.renderOrder = VR_PANEL_ORDER + 0.5; // after the panel, before the hands
		this.cursor.visible = false;
		this.mesh.add( this.cursor );
		this.title = '';
		this.subtitle = '';
		this.items = [];
		this.hover = - 1;
		this.rects = [];
		this.dirty = true;
		fontsReady().then( () => this.draw() ); // repaint once Kanit has loaded

	}

	set( title, items, subtitle = '' ) {

		this.title = title;
		this.subtitle = subtitle;
		this.items = items; // [{ label, detail, action }]
		this.hover = - 1;
		this.dirty = true;
		this.draw();

	}

	show( v ) {

		this.mesh.visible = v;

	}

	draw() {

		const c = this.canvas, ctx = c.getContext( '2d' );
		const W = c.width;
		const n = this.items.length;
		const top = this.subtitle ? 162 : 124, gap = 18, foot = 72;
		const bh = Math.min( 88, ( c.height - top - foot - 40 - gap * ( n - 1 ) ) / Math.max( 1, n ) );
		const H = Math.round( top + n * ( bh + gap ) - gap + 28 + foot + 16 );
		this._layout( H );
		ctx.clearRect( 0, 0, W, c.height );
		drawCard( ctx, W, H );
		ctx.textBaseline = 'alphabetic';
		inkText( ctx, this.title, 44, 92, 62, { maxW: W - 120 } );
		ctx.fillStyle = C.muted;
		if ( this.subtitle ) fitText( ctx, this.subtitle, 48, 134, W - 120, 26, 600, false );

		this.rects = [];
		this.items.forEach( ( it, i ) => {

			const y = top + i * ( bh + gap );
			const r = { x: 44, y, w: W - 120, h: bh };
			this.rects.push( r );
			const hov = i === this.hover;
			drawPlate( ctx, r.x, r.y, r.w, r.h, { selected: hov, focus: hov, scale: 1.6 } );
			ctx.fillStyle = C.ink;
			ctx.textBaseline = 'middle';
			ctx.textAlign = 'left';
			const label = ( hov ? '▶ ' : '' ) + it.label.replace( /^▸\s*/, '' ).toUpperCase();
			fitText( ctx, label, r.x + 34, r.y + r.h / 2 + 2, r.w * 0.6, bh * 0.44, 800 );
			let right = r.x + r.w - 30 - r.h * SKEW;
			if ( i === 0 ) {

				// the A button picks the top option: show it on the plate
				const kh = r.h * 0.56;
				ctx.font = font( kh * 0.58, 900 );
				const kw = ctx.measureText( 'A' ).width + kh * 0.9;
				drawKey( ctx, 'A', right - kw, r.y + ( r.h - kh ) / 2, kh, { fill: C.yellow } );
				right -= kw + 18;

			}
			if ( it.detail ) {

				ctx.textAlign = 'right';
				ctx.fillStyle = hov ? C.ink : '#4a4458';
				ctx.font = font( bh * 0.3, 700 );
				ctx.fillText( it.detail.toUpperCase(), right, r.y + r.h / 2 + 2 );

			}

		} );

		// controller legend in key-cap chips
		const ly = H - foot - 8, kh = 34;
		let x = 48;
		ctx.textBaseline = 'middle';
		const say = ( t ) => {

			ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = font( 22, 700 );
			ctx.fillText( t, x, ly + kh / 2 + 1 ); x += ctx.measureText( t ).width + 14;

		};
		x += drawKey( ctx, 'TRIGGER', x, ly, kh ) + 12; say( 'select' );
		x += drawKey( ctx, 'A', x, ly, kh, { fill: C.yellow } ) + 12; say( 'top option' );
		ctx.fillStyle = C.muted; ctx.font = font( 20, 600 );
		ctx.fillText( '· look at a controller for its buttons', x, ly + kh / 2 + 1 );
		this.tex.needsUpdate = true;
		this.dirty = false;

	}

	// Crop the texture to the painted rows and size the plane to match.
	_layout( H ) {

		if ( H === this.usedH ) return;
		this.usedH = H;
		const r = H / this.canvas.height;
		this.tex.repeat.set( 1, r );
		this.tex.offset.set( 0, 1 - r ); // flipY: canvas top is v = 1
		this.mesh.geometry.dispose();
		this.mesh.geometry = new THREE.PlaneGeometry( this.width, this.width * r );

	}

	// Returns the hovered item index for a controller's target-ray space.
	pick( rayObj, out = null ) {

		if ( ! this.mesh.visible ) return - 1;
		_m.identity().extractRotation( rayObj.matrixWorld );
		_ray.ray.origin.setFromMatrixPosition( rayObj.matrixWorld );
		_ray.ray.direction.set( 0, 0, - 1 ).applyMatrix4( _m );
		const hit = _ray.intersectObject( this.mesh, false )[ 0 ];
		if ( ! hit || ! hit.uv ) return - 1;
		if ( out ) out.copy( hit.point );
		const x = hit.uv.x * this.canvas.width, y = ( 1 - hit.uv.y ) * this.usedH;
		return this.rects.findIndex( ( r ) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h );

	}

	updateHover( rays ) {

		let h = - 1, hitAny = false;
		for ( const r of rays ) {

			const i = this.pick( r, _hit );
			if ( i >= 0 ) h = i;
			if ( _hitValid( r, this.mesh ) ) {

				hitAny = true;
				this.cursor.position.copy( this.mesh.worldToLocal( _hit.clone() ) ).setZ( 0.003 );

			}

		}

		this.cursor.visible = hitAny;

		if ( h !== this.hover ) {

			this.hover = h;
			this.draw();

		}

	}

	select( rayObj ) {

		const i = this.pick( rayObj );
		if ( i >= 0 ) this.items[ i ].action?.();
		return i >= 0;

	}

}
