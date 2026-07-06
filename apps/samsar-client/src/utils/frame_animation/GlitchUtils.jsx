import Konva from 'konva';

// Define the custom glitch filter
Konva.Filters.CustomGlitch = function(imageData) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Parameters for glitch effect
  const shiftAmount = 10; // Maximum pixels to shift
  const sliceHeight = 5;  // Height of each glitch slice

  // Apply glitch effect by shifting random horizontal slices
  for (let y = 0; y < height; y += sliceHeight) {
    if (Math.random() < 0.1) { // 10% chance to glitch this slice
      const shift = (Math.random() - 0.5) * 2 * shiftAmount;
      for (let x = 0; x < width; x++) {
        const sourceIndex = (y * width + x) * 4;
        const shiftedX = x + shift;
        if (shiftedX >= 0 && shiftedX < width) {
          const destIndex = (y * width + shiftedX) * 4;
          data[destIndex] = data[sourceIndex];
          data[destIndex + 1] = data[sourceIndex + 1];
          data[destIndex + 2] = data[sourceIndex + 2];
          data[destIndex + 3] = data[sourceIndex + 3];
        }
      }
    }
  }
};

export function applyGlitchEffect(node) {
  // Ensure the node is cached for filters to work
  if (!node.isCached()) {
    node.cache();
  }

  // Set the custom glitch filter
  node.filters([Konva.Filters.CustomGlitch]);

  // Optionally adjust filter parameters based on `params` and `t`
  // Currently, the filter doesn't accept parameters, but you can modify it to do so

  // Redraw the layer to apply the filter
  node.getLayer().batchDraw();
}
