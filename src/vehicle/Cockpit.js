import * as THREE from 'three/webgpu';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { toonMaterial, emissiveMaterial, addOutline } from '../render/toon.js';
import { clamp, damp, KMH, MPH } from '../core/math.js';
import { settings } from '../core/settings.js';

// Right-hand-drive cabin. Everything is in chassis space (+z fwd, +x left;
// `f` = metres back from the front bumper, so larger f is closer to the
// driver). The driver sits low on the RIGHT (negative x); shifter, handbrake,
// cup holder and phone are to the driver's left, where a JDM driver reaches.
//
// Layout is derived from the driver's eye so the frame reads like the
// reference shot: windshield header near the top of the screen, a low dash,
// an orange-lit cluster in a binnacle just above the wheel rim, centre vents
// with the cup holder under them, the phone GPS on a dash mount, the door
// card and mirror on the right, gloved hands on a three-spoke wheel.

const INTERIOR = 0x3a3843, INTERIOR_DARK = 0x22202a, TRIM = 0x4c4957, EDGE = 0x5d5a68, VENT = 0x121117;

export class Cockpit {

	constructor( carModel, quality ) {

		this.model = carModel;
		this.spec = carModel.spec;
		this.quality = quality;
		this.group = new THREE.Group();
		this.group.name = 'cockpit';
		carModel.chassis.add( this.group );
		const spec = this.spec;
		const sec = ( f ) => carModel.sections.reduce( ( a, s ) => ( Math.abs( s.f - f ) < Math.abs( a.f - f ) ? s : a ), carModel.sections[ 0 ] );
		// low bucket-seat eye: ~0.42 m behind the windshield header, ~0.28 m
		// under the roof skin
		this.fEye = spec.glass.windshield[ 1 ] + 0.42;
		const eyeY = Math.max( 0.92, sec( spec.glass.windshield[ 1 ] ).yCenter - 0.25 );
		this.eyePos = new THREE.Vector3( - 0.36, eyeY, carModel.zOf( this.fEye ) );
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
		const b = new GeoBuilder( { color: true } ); // opaque cabin, one draw call
		const em = new GeoBuilder( { color: true } ); // small self-lit details
		const box = ( w, h, d ) => new THREE.BoxGeometry( w, h, d );
		const M = ( x, y, z, rx = 0, ry = 0, rz = 0 ) => new THREE.Matrix4().compose(
			new THREE.Vector3( x, y, z ), new THREE.Quaternion().setFromEuler( new THREE.Euler( rx, ry, rz, 'YXZ' ) ), new THREE.Vector3( 1, 1, 1 ) );
		const Z = ( f ) => m.zOf( f );
		const add = ( B, color, geo, mat ) => {

			if ( Array.isArray( color ) ) B.setColor( ...color ); else B.setColor( color );
			B.addGeometry( geo, mat );

		};

		const sec = ( f ) => m.sections.reduce( ( a, s ) => ( Math.abs( s.f - f ) < Math.abs( a.f - f ) ? s : a ), m.sections[ 0 ] );
		const wsF = spec.glass.windshield[ 0 ], roofF = spec.glass.windshield[ 1 ];
		const sW = sec( wsF ), sR = sec( roofF );
		const halfW = sW.w1 - 0.07;
		const cowlY = sW.yEdge - 0.02; // where the glass meets the dash
		const roofY = sR.yCenter - 0.05;
		const dashF0 = wsF + 0.02, dashF1 = wsF + 0.38; // dash top surface, front -> rear edge
		const faceY0 = cowlY - 0.025, faceY1 = cowlY - 0.38; // dash face, top -> bottom
		const stackX = 0.04; // centre stack, a touch toward the driver

		// ---- dashboard ---------------------------------------------------------
		const topLen = dashF1 - dashF0;
		add( b, INTERIOR, box( halfW * 2, 0.04, topLen ), M( 0, ( cowlY + faceY0 ) / 2, Z( ( dashF0 + dashF1 ) / 2 ), - Math.atan2( cowlY - faceY0, topLen ) ) );
		add( b, EDGE, box( halfW * 2, 0.03, 0.04 ), M( 0, faceY0, Z( dashF1 ) ) ); // rolled rear lip catches the light
		add( b, INTERIOR_DARK, box( halfW * 2, faceY0 - faceY1, 0.06 ), M( 0, ( faceY0 + faceY1 ) / 2, Z( dashF1 + 0.02 ) ) );
		// lower knee bolster + passenger glovebox
		add( b, INTERIOR, box( 0.62, 0.16, 0.12 ), M( e.x, faceY1 + 0.02, Z( dashF1 + 0.1 ), - 0.3 ) );
		add( b, INTERIOR, box( 0.5, 0.17, 0.05 ), M( 0.5, faceY1 + 0.14, Z( dashF1 + 0.05 ) ) );
		add( b, EDGE, box( 0.1, 0.02, 0.02 ), M( 0.5, faceY1 + 0.2, Z( dashF1 + 0.08 ) ) );

		// gauge binnacle in front of the driver: visor hood + side cheeks
		// low, rounded hood: it barely clears the dash line, so the road ahead
		// stays open and the dials are read through the top of the wheel
		// The cluster sits proud of the dash face, framed by the top half of the
		// wheel (~25° below the eye line); its hood stays below the far dash line
		const binF = dashF1 + 0.05;
		const faceY = e.y - ( this.fEye - binF ) * 0.47;
		const binTop = faceY + 0.085;
		const hood = new THREE.CylinderGeometry( 0.21, 0.21, 0.16, 20, 1, true, Math.PI / 2, Math.PI ).rotateX( Math.PI / 2 ).scale( 1, 0.42, 1 );
		add( b, INTERIOR, hood, M( e.x, binTop - 0.088, Z( binF + 0.06 ) ) );
		add( b, EDGE, new THREE.TorusGeometry( 0.21, 0.007, 4, 20, Math.PI ).scale( 1, 0.42, 1 ), M( e.x, binTop - 0.088, Z( binF + 0.14 ) ) ); // stitched rim
		add( b, INTERIOR_DARK, box( 0.44, faceY - faceY1 + 0.07, 0.07 ), M( e.x, ( faceY + 0.07 + faceY1 ) / 2, Z( binF - 0.015 ) ) ); // pod body down to the knee panel

		// round eyeball vent at the driver's right, rectangular vents on the passenger side
		const ventPanel = ( x, y, w, h ) => {

			add( b, INTERIOR_DARK, box( w + 0.03, h + 0.03, 0.03 ), M( x, y, Z( dashF1 + 0.04 ) ) );
			add( b, VENT, box( w, h, 0.02 ), M( x, y, Z( dashF1 + 0.055 ) ) );
			for ( let k = 1; k < 4; k ++ ) add( b, TRIM, box( w - 0.01, 0.006, 0.02 ), M( x, y - h / 2 + k * h / 4, Z( dashF1 + 0.06 ), 0.4 ) );

		};

		add( b, INTERIOR_DARK, new THREE.CylinderGeometry( 0.05, 0.05, 0.03, 16 ).rotateX( Math.PI / 2 ), M( - halfW + 0.1, faceY0 - 0.08, Z( dashF1 + 0.04 ) ) );
		add( b, VENT, new THREE.CylinderGeometry( 0.038, 0.038, 0.02, 16 ).rotateX( Math.PI / 2 ), M( - halfW + 0.1, faceY0 - 0.08, Z( dashF1 + 0.055 ) ) );
		add( b, TRIM, box( 0.07, 0.008, 0.01 ), M( - halfW + 0.1, faceY0 - 0.08, Z( dashF1 + 0.068 ) ) );
		ventPanel( 0.42, faceY0 - 0.08, 0.14, 0.055 );
		ventPanel( halfW - 0.12, faceY0 - 0.08, 0.1, 0.055 );

		// ---- centre stack: twin vents, cassette deck, climate panel, console --
		const stackF = dashF1 + 0.05;
		add( b, INTERIOR, box( 0.34, cowlY - 0.38 - 0.06, 0.08 ), M( stackX, ( cowlY - 0.06 + 0.38 ) / 2, Z( stackF ) ) );
		for ( const s of [ - 1, 1 ] ) {

			const vx = stackX + s * 0.08;
			add( b, INTERIOR_DARK, box( 0.15, 0.075, 0.03 ), M( vx, faceY0 - 0.05, Z( stackF + 0.045 ) ) );
			add( b, VENT, box( 0.13, 0.058, 0.02 ), M( vx, faceY0 - 0.05, Z( stackF + 0.055 ) ) );
			for ( let k = 1; k < 4; k ++ ) add( b, EDGE, box( 0.125, 0.006, 0.022 ), M( vx, faceY0 - 0.08 + k * 0.0145, Z( stackF + 0.06 ), 0.35 ) );

		}

		const deckY = faceY0 - 0.27; // cassette deck sits behind the clip-on cup holder
		add( b, VENT, box( 0.24, 0.055, 0.02 ), M( stackX, deckY, Z( stackF + 0.05 ) ) );
		add( em, [ 1.9, 1.0, 0.3 ], box( 0.08, 0.016, 0.01 ), M( stackX + 0.05, deckY + 0.008, Z( stackF + 0.062 ) ) ); // tuner display
		for ( const s of [ - 1, 1 ] ) add( b, EDGE, new THREE.CylinderGeometry( 0.011, 0.011, 0.02, 10 ).rotateX( Math.PI / 2 ), M( stackX + s * 0.095, deckY, Z( stackF + 0.065 ) ) );
		const climY = deckY - 0.075;
		add( b, INTERIOR_DARK, box( 0.24, 0.05, 0.02 ), M( stackX, climY, Z( stackF + 0.05 ) ) );
		for ( let k = 0; k < 3; k ++ ) add( b, TRIM, new THREE.CylinderGeometry( 0.013, 0.013, 0.025, 10 ).rotateX( Math.PI / 2 ), M( stackX - 0.07 + k * 0.07, climY, Z( stackF + 0.065 ) ) );
		for ( let k = 0; k < 4; k ++ ) add( em, [ 1.6, 0.6, 0.15 ], box( 0.014, 0.006, 0.006 ), M( stackX - 0.09 + k * 0.06, climY + 0.02, Z( stackF + 0.062 ) ) );
		// console + transmission tunnel back between the seats
		add( b, INTERIOR_DARK, box( 0.26, 0.22, this.fEye - stackF + 0.1 ), M( stackX, 0.42, Z( ( stackF + this.fEye + 0.1 ) / 2 ) ) );
		add( b, INTERIOR, box( 0.2, 0.03, 0.4 ), M( stackX, 0.54, Z( this.fEye - 0.05 ) ) );

		// ---- pillars, header, visors, roof ------------------------------------
		const pillar = ( x0, y0, z0, x1, y1, z1, w, d, color ) => {

			const mid = new THREE.Vector3( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
			const len = Math.hypot( x1 - x0, y1 - y0, z1 - z0 );
			const q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( x1 - x0, y1 - y0, z1 - z0 ).normalize() );
			add( b, color, box( w, len, d ), new THREE.Matrix4().compose( mid, q, new THREE.Vector3( 1, 1, 1 ) ) );

		};

		for ( const s of [ 1, - 1 ] ) {

			pillar( s * ( sW.w2 - 0.04 ), cowlY, Z( wsF ), s * ( sR.w2 - 0.06 ), roofY, Z( roofF ), 0.1, 0.07, TRIM );
			pillar( s * ( sW.w2 - 0.08 ), cowlY, Z( wsF + 0.04 ), s * ( sR.w2 - 0.1 ), roofY - 0.02, Z( roofF + 0.04 ), 0.035, 0.035, EDGE );

		}

		const roofLen = spec.glass.side[ 1 ] - roofF + 0.2;
		add( b, 0x45424f, box( sR.w2 * 2, 0.02, roofLen ), M( 0, roofY, Z( roofF + roofLen / 2 - 0.1 ) ) );
		add( b, TRIM, box( sR.w2 * 2, 0.07, 0.07 ), M( 0, roofY - 0.025, Z( roofF + 0.02 ) ) ); // header rail
		for ( const s of [ 1, - 1 ] ) {

			add( b, 0x55525f, box( 0.34, 0.014, 0.15 ), M( s * 0.36, roofY - 0.035, Z( roofF + 0.13 ), 0.12 ) ); // sun visors (stowed)
			add( b, INTERIOR_DARK, box( 0.03, 0.03, 0.03 ), M( s * 0.2, roofY - 0.03, Z( roofF + 0.06 ) ) );

		}

		if ( spec.glass.pillars[ 1 ] ) {

			const fB = ( spec.glass.pillars[ 1 ][ 0 ] + spec.glass.pillars[ 1 ][ 1 ] ) / 2;
			const sB = sec( fB );
			for ( const s of [ 1, - 1 ] ) add( b, TRIM, box( 0.07, roofY - sB.ybelt, 0.12 ), M( s * ( sB.w2 + 0.02 ), ( roofY + sB.ybelt ) / 2, Z( fB ), 0, 0, s * 0.12 ) );

		}

		// ---- door cards ----------------------------------------------------------
		for ( const s of [ 1, - 1 ] ) {

			const f0 = wsF + 0.12, f1 = spec.glass.side[ 1 ] - 0.1;
			const x = s * ( halfW + 0.03 );
			const belt = sW.ybelt;
			add( b, INTERIOR, box( 0.04, belt - 0.3, f1 - f0 ), M( x, ( belt + 0.3 ) / 2, Z( ( f0 + f1 ) / 2 ) ) );
			add( b, EDGE, box( 0.07, 0.03, f1 - f0 ), M( x - s * 0.01, belt + 0.005, Z( ( f0 + f1 ) / 2 ) ) ); // window sill
			add( b, INTERIOR_DARK, box( 0.09, 0.05, 0.42 ), M( x - s * 0.045, belt - 0.13, Z( this.fEye - 0.12 ) ) ); // armrest
			add( b, INTERIOR_DARK, box( 0.03, 0.2, 0.55 ), M( x - s * 0.02, 0.42, Z( this.fEye - 0.35 ) ) ); // map pocket
			add( b, 0x1a1920, new THREE.CylinderGeometry( 0.06, 0.06, 0.02, 14 ).rotateZ( Math.PI / 2 ), M( x - s * 0.025, 0.47, Z( wsF + 0.35 ) ) ); // speaker
			add( b, 0xc8c9d2, box( 0.02, 0.03, 0.09 ), M( x - s * 0.03, belt - 0.06, Z( this.fEye - 0.42 ) ) ); // door pull
			add( b, EDGE, new THREE.CylinderGeometry( 0.012, 0.012, 0.06, 8 ).rotateZ( Math.PI / 2 ), M( x - s * 0.05, belt - 0.2, Z( this.fEye - 0.02 ) ) ); // window crank

		}

		// ---- seats, rear shelf, floor ----------------------------------------
		for ( const x of [ e.x, - e.x ] ) {

			add( b, x === e.x ? 0x26232d : 0x2d2a35, box( 0.48, 0.1, 0.5 ), M( x, 0.36, e.z + 0.05 ) );
			add( b, x === e.x ? 0x26232d : 0x2d2a35, box( 0.48, 0.7, 0.1 ), M( x, 0.72, e.z - 0.3, - 0.18 ) );
			for ( const s of [ 1, - 1 ] ) add( b, 0xb03048, box( 0.06, 0.55, 0.12 ), M( x + s * 0.22, 0.74, e.z - 0.27, - 0.18 ) );

		}

		add( b, INTERIOR_DARK, box( halfW * 2, 0.06, 0.7 ), M( 0, sec( spec.glass.side[ 1 ] ).ybelt - 0.02, Z( spec.glass.side[ 1 ] + 0.25 ) ) );
		add( b, 0x141219, box( halfW * 2, 0.02, 1.9 ), M( 0, 0.26, e.z + 0.35 ) );

		// ---- steering column ---------------------------------------------------
		const colTilt = - 0.38;
		this.wheelCenter = new THREE.Vector3( e.x, e.y - 0.33, Z( this.fEye - 0.5 ) );
		add( b, INTERIOR_DARK, box( 0.12, 0.11, 0.34 ), M( e.x, this.wheelCenter.y - 0.05, this.wheelCenter.z + 0.2, colTilt ) );
		add( b, TRIM, box( 0.05, 0.012, 0.1 ), M( e.x + 0.09, this.wheelCenter.y - 0.02, this.wheelCenter.z + 0.12, colTilt ) ); // indicator stalk
		add( b, TRIM, box( 0.05, 0.012, 0.1 ), M( e.x - 0.09, this.wheelCenter.y - 0.02, this.wheelCenter.z + 0.12, colTilt ) ); // wiper stalk

		// ---- phone mount (body + arm are static, the screen is its own mesh) --
		const phonePos = new THREE.Vector3( 0.15, cowlY + 0.075, Z( wsF + 0.31 ) );
		const phoneRot = new THREE.Euler( - 0.12, Math.PI - 0.42, 0, 'YXZ' );
		const phoneM = new THREE.Matrix4().compose( phonePos, new THREE.Quaternion().setFromEuler( phoneRot ), new THREE.Vector3( 1, 1, 1 ) );
		this.phoneHalf = { x: 0.04, y: 0.078 };
		add( b, 0x101014, box( 0.088, 0.168, 0.012 ), phoneM );
		add( b, 0x24232b, new THREE.CylinderGeometry( 0.007, 0.007, 0.11, 6 ), phoneM.clone().multiply( M( 0, - 0.11, 0.03, 0.5 ) ) );
		add( b, 0x24232b, new THREE.CylinderGeometry( 0.03, 0.035, 0.012, 12 ), M( phonePos.x, cowlY - 0.005, phonePos.z + 0.07 ) ); // suction foot
		add( b, 0x24232b, box( 0.1, 0.02, 0.02 ), phoneM.clone().multiply( M( 0, - 0.088, 0.008 ) ) ); // cradle lip

		// ---- clip-on cup holder hanging from the centre vent ------------------
		const cupPos = new THREE.Vector3( stackX + 0.07, faceY0 - 0.205, Z( stackF + 0.1 ) );
		add( b, INTERIOR_DARK, box( 0.03, 0.12, 0.012 ), M( cupPos.x, faceY0 - 0.12, Z( stackF + 0.065 ) ) ); // hook into the vent
		add( b, INTERIOR_DARK, new THREE.CylinderGeometry( 0.05, 0.05, 0.03, 18, 1, true ), M( cupPos.x, cupPos.y + 0.012, cupPos.z ) );
		add( b, INTERIOR_DARK, box( 0.05, 0.02, 0.09 ), M( cupPos.x, cupPos.y + 0.012, cupPos.z - 0.06 ) );
		add( b, INTERIOR_DARK, new THREE.CylinderGeometry( 0.045, 0.045, 0.01, 18 ), M( cupPos.x, cupPos.y - 0.02, cupPos.z ) );

		// ---- interior mesh ------------------------------------------------------
		this.interiorMat = toonMaterial( { vertexColors: true, rim: 0.18, emissive: 0x0e0d13 } );
		const interior = new THREE.Mesh( b.build(), this.interiorMat );
		interior.name = 'interior';
		this.group.add( interior );
		addOutline( interior, 0.0035 );
		const emMat = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
		emMat.fog = false;
		this.group.add( new THREE.Mesh( em.build(), emMat ) );

		// dashboard switches (VR-pressable): pop-up headlights, hazard, HUD
		this.buttons = {};
		const btnDefs = [
			[ 'headlights', e.x - 0.3, faceY0 - 0.17, 0xffc66b ],
			[ 'hazard', stackX, faceY0 - 0.105, 0xff3b4a ],
			[ 'hud', e.x + 0.3, faceY0 - 0.17, 0x6be0ff ]
		];
		for ( const [ name, x, y, col ] of btnDefs ) {

			const g = new THREE.Group();
			g.position.set( x, y, Z( dashF1 + ( name === 'hazard' ? 0.11 : 0.05 ) ) );
			const cap = new THREE.Mesh( new THREE.BoxGeometry( name === 'hazard' ? 0.03 : 0.04, 0.022, 0.02 ), emissiveMaterial( col, 1.3 ) );
			g.add( cap );
			g.userData.cap = cap;
			g.userData.pressed = 0;
			this.group.add( g );
			this.buttons[ name ] = g;

		}

		this._buildGauges( binTop, binF );
		this._buildWheel( colTilt );
		this._buildShifter();
		this._buildHandbrake();
		this._buildCup( cupPos );
		this._buildPhone( phonePos, phoneRot );
		this._buildMirrors( roofY, roofF );
		this.dashTopY = cowlY;
		this.dashZ = Z( wsF );
		this.roofY = roofY;

	}

