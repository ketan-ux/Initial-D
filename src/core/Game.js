import * as THREE from 'three/webgpu';
import { RenderSystem } from './renderer.js';
import { applyPreset, quality, isMobile } from './quality.js';
import { settings, setSetting, progress } from './settings.js';
import { bus } from './events.js';
import { clamp, damp, lerp, wrapAngle } from './math.js';
import { World } from '../world/World.js';
import { uTime } from '../render/toon.js';
import { Petals, LAYER_NO_MIRROR } from '../fx/Petals.js';
import { FX } from '../fx/Particles.js';
import { Cockpit } from '../vehicle/Cockpit.js';
import { Race } from '../modes/Race.js';
import { ReplayPlayer } from '../modes/Replay.js';
import { Garage } from '../modes/Garage.js';
import { CARS } from '../vehicle/carSpecs.js';
import { audio } from '../audio/AudioEngine.js';
import { CarAudio } from '../audio/CarAudio.js';
import { Radio } from '../audio/Radio.js';
import { Ambience } from '../audio/Ambience.js';
import { Input, TouchControls } from '../input/Input.js';
import { XRSessionManager } from '../xr/XRSession.js';
import { XRControls } from '../xr/XRControls.js';
import { ComfortVignette } from '../xr/Vignette.js';
import { MiniMap } from '../ui/MiniMap.js';
import { HUD } from '../ui/HUD.js';
import { TelemetryPanel, PhoneGPS } from '../ui/TelemetryPanel.js';
import { Captions } from '../ui/Captions.js';
import { Menus } from '../ui/Menus.js';
import { VRMenu } from '../ui/VRMenu.js';
import { SpeedLines } from '../ui/SpeedLines.js';
import { TitleDemo } from '../modes/TitleDemo.js';

