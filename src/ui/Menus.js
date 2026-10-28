import { settings, setSetting, resetSettings, progress } from '../core/settings.js';
import { PRESETS } from '../core/quality.js';
import { CARS, CAR_IDS } from '../vehicle/carSpecs.js';
import { carStats } from '../modes/Garage.js';
import { fmtTime } from './HUD.js';
import { KMH, MPH } from '../core/math.js';

const LOGO = `<div class="logo" aria-label="Touge Sakura — Initial Drift">
	<div class="burst"></div>
	<span class="line1">Touge</span><span class="line2">Sakura</span>
	<span class="tag">Initial Drift <span class="jp">峠・桜</span></span>
</div>`;

const h = ( html ) => {

	const t = document.createElement( 'template' );
	t.innerHTML = html.trim();
	return t.content.firstElementChild;

};

// DOM menus. All interactive elements are real <button>/<input>s so they are
// keyboard/gamepad-focusable, screen-reader labelled and touch friendly.
export class Menus {

	constructor( root, handlers ) {

		this.root = root;
		this.on = handlers; // callbacks into Game
		this.panels = {};
		this._loading();
		this._garage();
		this._settings();
		this._pause();
		this._results();
		this._replay();
		this._help();
		this._staging();
		this._confirm();
		this._fullscreen();

	}

	// Fullscreen toggle (top centre, every screen). Also on the F key. On phones
	// it locks to landscape when the browser allows. Hidden where the
	// Fullscreen API is missing (e.g. iPhone Safari - use Add to Home Screen).
	_fullscreen() {

		const de = document.documentElement;
		const req = de.requestFullscreen || de.webkitRequestFullscreen;
		if ( ! req ) return;
		const el = h( `<button class="fs-btn" aria-label="Toggle fullscreen" title="Fullscreen (F)">⛶</button>` );
		this.root.appendChild( el );
		const isFs = () => !! ( document.fullscreenElement || document.webkitFullscreenElement );
		const toggle = this.toggleFullscreen = async () => {

			try {

				if ( isFs() ) await ( document.exitFullscreen || document.webkitExitFullscreen ).call( document );
				else {

					await req.call( de, { navigationUI: 'hide' } );
					await screen.orientation?.lock?.( 'landscape' ).catch( () => {} );

				}

			} catch ( e ) {

				console.warn( 'fullscreen unavailable', e );

			}

		};

		el.addEventListener( 'click', ( e ) => {

			e.stopPropagation(); toggle(); el.blur();

		} );
		window.addEventListener( 'keydown', ( e ) => {

			if ( e.code === 'KeyF' && ! e.repeat && e.target.tagName !== 'INPUT' ) toggle();

		} );
		const sync = () => el.classList.toggle( 'on', isFs() );
		document.addEventListener( 'fullscreenchange', sync );
		document.addEventListener( 'webkitfullscreenchange', sync );

	}

	show( name, v = true ) {

		const p = this.panels[ name ];
		if ( ! p ) return;
		p.classList.toggle( 'open', v );
		p.setAttribute( 'aria-hidden', v ? 'false' : 'true' );
		if ( v ) {

			const f = p.querySelector( '[autofocus], .primary, button' );
			setTimeout( () => f?.focus( { preventScroll: true } ), 30 );

		}

	}

	hideAll() {

		for ( const k of Object.keys( this.panels ) ) if ( k !== 'loading' ) this.show( k, false );

	}

	isOpen( name ) {

		return this.panels[ name ]?.classList.contains( 'open' );

	}

	// Topmost open panel (dialogs stack over the screen panels).
	top() {

		for ( const n of [ 'confirm', 'settings', 'help', 'pause', 'results', 'garage', 'title', 'staging', 'replay' ] ) {

			if ( this.isOpen( n ) ) return n;

		}

		return null;

	}

	// Gamepad / d-pad focus movement through the top panel's controls.
	nav( dir ) {

		const name = this.top();
		if ( ! name ) return false;
		const items = [ ...this.panels[ name ].querySelectorAll( 'button, select, input' ) ].filter( ( b ) => ! b.disabled && b.offsetParent !== null );
		if ( ! items.length ) return false;
		const i = items.indexOf( document.activeElement );
		const n = i < 0 ? 0 : ( i + dir + items.length ) % items.length;
		items[ n ].focus( { preventScroll: false } );
		return true;

	}

