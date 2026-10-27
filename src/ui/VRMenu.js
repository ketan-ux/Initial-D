import * as THREE from 'three/webgpu';
import { emissiveMaterial } from '../render/toon.js';

const _ray = new THREE.Raycaster();
const _m = new THREE.Matrix4();

// World-anchored canvas menu for VR, operated with controller laser
// pointers (trigger = select). Large targets, high contrast, one column.
export class VRMenu {

	constructor( { width = 1.1, height = 0.7 } = {} ) {

		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = 1024; this.canvas.height = Math.round( 1024 * height / width );
		this.tex = new THREE.CanvasTexture( this.canvas );
		this.tex.colorSpace = THREE.NoColorSpace;
		const mat = emissiveMaterial( 0xffffff, 1.0, { transparent: true, side: THREE.DoubleSide } );
		mat.map = this.tex;
		this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( width, height ), mat );
		this.mesh.renderOrder = 40;
		this.mesh.visible = false;
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
		ctx.fillStyle = 'rgba(16,10,30,0.92)';
		ctx.beginPath(); ctx.roundRect( 0, 0, W, H, 40 ); ctx.fill();
		ctx.strokeStyle = '#ff8fc0'; ctx.lineWidth = 4; ctx.stroke();
		ctx.fillStyle = '#ffffff';
		ctx.font = '900 56px Arial';
		ctx.textAlign = 'left'; ctx.textBaseline = 'top';
		ctx.fillText( this.title, 48, 36 );
		if ( this.subtitle ) {

			ctx.font = '500 28px Arial';
			ctx.fillStyle = '#c9b8ff';
			ctx.fillText( this.subtitle, 50, 104 );

		}

		const top = this.subtitle ? 156 : 124;
		const n = this.items.length;
		const gap = 14;
		const bh = Math.min( 92, ( H - top - 36 - gap * ( n - 1 ) ) / Math.max( 1, n ) );
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
	pick( rayObj ) {

		if ( ! this.mesh.visible ) return - 1;
		_m.identity().extractRotation( rayObj.matrixWorld );
		_ray.ray.origin.setFromMatrixPosition( rayObj.matrixWorld );
		_ray.ray.direction.set( 0, 0, - 1 ).applyMatrix4( _m );
		const hit = _ray.intersectObject( this.mesh, false )[ 0 ];
		if ( ! hit || ! hit.uv ) return - 1;
		const x = hit.uv.x * this.canvas.width, y = ( 1 - hit.uv.y ) * this.canvas.height;
		return this.rects.findIndex( ( r ) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h );

	}

	updateHover( rays ) {

		let h = - 1;
		for ( const r of rays ) {

			const i = this.pick( r );
			if ( i >= 0 ) h = i;

		}

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
