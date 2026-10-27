// Spotter radio script. Voice lines were generated with ElevenLabs (two
// Japanese-accented voices: the summit coordinator and the roadside
// spotter) and are played through a walkie-talkie DSP chain. Lines without
// an audio file fall back to synthesised radio chatter + captions.

export const SPEAKERS = {
	summit: { name: 'Summit', color: '#ffd166' },
	spotter: { name: 'Spotter 2', color: '#7ee0ff' }
};

export const LINES = {
	summit_staging: { file: 'summit_staging.mp3', speaker: 'summit', text: 'Summit to all spotters. Both cars are on the line. Is the road clear?', priority: 3 },
	road_clear: { file: 'road_clear.mp3', speaker: 'spotter', text: "Spotter two here! Road's clear all the way down. No traffic. Send them!", priority: 3 },
	countdown: { file: 'countdown.mp3', speaker: 'summit', text: 'Copy that. Countdown… here we go.', priority: 3 },
	solo_run: { file: null, speaker: 'summit', text: 'Solo run tonight — time attack. Road is yours. Show us what you have.', priority: 3 },
	launch: { file: 'launch.mp3', speaker: 'spotter', text: "They're off! Both cars just launched off the summit line!", priority: 2 },
	hairpin_86: { file: 'hairpin_86.mp3', speaker: 'spotter', text: "Here they come into the first hairpin… hayai! The eighty-six didn't even touch the brakes!", priority: 2 },
	hairpin_generic: { file: 'hairpin_generic.mp3', speaker: 'spotter', text: "Here they come into the first hairpin… hayai! He didn't even touch the brakes!", priority: 2 },
	drift: { file: 'drift.mp3', speaker: 'spotter', text: 'No way… a full four-wheel drift at that speed! Sugoi!', priority: 1 },
	gutter: { file: 'gutter.mp3', speaker: 'summit', text: 'Did you see that?! He hooked his inside tires in the gutter!', priority: 2 },
	pass_player: { file: 'pass_player.mp3', speaker: 'spotter', text: "He's going for it… inside line… he's through! He took the lead!", priority: 2 },
	rival_ahead: { file: 'rival_ahead.mp3', speaker: 'summit', text: "The lead car's pulling away on the straights… the chaser has to make it up in the corners!", priority: 1 },
	close_battle: { file: 'close_battle.mp3', speaker: 'spotter', text: "They're bumper to bumper! I can't tell who's leading!", priority: 1 },
	guardrail: { file: 'guardrail.mp3', speaker: 'spotter', text: "Ooh! Sparks off the guardrail! That's gonna leave a mark.", priority: 1 },
	spin: { file: 'spin.mp3', speaker: 'spotter', text: "He's spinning! Is he okay?!", priority: 2 },
	final_section: { file: 'final_section.mp3', speaker: 'summit', text: "Final section! They're heading into the five consecutive hairpins!", priority: 2 },
	finish_win: { file: 'finish_win.mp3', speaker: 'spotter', text: 'Finish line! He did it — he actually won! Unbelievable!', priority: 3 },
	finish_lose: { file: 'finish_lose.mp3', speaker: 'summit', text: 'The lead car crosses first… but the chaser was right on his tail the whole way.', priority: 3 },
	finish_solo: { file: null, speaker: 'summit', text: 'Through the finish! Clean run. Bring it down to the lot.', priority: 3 },
	cooldown: { file: 'cooldown.mp3', speaker: 'summit', text: "Good run, everyone. Let's regroup at the parking lot down below.", priority: 2 },
	new_record: { file: 'new_record.mp3', speaker: 'spotter', text: 'New course record! Sugee!', priority: 3 }
};