	activate() {

		const el = document.activeElement;
		if ( ! el || ! this.top() || ! this.root.contains( el ) ) return false;
		if ( el.tagName === 'BUTTON' ) el.click();
		else if ( el.tagName === 'INPUT' && el.type === 'checkbox' ) el.click();
		return true;

	}

	// Gamepad B / Escape: close the top dialog or step back a screen.
	back() {

		const name = this.top();
		if ( name === 'confirm' ) {

			this.show( name, false ); return true;

		}

		if ( name === 'settings' || name === 'help' ) {

			this.closePage(); return true;

		}

		if ( name === 'garage' ) {

			this.on.back(); return true;

		}

		return false;

	}

	// ---------------------------------------------------------------- loading
	_loading() {

		const el = h( `<div class="panel loading open" role="dialog" aria-label="Loading">
			${LOGO}
			<div class="bar"><div class="fill"></div></div>
			<div class="msg">Preparing the mountain…</div>
			<div class="tip"></div>
		</div>` );
		this.root.appendChild( el );
		this.panels.loading = el;
		const tips = [
			'Tap the handbrake just before a hairpin to rotate the car, then feed in throttle.',
			'Hook your inside tyres in the gutter for extra grip in tight corners.',
			'Watch the water in your cup holder — it shows weight transfer.',
			'Chain drifts without touching the guardrail to build your multiplier up to x5.',
			'In VR, grab the wheel with both grips. Let it slide through your hands to countersteer.'
		];
		el.querySelector( '.tip' ).textContent = 'TIP: ' + tips[ ( Math.random() * tips.length ) | 0 ];
		this._title();

	}

	_title() {

		const el = h( `<div class="panel title" role="dialog" aria-label="Main menu">
			${LOGO}
			<nav class="menu" aria-label="Main menu">
				<button class="sel" data-act="battle">Downhill Touge</button>
				<button data-act="showroom">Garage Showroom <small>(3D)</small></button>
				<button data-act="timeattack">Time Attack</button>
				<button data-act="vr">WebXR / VR Mode <small>(Quest 3)</small></button>
				<button data-act="settings">Settings</button>
			</nav>
			<div class="note"></div>
			<div class="foot">🎮 / ⌨ TO NAVIGATE • CLICK / TRIGGER TO START</div>
		</div>` );
		this.root.appendChild( el );
		this.panels.title = el;
		const buttons = [ ...el.querySelectorAll( '.menu button' ) ];
		buttons.forEach( ( b ) => {

			b.addEventListener( 'click', () => this.on.titleAction( b.dataset.act ) );
			b.addEventListener( 'mouseenter', () => b.focus() );
			b.addEventListener( 'focus', () => buttons.forEach( ( x ) => x.classList.toggle( 'sel', x === b ) ) );

		} );
		// arrow keys / d-pad move the selection
		el.addEventListener( 'keydown', ( e ) => {

			const i = buttons.indexOf( document.activeElement );
			if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {

				e.preventDefault();
				const n = ( i + ( e.key === 'ArrowDown' ? 1 : - 1 ) + buttons.length ) % buttons.length;
				buttons[ n ].focus();

			}

		} );

	}

	setProgress( p, msg ) {

		const el = this.panels.loading;
		el.querySelector( '.fill' ).style.width = `${Math.round( p * 100 )}%`;
		if ( msg ) el.querySelector( '.msg' ).textContent = msg;

	}

	loadingDone( vrSupported, deviceText ) {

		this.show( 'loading', false );
		const t = this.panels.title;
		const vr = t.querySelector( '[data-act="vr"]' );
		vr.disabled = ! vrSupported;
		vr.title = vrSupported ? 'Enter immersive VR' : 'Open this page in the Meta Quest Browser to race in VR';
		t.querySelector( '.note' ).textContent = deviceText;
		this.show( 'title' );

	}

	loadingError( text ) {

		const el = this.panels.loading;
		el.querySelector( '.msg' ).textContent = text;
		el.classList.add( 'error' );

	}

