import { settings, setSetting, resetSettings, progress } from '../core/settings.js';
import { PRESETS } from '../core/quality.js';
import { CARS } from '../vehicle/carSpecs.js';
import { carStats } from '../modes/Garage.js';
import { fmtTime } from './HUD.js';
import { KMH, MPH } from '../core/math.js';

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

	// ---------------------------------------------------------------- loading
	_loading() {

		const el = h( `<div class="panel loading open" role="dialog" aria-label="Loading">
			<div class="logo"><span class="kanji">峠</span><div><div class="title">TOUGE</div><div class="sub">Sakura Downhill</div></div></div>
			<div class="bar"><div class="fill"></div></div>
			<div class="msg">Preparing the mountain…</div>
			<div class="tip"></div>
			<div class="start-row">
				<button class="primary start-btn" hidden>Start</button>
				<button class="vr-btn" hidden>Enter VR</button>
			</div>
			<div class="device-note"></div>
		</div>` );
		this.root.appendChild( el );
		this.panels.loading = el;
		const tips = [
			'Tap the handbrake just before a hairpin to rotate the car, then feed in throttle.',
			'Hook your inside tyres in the gutter for extra grip in tight corners.',
			'Watch the water in your cup holder — it shows weight transfer.',
			'Glance at your mirrors: the rival is often closer than you think.',
			'In VR, grab the wheel with both grips. Let it slide through your hands to countersteer.'
		];
		el.querySelector( '.tip' ).textContent = 'Tip: ' + tips[ ( Math.random() * tips.length ) | 0 ];
		el.querySelector( '.start-btn' ).addEventListener( 'click', () => this.on.start() );
		el.querySelector( '.vr-btn' ).addEventListener( 'click', () => this.on.enterVR() );

	}

	setProgress( p, msg ) {

		const el = this.panels.loading;
		el.querySelector( '.fill' ).style.width = `${Math.round( p * 100 )}%`;
		if ( msg ) el.querySelector( '.msg' ).textContent = msg;

	}

	loadingDone( vrSupported, deviceText ) {

		const el = this.panels.loading;
		el.querySelector( '.msg' ).textContent = 'Ready. Headlights up.';
		const b = el.querySelector( '.start-btn' );
		b.hidden = false;
		b.focus();
		el.querySelector( '.vr-btn' ).hidden = ! vrSupported;
		el.querySelector( '.device-note' ).textContent = deviceText;

	}

	loadingError( text ) {

		const el = this.panels.loading;
		el.querySelector( '.msg' ).textContent = text;
		el.classList.add( 'error' );

	}

	// ---------------------------------------------------------------- garage
	_garage() {

		const el = h( `<div class="panel garage" role="dialog" aria-label="Garage">
			<div class="g-left">
				<div class="g-head">
					<button class="icon prev" aria-label="Previous car">‹</button>
					<div class="g-name"><div class="g-code"></div><div class="g-title"></div></div>
					<button class="icon next" aria-label="Next car">›</button>
				</div>
				<p class="g-blurb"></p>
				<dl class="g-stats"></dl>
				<div class="g-label">Livery</div>
				<div class="g-liveries" role="radiogroup" aria-label="Livery"></div>
				<div class="g-row">
					<button class="toggle popups" aria-pressed="false">Pop-up lights</button>
					<button class="toggle inspect" aria-pressed="false">Inspect tyres</button>
				</div>
				<div class="g-wear" hidden>
					<div class="wear-grid"></div>
					<button class="small replace">Fit new tyres</button>
				</div>
			</div>
			<div class="g-right">
				<div class="g-label">Mode</div>
				<div class="seg mode" role="radiogroup" aria-label="Race mode">
					<button data-v="battle" role="radio">Battle</button>
					<button data-v="timeattack" role="radio">Time attack</button>
				</div>
				<label class="g-diff">Rival skill <input type="range" min="0.3" max="1" step="0.05" aria-label="Rival skill"></label>
				<div class="g-best"></div>
				<button class="primary drive">Drive to the summit ▸</button>
				<div class="g-row">
					<button class="settings-btn">Settings</button>
					<button class="help-btn">Controls</button>
					<button class="vr-btn" hidden>Enter VR</button>
				</div>
				<div class="g-hint">Drag / pinch to orbit the car · Enter to drive</div>
			</div>
		</div>` );
		this.root.appendChild( el );
		this.panels.garage = el;
		el.querySelector( '.prev' ).addEventListener( 'click', () => this.on.nextCar( - 1 ) );
		el.querySelector( '.next' ).addEventListener( 'click', () => this.on.nextCar( 1 ) );
		el.querySelector( '.popups' ).addEventListener( 'click', ( e ) => e.currentTarget.setAttribute( 'aria-pressed', String( this.on.togglePopups() ) ) );
		el.querySelector( '.inspect' ).addEventListener( 'click', ( e ) => {

			const on = e.currentTarget.getAttribute( 'aria-pressed' ) !== 'true';
			e.currentTarget.setAttribute( 'aria-pressed', String( on ) );
			el.querySelector( '.g-wear' ).hidden = ! on;
			this.on.inspect( on );
			this.refreshWear();

		} );
		el.querySelector( '.replace' ).addEventListener( 'click', () => {

			this.on.replaceTires(); this.refreshWear();

		} );
		el.querySelectorAll( '.mode button' ).forEach( ( b ) => b.addEventListener( 'click', () => {

			setSetting( 'mode', b.dataset.v ); this.refreshGarage();

		} ) );
		const diff = el.querySelector( '.g-diff input' );
		diff.value = settings.rivalDifficulty;
		diff.addEventListener( 'input', () => setSetting( 'rivalDifficulty', +diff.value ) );
		el.querySelector( '.drive' ).addEventListener( 'click', () => this.on.drive() );
		el.querySelector( '.settings-btn' ).addEventListener( 'click', () => this.openSettings() );
		el.querySelector( '.help-btn' ).addEventListener( 'click', () => this.show( 'help' ) );
		el.querySelector( '.vr-btn' ).addEventListener( 'click', () => this.on.enterVR() );

	}

	refreshGarage( vrSupported ) {

		const el = this.panels.garage;
		const id = settings.car, c = CARS[ id ], st = carStats( id );
		el.querySelector( '.g-code' ).textContent = c.code;
		el.querySelector( '.g-title' ).textContent = c.name;
		el.querySelector( '.g-blurb' ).textContent = c.blurb;
		el.querySelector( '.g-stats' ).innerHTML = `
			<dt>Engine</dt><dd>${st.engine}</dd><dt>Power</dt><dd>${st.power} hp</dd>
			<dt>Weight</dt><dd>${st.mass} kg</dd><dt>Layout</dt><dd>${st.layout}</dd>`;
		const lv = el.querySelector( '.g-liveries' );
		lv.innerHTML = '';
		c.liveries.forEach( ( l, i ) => {

			const b = h( `<button role="radio" aria-checked="${( settings.livery[ id ] ?? 0 ) === i}" title="${l.desc}">${l.name}</button>` );
			b.addEventListener( 'click', () => {

				this.on.setLivery( i ); this.refreshGarage();

			} );
			lv.appendChild( b );

		} );
		el.querySelectorAll( '.mode button' ).forEach( ( b ) => b.setAttribute( 'aria-checked', String( b.dataset.v === settings.mode ) ) );
		el.querySelector( '.g-diff' ).hidden = settings.mode !== 'battle';
		const best = progress.bestTimes[ id ];
		el.querySelector( '.g-best' ).textContent = best ? `Best time: ${fmtTime( best )} · Wins ${progress.wins || 0}/${progress.races || 0}` : 'No time set yet on this pass.';
		if ( vrSupported !== undefined ) el.querySelector( '.vr-btn' ).hidden = ! vrSupported;
		this.refreshWear();

	}

	refreshWear() {

		const w = progress.tireWear[ settings.car ] || [ 0, 0, 0, 0 ];
		const names = [ 'Front L', 'Front R', 'Rear L', 'Rear R' ];
		this.panels.garage.querySelector( '.wear-grid' ).innerHTML = w.map( ( v, i ) => `
			<div class="wear"><span>${names[ i ]}</span><div class="wbar"><div style="width:${Math.round( ( 1 - v ) * 100 )}%;background:${v > 0.6 ? '#ff5a6e' : v > 0.3 ? '#ffd15c' : '#6dff9c'}"></div></div><b>${Math.round( ( 1 - v ) * 100 )}%</b></div>` ).join( '' );

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
		el.querySelector( '.help-btn' ).addEventListener( 'click', () => this.show( 'help' ) );
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
					<tr><td>L</td><td>Look back</td></tr><tr><td>R</td><td>Reset car to road</td></tr><tr><td>Esc / P</td><td>Pause</td></tr>
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
			<button class="primary close">Close</button>
		</div>` );
		this.root.appendChild( el );
		this.panels.help = el;
		el.querySelector( '.close' ).addEventListener( 'click', () => this.show( 'help', false ) );

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
			<div class="g-row"><button class="primary close">Done</button><button class="reset">Reset to defaults</button></div>
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
				[ 'select', 'camera', 'Default camera', [ [ 'cockpit', 'First-person cockpit' ], [ 'chase', 'Third-person chase' ] ] ],
				[ 'select', 'units', 'Speed units', [ [ 'kmh', 'km/h' ], [ 'mph', 'mph' ] ] ],
				[ 'check', 'cameraShake', 'Camera shake' ]
			],
			hud: [
				[ 'select', 'hudMode', 'HUD mode', [ [ 'auto', 'Auto (diegetic in cockpit)' ], [ 'windshield', 'Project on windshield' ], [ 'slate', 'Floating slate / overlay' ], [ 'off', 'Off' ] ] ],
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
		el.querySelector( '.close' ).addEventListener( 'click', () => this.show( 'settings', false ) );
		el.querySelector( '.reset' ).addEventListener( 'click', () => this.confirm( 'Reset all settings to defaults?', () => {

			resetSettings(); this._syncSettings(); this.on.settingChanged?.( '*' );

		} ) );

	}

	_syncSettings() {

		for ( const f of this._controls ) f();

	}

	openSettings() {

		this._syncSettings();
		this.show( 'settings' );

	}

}