	_buildGauges( binTop, binF ) {

		const e = this.eyePos;
		this.gaugeCanvas = document.createElement( 'canvas' );
		this.gaugeCanvas.width = 512; this.gaugeCanvas.height = 200;
		this.gaugeTex = new THREE.CanvasTexture( this.gaugeCanvas );
		this.gaugeTex.colorSpace = THREE.NoColorSpace;
		this.drawGaugeFace();
		const W = 0.34, H = W * 200 / 512;
		const face = new THREE.Mesh( new THREE.PlaneGeometry( W, H ), emissiveMaterial( 0xffffff, 1.0 ) );
		face.material.map = this.gaugeTex;
		// recessed under the binnacle visor, tilted back toward the eye
		face.position.set( e.x, binTop - 0.085, this.model.zOf( binF + 0.025 ) );
		face.rotation.set( 0.3, Math.PI, 0, 'YXZ' );
		this.group.add( face );
		this.gaugeFace = face;
		// needles in face space (face rotated PI: local +x = driver's right = image right)
		const needleGeo = new THREE.BoxGeometry( 0.0045, 0.07, 0.002 );
		needleGeo.translate( 0, 0.03, 0.002 );
		const needleMat = emissiveMaterial( 0xff4a2a, 2.4 );
		this.tachNeedle = new THREE.Mesh( needleGeo, needleMat );
		this.tachNeedle.position.set( 0, - H * 0.02, 0.003 );
		this.speedNeedle = new THREE.Mesh( needleGeo.clone().scale( 0.82, 0.82, 1 ), needleMat );
		this.speedNeedle.position.set( ( 405 / 512 - 0.5 ) * W, - H * 0.02, 0.003 );
		face.add( this.tachNeedle, this.speedNeedle );

	}