	// ---------------------------------------------------------------- garage
	_garage() {

		const el = h( `<div class="panel garage" role="dialog" aria-label="Garage and vehicle select">
			<div class="g-col">
				<h1 class="h-display g-title">Garage / Vehicle Select</h1>
				<div class="rule"></div>
				<h2 class="h-display g-sec">Car List</h2>
				<div class="g-cars" role="radiogroup" aria-label="Car list"></div>
				<p class="g-blurb"></p>
				<h2 class="h-display g-sec">Customize</h2>
				<div class="g-row"><button class="liv-btn sel" aria-pressed="true">Liveries</button><button class="parts-btn" aria-pressed="false">Parts</button></div>
				<div class="g-liveries" role="radiogroup" aria-label="Livery"></div>
				<div class="g-wear" hidden><div class="wear-grid"></div><button class="small replace">Fit new tyres</button></div>
				<div class="toggle-line"><span class="hl-lbl">Pop-up headlights:</span>
					<button class="switch popups" aria-pressed="false" aria-label="Pop-up headlights"><span class="on-l">On</span><span class="off-l on">Off</span></button>
				</div>
				<h2 class="h-display g-sec">Car Specs</h2>
				<div class="specs"></div>
				<div class="g-best"></div>
			</div>
			<div class="g-360" aria-hidden="true"><span class="arc">⟲</span><span>360°<small> VIEW</small></span><span class="arc">⟳</span></div>
			<div class="g-hint">Drag / triggers / click to rotate the 3D car</div>
			<div class="g-foot">
				<button class="back">Back</button><span class="lbl">Return to main menu</span>
				<button class="primary drive">Select</button><span class="lbl confirm-lbl">Confirm vehicle</span>
			</div>
		</div>` );
		this.root.appendChild( el );
		this.panels.garage = el;
		// Liveries / Parts act as two tabs over the same slot
		const tab = ( parts ) => {

			el.querySelector( '.liv-btn' ).classList.toggle( 'sel', ! parts );
			el.querySelector( '.parts-btn' ).classList.toggle( 'sel', parts );
			el.querySelector( '.liv-btn' ).setAttribute( 'aria-pressed', String( ! parts ) );
			el.querySelector( '.parts-btn' ).setAttribute( 'aria-pressed', String( parts ) );
			el.querySelector( '.g-liveries' ).hidden = parts;
			el.querySelector( '.g-wear' ).hidden = ! parts;
			this.on.inspect( parts );
			this.refreshWear();

		};

		this._garageTab = tab;
		el.querySelector( '.liv-btn' ).addEventListener( 'click', () => tab( false ) );
		el.querySelector( '.parts-btn' ).addEventListener( 'click', () => tab( true ) );
		el.querySelector( '.popups' ).addEventListener( 'click', ( e ) => {

			const on = this.on.togglePopups();
			this._syncPopups( on );

		} );
		el.querySelector( '.replace' ).addEventListener( 'click', () => {

			this.on.replaceTires(); this.refreshWear();

		} );
		el.querySelector( '.drive' ).addEventListener( 'click', () => this.on.drive() );
		el.querySelector( '.back' ).addEventListener( 'click', () => this.on.back() );

	}

	_syncPopups( on ) {

		const b = this.panels.garage.querySelector( '.popups' );
		b.setAttribute( 'aria-pressed', String( on ) );
		b.querySelector( '.on-l' ).classList.toggle( 'on', on );
		b.querySelector( '.off-l' ).classList.toggle( 'on', ! on );

	}

