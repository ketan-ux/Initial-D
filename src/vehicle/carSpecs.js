// Car definitions: body loft keyframes (metres from the front bumper),
// running gear, engine/gearbox data and liveries. All three are JDM
// right-hand-drive, rear-wheel-drive coupes; the AE86 and FD3S have pop-up
// headlights, the Silvia S13 has fixed projector lamps.
//
// Loft keyframe: [ f, w0 (rocker half-width), w1 (shoulder half-width),
//   w2 (roof/hood edge half-width), yb (bottom), ybelt (beltline),
//   yEdge (top edge height), yCenter (top centre height) ]

export const CARS = {
	ae86: {
		id: 'ae86',
		make: 'Toyota',
		model: 'AE86 Trueno',
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
		ratings: { drift: 0.92, grip: 0.62 },
		mass: 960,
		cgHeight: 0.48,
		weightFront: 0.53,
		inertiaScale: 1.0,
		engine: {
			type: 'inline4', label: '4A-GE 1.6 twin-cam I4', cylinders: 4, idle: 950, redline: 8200, limiter: 8400,
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
		make: 'Mazda',
		model: 'RX-7 FD3S',
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
		ratings: { drift: 0.7, grip: 0.86 },
		mass: 1280,
		cgHeight: 0.44,
		weightFront: 0.50,
		inertiaScale: 1.05,
		engine: {
			type: 'rotary', label: '13B-REW twin-turbo rotary', turbo: true, cylinders: 4, idle: 900, redline: 8000, limiter: 8200,
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
	},
	s13: {
		id: 's13',
		make: 'Nissan',
		model: 'Silvia S13',
		name: 'Silvia K\'s',
		code: 'S13',
		years: '1988–1993',
		blurb: 'Balanced turbo coupe with a long wheelbase. Holds a slide forever and forgives a lazy countersteer.',
		length: 4.47,
		width: 1.69,
		wheelbase: 2.475,
		frontAxleF: 0.92,
		track: 1.465,
		wheelRadius: 0.3,
		tireWidth: 0.205,
		rimColor: 0xd2d5de,
		rimStyle: 'spoke6',
		loft: [
			[ 0.00, 0.62, 0.66, 0.52, 0.28, 0.44, 0.52, 0.53 ],
			[ 0.10, 0.78, 0.81, 0.70, 0.22, 0.56, 0.63, 0.64 ],
			[ 0.40, 0.82, 0.84, 0.74, 0.22, 0.62, 0.69, 0.70 ],
			[ 1.00, 0.83, 0.845, 0.74, 0.22, 0.66, 0.73, 0.75 ],
			[ 1.62, 0.83, 0.845, 0.72, 0.22, 0.70, 0.78, 0.80 ],
			[ 2.30, 0.83, 0.845, 0.58, 0.22, 0.75, 1.20, 1.26 ],
			[ 2.85, 0.83, 0.845, 0.58, 0.22, 0.76, 1.21, 1.27 ],
			[ 3.30, 0.835, 0.85, 0.60, 0.22, 0.77, 1.14, 1.19 ],
			[ 3.82, 0.84, 0.85, 0.68, 0.22, 0.79, 0.90, 0.92 ],
			[ 4.30, 0.82, 0.84, 0.70, 0.24, 0.80, 0.89, 0.90 ],
			[ 4.47, 0.74, 0.77, 0.62, 0.32, 0.76, 0.84, 0.85 ]
		],
		glass: { windshield: [ 1.64, 2.28 ], side: [ 1.66, 3.5 ], rear: [ 3.42, 3.84 ], pillars: [ [ 1.62, 1.78 ], [ 2.92, 3.02 ], [ 3.36, 3.52 ] ] },
		headlamps: { style: 'fixed', x: 0.53, w: 0.4, h: 0.1 },
		tail: { style: 'bar', y: 0.74, h: 0.13 },
		spoiler: 'trunk',
		ratings: { drift: 0.85, grip: 0.74 },
		mass: 1170,
		cgHeight: 0.47,
		weightFront: 0.55,
		inertiaScale: 1.03,
		engine: {
			type: 'inline4', label: 'SR20DET 2.0 turbo I4', turbo: true, cylinders: 4, idle: 850, redline: 7500, limiter: 7700,
			torque: [ [ 1000, 125 ], [ 2500, 185 ], [ 4000, 262 ], [ 5000, 258 ], [ 6000, 242 ], [ 7000, 212 ], [ 7700, 186 ] ],
			inertia: 0.15, sound: { base: 0.92, rasp: 0.7, lope: 0.0 }
		},
		gears: [ 3.321, 1.902, 1.308, 1.0, 0.759 ],
		reverse: 3.382,
		finalDrive: 4.08,
		grip: 1.08,
		steerLock: 0.64,
		brakeForce: 11800,
		dragCoef: 0.33,
		liveries: [
			{ name: 'Warm White Two-Tone', desc: 'Factory two-tone, 山茶花 club script', draw: 'sazanka' },
			{ name: 'Lime Green', desc: 'Lime metallic, black hood, 緑 kanji', draw: 'lime' },
			{ name: 'Yozora Blue', desc: 'Night blue with silver stars', draw: 'yozora' }
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
