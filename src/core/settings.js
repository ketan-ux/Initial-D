import { bus } from './events.js';

// Player-facing options, persisted to localStorage. Every option has a sane
// default so the game is playable with zero configuration (usability: user
// control & freedom without forcing decisions up-front).
const DEFAULTS = {
	preset: 'auto', // auto | low | quest | high
	resolutionScale: 1, // multiplier on the preset's pixel ratio
	adaptiveResolution: true,
	camera: 'cockpit', // cockpit | chase
	hudMode: 'auto', // auto | windshield | slate | off
	units: 'kmh', // kmh | mph
	transmission: 'auto', // auto | manual
	touchSteer: 'gyro', // gyro | drag (phones/tablets)
	gyroSensitivity: 1, // 0.5..2: tilt needed for full turn = 30° / sensitivity
	steeringAssist: 0.5, // 0..1 countersteer help for keyboard/touch
	vignette: 'auto', // off | auto (VR only) | always
	vignetteStrength: 0.7,
	cameraShake: true,
	captions: true,
	captionSize: 'medium', // small | medium | large
	masterVolume: 0.9,
	engineVolume: 0.9,
	sfxVolume: 0.8,
	radioVolume: 1.0,
	ambienceVolume: 0.6,
	vrShifter: 'sequential', // sequential | hpattern
	vrSteerRatio: 1.0, // wheel rotation multiplier
	haptics: true,
	mode: 'battle', // battle | timeattack
	car: 'ae86',
	livery: { ae86: 0, fd3s: 0 },
	rivalDifficulty: 0.75,
	showDebug: false
};

const KEY = 'touge.settings.v1';

function load() {

	try {

		const raw = localStorage.getItem( KEY );
		if ( raw ) return { ...DEFAULTS, ...JSON.parse( raw ) };

	} catch ( e ) { /* private mode or blocked storage: fall back to defaults */ }

	return { ...DEFAULTS };

}

export const settings = load();

export function setSetting( key, value ) {

	if ( settings[ key ] === value ) return;
	settings[ key ] = value;
	save();
	bus.emit( 'settings', { key, value } );

}

export function save() {

	try {

		localStorage.setItem( KEY, JSON.stringify( settings ) );

	} catch ( e ) { /* ignore */ }

}

export function resetSettings() {

	for ( const k of Object.keys( DEFAULTS ) ) settings[ k ] = structuredClone( DEFAULTS[ k ] );
	save();
	bus.emit( 'settings', { key: '*', value: null } );

}

// Persistent progress (tire wear, best times) lives separately from options.
const PKEY = 'touge.progress.v1';

function loadProgress() {

	try {

		const raw = localStorage.getItem( PKEY );
		if ( raw ) return JSON.parse( raw );

	} catch ( e ) { /* ignore */ }

	return { tireWear: { ae86: [ 0, 0, 0, 0 ], fd3s: [ 0, 0, 0, 0 ] }, bestTimes: {}, races: 0, wins: 0 };

}

export const progress = loadProgress();

export function saveProgress() {

	try {

		localStorage.setItem( PKEY, JSON.stringify( progress ) );

	} catch ( e ) { /* ignore */ }

}