	// Orange-backlit analog cluster: small temp/fuel dial, big centre tach,
	// speedo on the right, warning lamps along the bottom.
	drawGaugeFace() {

		const c = this.gaugeCanvas, ctx = c.getContext( '2d' );
		const spec = this.spec;
		const units = settings.units;
		this.units = units;
		ctx.fillStyle = '#060408';
		ctx.fillRect( 0, 0, 512, 200 );
		const dial = ( cx, cy, r, max, step, label, red, small ) => {

			const g = ctx.createRadialGradient( cx, cy, r * 0.1, cx, cy, r );
			g.addColorStop( 0, '#2a1608' ); g.addColorStop( 1, '#0c0705' );
			ctx.fillStyle = g;
			ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
			ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 3; ctx.stroke();
			const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
			if ( red ) {

				ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = r * 0.08;
				ctx.beginPath(); ctx.arc( cx, cy, r * 0.86, a0 + ( a1 - a0 ) * red, a1 ); ctx.stroke();

			}

			ctx.shadowColor = '#ff8a1a'; ctx.shadowBlur = 8;
			ctx.fillStyle = '#ffb04a'; ctx.strokeStyle = '#ffb04a';
			ctx.font = `700 ${r * ( small ? 0.26 : 0.19 )}px "Arial Narrow", Arial, sans-serif`;
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			for ( let v = 0; v <= max; v += step ) {

				const a = a0 + ( a1 - a0 ) * ( v / max );
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo( cx + Math.cos( a ) * r * 0.76, cy + Math.sin( a ) * r * 0.76 );
				ctx.lineTo( cx + Math.cos( a ) * r * 0.92, cy + Math.sin( a ) * r * 0.92 );
				ctx.stroke();
				const t = label( v );
				if ( t ) ctx.fillText( t, cx + Math.cos( a ) * r * 0.58, cy + Math.sin( a ) * r * 0.58 );

			}

			ctx.shadowBlur = 0;

		};

		const maxRpm = Math.ceil( spec.engine.limiter / 1000 ) + 1;
		dial( 256, 98, 92, maxRpm, 1, ( v ) => String( v ), spec.engine.redline / 1000 / maxRpm );
		ctx.font = '600 13px Arial'; ctx.fillStyle = '#ff8a2a';
		ctx.fillText( 'x1000 r/min', 256, 150 );
		const maxSpd = units === 'mph' ? 140 : 220;
		dial( 405, 98, 76, maxSpd, 20, ( v ) => ( v % 40 === 0 || units === 'mph' ? String( v ) : '' ), 0 );
		ctx.fillStyle = '#ff8a2a';
		ctx.fillText( units === 'mph' ? 'MPH' : 'km/h', 405, 140 );
		// temp + fuel, static-ish needles painted in
		dial( 105, 70, 46, 4, 1, ( v ) => ( [ 'C', '', '', '', 'H' ][ v ] ), 0.8, true );
		dial( 105, 152, 40, 4, 1, ( v ) => ( [ 'E', '', '½', '', 'F' ][ v ] ), 0, true );
		ctx.strokeStyle = '#ff4a2a'; ctx.lineWidth = 3;
		ctx.beginPath(); ctx.moveTo( 105, 70 ); ctx.lineTo( 105 + Math.cos( - 1.9 ) * 34, 70 + Math.sin( - 1.9 ) * 34 ); ctx.stroke();
		ctx.beginPath(); ctx.moveTo( 105, 152 ); ctx.lineTo( 105 + Math.cos( - 0.7 ) * 30, 152 + Math.sin( - 0.7 ) * 30 ); ctx.stroke();
		// warning lamps (dim)
		const lamps = [ '#3a1a10', '#3a2a08', '#0e2a14', '#3a1010', '#10203a' ];
		lamps.forEach( ( col, i ) => {

			ctx.fillStyle = col; ctx.fillRect( 186 + i * 30, 176, 20, 10 );

		} );
		this.maxRpmDial = maxRpm * 1000;
		this.maxSpdDial = maxSpd;
		this.gaugeTex.needsUpdate = true;

	}

