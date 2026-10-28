// Spotter radio script. Voice lines were generated with ElevenLabs (two
// Japanese-accented voices: the summit coordinator and the roadside
// spotter) and are played through a walkie-talkie DSP chain. Lines without
// an audio file fall back to synthesised radio chatter + captions.
// `alt` holds alternative takes for the same moment; the radio picks one at
// random and never repeats the take it played last.

export const SPEAKERS = {
	summit: { name: 'Summit', color: '#ffd166' },
	spotter: { name: 'Spotter 2', color: '#7ee0ff' }
};

export const LINES = {
	summit_staging: { file: 'summit_staging.mp3', speaker: 'summit', text: 'Summit to all spotters. Both cars are on the line. Is the road clear?', priority: 3 },
	road_clear: { file: 'road_clear.mp3', speaker: 'spotter', text: "Spotter two here! Road's clear all the way down. No traffic. Send them!", priority: 3 },
	countdown: { file: 'countdown.mp3', speaker: 'summit', text: 'Copy that. Countdown… here we go.', priority: 3 },
	solo_run: { file: 'solo_run.mp3', speaker: 'summit', text: 'Solo run tonight — time attack. Road is yours. Show us what you have.', alt: [ { file: 'solo_run_2.mp3', text: 'Time attack tonight. Just you and the mountain. Make it count.' } ], priority: 3 },
	launch: { file: 'launch.mp3', speaker: 'spotter', text: "They're off! Both cars just launched off the summit line!", alt: [ { file: 'launch_2.mp3', text: "And they're gone! Tyres screaming off the line!" } ], priority: 2 },
	hairpin_86: { file: 'hairpin_86.mp3', speaker: 'spotter', text: "Here they come into the first hairpin… hayai! The eighty-six didn't even touch the brakes!", priority: 2 },
	hairpin_generic: { file: 'hairpin_generic.mp3', speaker: 'spotter', text: "Here they come into the first hairpin… hayai! He didn't even touch the brakes!", alt: [ { file: 'hairpin_generic_2.mp3', text: 'First hairpin! Both cars are sideways, nose to tail!' } ], priority: 2 },
	drift: { file: 'drift.mp3', speaker: 'spotter', text: 'No way… a full four-wheel drift at that speed! Sugoi!', alt: [ { file: 'drift_2.mp3', text: "Look at that angle! He's drifting like it's nothing!" }, { file: 'drift_3.mp3', text: 'Smoke everywhere! That slide is beautiful!' } ], priority: 1 },
	gutter: { file: 'gutter.mp3', speaker: 'summit', text: 'Did you see that?! He hooked his inside tires in the gutter!', alt: [ { file: 'gutter_2.mp3', text: "Gutter run! He's riding the drain to carry his speed!" }, { file: 'gutter_3.mp3', text: 'Inside wheels in the ditch again… what a line!' } ], priority: 2 },
	pass_player: { file: 'pass_player.mp3', speaker: 'spotter', text: "He's going for it… inside line… he's through! He took the lead!", alt: [ { file: 'pass_player_2.mp3', text: "Overtake! He dove up the inside — he's in front now!" }, { file: 'pass_player_3.mp3', text: 'Unbelievable! He passed him right in the corner!' } ], priority: 2 },
	rival_ahead: { file: 'rival_ahead.mp3', speaker: 'summit', text: "The lead car's pulling away on the straights… the chaser has to make it up in the corners!", alt: [ { file: 'rival_ahead_2.mp3', text: 'The gap is growing… the chaser needs to push harder!' }, { file: 'rival_ahead_3.mp3', text: 'The leader is gone on the straight. Can he close it in the hairpins?' } ], priority: 1 },
	close_battle: { file: 'close_battle.mp3', speaker: 'spotter', text: "They're bumper to bumper! I can't tell who's leading!", alt: [ { file: 'close_battle_2.mp3', text: 'Nose to tail! Not even a car length between them!' }, { file: 'close_battle_3.mp3', text: "This is insane! They're side by side down the hill!" } ], priority: 1 },
	guardrail: { file: 'guardrail.mp3', speaker: 'spotter', text: "Ooh! Sparks off the guardrail! That's gonna leave a mark.", alt: [ { file: 'guardrail_2.mp3', text: 'He kissed the rail! Sparks everywhere!' }, { file: 'guardrail_3.mp3', text: "Ouch — metal on metal! He's still going though!" } ], priority: 1 },
	spin: { file: 'spin.mp3', speaker: 'spotter', text: "He's spinning! Is he okay?!", alt: [ { file: 'spin_2.mp3', text: "Whoa, whoa! He's around! He's facing the wrong way!" }, { file: 'spin_3.mp3', text: "Lost it! He's gone into a spin!" } ], priority: 2 },
	final_section: { file: 'final_section.mp3', speaker: 'summit', text: "Final section! They're heading into the five consecutive hairpins!", alt: [ { file: 'final_section_2.mp3', text: 'Here come the five hairpins! This is where it gets decided!' } ], priority: 2 },
	finish_win: { file: 'finish_win.mp3', speaker: 'spotter', text: 'Finish line! He did it — he actually won! Unbelievable!', alt: [ { file: 'finish_win_2.mp3', text: 'He crosses first! What a run! The mountain is his tonight!' } ], priority: 3 },
	finish_lose: { file: 'finish_lose.mp3', speaker: 'summit', text: 'The lead car crosses first… but the chaser was right on his tail the whole way.', alt: [ { file: 'finish_lose_2.mp3', text: 'The leader takes it. Close… but not close enough tonight.' } ], priority: 3 },
	finish_solo: { file: 'finish_solo.mp3', speaker: 'summit', text: 'Through the finish! Clean run. Bring it down to the lot.', alt: [ { file: 'finish_solo_2.mp3', text: 'Time is in. Nice and clean. Head down to the lot.' } ], priority: 3 },
	cooldown: { file: 'cooldown.mp3', speaker: 'summit', text: "Good run, everyone. Let's regroup at the parking lot down below.", alt: [ { file: 'cooldown_2.mp3', text: 'Great racing, everyone. Meet at the lot at the bottom.' } ], priority: 2 },
	new_record: { file: 'new_record.mp3', speaker: 'spotter', text: 'New course record! Sugee!', priority: 3 }
};
