import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import fs from 'fs';

export async function generatePriceChart(payload) {
  const { currentSupply, maxSupply, creatorMintAmount, appPath, mintPrice } = payload;

  const finalPrice = 1e18;  // 1 ETH in wei
  const width = 800;  // px
  const height = 600;  // px
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const supplies = [];
  const prices = [];
  const pointBackgroundColor = []; // Array to hold background color for points
  const pointRadius = []; // Array to hold the radius of each point

  // Calculate burn price
  const burnPrice = mintPrice - (mintPrice * 0.0005); // 0.05% of mintPrice

  // Round currentSupply to the nearest 100 to ensure it matches an x-axis point
  const roundedCurrentSupply = Math.round(currentSupply / 100) * 100;

  let mintPriceDisplay = mintPrice.toFixed(8);
  let burnPriceDisplay = burnPrice.toFixed(8);
  if (mintPrice > 0.0001) {
      mintPriceDisplay = mintPrice.toFixed(4);
      burnPriceDisplay = burnPrice.toFixed(4);
  }

  try {
      for (let totalSupply = 0; totalSupply <= maxSupply; totalSupply += 100) {
          supplies.push(totalSupply);
          const price = calculatePrice(totalSupply, finalPrice, maxSupply, creatorMintAmount);
          prices.push(price);

          // Default point color and size
          pointBackgroundColor.push('#1f2937'); // Changed to a dark navy color
          pointRadius.push(2); // Smaller default radius
      }

      // Highlight the rounded current supply point by changing its color and size
      const currentIndex = supplies.indexOf(roundedCurrentSupply);
      if (currentIndex >= 0) {
          pointBackgroundColor[currentIndex] = '#052e16'; // Highlight color
          pointRadius[currentIndex] = 8; // Larger radius for the matched point
      }

      const configuration = {
          type: 'line',
          data: {
              labels: supplies,
              datasets: [{
                  label: `Mint Price: ${mintPriceDisplay} ETH, Burn Price: ${burnPriceDisplay} ETH`,
                  data: prices,
                  borderColor: '#1f2937',
                  tension: 0.1,
                  pointBackgroundColor: pointBackgroundColor,
                  pointRadius: pointRadius, // Apply variable point radii
                  pointHoverRadius: 7
              }]
          },
          options: {
              scales: {
                  y: {
                      beginAtZero: true
                  }
              },
              plugins: {
                  tooltip: {
                      callbacks: {
                          label: function(context) {
                              // Provide more information in tooltip
                              return `${context.dataset.label.split(',')[0]}: ${context.raw} ETH at supply ${context.label}`;
                          }
                      }
                  }
              }
          }
      };

      const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
      fs.writeFileSync(appPath, buffer);
  } catch (error) {
      console.error(error);
  }
}


function calculatePrice(totalSupply, finalPrice, maxSupply, creatorMintAmount) {
  if (totalSupply <= creatorMintAmount) {
      return 0;
  }

  const adjustedSupply = totalSupply - creatorMintAmount;
  const maxAdjustedSupply = maxSupply - creatorMintAmount;
  const price = (finalPrice * adjustedSupply * adjustedSupply) / (maxAdjustedSupply * maxAdjustedSupply);
  const priceETH = price / 1e18;
  return priceETH.toFixed(8);
}