	_buildWheel( tilt ) {

		const r = 0.19;
		const wheel = new THREE.Group();
		wheel.position.copy( this.wheelCenter );
		wheel.rotation.set( tilt, 0, 0, 'YXZ' ); // column tilt; spin happens on the inner group
		const spin = new THREE.Group();
		wheel.add( spin );
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0x18161d );
		b.addGeometry( new THREE.TorusGeometry( r, 0.021, 10, 40 ), null ); // thick leather rim
		b.setColor( 0x6c6876 );
		// three brushed spokes: left, right, bottom
		for ( const a of [ Math.PI / 2 + 0.12, - Math.PI / 2 - 0.12, 0 ] ) {

			const sp = new THREE.BoxGeometry( a === 0 ? 0.05 : 0.038, r * 0.92, 0.01 );
			sp.translate( 0, - r * 0.48, - 0.012 );
			b.addGeometry( sp, new THREE.Matrix4().makeRotationZ( a ) );

		}

		b.setColor( 0x0e0d12 );
		for ( const a of [ Math.PI / 2 + 0.12, - Math.PI / 2 - 0.12 ] ) {

			b.addGeometry( new THREE.CylinderGeometry( 0.009, 0.009, 0.014, 8 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeRotationZ( a ).multiply( new THREE.Matrix4().makeTranslation( 0, - r * 0.55, - 0.011 ) ) );

		}

		b.setColor( 0xd8d0b8 ); // top-dead-centre stripe
		b.addGeometry( new THREE.BoxGeometry( 0.018, 0.034, 0.046 ), new THREE.Matrix4().makeTranslation( 0, r, 0 ) );
		b.setColor( 0x16141a );
		b.addGeometry( new THREE.CylinderGeometry( 0.062, 0.068, 0.045, 20 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0, - 0.02 ) ); // horn pad
		b.setColor( 0xff8a1a );
		b.addGeometry( new THREE.CylinderGeometry( 0.016, 0.016, 0.005, 12 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0, 0.004 ) );

		// gloved hands gripping the rim at roughly 9 and 3 (hidden in VR)
		const gloves = new GeoBuilder( { color: true } );
		this.handAngles = [ Math.PI - 0.42, 0.42 ]; // ~10 and ~2 o'clock: left, right (wheel space)
		for ( const ang of this.handAngles ) {

			const hm = new THREE.Matrix4().makeRotationZ( ang ).multiply( new THREE.Matrix4().makeTranslation( r, 0, 0 ) );
			gloves.setColor( 0x3a3946 );
			// palm wraps over the rim from the driver's side
			gloves.addGeometry( new THREE.SphereGeometry( 0.042, 10, 8 ).scale( 0.85, 1.25, 0.8 ), hm.clone().multiply( new THREE.Matrix4().makeTranslation( 0.012, 0, - 0.03 ) ) );
			// four fingers curled around the front of the rim
			for ( let k = 0; k < 4; k ++ ) {

				const fy = - 0.03 + k * 0.02;
				gloves.addGeometry( new THREE.CapsuleGeometry( 0.0095, 0.03, 3, 6 ).rotateX( Math.PI / 2 ), hm.clone().multiply( new THREE.Matrix4().makeTranslation( - 0.012, fy, 0.012 ) ) );

			}

			gloves.setColor( 0x2a2933 );
			gloves.addGeometry( new THREE.CapsuleGeometry( 0.011, 0.03, 3, 6 ), hm.clone().multiply( new THREE.Matrix4().makeTranslation( - 0.02, 0.045, - 0.015 ) ).multiply( new THREE.Matrix4().makeRotationZ( 0.6 ) ) ); // thumb
			gloves.setColor( 0xa8a6b4 );
			gloves.addGeometry( new THREE.CylinderGeometry( 0.032, 0.034, 0.03, 10 ).rotateX( Math.PI / 2 ), hm.clone().multiply( new THREE.Matrix4().makeTranslation( 0.03, - 0.01, - 0.075 ) ) ); // cuff

		}

		const mat = toonMaterial( { vertexColors: true, rim: 0.35, emissive: 0x0b0a10 } );
		const rimMesh = new THREE.Mesh( b.build(), mat );
		spin.add( rimMesh );
		addOutline( rimMesh, 0.003 );
		this.gloves = new THREE.Mesh( gloves.build(), mat );
		addOutline( this.gloves, 0.003 );
		spin.add( this.gloves );
		this.group.add( wheel );
		this.wheel = wheel;
		this.wheelSpin = spin;
		this.wheelRadius = r;

		// forearms (grey jacket sleeves) from each wrist back to an elbow by the
		// driver's sides; re-aimed every frame as the wheel turns
		const e = this.eyePos;
		const arm = new THREE.CylinderGeometry( 0.03, 0.04, 1, 10, 1, true ).translate( 0, 0.5, 0 );
		const armMat = toonMaterial( { color: 0x6a6878, rim: 0.3, emissive: 0x0a090e } );
		this.arms = [ 1, - 1 ].map( ( s ) => {

			const a = new THREE.Mesh( arm, armMat );
			a.userData.elbow = new THREE.Vector3( e.x + s * 0.3, e.y - 0.5, e.z + 0.06 );
			this.group.add( a );
			return a;

		} );
		this._wrist = new THREE.Vector3();

	}

