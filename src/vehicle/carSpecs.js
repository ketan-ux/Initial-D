// Car definitions: body loft keyframes (metres from the front bumper),
// running gear, engine/gearbox data and liveries. Both cars are JDM
// right-hand drive with pop-up headlights and rear-wheel drive.
//
// Loft keyframe: [ f, w0 (rocker half-width), w1 (shoulder half-width),
//   w2 (roof/hood edge half-width), yb (bottom), ybelt (beltline),
//   yEdge (top edge height), yCenter (top centre height) ]

export const CARS = {
	ae86: {
		id: 'ae86',
		name: 'Sprinter Trueno GT-APEX',
		code: 'AE86',
		years: '1983–1987',
		blurb: 'Feather-light hatchback with a screaming 4A-GE twin-cam. Brakes late, carries speed through hairpins.',
		length: 4.18,
		width: 1.625,
		wheelbase: 2.40,
		frontAxleF: 0.88,
		track: 1.36,
		wheelRadius: 0.29,
		tireWidth: 0.19,
		rimColor: 0x8b8f9c,
		rimStyle: 'mesh8',
		loft: [
			[ 0.00, 0.66, 0.70, 0.56, 0.30, 0.50, 0.58, 0.60 ],
			[ 0.07, 0.75, 0.78, 0.66, 0.24, 0.60, 0.66, 0.68 ],
			[ 0.30, 0.79, 0.80, 0.70, 0.22, 0.67, 0.73, 0.75 ],
			[ 0.90, 0.80, 0.81, 0.71, 0.22, 0.71, 0.78, 0.80 ],
			[ 1.50, 0.80, 0.81, 0.71, 0.22, 0.74, 0.82, 0.84 ],
			[ 1.62, 0.80, 0.81, 0.70, 0.22, 0.75, 0.86, 0.88 ],
			[ 2.22, 0.80, 0.81, 0.60, 0.22, 0.78, 1.26, 1.30 ],
			[ 2.70, 0.80, 0.81, 0.60, 0.22, 0.79, 1.27, 1.31 ],
			[ 3.12, 0.80, 0.81, 0.60, 0.22, 0.80, 1.24, 1.28 ],
			[ 3.92, 0.79, 0.80, 0.64, 0.24, 0.82, 0.96, 0.98 ],
			[ 4.10, 0.76, 0.78, 0.66, 0.28, 0.80, 0.92, 0.93 ],
			[ 4.18, 0.70, 0.72, 0.60, 0.32, 0.76, 0.86, 0.87 ]
		],
		glass: { windshield: [ 1.64, 2.2 ], side: [ 1.66, 3.15 ], rear: [ 3.14, 3.9 ], pillars: [ [ 1.62, 1.78 ], [ 2.55, 2.66 ], [ 3.08, 3.2 ] ] },
		popup: { f: 0.22, x: 0.5, w: 0.36, d: 0.3 },
		tail: { style: 'bar', y: 0.72, h: 0.12 },
		spoiler: 'lip',
		mass: 960,
		cgHeight: 0.48,
		weightFront: 0.53,
		inertiaScale: 1.0,
		engine: {
			type: 'inline4', cylinders: 4, idle: 950, redline: 8200, limiter: 8400,
			torque: [ [ 1000, 105 ], [ 3000, 128 ], [ 4800, 150 ], [ 6000, 160 ], [ 7200, 154 ], [ 8400, 128 ] ],
			inertia: 0.16, sound: { base: 1.0, rasp: 0.85, lope: 0.0 }
		},
		gears: [ 3.587, 2.022, 1.384, 1.0, 0.861 ],
		reverse: 3.484,
		finalDrive: 4.3,
		grip: 1.06,
		steerLock: 0.62,
		brakeForce: 9800,
		dragCoef: 0.36,
		liveries: [
			{ name: 'Panda Two-Tone', desc: 'White over black, tofu-shop door script', draw: 'panda' },
			{ name: 'Sakura Night', desc: 'Plum with drifting blossom', draw: 'sakuraNight' },
			{ name: 'Kanjō Black', desc: 'Gloss black, gold 峠 kanji', draw: 'kanjo' }
		]
	},
	fd3s: {
		id: 'fd3s',
		name: 'RX-7 Type R',
		code: 'FD3S',
		years: '1991–2002',
		blurb: 'Twin-turbo 13B-REW rotary. Monster power on the straights — tame it in the hairpins.',
		length: 4.285,
		width: 1.76,
		wheelbase: 2.425,
		frontAxleF: 0.83,
		track: 1.46,
		wheelRadius: 0.315,
		tireWidth: 0.225,
		rimColor: 0xc9ccd6,
		rimStyle: 'spoke5',
		loft: [
			[ 0.00, 0.60, 0.64, 0.50, 0.27, 0.42, 0.46, 0.47 ],
			[ 0.20, 0.80, 0.84, 0.76, 0.21, 0.54, 0.60, 0.58 ],
			[ 0.80, 0.86, 0.89, 0.80, 0.21, 0.60, 0.69, 0.62 ],
			[ 1.30, 0.84, 0.86, 0.76, 0.21, 0.65, 0.71, 0.67 ],
			[ 1.58, 0.83, 0.85, 0.72, 0.21, 0.68, 0.74, 0.72 ],
			[ 2.20, 0.83, 0.85, 0.56, 0.21, 0.72, 1.14, 1.20 ],
			[ 2.75, 0.84, 0.86, 0.57, 0.21, 0.73, 1.12, 1.18 ],
			[ 3.20, 0.86, 0.89, 0.62, 0.21, 0.74, 1.02, 1.06 ],
			[ 3.60, 0.87, 0.90, 0.72, 0.22, 0.76, 0.90, 0.92 ],
			[ 4.05, 0.84, 0.87, 0.74, 0.25, 0.77, 0.86, 0.87 ],
			[ 4.285, 0.76, 0.79, 0.66, 0.31, 0.73, 0.80, 0.81 ]
		],
		glass: { windshield: [ 1.6, 2.18 ], side: [ 1.62, 3.0 ], rear: [ 2.9, 3.62 ], pillars: [ [ 1.58, 1.74 ], [ 2.9, 3.05 ] ] },
		popup: { f: 0.26, x: 0.56, w: 0.34, d: 0.28 },
		tail: { style: 'round3', y: 0.7, h: 0.12 },
		spoiler: 'wing',
		mass: 1280,
		cgHeight: 0.44,
		weightFront: 0.50,
		inertiaScale: 1.05,
		engine: {
			type: 'rotary', cylinders: 4, idle: 900, redline: 8000, limiter: 8200,
			torque: [ [ 1000, 150 ], [ 3000, 230 ], [ 4500, 294 ], [ 5500, 300 ], [ 6500, 285 ], [ 8200, 220 ] ],
			inertia: 0.12, sound: { base: 1.0, rasp: 0.55, lope: 0.35 }
		},
		gears: [ 3.483, 2.015, 1.391, 1.0, 0.719 ],
		reverse: 3.288,
		finalDrive: 4.1,
		grip: 1.1,
		steerLock: 0.58,
		brakeForce: 13800,
		dragCoef: 0.31,
		liveries: [
			{ name: 'Competition Yellow', desc: 'Yellow mica, 疾風 team script', draw: 'yellowMica' },
			{ name: 'Shiro Raiden', desc: 'White with blue lightning, 雷電', draw: 'raiden' },
			{ name: 'Midnight Gekkō', desc: 'Midnight purple, gold 月光 moon', draw: 'gekko' }
		]
	}
};

export const CAR_IDS = Object.keys( CARS );

export function torqueAt( engine, rpm ) {

	const t = engine.torque;
	if ( rpm <= t[ 0 ][ 0 ] ) return t[ 0 ][ 1 ];
	for ( let i = 0; i < t.length - 1; i ++ ) {

		if ( rpm <= t[ i + 1 ][ 0 ] ) {

			const k = ( rpm - t[ i ][ 0 ] ) / ( t[ i + 1 ][ 0 ] - t[ i ][ 0 ] );
			return t[ i ][ 1 ] + ( t[ i + 1 ][ 1 ] - t[ i ][ 1 ] ) * k;

		}

	}

	return t[ t.length - 1 ][ 1 ];

}
