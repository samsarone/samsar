// Import necessary configurations
import { GLITCH_CONFIGURATIONS } from './GlitchConfigurations.js';
import { SNOWFALL_CONFIGURATIONS } from './SnowfallConfigurations.js';
import { LIGHT_TRANSITION_CONFIGURATIONS } from './LightTransitionConfigurations.js';
import { HOLOGRAM_CONFIGURATIONS } from './HologramConfigurations.js';
import { NEBULA_CONFIGURATIONS } from './NebulaConfigurations.js';
import { PARTICLE_CONFIGURATIONS } from './ParticleConfigurations.js';
import { BLOOM_CONFIGURATIONS } from './BloomConfigurations.js';
import { LENS_FLARE_CONFIGURATIONS } from './LensFlareConfigurations.js';
import { getFramesPerSecondFromValue } from '../FpsUtils.js';

// Define helper functions to get random configurations
function getRandomGlitchConfig() {
  return GLITCH_CONFIGURATIONS[Math.floor(Math.random() * GLITCH_CONFIGURATIONS.length)];
}

function getRandomSnowfallConfig() {
  return SNOWFALL_CONFIGURATIONS[Math.floor(Math.random() * SNOWFALL_CONFIGURATIONS.length)];
}

function getRandomLightTransitionConfig() {
  return LIGHT_TRANSITION_CONFIGURATIONS[Math.floor(Math.random() * LIGHT_TRANSITION_CONFIGURATIONS.length)];
}

function getRandomHologramConfig() {
  return HOLOGRAM_CONFIGURATIONS[Math.floor(Math.random() * HOLOGRAM_CONFIGURATIONS.length)];
}

function getRandomNebulaConfig() {
  return NEBULA_CONFIGURATIONS[Math.floor(Math.random() * NEBULA_CONFIGURATIONS.length)];
}

function getRandomParticleConfig() {
  return PARTICLE_CONFIGURATIONS[Math.floor(Math.random() * PARTICLE_CONFIGURATIONS.length)];
}

function getRandomBloomConfig() {
  return BLOOM_CONFIGURATIONS[Math.floor(Math.random() * BLOOM_CONFIGURATIONS.length)];
}

function getRandomLensFlareConfig() {
  return LENS_FLARE_CONFIGURATIONS[Math.floor(Math.random() * LENS_FLARE_CONFIGURATIONS.length)];
}

// Helper function for adding custom animations with deduplication
function getCustomAnimations() {
  let randVal = Math.random();

  let numCustomAnimations;
  if (randVal < 0.15) {
    numCustomAnimations = 2;
  } else if (randVal < 0.8) {
    numCustomAnimations = 1;
  } else {
    numCustomAnimations = 0;
  }

  const customAnimations = new Set(); // Use Set to ensure uniqueness
  const MAX_ATTEMPTS = 10; // Prevent infinite loops
  let attempts = 0;

  while (customAnimations.size < numCustomAnimations && attempts < MAX_ATTEMPTS) {
    const randomEffect = Math.random();
    let effect;
    if (randomEffect < 0.05) {
      effect = 'glitch';
    } else if (randomEffect < 0.25) {
      effect = 'snowfall';
    } else if (randomEffect < 0.3) {
      effect = 'lens_flare';
    } else if (randomEffect < 0.35) {
      effect = 'hologram';
    } else if (randomEffect < 0.4) {
      effect = 'nebula';
    } else if (randomEffect < 0.45) {
      effect = 'particle';
    } else if (randomEffect < 0.5) {
      effect = 'bloom';
    } else {
      effect = 'light_transition';
    }

    customAnimations.add(effect);
    attempts++;
  }

  // Convert set to array
  const customAnimationsArray = Array.from(customAnimations);

  return customAnimationsArray;
}