	_updateArms() {

		if ( ! this.arms[ 0 ].visible ) return;
		this.wheel.updateMatrix();
		this.wheelSpin.updateMatrix();
		const r = this.wheelRadius;
		this.handAngles.forEach( ( ang, i ) => {

			const a = this.arms[ i ];
			const w = this._wrist.set( Math.cos( ang ) * ( r + 0.03 ), Math.sin( ang ) * ( r + 0.03 ) - 0.01, - 0.085 );
			w.applyMatrix4( this.wheelSpin.matrix ).applyMatrix4( this.wheel.matrix );
			const el = a.userData.elbow;
			a.position.copy( w );
			const dir = el.clone().sub( w );
			a.scale.set( 1, dir.length(), 1 );
			a.quaternion.setFromUnitVectors( _up, dir.normalize() );

		} );

	}

	_buildShifter() {

		const e = this.eyePos;
		const g = new THREE.Group();
		g.position.set( e.x + 0.4, 0.53, e.z + 0.34 ); // on the tunnel, to the driver's left
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0x141219 );
		b.addGeometry( new THREE.ConeGeometry( 0.065, 0.11, 10 ), new THREE.Matrix4().makeTranslation( 0, 0.035, 0 ) ); // leather boot
		b.setColor( 0x56505e );
		b.addGeometry( new THREE.CylinderGeometry( 0.008, 0.008, 0.16, 6 ), new THREE.Matrix4().makeTranslation( 0, 0.1, 0 ) );
		b.setColor( 0x1b1a20 );
		b.addGeometry( new THREE.SphereGeometry( 0.03, 12, 10 ), new THREE.Matrix4().makeTranslation( 0, 0.19, 0 ) ); // knob
		b.setColor( 0xe8e4f0 );
		b.addGeometry( new THREE.CylinderGeometry( 0.018, 0.018, 0.004, 10 ), new THREE.Matrix4().makeTranslation( 0, 0.218, 0 ) ); // shift pattern cap
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
		g.position.set( e.x + 0.4, 0.55, e.z - 0.05 );
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