	refreshGarage( mode, headlightsOn ) {

		const el = this.panels.garage;
		if ( mode ) {

			this.garageMode = mode;
			this._garageTab( false );

		}

		const id = settings.car, c = CARS[ id ];
		el.querySelector( '.hl-lbl' ).textContent = c.popup ? 'Pop-up headlights:' : 'Headlights:';
		if ( headlightsOn != null ) this._syncPopups( headlightsOn );
		const cars = el.querySelector( '.g-cars' );
		cars.innerHTML = '';
		for ( const cid of CAR_IDS ) {

			const cc = CARS[ cid ];
			const b = h( `<button role="radio" class="${cid === id ? 'sel' : ''}" aria-checked="${cid === id}">${cc.make} ${cc.model}</button>` );
			b.addEventListener( 'click', () => {

				this.on.selectCar( cid ); this.refreshGarage();

			} );
			cars.appendChild( b );

		}

		el.querySelector( '.g-blurb' ).textContent = c.blurb;
		const lv = el.querySelector( '.g-liveries' );
		lv.innerHTML = '';
		c.liveries.forEach( ( l, i ) => {

			const b = h( `<button role="radio" aria-checked="${( settings.livery[ id ] ?? 0 ) === i}" title="${l.desc}">${l.name}</button>` );
			b.addEventListener( 'click', () => {

				this.on.setLivery( i ); this.refreshGarage();

			} );
			lv.appendChild( b );

		} );
		const st = carStats( id );
		const bars = [ [ '⚡', 'Power', st.powerBar ], [ '⚖', 'Weight', st.weightBar ], [ '🌀', 'Drift', st.driftBar ], [ '◎', 'Grip', st.gripBar ] ];
		el.querySelector( '.specs' ).innerHTML = bars.map( ( [ i, n, v ] ) => `<span class="ico">${i}</span><span>${n}</span><div class="bar" role="meter" aria-label="${n}" aria-valuenow="${Math.round( v * 100 )}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round( v * 100 )}%"></div></div>` ).join( '' );
		const best = progress.bestTimes[ id ];
		const modeName = { battle: 'Downhill battle vs rival', timeattack: 'Time attack', showroom: 'Showroom' }[ this.garageMode || 'battle' ];
		el.querySelector( '.g-best' ).textContent = `${modeName}${best ? ` · best ${fmtTime( best )}` : ''} · ${st.power} hp · ${st.mass} kg`;
		el.querySelector( '.confirm-lbl' ).textContent = this.garageMode === 'showroom' ? 'Race this car' : 'Confirm vehicle';
		this.refreshWear();

	}

	refreshWear() {

		const w = progress.tireWear[ settings.car ] || [ 0, 0, 0, 0 ];
		const names = [ 'Front L', 'Front R', 'Rear L', 'Rear R' ];
		this.panels.garage.querySelector( '.wear-grid' ).innerHTML = w.map( ( v, i ) => `
			<div class="wear"><span>${names[ i ]}</span><div class="wbar"><div style="width:${Math.round( ( 1 - v ) * 100 )}%;background:${v > 0.6 ? '#ff3b3b' : v > 0.3 ? '#ffd23f' : '#7dffa6'}"></div></div><b>${Math.round( ( 1 - v ) * 100 )}%</b></div>` ).join( '' );

	}

	// ---------------------------------------------------------------- staging
	_staging() {

		const el = h( `<div class="panel staging" aria-live="polite">
			<div class="st-title">Summit staging</div>
			<div class="st-msg">Rev it up. Press <kbd>Enter</kbd> / <kbd>Gas</kbd> to start the countdown.</div>
			<button class="primary ready">Ready</button>
		</div>` );
		this.root.appendChild( el );
		this.panels.staging = el;
		el.querySelector( '.ready' ).addEventListener( 'click', () => this.on.ready() );

	}

	// ---------------------------------------------------------------- pause
	_pause() {

		const el = h( `<div class="panel pause" role="dialog" aria-label="Paused">
			<h2>Paused</h2>
			<button class="primary resume">Resume</button>
			<button class="restart">Restart run</button>
			<button class="cam">Switch camera (C)</button>
			<button class="recenter">Recenter VR view</button>
			<button class="settings-btn">Settings</button>
			<button class="help-btn">Controls</button>
			<button class="quit">Quit to garage</button>
		</div>` );
		this.root.appendChild( el );
		this.panels.pause = el;
		el.querySelector( '.resume' ).addEventListener( 'click', () => this.on.resume() );
		el.querySelector( '.restart' ).addEventListener( 'click', () => this.confirm( 'Restart this run from the summit?', () => this.on.restart() ) );
		el.querySelector( '.cam' ).addEventListener( 'click', () => this.on.camera() );
		el.querySelector( '.recenter' ).addEventListener( 'click', () => this.on.recenter() );
		el.querySelector( '.settings-btn' ).addEventListener( 'click', () => this.openSettings() );
		el.querySelector( '.help-btn' ).addEventListener( 'click', () => this.openPage( 'help' ) );
		el.querySelector( '.quit' ).addEventListener( 'click', () => this.confirm( 'Quit to the garage? This run will be lost.', () => this.on.quit() ) );

	}