export function getPresetAnimationListForDistribution(
  distribution,
  layerIdx,
  canvasDimensions,
  layerFrameDuration,
  framesPerSecond
) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);

  // Build the animation sequence with combined animations
  let animationSequence = [];

  let initialBasicAnimation = [];

  const startingDistribution = distribution[0];
  const startDistEnd = startingDistribution.endFrame;

  const endDistStart = startingDistribution.endFrame + 1;
  const endDistEnd = distribution[distribution.length - 1].endFrame + effectiveFramesPerSecond;

  const numItems = distribution.length;

  // Determine the number of animations to generate based on the distribution length
  let numAnimations = numItems;

  // Initialize previous transforms
  let previousZoom = {
    startScale: 100,
    endScale: 100,
  };
  let previousSlide = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  };
  let previousRotate = {
    startAngle: 0,
    endAngle: 0,
  };

  // Initialize cumulative transformations
  let cumulativeScale = 100;
  let cumulativeSlideX = 0;
  let cumulativeSlideY = 0;
  let lastZoomDirection = 'out'; // Start so that first zoom is in

  // Added previousOrbit and previousSway to keep track of their states
  let previousOrbit = {
    startAngle: 0,
    endAngle: 0,
    radius: 6,
    centerX: 0,
    centerY: 0,
  };

  let previousSway = {
    amplitude: 8,
    frequency: 1,
    phase: 0,
  };

  let customAnimationApplied = false;

  // For middle layers
  let lastZoomApplied = false;
  for (let i = 0; i < numAnimations; i++) {
    let currentDistributionAnimationList = [];
    const rand = Math.random();

    // Determine whether to add zoom_in_mini + slide_left or zoom_out_mini + slide_right in certain distributions
    let addZoomTranslate = i % 4 === 0 || i % 4 === 2; // Add combinations at every 2nd and 4th distribution

    if (addZoomTranslate) {
      let zoomDirection = lastZoomDirection === 'out' ? 'in' : 'out';
      lastZoomDirection = zoomDirection;

      if (zoomDirection === 'in') {
        currentDistributionAnimationList.push('zoom_in_mini');
        currentDistributionAnimationList.push('slide_left');
      } else {
        currentDistributionAnimationList.push('zoom_out_mini');
        currentDistributionAnimationList.push('slide_right');
      }
      lastZoomApplied = true;
    } else {
      // Add same zoom and same pan to prevent jerkiness
      currentDistributionAnimationList.push('same_zoom');
      currentDistributionAnimationList.push('same_pan');
    }

    // Apply custom animations
    const transformsWithCustomAnimations = getCustomAnimations();

    currentDistributionAnimationList = currentDistributionAnimationList.concat(
      transformsWithCustomAnimations
    );

    if (!customAnimationApplied) {
      if (rand < 0.6) {
        currentDistributionAnimationList.push("orbit");
        customAnimationApplied = true;
      } else {
        currentDistributionAnimationList.push("sway");
        customAnimationApplied = true;
      }
    }

    animationSequence.push(currentDistributionAnimationList);
  }

  let animationList = [];

  // Initialize previousActiveTransforms to keep track of active animations
  let previousActiveTransforms = {
    orbit: false,
    sway: false,
  };

  for (let i = 0; i < distribution.length; i++) {
    const currentDistribution = distribution[i];
    const currentAnimationConfigList = animationSequence[i] || [];

    const frameDuration =
      currentDistribution.endFrame - currentDistribution.startFrame;
    const durationInSeconds = frameDuration / effectiveFramesPerSecond;

    // Set activeTransforms based on currentAnimationConfigList
    let activeTransforms = {};

    for (let transform of currentAnimationConfigList) {
      activeTransforms[transform] = true;
    }

    // Ensure that "orbit" and "sway" animations return to their starting point
    // by adjusting their parameters to complete full cycles
    for (let transformName of ["orbit", "sway"]) {
      if (activeTransforms[transformName]) {
        // The transform is active in the current distribution
        // We need to set its parameters to complete a full cycle

        if (transformName === "orbit") {
          // For "orbit", complete a full circle (360 degrees)
          let type = "orbit";
          let params = {
            startAngle: previousOrbit.endAngle % 360,
            endAngle: previousOrbit.endAngle + 360,
            radius: previousOrbit.radius,
            centerX: previousOrbit.centerX,
            centerY: previousOrbit.centerY,
          };
          previousOrbit = {
            startAngle: params.endAngle % 360,
            endAngle: params.endAngle % 360,
            radius: params.radius,
            centerX: params.centerX,
            centerY: params.centerY,
          };

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: currentDistribution.startFrame,
          };

          animationList.push(animationObject);
        } else if (transformName === "sway") {
          // For "sway", complete a full sine wave cycle
          let type = "sway";
          let params = {
            amplitude: previousSway.amplitude,
            frequency: 1 / durationInSeconds,
            phase: previousSway.phase,
          };
          // Update phase to ensure continuity
          previousSway.phase =
            (previousSway.phase + 2 * Math.PI * params.frequency * durationInSeconds) %
            (2 * Math.PI);

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: currentDistribution.startFrame,
          };

          animationList.push(animationObject);
        }
        previousActiveTransforms[transformName] = true;
      } else if (previousActiveTransforms[transformName]) {
        // The transform was active in the previous distribution but not in the current
        // Add it with parameters that return to the starting point

        if (transformName === "orbit") {
          // Add an orbit animation that returns to the starting angle
          let type = "orbit";
          let params = {
            startAngle: previousOrbit.endAngle % 360,
            endAngle: previousOrbit.startAngle % 360,
            radius: previousOrbit.radius,
            centerX: previousOrbit.centerX,
            centerY: previousOrbit.centerY,
          };
          previousOrbit = {
            startAngle: params.endAngle % 360,
            endAngle: params.endAngle % 360,
            radius: params.radius,
            centerX: params.centerX,
            centerY: params.centerY,
          };

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: currentDistribution.startFrame,
          };

          animationList.push(animationObject);
        } else if (transformName === "sway") {
          // Add a sway animation that returns to zero displacement
          let type = "sway";
          let params = {
            amplitude: previousSway.amplitude,
            frequency: 1 / durationInSeconds,
            phase: previousSway.phase,
          };
          // Update phase to complete the current cycle
          previousSway.phase =
            (previousSway.phase + 2 * Math.PI * params.frequency * durationInSeconds) %
            (2 * Math.PI);

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: currentDistribution.startFrame,
          };

          animationList.push(animationObject);
        }
        previousActiveTransforms[transformName] = false;
      }
    }

    // Process other transforms (excluding "orbit" and "sway")
    for (let transform of currentAnimationConfigList) {
      if (["orbit", "sway"].includes(transform)) {
        continue; // Already processed
      }

      let type;
      let params = {};

      switch (transform) {
        case "zoom_in_mini":
          type = "zoom";
          params = {
            startScale: cumulativeScale,
            endScale: cumulativeScale + 5,
          };
          cumulativeScale = params.endScale;
          previousZoom = {
            startScale: params.startScale,
            endScale: params.endScale,
          };
          break;
        case "zoom_out_mini":
          type = "zoom";
          params = {
            startScale: cumulativeScale,
            endScale: cumulativeScale - 5,
          };
          cumulativeScale = params.endScale;
          previousZoom = {
            startScale: params.startScale,
            endScale: params.endScale,
          };
          break;
        case "same_zoom":
          type = "zoom";
          params = {
            startScale: cumulativeScale,
            endScale: cumulativeScale,
          };
          previousZoom = {
            startScale: params.startScale,
            endScale: params.endScale,
          };
          break;
        case "slide_left":
          type = "slide";
          params = {
            startX: cumulativeSlideX,
            startY: cumulativeSlideY,
            endX: cumulativeSlideX - 10,
            endY: cumulativeSlideY,
          };
          cumulativeSlideX = params.endX;
          cumulativeSlideY = params.endY;
          previousSlide = {
            startX: params.startX,
            startY: params.startY,
            endX: params.endX,
            endY: params.endY,
          };
          break;
        case "slide_right":
          type = "slide";
          params = {
            startX: cumulativeSlideX,
            startY: cumulativeSlideY,
            endX: cumulativeSlideX + 10,
            endY: cumulativeSlideY,
          };
          cumulativeSlideX = params.endX;
          cumulativeSlideY = params.endY;
          previousSlide = {
            startX: params.startX,
            startY: params.startY,
            endX: params.endX,
            endY: params.endY,
          };
          break;
        case "same_pan":
          type = "slide";
          params = {
            startX: cumulativeSlideX,
            startY: cumulativeSlideY,
            endX: cumulativeSlideX,
            endY: cumulativeSlideY,
          };
          previousSlide = {
            startX: params.startX,
            startY: params.startY,
            endX: params.endX,
            endY: params.endY,
          };
          break;
        case "glitch":
          type = "glitch";
          params = getRandomGlitchConfig();
          break;
        case "snowfall":
          type = "snowfall";
          params = getRandomSnowfallConfig();
          break;
        case "light_transition":
          type = "light_transition";
          params = getRandomLightTransitionConfig();
          break;
        case "hologram":
          type = "hologram";
          params = getRandomHologramConfig();
          break;
        case "nebula":
          type = "nebula";
          params = getRandomNebulaConfig();
          break;
        case "particle":
          type = "particle";
          params = getRandomParticleConfig();
          break;
        case "bloom":
          type = "bloom";
          params = getRandomBloomConfig();
          break;
        case "lens_flare":
          type = "lens_flare";
          params = getRandomLensFlareConfig();
          break;
        default:
          break;
      }

      // Create animation object
      const animationObject = {
        type: type,
        params: params,
        frameDuration: frameDuration,
        frameOffset: currentDistribution.startFrame,
      };

      animationList.push(animationObject);
    }

    // Update previousActiveTransforms
    previousActiveTransforms = activeTransforms;
  }

  // Handle animations between the last distribution boundary and layerEndFrame
  const lastDistributionEndFrame =
    distribution[distribution.length - 1].endFrame;

  if (lastDistributionEndFrame < layerFrameDuration) {
    // Need to add animations from lastDistributionEndFrame to layerFrameDuration
    const frameDuration = layerFrameDuration - lastDistributionEndFrame;
    const durationInSeconds = frameDuration / effectiveFramesPerSecond;

    // For all active transforms, add them with parameters that return to the starting point
    for (let transformName in previousActiveTransforms) {
      if (previousActiveTransforms[transformName]) {
        if (transformName === "orbit") {
          // Add an orbit animation that returns to the starting angle
          let type = "orbit";
          let params = {
            startAngle: previousOrbit.endAngle % 360,
            endAngle: previousOrbit.startAngle % 360,
            radius: previousOrbit.radius,
            centerX: previousOrbit.centerX,
            centerY: previousOrbit.centerY,
          };
          previousOrbit = {
            startAngle: params.endAngle % 360,
            endAngle: params.endAngle % 360,
            radius: params.radius,
            centerX: params.centerX,
            centerY: params.centerY,
          };

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: lastDistributionEndFrame,
          };

          animationList.push(animationObject);
        } else if (transformName === "sway") {
          // Add a sway animation that returns to zero displacement
          let type = "sway";
          let params = {
            amplitude: previousSway.amplitude,
            frequency: 1 / durationInSeconds,
            phase: previousSway.phase,
          };
          // Update phase to complete the current cycle
          previousSway.phase =
            (previousSway.phase + 2 * Math.PI * params.frequency * durationInSeconds) %
            (2 * Math.PI);

          const animationObject = {
            type: type,
            params: params,
            frameDuration: frameDuration,
            frameOffset: lastDistributionEndFrame,
          };

          animationList.push(animationObject);
        }
      }
    }

    // Add same_zoom and same_pan to prevent jerkiness at the end
    const zoomAnimationObject = {
      type: "zoom",
      params: {
        startScale: cumulativeScale,
        endScale: cumulativeScale,
      },
      frameDuration: frameDuration,
      frameOffset: lastDistributionEndFrame,
    };
    animationList.push(zoomAnimationObject);

    const slideAnimationObject = {
      type: "slide",
      params: {
        startX: cumulativeSlideX,
        startY: cumulativeSlideY,
        endX: cumulativeSlideX,
        endY: cumulativeSlideY,
      },
      frameDuration: frameDuration,
      frameOffset: lastDistributionEndFrame,
    };
    animationList.push(slideAnimationObject);
  }



  return animationList;
}