const PHYS_DT = 1 / 120;
const HUD_MODES = [ 'auto', 'diegetic', 'windshield', 'slate', 'off' ];
const HUD_NAMES = { auto: 'arcade', diegetic: 'diegetic only', windshield: 'windshield', slate: 'floating slate', off: 'off' };
const REDUCED_MOTION = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {

	constructor( root ) {

		this.root = root;
		this.state = 'loading';
		this.paused = false;
		this.params = new URLSearchParams( location.search );
		this.acc = 0;
		this.last = 0;
		this.fps = 60;
		this.chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
		this.lookYaw = 0;
		this.shake = 0;
		this.stagingHold = 0;

	}

	async init() {

		const q = applyPreset( this.params.get( 'preset' ) || settings.preset );
		// debugging overrides, e.g. ?q.mirrors=0&q.petals=500
		for ( const [ k, v ] of this.params ) {

			if ( ! k.startsWith( 'q.' ) ) continue;
			const key = k.slice( 2 );
			if ( typeof q[ key ] === 'boolean' ) q[ key ] = v === '1' || v === 'true';
			else if ( typeof q[ key ] === 'number' ) q[ key ] = +v;
			else q[ key ] = v;

		}

		this.quality = q;
		// canvas-painted liveries, posters and signs use these faces; canvas text
		// does not trigger web-font loading on its own (capped so offline is fine)
		await Promise.race( [
			Promise.all( [ '900 40px "Noto Serif JP"', '800 40px "Noto Sans JP"', 'italic 900 40px Kanit' ].map( ( f ) => document.fonts?.load( f ) ) ).catch( () => {} ),
			new Promise( ( r ) => setTimeout( r, 2500 ) )
		] );
		const container = this.root.querySelector( '#viewport' );
		const ui = this.root.querySelector( '#ui' );
		this.menus = new Menus( ui, this._handlers() );
		this.rs = new RenderSystem( q );
		this.rs.userScale = settings.resolutionScale;
		try {

			await this.rs.init( container );

		} catch ( e ) {

			console.error( e );
			this.menus.loadingError( 'This browser could not start WebGL 2 / WebGPU. Try a recent Chrome, Edge, Firefox, Safari or the Meta Quest Browser.' );
			return;

		}

		const renderer = this.rs.renderer;
		this.input = new Input();
		if ( isMobile() || this.params.has( 'touch' ) ) {

			this.touch = new TouchControls( this.input, ui );
			this.touch.show( false );

		}

		this.xrSession = new XRSessionManager( renderer, q );
		this.vrSupported = await this.xrSession.check();

		// --- world ---
		this.scene = new THREE.Scene();
		this.world = new World( this.scene, q );
		await this.world.build( ( p, msg ) => this.menus.setProgress( p * 0.85, msg ) );
		this.track = this.world.track;

		this.camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.06, q.drawDistance );
		this.camera.layers.enable( LAYER_NO_MIRROR );
		this.rig = new THREE.Group();
		this.rig.name = 'rig';
		this.rig.add( this.camera );
		this.scene.add( this.rig );
		this.rs.setupScene( this.scene, this.camera, this.world.moon );

		this.petals = new Petals( q.petals );
		this.scene.add( this.petals.mesh );
		this.fx = new FX( this.scene, q );
		this.minimap = new MiniMap( this.track );
		this.hud = new HUD( ui, this.minimap );
		this.hud.show( false );
		this.hud.setTouch( !! this.touch );
		this.speedLines = new SpeedLines( ui );
		if ( this.touch && ! this.menus.toggleFullscreen ) this.touch.el.querySelector( '.tc-fs' )?.remove();
		this.captions = new Captions( ui );
		this.telemetry = new TelemetryPanel( this.minimap );
		this.vignette = new ComfortVignette();
		this.camera.add( this.vignette.mesh );
		this.xrControls = new XRControls( renderer, this.input );
		this.xrControls.attach( this.rig );
		this.xrControls.onSelect = ( h ) => this.vrMenu.select( h.ray );
		// A on the right controller = the open menu's first (primary) option
		this.xrControls.onPrimary = () => this.vrMenu.mesh.visible && this.vrMenu.items[ 0 ]?.action?.();
		this.vrMenu = new VRMenu();
		this.radio = new Radio( audio );
		this.ambience = new Ambience( audio );
		this.menus.setProgress( 0.88, 'Opening the garage' );
		this.garage = new Garage( this.rs, q );
		this.demo = new TitleDemo( this.world, this.scene, q );
		this.demo.start();

		this._bindInput();
		this._bindBus();

		// pre-compile shaders so the first frames do not hitch
		this.menus.setProgress( 0.92, 'Compiling shaders' );
		try {

			const p = this.track.pointAt( this.track.startS );
			this.camera.position.set( p.x, p.y + 3, p.z );
			await renderer.compileAsync( this.scene, this.camera );
			await renderer.compileAsync( this.garage.scene, this.garage.camera );

		} catch ( e ) {

			console.warn( 'precompile skipped', e );

		}

		this.menus.setProgress( 1, 'Ready' );
		const dev = `${q.name} preset · ${this.rs.backend} · ${this.vrSupported ? 'VR headset detected' : 'flatscreen'}`;
		this.menus.loadingDone( this.vrSupported, dev );
		this.toTitle();
		// the first gesture anywhere unlocks Web Audio (ambience under the title)
		const unlock = () => this._start();
		window.addEventListener( 'pointerdown', unlock, { once: true } );
		window.addEventListener( 'keydown', unlock, { once: true } );
		renderer.setAnimationLoop( ( t, frame ) => this._loop( t, frame ) );
		window.__game = this;
		if ( this.params.has( 'noadapt' ) ) setSetting( 'adaptiveResolution', false );
		if ( this.params.has( 'autostart' ) ) {

			await this._start();
			this.startRace();
			if ( this.params.has( 'autopilot' ) ) {

				this.race.beginCountdown();
				this.autopilotPlayer = true;

			}

		}

	}

	// --------------------------------------------------------------- handlers
	_handlers() {

		return {
			titleAction: async ( act ) => {

				audio.click();
				if ( act === 'vr' ) return this._enterVR();
				if ( act === 'settings' ) return this.menus.openSettings();
				await this._start();
				if ( act === 'battle' || act === 'timeattack' ) setSetting( 'mode', act );
				this.toGarage( act );

			},
			selectCar: ( id ) => {

				this.garage.setCar( id, settings.livery[ id ] ?? 0 ); audio.click(); this._garageVRMenu();

			},
			nextCar: ( d ) => {

				this.garage.nextCar( d ); this.menus.refreshGarage(); audio.click(); this._garageVRMenu();

			},
			back: () => {

				audio.click(); this.toTitle();

			},
			setLivery: ( i ) => {

				this.garage.setLivery( i ); audio.click();

			},
			togglePopups: () => {

				const on = this.garage.toggleHeadlights(); this._popupSound(); return on;

			},
			inspect: ( on ) => this.garage.setInspect( on ),
			replaceTires: () => {

				this.garage.replaceTires(); audio.click();

			},
			drive: () => this.startRace(),
			ready: () => this.race?.beginCountdown(),
			resume: () => this.setPaused( false ),
			restart: () => {

				this.setPaused( false ); this.startRace();

			},
			camera: () => this.toggleCamera(),
			recenter: () => this._recenterXR(),
			quit: () => {

				this.setPaused( false ); this.toGarage();

			},
			replay: () => this.startReplay(),
			replayCmd: ( cmd, v ) => this._replayCmd( cmd, v ),
			settingChanged: ( key ) => this._settingChanged( key ),
			// Back from settings/controls: only return to the pause panel if still paused
			pageReturn: ( from ) => ( from === 'pause' ? this.paused && this.state === 'race' : true )
		};

	}

	async _start() {

		if ( this.started ) return this._starting;
		this.started = true;
		this._starting = this._initAudio();
		return this._starting;

	}

	async _initAudio() {

		try {

			await audio.init( { hrtf: this.vrSupported || this.quality.key === 'high' } );

		} catch ( e ) {

			console.warn( 'audio unavailable', e );

		}

		this.ambience.start();
		this.ambience.setLevel( 1 );
		this.radio.preload();

	}

	async _enterVR() {

		if ( ! this.started ) await this._start();
		try {

			audio.setHRTF( true );
			await this.xrSession.enter();

		} catch ( e ) {

			console.error( e );
			this.hud.toast( 'Could not start VR: ' + e.message, 4 );

		}

	}

	_bindInput() {

		const i = this.input;
		i.on( 'pause', () => {

			// VR Y button: only meaningful in a race (menus elsewhere have Back items)
			if ( this.xrSession.presenting && this.state !== 'race' ) return;
			if ( this.menus.isOpen( 'confirm' ) ) this.menus.show( 'confirm', false );
			else if ( this.menus.page ) this.menus.closePage();
			else if ( this.state === 'race' ) this.setPaused( ! this.paused );
			else if ( this.state === 'replay' ) this._replayCmd( 'exit' );
			else this.menus.back();

		} );
		i.on( 'camera', () => this.toggleCamera() );
		i.on( 'fullscreen', () => this.menus.toggleFullscreen?.() );
		i.on( 'headlights', () => {

			if ( this.state === 'race' && ! this.paused ) this.toggleHeadlights();

		} );
		// gamepad menu navigation (d-pad / stick, A, B)
		const menuMode = () => this.state !== 'race' || this.paused || !! this.menus.top();
		i.on( 'menuUp', () => menuMode() && this.menus.nav( - 1 ) );
		i.on( 'menuDown', () => menuMode() && this.menus.nav( 1 ) );
		i.on( 'menuOk', () => menuMode() && this.menus.activate() );
		i.on( 'menuBack', () => {

			if ( ! menuMode() ) return;
			if ( this.paused && this.menus.top() === 'pause' ) this.setPaused( false );
			else this.menus.back();

		} );
		i.on( 'shiftUp', () => this._shift( 1 ) );
		i.on( 'shiftDown', () => this._shift( - 1 ) );
		i.on( 'reset', () => {

			if ( this.state === 'race' && this.race.phase === 'race' && ! this.paused ) this.race.respawn();

		} );
		i.on( 'hud', () => {

			const n = HUD_MODES[ ( HUD_MODES.indexOf( settings.hudMode ) + 1 ) % HUD_MODES.length ];
			setSetting( 'hudMode', n );
			this.hud.toast( 'HUD: ' + HUD_NAMES[ n ] );
			this._applyHud();

		} );
		i.on( 'debug', () => setSetting( 'showDebug', ! settings.showDebug ) );
		i.on( 'vignette', () => {

			const n = settings.vignette === 'off' ? 'always' : 'off';
			setSetting( 'vignette', n );
			this.hud.toast( 'Comfort vignette: ' + n );

		} );
		i.on( 'confirm', () => {

			if ( this.state === 'garage' && ! this.menus.isOpen( 'settings' ) && ! this.menus.isOpen( 'help' ) && document.activeElement?.tagName !== 'BUTTON' ) this.startRace();
			else if ( this.state === 'race' && this.race?.phase === 'staging' ) this.race.beginCountdown();

		} );
		i.on( 'lookBackToggle', () => ( this.input.lookBack = ! this.input.lookBack ) );

	}

	_bindBus() {

		bus.on( 'xr-start', ( info ) => {

			this.xrInfo = info;
			this.cockpit?.setVR( true );
			this.captions.setVR( true );
			this.hud.show( false );
			this.touch?.show( false );
			if ( this.state === 'garage' || this.state === 'title' ) {

				if ( this.state === 'title' ) this.toGarage();
				this.garage.enterVR();
				this._garageVRMenu();

			} else {

				this._needsRecenter = 0.4;

			}

			this._applyHud();

		} );
		bus.on( 'xr-end', () => {

			this.cockpit?.setVR( false );
			this.captions.setVR( false );
			this._hideVRMenu();
			if ( this.state === 'garage' ) {

				this.garage.exitVR();
				this.garage.enter();

			}

			this._resetRig();
			this._applyHud();
			this._applyCamera();

		} );
		bus.on( 'xr-recenter', () => this._recenterXR() );
		bus.on( 'countdown', ( n ) => {

			if ( n > 0 ) audio.beep( 880, 0.14, 0.3 );
			else audio.beep( 1760, 0.5, 0.35 );
			this.countdownText = n > 0 ? String( n ) : 'GO!';
			this.countdownTimer = n > 0 ? 1 : 1.2;
			if ( this._showDomCountdown() ) this.hud.countdown( this.countdownText, n > 0 ? '' : 'go' );
			if ( n === 3 ) this.menus.show( 'staging', false );
			if ( this.xrSession.presenting ) {

				this._hideVRMenu();
				// keep the button legends up through the lights and a few seconds after
				this.xrControls.showHelp( 'drive', n > 0 ? Infinity : 8 );

			}

		} );
		bus.on( 'race-phase', ( p ) => {

			if ( p === 'race' ) {

				this.ambience.setLevel( 0.25 );
				// test hook: ?skipto=<metres> teleports the field down the mountain
				const skip = +this.params.get( 'skipto' );
				if ( skip > 0 ) {

					this.race.player.reset( skip, 1.5, 24 );
					this.race.rival?.reset( skip + 8, - 1.5, 24 );
					this.chase.init = false;

				}

			}
			if ( p === 'finish' ) {

				this.hud.toast( this.race.rival ? ( this.race.won ? 'WIN' : 'LOSE' ) : 'FINISH', 2.5 );
				this.slowmoFinish = 1.2;

			}

			if ( p === 'cooldown' ) {

				this.ambience.setLevel( 1 );
				setTimeout( () => {

					if ( this.state !== 'race' || this.race?.phase !== 'cooldown' ) return;
					this.menus.showResults( this.race.results() );
					this._resultsVRMenu();

				}, 2500 );

			}

		} );
		bus.on( 'cockpit-button', ( name ) => {

			if ( name === 'headlights' ) this.toggleHeadlights( true );
			else if ( name === 'hazard' && this.cockpit ) {

				this.cockpit.hazard = ! this.cockpit.hazard;
				if ( ! this.cockpit.hazard ) this.race.player.model.uniforms.marker.value = 1;

			} else if ( name === 'hud' ) this.input.emit( 'hud' );
			audio.click();

		} );
		bus.on( 'phone-tap', () => {

			this.phone?.cycle(); audio.beep( 1320, 0.05, 0.12 );

		} );
		bus.on( 'settings', ( { key } ) => {

			if ( key.endsWith( 'Volume' ) || key === '*' ) audio.applyVolumes();

		} );
		bus.on( 'car-contact', ( v ) => {

			audio.thud( clamp( v / 6, 0.2, 0.7 ), 90 );
			this.shake = Math.max( this.shake, clamp( v / 6, 0, 1 ) );
			this.xrControls.pulseAll( clamp( v / 8, 0.4, 1 ), 120 );

		} );

	}

	// --------------------------------------------------------------- states
	toTitle() {

		this._endRace();
		this.state = 'title';
		this.menus.hideAll();
		this.menus.show( 'title' );
		this.hud.show( false );
		this.touch?.show( false );
		this.garage.leave();
		this.demo.start();
		this.fx.clear();
		this.camera.fov = 40;
		this.camera.updateProjectionMatrix();
		this.rs.setCamera( this.camera );
		this.ambience.setLevel( 0.8 );

	}

	_leaveTitle() {

		this.demo.stop();
		this.demoAudio?.forEach( ( a ) => a.stop() );
		this.demoAudio = null;
		this.fx.clear();
		this.speedLines.clear();

	}

	toGarage( mode ) {

		this._endRace();
		this._leaveTitle();
		this.state = 'garage';
		if ( mode ) this.garageMode = mode;
		this.menus.hideAll();
		this.menus.refreshGarage( this.garageMode || settings.mode, !! this.garage.headlights );
		this.menus.show( 'garage' );
		this.hud.show( false );
		this.touch?.show( false );
		this.garage.setCar( settings.car, settings.livery[ settings.car ] ?? 0 );
		this.garage.enter();
		this.ambience.setLevel( 1 );
		if ( this.xrSession.presenting ) {

			this.garage.enterVR();
			this._garageVRMenu();

		}

	}

	startRace() {

		this._endRace();
		this._leaveTitle();
		const carId = settings.car;
		this.state = 'race';
		this.paused = false;
		this.menus.hideAll();
		this.garage.leave();
		this.race = new Race( this.world, this.scene, this.quality, {
			mode: settings.mode, carId, livery: settings.livery[ carId ] ?? 0, radio: this.radio
		} );
		this.cockpit = new Cockpit( this.race.player.model, this.quality );
		this.cockpit.setVR( this.xrSession.presenting );
		this.phone = new PhoneGPS( this.cockpit, this.minimap );
		this.telemetry.mount( this.cockpit );
		this.captions.mount( this.cockpit );
		this.captions.setVR( this.xrSession.presenting );
		this.xrControls.setCockpit( this.cockpit, this.race.player.physics );
		this.hud.setSpec( this.race.player.spec, this.track );
		this.carAudio = this.race.cars.map( ( c ) => new CarAudio( audio, c, { isPlayer: c === this.race.player } ) );
		this.fx.clear();
		this.chase.init = false;
		this.cameraMode = settings.camera;
		this._applyCamera();
		this._applyHud();
		this.rs.setCamera( this.camera );
		this.touch?.show( true );
		this.ambience.setLevel( 0.7 );
		if ( this.xrSession.presenting ) {

			this._needsRecenter = 0.2;
			this._stagingVRMenu();

		} else this.menus.show( 'staging' );

		this.hud.countdown( '' );

	}

	_endRace() {

		this.radio.clear();
		this.carAudio?.forEach( ( a ) => a.stop() );
		this.carAudio = null;
		this.replay = null;
		if ( this.race ) {

			this.telemetry.windshield.removeFromParent();
			this.telemetry.slate.removeFromParent();
			this.captions.mesh.removeFromParent();
			this.race.dispose();
			this.race = null;
			this.cockpit = null;
			this.phone = null;

		}

		this._resetRig();
		this._hideVRMenu();
		this.speedLines.clear();

	}

	startReplay() {

		if ( ! this.race || this.race.recorder.frames < 10 ) return;
		this.state = 'replay';
		this.menus.hideAll();
		this.replay = new ReplayPlayer( this.race.recorder, this.race.cars, this.track, this.world.field );
		this.radio.clear();
		this.hud.show( false );
		this.touch?.show( false );
		this.cockpit.group.visible = false;
		this.race.player.model.setInterior( false );
		this.fx.clear();
		this._resetRig();
		this.scene.add( this.rig );
		this.camera.fov = 55;
		this.camera.updateProjectionMatrix();
		if ( this.xrSession.presenting ) {

			this._replayVRMenu();

		} else this.menus.show( 'replay' );

	}

	_replayCmd( cmd, v ) {

		const r = this.replay;
		if ( ! r ) return;
		if ( cmd === 'toggle' ) r.playing = ! r.playing;
		else if ( cmd === 'seek' ) {

			r.seek( v * r.duration ); this.fx.clear();

		} else if ( cmd === 'speed' ) r.speed = v;
		else if ( cmd === 'cam' ) r.camMode = v;
		else if ( cmd === 'focus' ) {

			r.focus = ( r.focus + 1 ) % this.race.cars.length; return r.focus;

		} else if ( cmd === 'exit' ) {

			this.state = 'race';
			this.replay = null;
			this.menus.show( 'replay', false );
			this.fx.clear();
			// park the cars back at the end state
			for ( const c of this.race.cars ) c.sync( 0 );
			this._applyCamera();
			this.menus.showResults( this.race.results() );
			this._resultsVRMenu();

		}

	}

	setPaused( p ) {

		if ( this.state !== 'race' ) return;
		this.paused = p;
		if ( ! p ) this.menus.closeAllPages();
		this.menus.show( 'pause', p );
		document.body.classList.toggle( 'paused', p );
		if ( p ) audio.suspend(); else audio.resume();
		if ( this.xrSession.presenting ) {

			if ( p ) this._pauseVRMenu(); else {

				this._hideVRMenu();
				this.xrControls.showHelp( 'drive', 4 );

			}

		}

	}

	// --------------------------------------------------------------- VR menus
	// Menus spawn in front of wherever the player is looking (1.1 m ahead,
	// a little below eye level, turned to face them) inside `parent`, so they
	// ride along with the garage or the car. Placement waits a few frames for
	// a valid head pose; the panel drifts back into view if you look away.
	_placeVRMenu( parent, dist = 1.1, drive = false ) {

		this.xrControls.setPointerMode( true, drive );
		this.xrControls.showHelp( drive ? 'drive' : 'menu' );
		// a refresh of the open menu (Next car, Livery…) keeps it where it is
		if ( this._menuWanted && this._menuParent === parent && this.vrMenu.mesh.visible ) return;
		this._menuDist = dist;
		parent.add( this.vrMenu.mesh );
		this._menuParent = parent;
		this._menuPlaceIn = 0.12; // seconds: let the head pose settle first
		this._menuAway = 0;
		this.vrMenu.mesh.visible = false;
		this._menuWanted = true;

	}

	_headPose( pos, fwd ) {

		const cam = this.rs.renderer.xr.getCamera();
		cam.matrixWorld.decompose( pos, _q, _u );
		fwd.set( 0, 0, - 1 ).applyQuaternion( _q );
		fwd.y = 0;
		if ( fwd.lengthSq() < 1e-4 ) fwd.set( 0, 0, - 1 );
		fwd.normalize();

	}

	_menuToHead() {

		const m = this.vrMenu.mesh, parent = this._menuParent;
		const head = new THREE.Vector3(), fwd = new THREE.Vector3();
		this._headPose( head, fwd );
		const target = head.clone().addScaledVector( fwd, this._menuDist ?? 1.1 );
		target.y -= 0.1 * ( this._menuDist ?? 1.1 );
		parent.updateMatrixWorld( true );
		m.position.copy( parent.worldToLocal( target.clone() ) );
		// constant angular size (~43° wide) whatever the distance
		m.scale.setScalar( ( this._menuDist ?? 1.1 ) / 1.4 );
		// world yaw so the panel's +z faces the head, expressed in parent space
		const yaw = Math.atan2( head.x - target.x, head.z - target.z );
		const wq = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), yaw );
		const pq = new THREE.Quaternion();
		parent.getWorldQuaternion( pq );
		m.quaternion.copy( pq.invert().multiply( wq ) );

	}

	_updateVRMenuPlacement( dt ) {

		if ( ! this._menuWanted || ! this.xrSession.presenting ) return;
		if ( this._needsRecenter != null ) return; // seat the player first
		if ( this._menuPlaceIn > 0 ) {

			this._menuPlaceIn -= dt;
			if ( this._menuPlaceIn <= 0 ) {

				this._menuToHead();
				this.vrMenu.show( true );

			}

			return;

		}

		// lazy follow: if the panel is far out of view for a moment, bring it back
		const head = new THREE.Vector3(), fwd = new THREE.Vector3(), mp = new THREE.Vector3();
		this._headPose( head, fwd );
		this.vrMenu.mesh.getWorldPosition( mp );
		const to = mp.sub( head ).setY( 0 ).normalize();
		this._menuAway = to.dot( fwd ) < 0.45 ? this._menuAway + dt : 0;
		if ( this._menuAway > 1.2 ) {

			this._menuAway = 0;
			this._menuToHead();

		}

	}

	_hideVRMenu() {

		this._menuWanted = false;
		this.vrMenu.show( false );
		this.xrControls.setPointerMode( false );
		this.xrControls.showHelp( null );

	}

	_garageVRMenu() {

		if ( ! this.xrSession.presenting || this.state !== 'garage' ) return;
		const id = settings.car, c = CARS[ id ];
		this.vrMenu.set( `${c.make} ${c.model}`, [
			{ label: '▸ Drive to the summit', detail: settings.mode === 'battle' ? 'Battle vs rival' : 'Time attack', action: () => this.startRace() },
			{ label: 'Next car', detail: c.code, action: () => {

				this.garage.nextCar( 1 ); this.menus.refreshGarage(); audio.click(); this._garageVRMenu();

			} },
			{ label: 'Livery', detail: c.liveries[ settings.livery[ id ] ?? 0 ].name, action: () => {

				const n = ( ( settings.livery[ id ] ?? 0 ) + 1 ) % c.liveries.length; this.garage.setLivery( n ); this._garageVRMenu();

			} },
			{ label: c.popup ? 'Pop-up headlights' : 'Headlights', detail: this.garage.headlights ? 'ON' : 'OFF', action: () => {

				this.garage.toggleHeadlights(); this._popupSound(); this._garageVRMenu();

			} },
			{ label: 'Mode', detail: settings.mode === 'battle' ? 'Battle' : 'Time attack', action: () => {

				setSetting( 'mode', settings.mode === 'battle' ? 'timeattack' : 'battle' ); this._garageVRMenu();

			} },
			{ label: 'Exit VR', action: () => this.xrSession.exit() }
		], 'Walk around the car — it is life-size. Point and pull the trigger.' );
		this._placeVRMenu( this.garage.scene );

	}

	_stagingVRMenu() {

		this.vrMenu.set( 'Summit staging', [
			{ label: '▸ Ready — start countdown', action: () => {

				this.race?.beginCountdown(); this._hideVRMenu();

			} },
			{ label: 'Recenter seat', action: () => this._recenterXR() },
			{ label: 'Back to garage', action: () => this.toGarage() }
		], 'Squeeze GRIP on the glowing rim to hold the wheel · right TRIGGER revs · A = Ready' );
		this._placeVRMenu( this.cockpit.group, 0.62, true );

	}

	_pauseVRMenu() {

		this.vrMenu.set( 'Paused', [
			{ label: 'Resume', action: () => this.setPaused( false ) },
			{ label: 'Restart run', action: () => this._handlers().restart() },
			{ label: 'Recenter seat', action: () => this._recenterXR() },
			{ label: 'Quit to garage', action: () => this._handlers().quit() }
		] );
		this._placeVRMenu( this.cockpit.group, 0.62 );

	}

	_resultsVRMenu() {

		if ( ! this.xrSession.presenting || ! this.race ) return;
		const r = this.race.results();
		const fmt = ( t ) => ( t ? `${Math.floor( t / 60 )}:${( t % 60 ).toFixed( 2 ).padStart( 5, '0' )}` : '--' );
		this.vrMenu.set( r.mode === 'battle' ? ( r.won ? '勝利 — You won!' : '敗北 — So close' ) : 'Time attack', [
			{ label: 'Watch replay', detail: 'drone · roadside · slow-mo', action: () => this.startReplay() },
			{ label: 'Race again', action: () => this._handlers().restart() },
			{ label: 'Garage', action: () => this.toGarage() }
		], `Your time ${fmt( r.time )}${r.rivalTime ? ' · rival ' + fmt( r.rivalTime ) : ''}` );
		this._placeVRMenu( this.cockpit.group, 0.62 );

	}

	_replayVRMenu() {

		const r = this.replay;
		this.vrMenu.set( 'Touge Attack replay', [
			{ label: 'Play / pause', action: () => this._replayCmd( 'toggle' ) },
			{ label: 'Camera', detail: r.camMode, action: () => {

				const modes = [ 'spotter', 'director', 'chase', 'drone', 'onboard' ];
				r.camMode = modes[ ( modes.indexOf( r.camMode ) + 1 ) % modes.length ]; this._replayVRMenu();

			} },
			{ label: 'Speed', detail: r.speed + '×', action: () => {

				r.speed = r.speed >= 1 ? 0.25 : r.speed * 2; this._replayVRMenu();

			} },
			{ label: 'Exit replay', action: () => this._replayCmd( 'exit' ) }
		], 'Spectating from roadside spotter positions' );
		r.camMode = r.camMode === 'director' ? 'spotter' : r.camMode;
		this._placeVRMenu( this.rig );

	}

	// --------------------------------------------------------------- camera
	toggleCamera() {

		if ( this.state !== 'race' || this.xrSession.presenting ) return;
		this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
		this.chase.init = false;
		this._applyCamera();
		this._applyHud();

	}

	_applyCamera() {

		if ( ! this.race ) return;
		const fpp = this.cameraMode === 'cockpit' || this.xrSession.presenting;
		this.cockpit.group.visible = fpp;
		this.race.player.model.setInterior( fpp );
		this._resetRig();
		if ( fpp ) {

			this.cockpit.eye.add( this.rig );
			this.rig.position.set( 0, 0, 0 );
			this.rig.rotation.set( 0, Math.PI * 0, 0 );
			this.camera.fov = 70;

		} else {

			this.scene.add( this.rig );
			this.camera.fov = 62;

		}

		this.camera.position.set( 0, 0, 0 );
		this.camera.rotation.set( 0, 0, 0 );
		this.camera.updateProjectionMatrix();

	}

	_resetRig() {

		this.scene.add( this.rig );
		this.rig.position.set( 0, 0, 0 );
		this.rig.rotation.set( 0, 0, 0 );
		this.rig.scale.set( 1, 1, 1 );

	}

	// Place the XR rig so the user's head sits at the driver's eye point,
	// facing down the road (seated, local-floor reference space).
	_recenterXR() {

		if ( ! this.xrSession.presenting || ! this.cockpit || this.state === 'replay' ) return;
		const cam = this.camera; // local transform = head pose relative to the rig
		const e = new THREE.Euler().setFromQuaternion( cam.quaternion, 'YXZ' );
		const yaw = e.y;
		this.cockpit.eye.add( this.rig );
		// cockpit "eye" faces +z; XR forward is -z, so rotate PI plus the head yaw
		this.rig.rotation.set( 0, Math.PI - yaw, 0 );
		const headLocal = cam.position.clone().applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI - yaw );
		this.rig.position.copy( headLocal.negate() );
		this.hud.toast( 'View recentered' );
		if ( this._menuWanted && this._menuPlaceIn <= 0 ) {

			this.rig.updateMatrixWorld( true );
			this._menuPlaceIn = 0.05; // re-place in front of the new view

		}

	}

	_updateCamera( dt ) {

		const race = this.race, car = race.player, p = car.physics;
		if ( this.xrSession.presenting ) return;
		if ( this.cameraMode === 'cockpit' ) {

			// look into corners with yaw rate / steering, and glance back on demand
			// small bias toward the centre console (RHD: to the left) keeps the
			// phone GPS and cup in frame; look into corners on top of that
			const fwd = p.gear !== - 1;
			const want = 0.07 + ( fwd ? clamp( p.yawRate * 0.12 + p.steerAngle * 0.15, - 0.22, 0.22 ) : 0 ) + ( this.input.lookBack ? Math.PI : 0 );
			this.lookYaw = damp( this.lookYaw, want, 6, dt );
			this.rig.rotation.set( 0, Math.PI + this.lookYaw, 0 );
			const sh = this._shakeAmount( dt );
			this.camera.position.set( ( Math.random() - 0.5 ) * sh * 0.01, ( Math.random() - 0.5 ) * sh * 0.012, 0 );
			const fov = 70 + clamp( p.speed / 50, 0, 1 ) * 5;
			if ( Math.abs( this.camera.fov - fov ) > 0.05 ) {

				this.camera.fov = damp( this.camera.fov, fov, 3, dt ); this.camera.updateProjectionMatrix();

			}

		} else {

			const speed = p.speed;
			// sit behind the car's nose; lean a little toward the slide when
			// moving forward. The blend is done on the wrapped angle difference
			// (a plain lerp across +-PI swung the camera to the wrong side), and
			// never when reversing, so the car always backs toward the camera.
			const vLong = p.vx * Math.sin( p.heading ) + p.vz * Math.cos( p.heading );
			let camHeading = p.heading;
			if ( speed > 3 && vLong > 1 ) camHeading += clamp( wrapAngle( Math.atan2( p.vx, p.vz ) - p.heading ) * 0.45, - 0.5, 0.5 );
			_f.set( Math.sin( camHeading ), 0, Math.cos( camHeading ) );
			if ( this.input.lookBack ) _f.negate();
			// tight, low chase framing like the reference: the car fills the lower third
			const dist = 5.0 + clamp( speed / 40, 0, 1 ) * 1.1;
			_v.copy( car.root.position ).addScaledVector( _f, - dist );
			_v.y += 1.75 + clamp( speed / 40, 0, 1 ) * 0.25;
			// keep the chase camera above the road surface
			const pr = this.track.project( _v.x, _v.z, p.trackHint );
			_v.y = Math.max( _v.y, pr.y + 1.1 );
			if ( ! this.chase.init ) {

				this.chase.pos.copy( _v ); this.chase.look.copy( car.root.position ); this.chase.init = true;

			}

			this.chase.pos.lerp( _v, 1 - Math.exp( - dt * 7 ) );
			_u.copy( car.root.position ).addScaledVector( _f, 3.5 );
			_u.y += 0.8;
			this.chase.look.lerp( _u, 1 - Math.exp( - dt * 12 ) );
			const sh = this._shakeAmount( dt );
			this.rig.position.copy( this.chase.pos ).add( new THREE.Vector3( ( Math.random() - 0.5 ) * sh * 0.06, ( Math.random() - 0.5 ) * sh * 0.06, 0 ) );
			this.rig.lookAt( this.chase.look );
			this.rig.rotateY( Math.PI ); // Object3D.lookAt points +z; cameras look down -z
			const fov = 60 + clamp( speed / 45, 0, 1 ) * 10;
			if ( Math.abs( this.camera.fov - fov ) > 0.05 ) {

				this.camera.fov = damp( this.camera.fov, fov, 3, dt ); this.camera.updateProjectionMatrix();

			}

		}

	}

	_shakeAmount( dt ) {

		if ( ! settings.cameraShake || ! this.race ) return 0;
		const p = this.race.player.physics;
		const gutter = p.inGutter.some( ( g ) => g ) ? 0.6 : 0;
		const target = Math.max( p.scrape, gutter * clamp( p.speed / 25, 0, 1 ), clamp( p.speed / 70, 0, 0.25 ) );
		this.shake = damp( this.shake, target, 5, dt );
		return this.shake;

	}

	// --------------------------------------------------------------- HUD
	_showDomCountdown() {

		return ! this.xrSession.presenting && ( this.cameraMode === 'chase' || settings.hudMode === 'slate' || settings.hudMode === 'auto' );

	}

	_applyHud() {

		const vr = this.xrSession.presenting;
		const mode = settings.hudMode;
		const fpp = this.cameraMode === 'cockpit' || vr;
		const inRace = this.state === 'race';
		let dom = false;
		if ( inRace && ! vr ) {

			if ( ! fpp ) dom = mode !== 'off';
			else dom = mode === 'slate' || mode === 'auto';

		}

		this.hud.show( dom );
		// arcade mode collapses to a compact needle tach while in the cockpit
		this.hud.setCockpit( fpp && mode === 'auto' );
		let panel = 'none';
		if ( inRace && fpp ) {

			if ( mode === 'windshield' ) panel = 'windshield';
			else if ( mode === 'slate' && vr ) panel = 'slate';

		}

		this.telemetry.setMode( panel );

	}

	_settingChanged( key ) {

		if ( key === 'hudMode' || key === '*' ) this._applyHud();
		if ( key === 'camera' && this.state === 'race' ) {

			this.cameraMode = settings.camera; this._applyCamera(); this._applyHud();

		}

		if ( key === 'resolutionScale' ) {

			this.rs.userScale = settings.resolutionScale; this.rs.applyPixelRatio(); this.rs.resize();

		}

		if ( key === 'transmission' && this.race ) this.race.player.physics.autoShift = settings.transmission === 'auto';
		if ( key === 'preset' ) {

			this.menus.confirm( 'Reload now to apply the new quality preset?', () => location.reload() );

		}

	}

	// --------------------------------------------------------------- actions
	_shift( dir ) {

		if ( ! this.race || this.race.phase !== 'race' ) return;
		const p = this.race.player.physics;
		if ( p.autoShift ) {

			// tapping a shift control switches to manual on the fly
			p.autoShift = false;
			setSetting( 'transmission', 'manual' );
			this.hud.toast( 'Manual transmission' );

		}

		if ( dir > 0 ) p.shiftUp(); else p.shiftDown();

	}

	toggleHeadlights( fromCockpit = false ) {

		const car = this.race?.player;
		if ( ! car ) return;
		car.setHeadlights( ! car.headlightsOn );
		if ( ! fromCockpit ) this.cockpit?.pressButton( 'headlights' );
		this._popupSound();
		this.hud.toast( car.headlightsOn ? ( car.spec.popup ? 'Pop-ups up' : 'Lights on' ) : 'Lights off — risky!' );

	}

	_popupSound() {

		if ( ! audio.ready ) return;
		audio.noiseBurst( { dur: 0.35, freq: 420, q: 4, gain: 0.18 } );
		audio.beep( 140, 0.3, 0.08, 'sfx', 'sawtooth' );

	}

	// --------------------------------------------------------------- loop
	_loop( time ) {

		const now = time / 1000;
		let dt = this.last ? now - this.last : 1 / 60;
		this.last = now;
		dt = clamp( dt, 0, 0.1 );
		this.fps = lerp( this.fps, 1 / Math.max( dt, 1e-3 ), 0.05 );
		this.input.update( dt );
		this.xrControls.update( dt );
		this._updateVRMenuPlacement( dt );
		if ( this.vrMenu.mesh.visible ) this.vrMenu.updateHover( this.xrControls.hands.map( ( h ) => h.ray ) );

		if ( this.state === 'title' ) {

			this._titleFrame( dt );

		} else if ( this.state === 'garage' ) {

			uTime.value += dt;
			this.garage.update( dt );
			this._listener( this.garage.camera );
			this.ambience.update( dt );
			this.rs.render( this.garage.scene, this.garage.camera );

		} else if ( this.state === 'race' ) {

			this._raceFrame( dt );

		} else if ( this.state === 'replay' ) {

			this._replayFrame( dt );

		}

		this.captions.update( this.paused ? 0 : dt );
		this.radio.update();
		this.rs.adapt( dt, settings.adaptiveResolution );
		if ( settings.showDebug ) {

			const info = this.rs.renderer.info.render;
			this.hud.el.classList.remove( 'hidden' );
			this.hud.debug( `${Math.round( this.fps )} fps · ${info.drawCalls} draws · ${( info.triangles / 1000 ).toFixed( 0 )}k tris · ${this.quality.name} · ${this.rs.backend} · pr ${this.rs.pixelRatio.toFixed( 2 )}${this.xrInfo ? ` · XR multiview ${this.xrInfo.multiview ? 'ON' : 'off'}` : ''}` );

		} else this.hud.debug( '' );

	}

	_titleFrame( dt ) {

		uTime.value += dt;
		const drift = this.demo.update( dt, this.camera );
		this.fx.beginFrame();
		for ( const c of this.demo.cars ) this.fx.emitForCar( c, dt );
		this.fx.endFrame();
		this.camera.getWorldPosition( _v );
		this.petals.update( _v, this.demo.cars.map( ( c ) => ( { x: c.physics.x, y: c.physics.y, z: c.physics.z, vx: c.physics.vx, vz: c.physics.vz, drift: c.telemetry.drift } ) ) );
		this.world.update( dt, _v, this.camera.far );
		// engines of the battling cars once audio is unlocked (quiet under the menu)
		if ( audio.ready && ! this.demoAudio && ! this.xrSession.presenting ) this.demoAudio = this.demo.cars.map( ( c ) => new CarAudio( audio, c, { isPlayer: false } ) );
		this._listener( this.camera );
		this.demoAudio?.forEach( ( a ) => a.update( dt, _v.clone(), 1 ) );
		this.ambience.update( dt );
		this.vignette.update( dt, 0, 0, 0, false );
		if ( ! REDUCED_MOTION ) this.speedLines.set( this.demo.shot === 'front' || this.demo.shot === 'rear' ? 0.25 + drift * 0.3 : 0 );
		this.speedLines.update( dt );
		this.rs.render( this.scene, this.camera, drift * 0.5 );

	}

	_raceFrame( dt ) {

		const race = this.race;
		if ( this._needsRecenter != null ) {

			this._needsRecenter -= dt;
			if ( this._needsRecenter <= 0 ) {

				this._needsRecenter = null; this._recenterXR();

			}

		}

		let simDt = this.paused ? 0 : dt;
		if ( this.slowmoFinish > 0 ) {

			this.slowmoFinish -= dt;
			simDt *= 0.4;

		}

		// --- input → physics (fixed 120 Hz) ---
		const controls = { ...this.input.state };
		if ( this.autopilotPlayer && race.phase === 'race' ) {

			race.autopilot.update( simDt, { raceActive: true } );
			Object.assign( controls, race.player.physics.controls );

		}

		if ( race.phase === 'staging' && controls.throttle > 0.5 ) {

			this.stagingHold += dt;
			if ( this.stagingHold > 0.8 ) race.beginCountdown();

		} else this.stagingHold = 0;
		if ( race.phase === 'staging' && race.phaseTime > 25 ) race.beginCountdown();

		this.acc += simDt;
		let steps = 0;
		while ( this.acc >= PHYS_DT && steps < 10 ) {

			race.step( PHYS_DT, controls );
			this.acc -= PHYS_DT;
			steps ++;

		}

		if ( steps >= 10 ) this.acc = 0;
		race.update( simDt );

		// physics events -> haptics / audio cues
		for ( const c of race.cars ) {

			for ( const e of c.physics.events ) {

				if ( c === race.player ) {

					this.xrControls.onPhysicsEvent( e );
					if ( e.type === 'wallHit' ) {

						audio.thud( clamp( e.impact / 8, 0.25, 0.8 ) );
						this.shake = 1;

					}

					if ( e.type === 'gutterClip' ) audio.noiseBurst( { dur: 0.12, freq: 180, q: 1, gain: 0.35, type: 'lowpass' } );
					if ( e.type === 'shiftDenied' ) audio.beep( 300, 0.08, 0.15, 'ui', 'square' );

				}

			}

			c.physics.events.length = 0;

		}

		if ( race.respawnPrompt > 3 && race.phase === 'race' ) {

			this.hud.toast( 'Stuck? Press R / X (gamepad) to reset', 1 );
			if ( race.respawnPrompt > 7 ) race.respawn();

		}

		uTime.value += simDt;

		// --- camera, cockpit, FX ---
		this._updateCamera( dt );
		const tel = race.player.telemetry;
		// flatscreen: the wheel mirrors the rack (±135° at full lock); in VR the hands drive it
		if ( ! this.xrSession.presenting ) this.cockpit.wheelAngle = race.player.physics.steerAngle / race.player.spec.steerLock * Math.PI * 0.75;
		this.cockpit.update( dt, tel, race.player.physics );
		this.fx.beginFrame();
		const inCabin = this.cameraMode === 'cockpit' || this.xrSession.presenting;
		if ( simDt > 0 ) for ( const c of race.cars ) this.fx.emitForCar( c, simDt, { skipHeadGlow: inCabin && c === race.player } );
		this.fx.endFrame();
		this.camera.getWorldPosition( _v );
		this.petals.update( _v, race.cars.map( ( c ) => ( { x: c.physics.x, y: c.physics.y, z: c.physics.z, vx: c.physics.vx, vz: c.physics.vz, drift: c.telemetry.drift } ) ) );
		this.world.update( dt, _v, this.camera.far );
		const vigOn = settings.vignette === 'always' || ( settings.vignette === 'auto' && this.xrSession.presenting );
		this.vignette.update( dt, race.player.physics.yawRate, race.player.physics.slipAngle, settings.vignetteStrength, vigOn && ( this.cameraMode === 'cockpit' || this.xrSession.presenting ) );

		// --- HUD ---
		const hd = race.hudData();
		hd.countdown = this.countdownTimer > 0 ? this.countdownText : null;
		if ( this.countdownTimer > 0 ) {

			this.countdownTimer -= dt;
			if ( this.countdownTimer <= 0 ) this.hud.countdown( '' );

		}

		this.hud.update( dt, hd );
		// manga speed lines at speed / mid-drift (flatscreen chase + arcade cockpit)
		const kmh = race.player.physics.speed * 3.6;
		const lines = this.paused || this.xrSession.presenting || REDUCED_MOTION ? 0
			: clamp( ( kmh - 80 ) / 70, 0, 1 ) * 0.6 + clamp( tel.drift - 0.35, 0, 1 ) * 0.6;
		this.speedLines.set( this.cameraMode === 'chase' ? lines : lines * 0.5, 0.5, this.cameraMode === 'chase' ? 0.5 : 0.42 );
		this.speedLines.update( dt );
		this.telemetry.update( dt, hd );
		this.phone.update( dt, hd );

		// --- audio ---
		this._listener( this.camera );
		const lp = _v.clone();
		this.carAudio?.forEach( ( a ) => a.update( simDt || 0, lp, this.slowmoFinish > 0 ? 0.4 : 1 ) );
		this.ambience.update( dt );

		// --- render ---
		if ( this.cockpit.group.visible && ! this.paused ) this.cockpit.renderMirrors( this.rs.renderer, this.scene );
		this.rs.render( this.scene, this.camera, this.cameraMode === 'chase' ? tel.drift : tel.drift * 0.5 );

	}

	_replayFrame( dt ) {

		const r = this.replay;
		const scale = r.update( dt );
		uTime.value += dt * scale;
		if ( this.xrSession.presenting ) {

			// spectator: teleport the rig between roadside spotter points
			const res = r.director.update( this.camera, 0, r.cars[ r.focus ], 'spotter', r.time, null );
			const sp = r.director.spot;
			if ( sp && sp !== this._vrSpot ) {

				this._vrSpot = sp;
				this.rig.position.set( sp.pos.x, sp.pos.y - 1.6, sp.pos.z );

			}

			r.slowmo = res.slowmo;
			this.camera.position.set( 0, 0, 0 );

		} else {

			const res = r.updateCamera( this.camera, dt, this.cockpit.eye );
			this.menus.updateReplay( r.time, r.duration, r.playing, r.slowmo, res.mode );

		}

		this.fx.beginFrame();
		if ( scale > 0 ) for ( const c of r.cars ) this.fx.emitForCar( c, dt * scale );
		this.fx.endFrame();
		this.camera.getWorldPosition( _v );
		const focus = r.cars[ r.focus ];
		this.petals.update( _v, r.cars.map( ( c ) => ( { x: c.physics.x, y: c.physics.y, z: c.physics.z, vx: c.physics.vx, vz: c.physics.vz, drift: c.telemetry.drift } ) ) );
		this.world.update( dt, _v, this.camera.far );
		this._listener( this.camera );
		this.carAudio?.forEach( ( a ) => a.update( dt * scale, _v.clone(), scale ) );
		this.vignette.update( dt, 0, 0, 0, false );
		this.rs.render( this.scene, this.camera, focus.telemetry.drift * 0.6 );

	}

	_listener( cam ) {

		if ( ! audio.ready ) return;
		// In XR the user camera holds the head pose relative to its parent rig
		// (the XR camera's own matrixWorld would be rebuilt without the rig).
		const c = cam;
		c.getWorldPosition( _v );
		c.getWorldQuaternion( _q );
		_f.set( 0, 0, - 1 ).applyQuaternion( _q );
		_u.set( 0, 1, 0 ).applyQuaternion( _q );
		audio.setListener( _v, _f, _u );

	}

}

export { progress };
