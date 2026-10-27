// Layout of the downhill pass, authored as driving instructions.
// angle > 0 turns left, < 0 turns right (degrees). grade is rise/run (negative = downhill).
// `tag` marks sections the spotters and replay director know about.

export const ROAD = {
	halfWidth: 4.0, // two 4 m lanes
	gutterWidth: 0.6, // concrete U-gutter outside the white line
	gutterDepth: 0.22,
	shoulder: 0.5,
	sampleSpacing: 2.0
};

// Physics boundary (guardrail / retaining wall face) measured from the centerline.
export const WALL_OFFSET = ROAD.halfWidth + ROAD.gutterWidth + ROAD.shoulder;

export const LAYOUT = [
	{ straight: 140, grade: - 0.01, tag: 'summit' },
	{ arc: 260, angle: - 28, grade: - 0.04 },
	{ straight: 150, grade: - 0.065 },
	{ arc: 110, angle: 62, grade: - 0.06 },
	{ arc: 75, angle: - 74, grade: - 0.06, tag: 'esses' },
	{ straight: 210, grade: - 0.075, tag: 'fast' },
	{ arc: 19, angle: 168, grade: - 0.045, tag: 'hairpin1' },
	{ straight: 120, grade: - 0.07 },
	{ arc: 58, angle: - 84, grade: - 0.065 },
	{ arc: 92, angle: 48, grade: - 0.065 },
	{ straight: 170, grade: - 0.075 },
	{ arc: 44, angle: - 118, grade: - 0.06, tag: 'carousel' },
	{ arc: 150, angle: 36, grade: - 0.07 },
	{ straight: 260, grade: - 0.085, tag: 'longStraight' },
	{ arc: 21, angle: - 172, grade: - 0.05, tag: 'hairpin2' },
	{ straight: 105, grade: - 0.075 },
	{ arc: 68, angle: 88, grade: - 0.07 },
	{ arc: 70, angle: - 92, grade: - 0.07 },
	{ straight: 130, grade: - 0.08 },
	// The five consecutive hairpins: a switchback ladder down the slope face.
	{ arc: 17, angle: 174, grade: - 0.05, tag: 'fiveHairpins' },
	{ straight: 72, grade: - 0.09 },
	{ arc: 17, angle: - 176, grade: - 0.05 },
	{ straight: 72, grade: - 0.09 },
	{ arc: 17, angle: 176, grade: - 0.05 },
	{ straight: 72, grade: - 0.09 },
	{ arc: 17, angle: - 176, grade: - 0.05 },
	{ straight: 72, grade: - 0.09 },
	{ arc: 17, angle: 172, grade: - 0.05 },
	{ straight: 90, grade: - 0.07, tag: 'finalSection' },
	{ arc: 160, angle: - 32, grade: - 0.05 },
	{ straight: 200, grade: - 0.03, tag: 'finish' },
	{ straight: 170, grade: - 0.005, tag: 'cooldown' }
];

// Distances from the end of the 'finish' straight segment start where the line sits.
export const FINISH_INTO_SEGMENT = 150;
export const START_INTO_SEGMENT = 70;
