import Konva from 'konva';

// Define the custom bloom filter
Konva.Filters.CustomBloom = function(imageData) {
  const data = imageData.data;
  const length = data.length;
  const threshold = 200; // Adjust as needed

  for (let i = 0; i < length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const brightness = (r + g + b) / 3;

    if (brightness > threshold) {
      data[i] = Math.min(255, r * 1.2);     // Increase red channel
      data[i + 1] = Math.min(255, g * 1.2); // Increase green channel
      data[i + 2] = Math.min(255, b * 1.2); // Increase blue channel
    }
  }
};

export function applyBloomEffect(node) {
  if (!node.isCached()) {
    node.cache();
  }

  node.filters([Konva.Filters.CustomBloom]);

  // Redraw the layer to apply the filter
  node.getLayer().batchDraw();
}
