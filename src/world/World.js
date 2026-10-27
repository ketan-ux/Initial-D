import * as THREE from 'three/webgpu';
import { Track } from './Track.js';
import { TerrainField } from './TerrainField.js';
import { Terrain } from './Terrain.js';
import { classifySides, buildRoad, buildLampPools } from './TrackMesh.js';
import { buildLocations, defineLots } from './Locations.js';
import { createRoadAtlas, createGlowTexture } from '../render/textures.js';
import { toonMaterial, uMoonDir } from '../render/toon.js';
import { createSky, FOG_COLOR } from '../render/sky.js';

// Owns the static environment: the pass, terrain, foliage, sky, moonlight.
export class World {

	constructor( scene, quality ) {

		this.scene = scene;
		this.quality = quality;
		this.root = new THREE.Group();
		this.root.name = 'world';
		scene.add( this.root );

	}

	async build( onProgress = () => {} ) {

		const q = this.quality;
		onProgress( 0.02, 'Surveying the pass' );
		this.track = new Track();
		this.lots = defineLots( this.track );
		this.field = new TerrainField( this.track );
		await tick();

		onProgress( 0.08, 'Paving the road' );
		this.atlas = createRoadAtlas();
		this.roadMaterial = toonMaterial( { map: this.atlas, vertexColors: true, glowAttr: 'glow', rim: 0.08, side: THREE.DoubleSide } );
		this.terrainMaterial = toonMaterial( { vertexColors: true, sway: true, rim: 0.3 } );
		this.sides = classifySides( this.track, this.field );
		const { group: road, lamps } = buildRoad( this.track, this.sides, this.roadMaterial );
		this.road = road;
		this.lamps = lamps;
		this.root.add( road );
		await tick();

		onProgress( 0.15, 'Growing cherry blossoms' );
		this.terrain = new Terrain( this.track, this.field, this.terrainMaterial, q, ( p ) => onProgress( 0.15 + p * 0.6, 'Growing cherry blossoms' ) );
		this.root.add( await this.terrain.build() );

		onProgress( 0.78, 'Lighting the lanterns' );
		this.lampPools = buildLampPools( lamps, createGlowTexture( 'rgba(255,190,120,1)' ) );
		this.root.add( this.lampPools );
		this.locations = buildLocations( this.track, this.field, this.roadMaterial, q );
		this.root.add( this.locations.group );

		this.sky = createSky();
		this.scene.add( this.sky );

		// Moonlight: the only directional light. CSM is attached by the renderer
		// setup on the High preset; Quest/Low skip directional shadows.
		this.moon = new THREE.DirectionalLight( 0xd2ccff, q.toon === 'unlit' ? 0 : 1.7 );
		this.moon.position.copy( uMoonDir.value ).multiplyScalar( 400 );
		this.moon.target.position.set( 0, 0, 0 );
		this.scene.add( this.moon, this.moon.target );
		if ( q.toon !== 'unlit' ) {

			// twilight sky fill from above, dusky bounce from below
			this.hemi = new THREE.HemisphereLight( 0x9a88e0, 0x3a2a48, 1.25 );
			this.scene.add( this.hemi );

		}

		this.scene.fog = new THREE.FogExp2( FOG_COLOR.getHex(), 0.0021 * q.fogDensity );
		this.scene.background = FOG_COLOR.clone();
		onProgress( 0.85, 'World ready' );

	}

	update( dt, cameraWorldPos, far ) {

		this.sky.position.copy( cameraWorldPos );
		this.sky.scale.setScalar( far * 0.92 );

	}

}

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );
