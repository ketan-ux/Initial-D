import * as THREE from 'three/webgpu';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { toonMaterial, emissiveMaterial } from '../render/toon.js';
import { clamp, damp, KMH, MPH } from '../core/math.js';
import { settings } from '../core/settings.js';

// Right-hand-drive cabin. Everything is in chassis space (+z fwd, +x left).
// The driver sits on the RIGHT (negative x); shifter, handbrake and cup
// holder are to the driver's left, exactly where a JDM driver reaches.

const INTERIOR = 0x2a2633, INTERIOR_DARK = 0x18151f, TRIM = 0x3b3646;

export class Cockpit {

	constructor( carModel, quality ) {

		this.model = carModel;
		this.spec = carModel.spec;
		this.quality = quality;
		this.group = new THREE.Group();
		this.group.name = 'cockpit';
		carModel.chassis.add( this.group );
		const spec = this.spec;
		// driver's eye ~0.5 m behind the top of the windshield (roughly level
		// with the B-pillar), which leaves room for dash, cluster and wheel
		const fEye = spec.glass.windshield[ 1 ] + 0.5;
		this.eyePos = new THREE.Vector3( - 0.36, spec.id === 'fd3s' ? 0.98 : 1.05, carModel.zOf( fEye ) );
		this.eye = new THREE.Object3D();
		this.eye.position.copy( this.eyePos );
		this.group.add( this.eye );
		this.wheelAngle = 0; // radians of steering-wheel rotation (+ = left)
		this.handbrakePull = 0;
		this.shifterOffset = new THREE.Vector2();
		this.cup = { tx: 0, tz: 0, vx: 0, vz: 0 };
		this.gaugeRpm = 0; this.gaugeSpeed = 0;
		this.hazard = false;
		this._build();

	}

	_build() {

		const spec = this.spec, m = this.model, e = this.eyePos;
		const b = new GeoBuilder( { color: true } );
		const box = ( w, h, d ) => new THREE.BoxGeometry( w, h, d );
		const M = ( x, y, z, rx = 0, ry = 0, rz = 0 ) => new THREE.Matrix4().compose(
			new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz, 'YXZ' ) ), new THREE.Vector3( 1, 1, 1 ) );
		const sec = ( f ) => m.sections.reduce( ( a, s ) => ( Math.abs( s.f - f ) < Math.abs( a.f - f ) ? s : a ), m.sections[ 0 ] );
		const wsF = spec.glass.windshield[ 0 ], roofF = spec.glass.windshield[ 1 ];
		const sW = sec( wsF ), sR = sec( roofF );
		const halfW = sW.w1 - 0.06;
		const dashZ = m.zOf( wsF + 0.05 );
		const dashTopY = sW.ybelt + 0.06;
		const roofY = sR.yCenter - 0.04;

		// dashboard: top slab + face + glovebox side
		b.setColor( INTERIOR );
		b.addGeometry( box( halfW * 2, 0.06, 0.5 ), M( 0, dashTopY, dashZ - 0.2, 0.08 ) );
		b.setColor( INTERIOR_DARK );
		b.addGeometry( box( halfW * 2, 0.32, 0.08 ), M( 0, dashTopY - 0.17, dashZ - 0.44 ) );
		// gauge binnacle hood over the cluster (in front of the driver)
		b.setColor( INTERIOR );
		b.addGeometry( box( 0.46, 0.035, 0.2 ), M( e.x, dashTopY + 0.2, dashZ - 0.33, 0.12 ) );
		b.addGeometry( box( 0.44, 0.22, 0.03 ), M( e.x, dashTopY + 0.08, dashZ - 0.31, - 0.3 ) );
		// centre console + tunnel
		b.setColor( INTERIOR_DARK );
		b.addGeometry( box( 0.24, 0.3, 0.55 ), M( 0.02, dashTopY - 0.32, dashZ - 0.7 ) );
		b.addGeometry( box( 0.22, 0.16, 0.85 ), M( 0.02, 0.42, e.z + 0.05 ) );
		// A-pillars
		b.setColor( TRIM );
		for ( const s of [ 1, - 1 ] ) {

			const x0 = s * ( sW.w2 - 0.03 ), x1 = s * ( sR.w2 - 0.05 );
			const y0 = dashTopY, y1 = roofY;
			const z0 = dashZ, z1 = m.zOf( roofF );
			const mid = new THREE.Vector3( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
			const len = Math.hypot( x1 - x0, y1 - y0, z1 - z0 );
			const dir = new THREE.Vector3( x1 - x0, y1 - y0, z1 - z0 ).normalize();
			const q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir );
			b.addGeometry( box( 0.07, len, 0.06 ), new THREE.Matrix4().compose( mid, q, new THREE.Vector3( 1, 1, 1 ) ) );

		}

		// roof liner, header rail, B-pillars, rear shelf
		const roofLen = spec.glass.side[ 1 ] - roofF + 0.2;
		b.setColor( 0x3a3546 );
		b.addGeometry( box( sR.w2 * 2, 0.02, roofLen ), M( 0, roofY, m.zOf( roofF + roofLen / 2 - 0.1 ) ) );
		b.setColor( TRIM );
		b.addGeometry( box( sR.w2 * 2, 0.05, 0.06 ), M( 0, roofY - 0.02, m.zOf( roofF ) ) );
		if ( spec.glass.pillars[ 1 ] ) {

			const fB = ( spec.glass.pillars[ 1 ][ 0 ] + spec.glass.pillars[ 1 ][ 1 ] ) / 2;
			const sB = sec( fB );
			for ( const s of [ 1, - 1 ] ) b.addGeometry( box( 0.06, roofY - sB.ybelt, 0.1 ), M( s * ( sB.w2 + 0.02 ), ( roofY + sB.ybelt ) / 2, m.zOf( fB ), 0, 0, s * 0.12 ) );

		}

		// door cards (inner panels) with armrest
		for ( const s of [ 1, - 1 ] ) {

			b.setColor( INTERIOR );
			const f0 = wsF + 0.05, f1 = spec.glass.side[ 1 ] - 0.1;
			b.addGeometry( box( 0.04, 0.42, f1 - f0 ), M( s * ( halfW + 0.02 ), sW.ybelt - 0.2, m.zOf( ( f0 + f1 ) / 2 ) ) );
			b.setColor( INTERIOR_DARK );
			b.addGeometry( box( 0.08, 0.05, 0.5 ), M( s * ( halfW - 0.02 ), sW.ybelt - 0.12, e.z + 0.05 ) );

		}

		// seats: bucket seat for driver, passenger seat, rear bench hint
		for ( const x of [ e.x, - e.x ] ) {

			b.setColor( x === e.x ? 0x24202c : 0x2b2733 );
			b.addGeometry( box( 0.48, 0.1, 0.5 ), M( x, 0.38, e.z + 0.05 ) );
			b.addGeometry( box( 0.48, 0.7, 0.1 ), M( x, 0.75, e.z - 0.28, - 0.18 ) );
			b.setColor( 0xb03048 ); // racing seat bolsters
			for ( const s of [ 1, - 1 ] ) b.addGeometry( box( 0.06, 0.55, 0.12 ), M( x + s * 0.22, 0.76, e.z - 0.25, - 0.18 ) );

		}

		b.setColor( INTERIOR_DARK );
		b.addGeometry( box( halfW * 2, 0.06, 0.7 ), M( 0, sec( spec.glass.side[ 1 ] ).ybelt - 0.02, m.zOf( spec.glass.side[ 1 ] + 0.25 ) ) );
		// floor
		b.setColor( 0x141219 );
		b.addGeometry( box( halfW * 2, 0.02, 1.8 ), M( 0, 0.28, e.z + 0.3 ) );
		// steering column shroud
		b.setColor( INTERIOR_DARK );
		const colTilt = - 0.42;
		this.wheelCenter = new THREE.Vector3( e.x, e.y - 0.3, e.z + 0.42 );
		b.addGeometry( box( 0.1, 0.1, 0.3 ), M( e.x, this.wheelCenter.y - 0.06, this.wheelCenter.z + 0.16, colTilt ) );

		// dashboard switches (VR-pressable): pop-up headlights, hazard, HUD
		this.buttons = {};
		const btnDefs = [
			[ 'headlights', e.x - 0.27, 0xffc66b ],
			[ 'hazard', 0.05, 0xff3b4a ],
			[ 'hud', e.x + 0.26, 0x6be0ff ]
		];
		this.interiorMat = toonMaterial( { vertexColors: true, rim: 0.12 } );
		const interior = new THREE.Mesh( b.build(), this.interiorMat );
		interior.name = 'interior';
		this.group.add( interior );

		for ( const [ name, x, col ] of btnDefs ) {

			const g = new THREE.Group();
			g.position.set( x, dashTopY - 0.06, dashZ - 0.49 );
			const cap = new THREE.Mesh( new THREE.BoxGeometry( 0.045, 0.03, 0.025 ), emissiveMaterial( col, 1.4 ) );
			g.add( cap );
			g.userData.cap = cap;
			g.userData.pressed = 0;
			this.group.add( g );
			this.buttons[ name ] = g;

		}

		this._buildGauges( dashTopY, dashZ );
		this._buildWheel( colTilt );
		this._buildShifter( dashTopY, dashZ );
		this._buildHandbrake();
		this._buildCup( dashTopY, dashZ );
		this._buildPhone( dashTopY, dashZ, roofY );
		this._buildMirrors( sW, roofY, dashZ );
		this.dashTopY = dashTopY;
		this.dashZ = dashZ;
		this.roofY = roofY;

	}

	_buildGauges( dashTopY, dashZ ) {

		const e = this.eyePos;
		this.gaugeCanvas = document.createElement( 'canvas' );
		this.gaugeCanvas.width = 512; this.gaugeCanvas.height = 256;
		this.gaugeTex = new THREE.CanvasTexture( this.gaugeCanvas );
		this.gaugeTex.colorSpace = THREE.NoColorSpace;
		this.drawGaugeFace();
		const face = new THREE.Mesh( new THREE.PlaneGeometry( 0.38, 0.19 ), emissiveMaterial( 0xffffff, 1.0 ) );
		face.material.map = this.gaugeTex;
		// sits on the dash under the binnacle hood, tilted back toward the eye,
		// visible just above the steering wheel rim
		face.position.set( e.x, dashTopY + 0.085, dashZ - 0.335 );
		face.rotation.set( 0.3, Math.PI, 0 );
		this.group.add( face );
		this.gaugeFace = face;
		// needles live in the face's local space; face is rotated PI so local +x is car right
		const needleGeo = new THREE.BoxGeometry( 0.004, 0.06, 0.002 );
		needleGeo.translate( 0, 0.026, 0.002 );
		const needleMat = emissiveMaterial( 0xff4a2a, 2.2 );
		this.tachNeedle = new THREE.Mesh( needleGeo, needleMat );
		this.tachNeedle.position.set( - 0.07 * - 1, 0, 0.003 );
		const sGeo = needleGeo.clone();
		this.speedNeedle = new THREE.Mesh( sGeo, needleMat );
		// tach on the left of the face image, speedo on the right (face mirrored by PI)
		this.tachNeedle.position.set( - 0.085, 0.0, 0.003 );
		this.speedNeedle.position.set( 0.095, 0.0, 0.003 );
		face.add( this.tachNeedle, this.speedNeedle );

	}

	// Orange-backlit analog cluster drawn once (and on unit changes).
	drawGaugeFace() {

		const c = this.gaugeCanvas, ctx = c.getContext( '2d' );
		const spec = this.spec;
		const units = settings.units;
		this.units = units;
		ctx.fillStyle = '#07050a';
		ctx.fillRect( 0, 0, 512, 256 );
		const dial = ( cx, cy, r, max, step, label, red ) => {

			const g = ctx.createRadialGradient( cx, cy, r * 0.2, cx, cy, r );
			g.addColorStop( 0, '#1a0f08' ); g.addColorStop( 1, '#0b0705' );
			ctx.fillStyle = g;
			ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
			ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 4; ctx.stroke();
			const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
			if ( red ) {

				ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 10;
				ctx.beginPath(); ctx.arc( cx, cy, r * 0.86, a0 + ( a1 - a0 ) * red, a1 ); ctx.stroke();

			}

			ctx.fillStyle = '#ffae3a'; ctx.strokeStyle = '#ffae3a';
			ctx.font = `700 ${r * 0.17}px "Arial Narrow", Arial, sans-serif`;
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			for ( let v = 0; v <= max; v += step ) {

				const a = a0 + ( a1 - a0 ) * ( v / max );
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo( cx + Math.cos( a ) * r * 0.78, cy + Math.sin( a ) * r * 0.78 );
				ctx.lineTo( cx + Math.cos( a ) * r * 0.92, cy + Math.sin( a ) * r * 0.92 );
				ctx.stroke();
				ctx.fillText( label( v ), cx + Math.cos( a ) * r * 0.62, cy + Math.sin( a ) * r * 0.62 );

			}

		};

		const maxRpm = Math.ceil( spec.engine.limiter / 1000 ) + 1;
		dial( 150, 128, 116, maxRpm, 1, ( v ) => String( v ), spec.engine.redline / 1000 / maxRpm );
		ctx.font = '600 14px Arial'; ctx.fillStyle = '#ff8a2a';
		ctx.fillText( 'x1000 r/min', 150, 190 );
		const maxSpd = units === 'mph' ? 140 : 220;
		dial( 380, 128, 100, maxSpd, units === 'mph' ? 20 : 20, ( v ) => ( v % 40 === 0 || units === 'mph' ? String( v ) : '' ), 0 );
		ctx.fillText( units === 'mph' ? 'MPH' : 'km/h', 380, 185 );
		this.maxRpmDial = maxRpm * 1000;
		this.maxSpdDial = maxSpd;
		this.gaugeTex.needsUpdate = true;

	}

	_buildWheel( tilt ) {

		const r = 0.185;
		const wheel = new THREE.Group();
		wheel.position.copy( this.wheelCenter );
		wheel.rotation.set( tilt, 0, 0, 'YXZ' ); // column tilt; spin happens on the inner group
		const spin = new THREE.Group();
		wheel.add( spin );
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0x1b1820 );
		b.addGeometry( new THREE.TorusGeometry( r, 0.017, 8, 32 ), null );
		b.setColor( 0x2d2833 );
		for ( const a of [ 0, Math.PI * 0.8, - Math.PI * 0.8 ] ) {

			const sp = new THREE.BoxGeometry( 0.025, r * 0.95, 0.012 );
			sp.translate( 0, - r * 0.47, 0 );
			b.addGeometry( sp, new THREE.Matrix4().makeRotationZ( a + Math.PI ) );

		}

		b.setColor( 0xcfc8b0 ); // top-dead-centre marker stripe
		b.addGeometry( new THREE.BoxGeometry( 0.02, 0.03, 0.036 ), new THREE.Matrix4().makeTranslation( 0, r, 0 ) );
		b.setColor( 0x3a3342 );
		b.addGeometry( new THREE.CylinderGeometry( 0.05, 0.055, 0.04, 16 ).rotateX( Math.PI / 2 ), null );
		// stylised gloves at 9 and 3 (hidden in VR, where real hands take over)
		const gloves = new GeoBuilder( { color: true } );
		gloves.setColor( 0x2c2a36 );
		for ( const s of [ 1, - 1 ] ) {

			gloves.addGeometry( new THREE.SphereGeometry( 0.035, 8, 6 ), new THREE.Matrix4().makeTranslation( s * r, 0.0, - 0.01 ).multiply( new THREE.Matrix4().makeScale( 1, 1.25, 0.9 ) ) );
			gloves.setColor( 0xe9e2f0 );
			gloves.addGeometry( new THREE.BoxGeometry( 0.06, 0.03, 0.05 ), new THREE.Matrix4().makeTranslation( s * ( r + 0.02 ), - 0.04, - 0.05 ) );
			gloves.setColor( 0x2c2a36 );

		}

		const mat = toonMaterial( { vertexColors: true, rim: 0.3 } );
		spin.add( new THREE.Mesh( b.build(), mat ) );
		this.gloves = new THREE.Mesh( gloves.build(), mat );
		spin.add( this.gloves );
		this.group.add( wheel );
		this.wheel = wheel;
		this.wheelSpin = spin;
		this.wheelRadius = r;

	}

	_buildShifter( dashTopY, dashZ ) {

		const e = this.eyePos;
		const g = new THREE.Group();
		g.position.set( e.x + 0.38, 0.52, e.z + 0.32 ); // to the driver's left (toward +x)
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0x141219 );
		b.addGeometry( new THREE.ConeGeometry( 0.06, 0.1, 8 ), new THREE.Matrix4().makeTranslation( 0, 0.03, 0 ) ); // boot
		b.setColor( 0x56505e );
		b.addGeometry( new THREE.CylinderGeometry( 0.008, 0.008, 0.16, 6 ), new THREE.Matrix4().makeTranslation( 0, 0.1, 0 ) );
		b.setColor( 0xe8e4f0 );
		b.addGeometry( new THREE.SphereGeometry( 0.028, 12, 10 ), new THREE.Matrix4().makeTranslation( 0, 0.19, 0 ) ); // knob
		const lever = new THREE.Mesh( b.build(), toonMaterial( { vertexColors: true, rim: 0.4 } ) );
		g.add( lever );
		this.group.add( g );
		this.shifter = g;
		this.shifterLever = lever;
		this.shifterKnobLocal = new THREE.Vector3( 0, 0.19, 0 );

	}

	_buildHandbrake() {

		const e = this.eyePos;
		const g = new THREE.Group();
		g.position.set( e.x + 0.38, 0.5, e.z - 0.05 );
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0x2a2531 );
		b.addGeometry( new THREE.BoxGeometry( 0.035, 0.03, 0.3 ), new THREE.Matrix4().makeTranslation( 0, 0, 0.15 ) );
		b.setColor( 0x111015 );
		b.addGeometry( new THREE.CylinderGeometry( 0.019, 0.019, 0.12, 8 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0, 0.27 ) );
		b.setColor( 0xd0cad8 );
		b.addGeometry( new THREE.CylinderGeometry( 0.008, 0.008, 0.02, 8 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0, 0.34 ) );
		const lever = new THREE.Mesh( b.build(), toonMaterial( { vertexColors: true, rim: 0.3 } ) );
		g.add( lever );
		this.group.add( g );
		this.handbrake = g;
		this.handbrakeGripLocal = new THREE.Vector3( 0, 0, 0.27 );

	}

	_buildCup( dashTopY, dashZ ) {

		const e = this.eyePos;
		const g = new THREE.Group();
		g.position.set( e.x + 0.4, 0.62, e.z + 0.58 );
		const cupMat = new THREE.MeshBasicNodeMaterial( { color: 0xeae6f5, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false } );
		const cup = new THREE.Mesh( new THREE.CylinderGeometry( 0.038, 0.03, 0.11, 16, 1, true ), cupMat );
		cup.position.y = 0.055;
		cup.renderOrder = 5;
		const water = new THREE.Mesh( new THREE.CircleGeometry( 0.035, 20 ).rotateX( - Math.PI / 2 ), emissiveMaterial( 0x7fd6ff, 0.75, { transparent: true, opacity: 0.85 } ) );
		water.position.y = 0.075;
		water.renderOrder = 4;
		const holder = new THREE.Mesh( new THREE.CylinderGeometry( 0.05, 0.05, 0.03, 16 ), toonMaterial( { color: 0x15131a, rim: 0 } ) );
		g.add( holder, water, cup );
		this.group.add( g );
		this.water = water;

	}

	_buildPhone( dashTopY, dashZ, roofY ) {

		const e = this.eyePos;
		const g = new THREE.Group();
		g.position.set( e.x + 0.2, dashTopY + 0.12, dashZ - 0.1 );
		g.rotation.set( - 0.2, Math.PI - 0.32, 0, 'YXZ' );
		const body = new THREE.Mesh( new THREE.BoxGeometry( 0.165, 0.085, 0.012 ), toonMaterial( { color: 0x101014, rim: 0.4 } ) );
		const arm = new THREE.Mesh( new THREE.CylinderGeometry( 0.006, 0.006, 0.09, 6 ), toonMaterial( { color: 0x2a2a30, rim: 0 } ) );
		arm.position.set( 0, - 0.06, - 0.02 );
		arm.rotation.x = 0.6;
		this.phoneCanvas = document.createElement( 'canvas' );
		this.phoneCanvas.width = 320; this.phoneCanvas.height = 160;
		this.phoneTex = new THREE.CanvasTexture( this.phoneCanvas );
		this.phoneTex.colorSpace = THREE.NoColorSpace;
		const screenMat = emissiveMaterial( 0xffffff, 1.0 );
		screenMat.map = this.phoneTex;
		const screen = new THREE.Mesh( new THREE.PlaneGeometry( 0.152, 0.076 ), screenMat );
		screen.position.z = 0.0065;
		g.add( body, arm, screen );
		this.group.add( g );
		this.phone = g;
		this.phoneScreen = screen;

	}

	// Rear-view + both door mirrors share ONE wide rear camera / render target.
	_buildMirrors( sW, roofY, dashZ ) {

		const q = this.quality;
		this.mirrorCam = new THREE.PerspectiveCamera( 32, 3.2, 0.5, 120 ); // short far plane = fewer chunks drawn
		this.mirrorCam.position.set( 0, roofY + 0.05, this.model.zOf( this.spec.length - 0.2 ) );
		// cameras look down local -z, which is the car's rear: no rotation needed
		// only layer 0: particles on LAYER_NO_MIRROR (5) are skipped in mirrors
		this.model.chassis.add( this.mirrorCam );
		const size = q.mirrors ? q.mirrorSize : 0;
		const uvRemap = ( geo, u0, u1 ) => {

			const uv = geo.attributes.uv;
			for ( let i = 0; i < uv.count; i ++ ) uv.setX( i, u1 + ( u0 - u1 ) * uv.getX( i ) ); // mirrored horizontally
			return geo;

		};

		let mat;
		if ( size > 0 ) {

			this.mirrorRT = new THREE.RenderTarget( size, Math.round( size / 3.2 ), { depthBuffer: true } );
			this.mirrorRT.texture.colorSpace = THREE.NoColorSpace;
			mat = new THREE.MeshBasicNodeMaterial( { map: this.mirrorRT.texture } );

		} else {

			// Low preset: stylised static mirror (dark sky gradient) — no extra render pass
			mat = new THREE.MeshBasicNodeMaterial( { color: 0x463a6e } );

		}

		mat.fog = false;
		const frameMat = toonMaterial( { color: 0x15131a, rim: 0.2 } );
		const e = this.eyePos;
		const mk = ( w, h, u0, u1, pos, rotY, rotX = 0 ) => {

			const g = new THREE.Group();
			g.position.copy( pos );
			g.rotation.set( rotX, Math.PI + rotY, 0, 'YXZ' ); // face the driver (-z)
			const frame = new THREE.Mesh( new THREE.BoxGeometry( w + 0.02, h + 0.02, 0.02 ), frameMat );
			frame.position.z = - 0.012;
			const glassM = new THREE.Mesh( uvRemap( new THREE.PlaneGeometry( w, h ), u0, u1 ), mat );
			g.add( frame, glassM );
			this.group.add( g );
			return g;

		};

		// rear-view (centre of windshield header), angled toward the driver
		this.rearMirror = mk( 0.25, 0.065, 0.32, 0.68, new THREE.Vector3( 0, roofY - 0.06, dashZ - 0.32 ), - 0.12, 0.05 );
		const fm = this.spec.glass.side[ 0 ] + 0.12;
		const sm = this.model.sections.reduce( ( a, s ) => ( Math.abs( s.f - fm ) < Math.abs( a.f - fm ) ? s : a ), this.model.sections[ 0 ] );
		this.leftMirror = mk( 0.13, 0.085, 0.72, 1.0, new THREE.Vector3( sm.w1 + 0.1, sm.ybelt + 0.1, this.model.zOf( fm ) - 0.02 ), - 0.55 );
		this.rightMirror = mk( 0.13, 0.085, 0.0, 0.28, new THREE.Vector3( - sm.w1 - 0.1, sm.ybelt + 0.1, this.model.zOf( fm ) - 0.02 ), 0.3 );
		void e;
		this._mirrorFrame = 0;

	}

	// Render the shared mirror target (throttled per preset).
	renderMirrors( renderer, scene ) {

		if ( ! this.mirrorRT || ! this.group.visible ) return;
		const rate = this.quality.mirrorRate || 1;
		if ( ( this._mirrorFrame ++ ) % rate !== 0 ) return;
		// Binding a non-output render target makes the renderer use the mirror
		// camera as a plain mono view, also while an XR session is presenting.
		const prev = renderer.getRenderTarget();
		this.mirrorCam.updateMatrixWorld();
		renderer.setRenderTarget( this.mirrorRT );
		renderer.render( scene, this.mirrorCam );
		renderer.setRenderTarget( prev );

	}

	setVR( on ) {

		this.gloves.visible = ! on;

	}

	// Per-frame cabin animation from telemetry.
	update( dt, tel, physics ) {

		// gauges: needles with mechanical lag
		this.gaugeRpm = damp( this.gaugeRpm, tel.rpm, 14, dt );
		const spd = tel.speed * ( settings.units === 'mph' ? MPH : KMH );
		this.gaugeSpeed = damp( this.gaugeSpeed, spd, 8, dt );
		if ( settings.units !== this.units ) this.drawGaugeFace();
		const sweep = Math.PI * 1.5;
		// needle angle: 0 at 7:30 position, sweeping clockwise
		this.tachNeedle.rotation.z = ( Math.PI * 0.75 ) - sweep * clamp( this.gaugeRpm / this.maxRpmDial, 0, 1 );
		this.speedNeedle.rotation.z = ( Math.PI * 0.75 ) - sweep * clamp( this.gaugeSpeed / this.maxSpdDial, 0, 1 );

		// steering wheel follows the rack (or the VR hands drive the rack)
		// +wheelAngle = counter-clockwise as seen by the driver (looking down +z)
		this.wheelSpin.rotation.z = - this.wheelAngle;

		// handbrake lever & shifter
		this.handbrake.rotation.x = - this.handbrakePull * 0.5;
		this.shifterLever.rotation.set( this.shifterOffset.y * 0.35, 0, - this.shifterOffset.x * 0.3 );

		// water in the cup: spring-damped tilt driven by the car's accelerations
		if ( physics ) {

			const c = this.cup;
			const tx = Math.atan2( physics.axS, 9.81 ) * 1.4, tz = Math.atan2( - physics.ayS, 9.81 ) * 1.4;
			c.vx += ( ( tx - c.tx ) * 55 - c.vx * 2.6 ) * dt;
			c.vz += ( ( tz - c.tz ) * 55 - c.vz * 2.6 ) * dt;
			c.tx += c.vx * dt; c.tz += c.vz * dt;
			this.water.rotation.set( clamp( c.tx, - 0.6, 0.6 ), 0, clamp( c.tz, - 0.6, 0.6 ) );

		}

		// dash buttons spring back
		for ( const bt of Object.values( this.buttons ) ) {

			bt.userData.pressed = Math.max( 0, bt.userData.pressed - dt * 6 );
			bt.userData.cap.position.z = bt.userData.pressed * 0.008;

		}

		if ( this.hazard ) {

			const on = ( performance.now() % 800 ) < 400;
			this.model.uniforms.marker.value = on ? 2.5 : 0.2;

		}

	}

	pressButton( name ) {

		const bt = this.buttons[ name ];
		if ( bt ) bt.userData.pressed = 1;

	}

}
