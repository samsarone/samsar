import { createCanvas } from 'canvas';
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1024;

export function applyRGBSplit(ctx, intensity) {
  // Define the offset based on intensity (approx 75% of original values)
  let offset;
  switch (intensity) {
    case 'low':
      offset = 0.375; // 75% of 0.5
      break;
    case 'medium':
      offset = 1.125; // 75% of 1.5
      break;
    case 'high':
      offset = 1.875; // 75% of 2.5
      break;
    default:
      offset = 1.875;
  }

  // Create temporary canvases for each RGB channel
  const redCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const greenCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const blueCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);

  const redCtx = redCanvas.getContext('2d');
  const greenCtx = greenCanvas.getContext('2d');
  const blueCtx = blueCanvas.getContext('2d');

  // Draw the current canvas onto each channel canvas
  redCtx.drawImage(ctx.canvas, 0, 0);
  greenCtx.drawImage(ctx.canvas, 0, 0);
  blueCtx.drawImage(ctx.canvas, 0, 0);

  // Get image data for each channel
  let redData = redCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  let greenData = greenCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  let blueData = blueCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Manipulate the image data to isolate channels
  for (let i = 0; i < redData.data.length; i += 4) {
    // Red channel
    greenData.data[i] = 0;
    blueData.data[i] = 0;

    // Green channel
    redData.data[i + 1] = 0;
    blueData.data[i + 1] = 0;

    // Blue channel
    redData.data[i + 2] = 0;
    greenData.data[i + 2] = 0;
  }

  // Put the manipulated data back onto the canvases
  redCtx.putImageData(redData, 0, 0);
  greenCtx.putImageData(greenData, 0, 0);
  blueCtx.putImageData(blueData, 0, 0);

  // Clear the main canvas
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Draw each channel with subtle offsets
  ctx.globalAlpha = 0.45; // 75% of 0.6
  ctx.drawImage(redCanvas, -offset, 0);
  ctx.drawImage(greenCanvas, offset, 0);
  ctx.drawImage(blueCanvas, 0, offset);
  ctx.globalAlpha = 1.0; // Reset transparency
}

export function applyNoiseOverlay(ctx, intensity) {
  const noiseCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const noiseCtx = noiseCanvas.getContext('2d');

  const imageData = noiseCtx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = imageData.data;

  // Define noise density based on intensity (approx 75% of original values)
  let noiseDensity;
  switch (intensity) {
    case 'low':
      noiseDensity = 0.00375; // 75% of 0.005
      break;
    case 'medium':
      noiseDensity = 0.01125; // 75% of 0.015
      break;
    case 'high':
      noiseDensity = 0.01875; // 75% of 0.025
      break;
    default:
      noiseDensity = 0.01125;
  }

  for (let i = 0; i < data.length; i += 4) {
    if (Math.random() < noiseDensity) {
      const grayscale = Math.floor(Math.random() * 256);
      data[i] = grayscale;        // R
      data[i + 1] = grayscale;    // G
      data[i + 2] = grayscale;    // B
      data[i + 3] = Math.floor(Math.random() * 22.5) + 22.5; // 75% of (30)
    } else {
      data[i + 3] = 0; // Fully transparent
    }
  }

  noiseCtx.putImageData(imageData, 0, 0);

  // Overlay the noise onto the main canvas with further reduced opacity
  ctx.globalAlpha = 0.15; // 75% of 0.2
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noiseCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0; // Reset opacity
}

export function applyDisplacementShifts(ctx, intensity) {
  const displacementCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const displacementCtx = displacementCanvas.getContext('2d');

  displacementCtx.drawImage(ctx.canvas, 0, 0);

  // Define displacement and rotation parameters based on intensity (25% of original values)
  let maxOffset, maxRotation;
  switch (intensity) {
    case 'low':
      maxOffset = 0.375; // 25% of 1.5
      maxRotation = 0.0025; // 25% of 0.01 (in radians)
      break;
    case 'medium':
      maxOffset = 0.75; // 25% of 3
      maxRotation = 0.00375; // 25% of 0.015
      break;
    case 'high':
      maxOffset = 1.25; // 25% of 5
      maxRotation = 0.005; // 25% of 0.02
      break;
    default:
      maxOffset = 0.75; // Default to 'medium' intensity quartered
      maxRotation = 0.00375;
  }

  // Apply random horizontal and vertical shifts
  const shiftX = (Math.random() - 0.5) * maxOffset;
  const shiftY = (Math.random() - 0.5) * maxOffset;

  // Apply a small random rotation based on intensity
  const angle = (Math.random() - 0.5) * maxRotation;

  // Clear the main canvas and apply the transformation
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.save(); // Save the current canvas state

  // Apply the translation and rotation
  ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2); // Move the canvas origin to the center
  ctx.rotate(angle); // Rotate the canvas by the random angle
  ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2); // Move the origin back

  ctx.globalAlpha = 0.2125; // 25% of 0.85
  ctx.drawImage(displacementCanvas, shiftX, shiftY);

  ctx.restore(); // Restore the canvas to its original state
  ctx.globalAlpha = 1.0; // Reset opacity
}





export function applyScanLineDisturbances(ctx, intensity) {
  const scanLineCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const scanLineCtx = scanLineCanvas.getContext('2d');

  // Define scan line parameters based on intensity (approx 75% of original values)
  let lineSpacing, lineThickness, lineOpacity;
  switch (intensity) {
    case 'low':
      lineSpacing = 6; // 75% of 8
      lineThickness = 0.375; // 75% of 0.5
      lineOpacity = 0.015; // 75% of 0.02
      break;
    case 'medium':
      lineSpacing = 4.5; // 75% of 6
      lineThickness = 0.75; // 75% of 1
      lineOpacity = 0.0225; // 75% of 0.03
      break;
    case 'high':
      lineSpacing = 3; // 75% of 4
      lineThickness = 1.125; // 75% of 1.5
      lineOpacity = 0.03; // 75% of 0.04
      break;
    default:
      lineSpacing = 4.5;
      lineThickness = 0.75;
      lineOpacity = 0.0225;
  }

  scanLineCtx.strokeStyle = `rgba(0, 0, 0, ${lineOpacity})`; // Darker lines for natural look
  scanLineCtx.lineWidth = lineThickness;

  for (let y = 0; y < CANVAS_HEIGHT; y += lineSpacing) {
    if (Math.random() > 0.8) { // Further reduced randomness for natural look
      scanLineCtx.beginPath();
      scanLineCtx.moveTo(0, y);
      scanLineCtx.lineTo(CANVAS_WIDTH, y);
      scanLineCtx.stroke();
    }
  }

  // Overlay the scan lines onto the main canvas with further reduced opacity
  ctx.globalAlpha = 0.1875; // 75% of 0.25
  ctx.drawImage(scanLineCanvas, 0, 0);
  ctx.globalAlpha = 1.0; // Reset opacity
}