	_confirm() {

		const el = h( `<div class="panel confirm" role="alertdialog" aria-label="Confirm">
			<p class="c-msg"></p>
			<div class="g-row"><button class="primary yes">Yes</button><button class="no">Cancel</button></div>
		</div>` );
		this.root.appendChild( el );
		this.panels.confirm = el;
		el.querySelector( '.no' ).addEventListener( 'click', () => this.show( 'confirm', false ) );
		el.querySelector( '.yes' ).addEventListener( 'click', () => {

			this.show( 'confirm', false ); this._confirmFn?.();

		} );

	}

	confirm( msg, fn ) {

		this.panels.confirm.querySelector( '.c-msg' ).textContent = msg;
		this._confirmFn = fn;
		this.show( 'confirm' );

	}

	// ---------------------------------------------------------------- results
	_results() {

		const el = h( `<div class="panel results" role="dialog" aria-label="Results">
			<div class="r-badge"></div>
			<h2 class="r-title"></h2>
			<dl class="r-stats"></dl>
			<div class="g-row">
				<button class="primary replay">Watch replay</button>
				<button class="again">Race again</button>
				<button class="garage-btn">Garage</button>
			</div>
		</div>` );
		this.root.appendChild( el );
		this.panels.results = el;
		el.querySelector( '.replay' ).addEventListener( 'click', () => this.on.replay() );
		el.querySelector( '.again' ).addEventListener( 'click', () => this.on.restart() );
		el.querySelector( '.garage-btn' ).addEventListener( 'click', () => this.on.quit() );

	}

	showResults( r ) {

		const el = this.panels.results;
		const unit = settings.units === 'mph' ? MPH : KMH;
		el.querySelector( '.r-badge' ).textContent = r.mode === 'battle' ? ( r.won ? '勝利' : '敗北' ) : 'タイム';
		el.querySelector( '.r-badge' ).className = 'r-badge ' + ( r.mode === 'battle' ? ( r.won ? 'win' : 'lose' ) : 'ta' );
		el.querySelector( '.r-title' ).textContent = r.mode === 'battle' ? ( r.won ? 'You took the downhill!' : 'Lost the battle — so close.' ) : 'Time attack complete';
		const gap = r.rivalTime && r.time ? r.time - r.rivalTime : null;
		el.querySelector( '.r-stats' ).innerHTML = `
			<dt>Your time</dt><dd>${fmtTime( r.time )}${r.newRecord ? ' <em>NEW RECORD</em>' : ''}</dd>
			${r.rivalTime ? `<dt>Rival</dt><dd>${fmtTime( r.rivalTime )} (${gap >= 0 ? '+' : '−'}${Math.abs( gap ).toFixed( 2 )}s)</dd>` : ''}
			<dt>Best</dt><dd>${fmtTime( r.best )}</dd>
			<dt>Top speed</dt><dd>${Math.round( r.topSpeed * unit )} ${settings.units === 'mph' ? 'mph' : 'km/h'}</dd>
			<dt>Drift time</dt><dd>${r.driftTime.toFixed( 1 )} s · max ${Math.round( r.maxDrift * 57.3 )}°</dd>
			<dt>Drift score</dt><dd>${( r.driftScore || 0 ).toLocaleString( 'en-US' )} pts</dd>
			<dt>Gutter hooks</dt><dd>${r.hooks}</dd>
			<dt>Wall contacts</dt><dd>${r.wallHits}</dd>`;
		this.show( 'results' );

	}

