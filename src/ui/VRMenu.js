import * as THREE from 'three/webgpu';
import { emissiveMaterial } from '../render/toon.js';

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

// fillText that shrinks the font until the line fits maxW
const fitText = ( ctx, text, x, y, maxW, size, weight ) => {

	do ctx.font = `${weight} ${size}px Arial`; while ( ctx.measureText( text ).width > maxW && -- size > 12 );
	ctx.fillText( text, x, y );

};

// World-anchored canvas menu for VR, operated with controller laser
// pointers (trigger = select). Large targets, high contrast, one column.
export class VRMenu {

	constructor( { width = 1.1, height = 0.7 } = {} ) {

		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 1024; this.canvas.height = Math.round( 1024 * height / width );
		this.tex = new THREE.CanvasTexture( this.canvas );
		this.tex.colorSpace = THREE.NoColorSpace;
		// Opaque panel (alpha-tested corners) drawn after the cabin with an
		// always-passing depth test, so the dashboard or a pillar can never hide
		// it. It still writes depth (a disabled depth test would not), so glass,
		// mist and petals stay behind it, and the gloves (VR_HAND_ORDER, drawn
		// later) correctly cover it when a hand is in front.
		const mat = new THREE.MeshBasicNodeMaterial( { map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide } );
		mat.depthFunc = THREE.AlwaysDepth;
		mat.fog = false;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( width, height ), mat );
		this.mesh.renderOrder = VR_PANEL_ORDER;
		this.mesh.visible = false;
		// pointer cursor: where the laser meets the panel
		this.cursor = new THREE.Mesh( new THREE.RingGeometry( 0.008, 0.016, 20 ), emissiveMaterial( 0xff8fc0, 1.6, { side: THREE.DoubleSide, depthWrite: false } ) );
		this.cursor.material.fog = false;
		this.cursor.position.z = 0.003;
		this.cursor.renderOrder = VR_PANEL_ORDER + 0.5; // after the panel, before the hands
		this.cursor.visible = false;
		this.mesh.add( this.cursor );
		this.height = height;
		this.title = '';
		this.subtitle = '';
		this.items = [];
		this.hover = - 1;
		this.rects = [];
		this.dirty = true;

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
		const W = c.width, H = c.height;
		ctx.clearRect( 0, 0, W, H );
		ctx.fillStyle = '#100a1e';
		ctx.beginPath(); ctx.roundRect( 0, 0, W, H, 40 ); ctx.fill();
		ctx.strokeStyle = '#ff8fc0'; ctx.lineWidth = 4; ctx.stroke();
		ctx.fillStyle = '#ffffff';
		ctx.font = '900 56px Arial';
		ctx.textAlign = 'left'; ctx.textBaseline = 'top';
		ctx.fillText( this.title, 48, 36 );
		if ( this.subtitle ) {

			ctx.fillStyle = '#c9b8ff';
			fitText( ctx, this.subtitle, 50, 104, W - 100, 28, '500' );

		}

		const top = this.subtitle ? 156 : 124;
		const n = this.items.length;
		const gap = 14;
		const foot = 64; // controller legend
		const bh = Math.min( 92, ( H - top - foot - 20 - gap * ( n - 1 ) ) / Math.max( 1, n ) );
		ctx.font = '700 26px Arial';
		ctx.fillStyle = '#ffd166';
		ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
		fitText( ctx, '◉ Point + TRIGGER to select · A = top option · look at a controller for its buttons', 50, H - foot / 2 - 6, W - 100, 26, '700' );
		this.rects = [];
		this.items.forEach( ( it, i ) => {

			const y = top + i * ( bh + gap );
			const r = { x: 48, y, w: W - 96, h: bh };
			this.rects.push( r );
			const hov = i === this.hover;
			ctx.fillStyle = hov ? '#ff8fc0' : 'rgba(255,255,255,0.08)';
			ctx.beginPath(); ctx.roundRect( r.x, r.y, r.w, r.h, 22 ); ctx.fill();
			ctx.fillStyle = hov ? '#1a0f24' : '#ffffff';
			ctx.font = `800 ${Math.round( bh * 0.4 )}px Arial`;
			ctx.textBaseline = 'middle';
			ctx.fillText( it.label, r.x + 30, r.y + r.h / 2 );
			if ( it.detail ) {

				ctx.textAlign = 'right';
				ctx.font = `500 ${Math.round( bh * 0.3 )}px Arial`;
				ctx.fillStyle = hov ? '#3a1d44' : '#bfb2e8';
				ctx.fillText( it.detail, r.x + r.w - 30, r.y + r.h / 2 );
				ctx.textAlign = 'left';

			}

		} );
		this.tex.needsUpdate = true;
		this.dirty = false;

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
		const x = hit.uv.x * this.canvas.width, y = ( 1 - hit.uv.y ) * this.canvas.height;
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