	// Paper cup with a blue band; the water surface sloshes with g-forces.
	_buildCup( pos ) {

		const g = new THREE.Group();
		g.position.copy( pos );
		const b = new GeoBuilder( { color: true } );
		b.setColor( 0xf2f0f6 );
		b.addGeometry( new THREE.CylinderGeometry( 0.041, 0.031, 0.115, 18, 1, true ), new THREE.Matrix4().makeTranslation( 0, 0.057, 0 ) );
		b.setColor( 0x3f86d8 );
		b.addGeometry( new THREE.CylinderGeometry( 0.0395, 0.0365, 0.034, 18, 1, true ).scale( 1.01, 1, 1.01 ), new THREE.Matrix4().makeTranslation( 0, 0.072, 0 ) );
		b.setColor( 0xffffff );
		b.addGeometry( new THREE.TorusGeometry( 0.041, 0.0035, 4, 18 ).rotateX( Math.PI / 2 ), new THREE.Matrix4().makeTranslation( 0, 0.115, 0 ) ); // rolled lip
		b.setColor( 0xb9bccb );
		b.addGeometry( new THREE.CylinderGeometry( 0.0395, 0.0295, 0.113, 18, 1, true ).scale( - 1, 1, 1 ), new THREE.Matrix4().makeTranslation( 0, 0.058, 0 ) ); // inner wall
		const cup = new THREE.Mesh( b.build(), toonMaterial( { vertexColors: true, rim: 0.3, emissive: 0x16151c } ) );
		addOutline( cup, 0.0025 );
		const water = new THREE.Mesh( new THREE.CircleGeometry( 0.038, 22 ).rotateX( - Math.PI / 2 ), emissiveMaterial( 0x55c2ff, 0.95 ) );
		water.position.y = 0.094;
		g.add( cup, water );
		this.group.add( g );
		this.water = water;

	}

	_buildPhone( pos, rot ) {

		const g = new THREE.Group();
		g.position.copy( pos );
		g.rotation.copy( rot );
		this.phoneCanvas = document.createElement( 'canvas' );
		this.phoneCanvas.width = 180; this.phoneCanvas.height = 340;
		this.phoneTex = new THREE.CanvasTexture( this.phoneCanvas );
		this.phoneTex.colorSpace = THREE.NoColorSpace;
		const screenMat = emissiveMaterial( 0xffffff, 1.0 );
		screenMat.map = this.phoneTex;
		const screen = new THREE.Mesh( new THREE.PlaneGeometry( 0.078, 0.156 ), screenMat );
		screen.position.z = 0.0065;
		g.add( screen );
		this.group.add( g );
		this.phone = g;
		this.phoneScreen = screen;

	}

	// Rear-view + both door mirrors share ONE wide rear camera / render target.
	_buildMirrors( roofY, roofF ) {

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
		const frameMat = toonMaterial( { color: 0x1a1820, rim: 0.3 } );
		const mk = ( w, h, u0, u1, pos, rotY, rotX = 0 ) => {

			const g = new THREE.Group();
			g.position.copy( pos );
			g.rotation.set( rotX, Math.PI + rotY, 0, 'YXZ' ); // face the driver (-z)
			const frame = new THREE.Mesh( new THREE.CapsuleGeometry( ( h + 0.016 ) / 2, w - h + 0.004, 4, 12 ).rotateZ( Math.PI / 2 ).scale( 1, 1, 0.22 ), frameMat );
			frame.position.z = - 0.008;
			const glassM = new THREE.Mesh( uvRemap( new THREE.PlaneGeometry( w, h ), u0, u1 ), mat );
			g.add( frame, glassM );
			this.group.add( g );
			return g;

		};

		// rear-view hanging from the header at the car's centreline, angled to the driver
		this.rearMirror = mk( 0.21, 0.058, 0.32, 0.68, new THREE.Vector3( 0, roofY - 0.085, this.model.zOf( roofF + 0.07 ) ), - 0.38, 0.06 );
		const stem = new THREE.Mesh( new THREE.CylinderGeometry( 0.008, 0.008, 0.05, 6 ), frameMat );
		stem.position.set( 0, roofY - 0.04, this.model.zOf( roofF + 0.06 ) );
		this.group.add( stem );
		const fm = this.spec.glass.side[ 0 ] + 0.12;
		const sm = this.model.sections.reduce( ( a, s ) => ( Math.abs( s.f - fm ) < Math.abs( a.f - fm ) ? s : a ), this.model.sections[ 0 ] );
		this.leftMirror = mk( 0.13, 0.085, 0.72, 1.0, new THREE.Vector3( sm.w1 + 0.1, sm.ybelt + 0.1, this.model.zOf( fm ) - 0.02 ), - 0.55 );
		this.rightMirror = mk( 0.14, 0.09, 0.0, 0.28, new THREE.Vector3( - sm.w1 - 0.1, sm.ybelt + 0.1, this.model.zOf( fm ) - 0.02 ), 0.3 );
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
		for ( const a of this.arms ) a.visible = ! on;

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
		this._updateArms();

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

const _up = new THREE.Vector3( 0, 1, 0 );