	// ---------------------------------------------------------------- replay
	_replay() {

		const el = h( `<div class="panel replaybar" role="toolbar" aria-label="Replay controls">
			<button class="icon play" aria-label="Play/pause">❚❚</button>
			<input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Timeline">
			<span class="r-time">0:00</span>
			<div class="seg speed">${[ 0.25, 0.5, 1, 2 ].map( ( s ) => `<button data-v="${s}" aria-checked="${s === 1}">${s}×</button>` ).join( '' )}</div>
			<div class="seg cams">${[ [ 'director', 'Auto' ], [ 'drone', 'Drone' ], [ 'spotter', 'Roadside' ], [ 'chase', 'Chase' ], [ 'onboard', 'Onboard' ] ].map( ( [ v, l ] ) => `<button data-v="${v}" aria-checked="${v === 'director'}">${l}</button>` ).join( '' )}</div>
			<button class="focus">Focus: You</button>
			<span class="slowmo">SLOW-MO</span>
			<button class="exit">Exit replay</button>
		</div>` );
		this.root.appendChild( el );
		this.panels.replay = el;
		el.querySelector( '.play' ).addEventListener( 'click', () => this.on.replayCmd( 'toggle' ) );
		el.querySelector( '.scrub' ).addEventListener( 'input', ( e ) => this.on.replayCmd( 'seek', +e.target.value / 1000 ) );
		el.querySelectorAll( '.speed button' ).forEach( ( b ) => b.addEventListener( 'click', () => {

			el.querySelectorAll( '.speed button' ).forEach( ( x ) => x.setAttribute( 'aria-checked', String( x === b ) ) );
			this.on.replayCmd( 'speed', +b.dataset.v );

		} ) );
		el.querySelectorAll( '.cams button' ).forEach( ( b ) => b.addEventListener( 'click', () => {

			el.querySelectorAll( '.cams button' ).forEach( ( x ) => x.setAttribute( 'aria-checked', String( x === b ) ) );
			this.on.replayCmd( 'cam', b.dataset.v );

		} ) );
		el.querySelector( '.focus' ).addEventListener( 'click', ( e ) => {

			const f = this.on.replayCmd( 'focus' );
			e.currentTarget.textContent = f === 0 ? 'Focus: You' : 'Focus: Rival';

		} );
		el.querySelector( '.exit' ).addEventListener( 'click', () => this.on.replayCmd( 'exit' ) );

	}

	updateReplay( t, dur, playing, slow, mode ) {

		const el = this.panels.replay;
		if ( ! el.classList.contains( 'open' ) ) return;
		const sc = el.querySelector( '.scrub' );
		if ( document.activeElement !== sc ) sc.value = dur > 0 ? Math.round( t / dur * 1000 ) : 0;
		el.querySelector( '.r-time' ).textContent = `${fmtTime( t ).slice( 0, - 3 )} / ${fmtTime( dur ).slice( 0, - 3 )}`;
		el.querySelector( '.play' ).textContent = playing ? '❚❚' : '▶';
		el.querySelector( '.slowmo' ).classList.toggle( 'on', slow < 0.8 );
		el.dataset.mode = mode;

	}

	// ---------------------------------------------------------------- help
	_help() {

		const el = h( `<div class="panel help" role="dialog" aria-label="Controls">
			<h2>Controls</h2>
			<div class="help-grid">
				<section><h3>Keyboard</h3><table>
					<tr><td>W / ↑</td><td>Throttle</td></tr><tr><td>S / ↓</td><td>Brake · hold to reverse</td></tr>
					<tr><td>A D / ← →</td><td>Steer</td></tr><tr><td>Space</td><td>Handbrake</td></tr>
					<tr><td>E / Q</td><td>Shift up / down (manual)</td></tr><tr><td>C</td><td>Cockpit ⇄ chase camera</td></tr>
					<tr><td>H</td><td>Pop-up headlights</td></tr><tr><td>U</td><td>Cycle HUD mode</td></tr>
					<tr><td>L</td><td>Look back</td></tr><tr><td>F</td><td>Fullscreen</td></tr><tr><td>R</td><td>Reset car to road</td></tr><tr><td>Esc / P</td><td>Pause</td></tr>
				</table></section>
				<section><h3>Gamepad</h3><table>
					<tr><td>Left stick</td><td>Steer</td></tr><tr><td>RT / LT</td><td>Throttle / brake</td></tr>
					<tr><td>A</td><td>Handbrake</td></tr><tr><td>RB / LB</td><td>Shift up / down</td></tr>
					<tr><td>Y</td><td>Camera</td></tr><tr><td>D-pad ↑</td><td>Headlights</td></tr><tr><td>X</td><td>Reset car</td></tr><tr><td>Start</td><td>Pause</td></tr>
				</table></section>
				<section><h3>Meta Quest (Touch Plus)</h3><table>
					<tr><td>Grip on wheel rim</td><td>Grab &amp; steer (one or two hands)</td></tr>
					<tr><td>Right / left trigger</td><td>Throttle / brake</td></tr>
					<tr><td>Grip lever, pull up</td><td>Handbrake (or hold B)</td></tr>
					<tr><td>Grip shifter, push/pull</td><td>Sequential (or H-pattern) · slap to shift</td></tr>
					<tr><td>A / X</td><td>Shift up / down</td></tr><tr><td>Touch dash switches</td><td>Pop-ups · hazards · HUD</td></tr>
					<tr><td>Tap the phone</td><td>Cycle GPS view</td></tr><tr><td>Y</td><td>Pause · L-stick click: recenter</td></tr>
				</table></section>
				<section><h3>Touch</h3><table>
					<tr><td>Left pad</td><td>Drag to steer (or TILT)</td></tr><tr><td>GAS / BRAKE</td><td>Pedals</td></tr>
					<tr><td>HB</td><td>Handbrake</td></tr><tr><td>+ / −</td><td>Shift</td></tr>
				</table></section>
			</div>
			<button class="primary close">Back</button>
		</div>` );
		this.root.appendChild( el );
		this.panels.help = el;
		el.querySelector( '.close' ).addEventListener( 'click', () => this.closePage() );

	}

	// ---------------------------------------------------------------- settings
	_settings() {

		const el = h( `<div class="panel settings" role="dialog" aria-label="Settings">
			<h2>Settings</h2>
			<div class="tabs" role="tablist">
				<button role="tab" data-tab="gfx" aria-selected="true">Graphics</button>
				<button role="tab" data-tab="drive">Driving</button>
				<button role="tab" data-tab="hud">HUD &amp; comfort</button>
				<button role="tab" data-tab="audio">Audio</button>
				<button role="tab" data-tab="vr">VR</button>
			</div>
			<div class="tabpanes"></div>
			<div class="g-row"><button class="primary close">Back</button><button class="reset">Reset to defaults</button></div>
		</div>` );
		this.root.appendChild( el );
		this.panels.settings = el;
		const presetOpts = [ [ 'auto', 'Auto-detect' ], ...Object.entries( PRESETS ).map( ( [ k, v ] ) => [ k, v.name ] ) ];
		const schema = {
			gfx: [
				[ 'select', 'preset', 'Quality preset', presetOpts, 'Applies after reloading the mountain' ],
				[ 'range', 'resolutionScale', 'Resolution scale', [ 0.5, 1.5, 0.05 ] ],
				[ 'check', 'adaptiveResolution', 'Adaptive resolution (keeps frame rate)' ],
				[ 'check', 'showDebug', 'Show FPS / draw calls' ]
			],
			drive: [
				[ 'select', 'transmission', 'Transmission', [ [ 'auto', 'Automatic' ], [ 'manual', 'Manual (E/Q, paddles)' ] ] ],
				[ 'range', 'steeringAssist', 'Countersteer assist', [ 0, 1, 0.05 ] ],
				[ 'range', 'rivalDifficulty', 'Rival skill', [ 0.3, 1, 0.05 ] ],
				[ 'select', 'camera', 'Default camera', [ [ 'cockpit', 'First-person cockpit' ], [ 'chase', 'Third-person chase' ] ] ],
				[ 'select', 'units', 'Speed units', [ [ 'kmh', 'km/h' ], [ 'mph', 'mph' ] ] ],
				[ 'check', 'cameraShake', 'Camera shake' ]
			],
			hud: [
				[ 'select', 'hudMode', 'HUD mode', [ [ 'auto', 'Arcade (compact in cockpit)' ], [ 'diegetic', 'Diegetic only in cockpit / VR' ], [ 'windshield', 'Project on windshield' ], [ 'slate', 'Floating slate (VR) / overlay' ], [ 'off', 'Off' ] ] ],
				[ 'check', 'captions', 'Closed captions [CC] for radio' ],
				[ 'select', 'captionSize', 'Caption size', [ [ 'small', 'Small' ], [ 'medium', 'Medium' ], [ 'large', 'Large' ] ] ],
				[ 'select', 'vignette', 'Comfort vignette', [ [ 'off', 'Off' ], [ 'auto', 'VR only' ], [ 'always', 'Always' ] ] ],
				[ 'range', 'vignetteStrength', 'Vignette strength', [ 0.2, 1, 0.05 ] ]
			],
			audio: [
				[ 'range', 'masterVolume', 'Master', [ 0, 1, 0.05 ] ],
				[ 'range', 'engineVolume', 'Engine', [ 0, 1, 0.05 ] ],
				[ 'range', 'sfxVolume', 'Effects', [ 0, 1, 0.05 ] ],
				[ 'range', 'radioVolume', 'Spotter radio', [ 0, 1, 0.05 ] ],
				[ 'range', 'ambienceVolume', 'Ambience', [ 0, 1, 0.05 ] ]
			],
			vr: [
				[ 'select', 'vrShifter', 'Shifter', [ [ 'sequential', 'Sequential (pull = up)' ], [ 'hpattern', 'H-pattern' ] ] ],
				[ 'range', 'vrSteerRatio', 'Wheel ratio (quicker →)', [ 0.6, 2, 0.05 ] ],
				[ 'check', 'haptics', 'Controller haptics' ]
			]
		};
		const panes = el.querySelector( '.tabpanes' );
		this._controls = [];
		for ( const [ tab, rows ] of Object.entries( schema ) ) {

			const pane = h( `<div class="pane" data-pane="${tab}" ${tab !== 'gfx' ? 'hidden' : ''}></div>` );
			for ( const [ type, key, label, opts, note ] of rows ) {

				let row;
				if ( type === 'select' ) {

					row = h( `<label class="row"><span>${label}</span><select>${opts.map( ( [ v, l ] ) => `<option value="${v}">${l}</option>` ).join( '' )}</select></label>` );
					const s = row.querySelector( 'select' );
					s.addEventListener( 'change', () => {

						setSetting( key, s.value ); this.on.settingChanged?.( key );

					} );
					this._controls.push( () => ( s.value = settings[ key ] ) );

				} else if ( type === 'range' ) {

					row = h( `<label class="row"><span>${label}</span><input type="range" min="${opts[ 0 ]}" max="${opts[ 1 ]}" step="${opts[ 2 ]}"><output></output></label>` );
					const r = row.querySelector( 'input' ), o = row.querySelector( 'output' );
					r.addEventListener( 'input', () => {

						setSetting( key, +r.value ); o.textContent = ( +r.value ).toFixed( 2 ); this.on.settingChanged?.( key );

					} );
					this._controls.push( () => {

						r.value = settings[ key ]; o.textContent = ( +settings[ key ] ).toFixed( 2 );

					} );

				} else {

					row = h( `<label class="row check"><input type="checkbox"><span>${label}</span></label>` );
					const c = row.querySelector( 'input' );
					c.addEventListener( 'change', () => {

						setSetting( key, c.checked ); this.on.settingChanged?.( key );

					} );
					this._controls.push( () => ( c.checked = !! settings[ key ] ) );

				}

				if ( note ) row.appendChild( h( `<small>${note}</small>` ) );
				pane.appendChild( row );

			}

			panes.appendChild( pane );

		}

		el.querySelectorAll( '.tabs button' ).forEach( ( b ) => b.addEventListener( 'click', () => {

			el.querySelectorAll( '.tabs button' ).forEach( ( x ) => x.setAttribute( 'aria-selected', String( x === b ) ) );
			el.querySelectorAll( '.pane' ).forEach( ( p ) => ( p.hidden = p.dataset.pane !== b.dataset.tab ) );

		} ) );
		el.querySelector( '.close' ).addEventListener( 'click', () => this.closePage() );
		el.querySelector( '.reset' ).addEventListener( 'click', () => this.confirm( 'Reset all settings to defaults?', () => {

			resetSettings(); this._syncSettings(); this.on.settingChanged?.( '*' );

		} ) );

	}

	_syncSettings() {

		for ( const f of this._controls ) f();

	}

	openSettings() {

		this._syncSettings();
		this.openPage( 'settings' );

	}

	// One panel at a time: a sub-page (settings, controls) replaces the panel
	// it was opened from (pause or title) and Back returns to it.
	openPage( name ) {

		const from = [ 'pause', 'title', 'results' ].find( ( n ) => this.isOpen( n ) ) ?? null;
		if ( this.page && this.page !== name ) this.show( this.page, false );
		this.page = name;
		this.pageFrom = from ?? this.pageFrom;
		if ( from ) this.show( from, false );
		this.show( name );

	}

	closePage() {

		if ( ! this.page ) return;
		this.show( this.page, false );
		const from = this.pageFrom;
		this.page = null; this.pageFrom = null;
		if ( from && this.on.pageReturn?.( from ) !== false ) this.show( from );

	}

	closeAllPages() {

		if ( this.page ) this.show( this.page, false );
		this.page = null; this.pageFrom = null;

	}

}
