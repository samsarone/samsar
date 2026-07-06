// StegUtils.js
import fs from 'fs';
import path from 'path';
import { Jimp } from "jimp";





/**
 * Embeds an invisible watermark into every 30th PNG frame in the provided directory.
 */
export async function embedInvisibleWatermarkEvery30thFrame(
  frameOutputPath,
  videoSessionId,
  watermarkMessage = 'Ai generated'
) {
  try {
    const allFrameFiles = fs.readdirSync(frameOutputPath)
      .filter((file) => path.extname(file).toLowerCase() === '.png')
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    for (let i = 0; i < allFrameFiles.length; i += 1) {
      if (i % 30 === 0) {
        const frameFile = allFrameFiles[i];
        const framePath = path.join(frameOutputPath, frameFile);

        try {
          await embedMessageInPNG(framePath, watermarkMessage);
        } catch (err) {
          console.error(
            `Failed to embed watermark in frame #${i} for session ${videoSessionId}:`,
            err
          );
        }
      }
    }
  } catch (err) {
    console.error(`Error while embedding watermark for session ${videoSessionId}:`, err);
  }
}

/**
 * Encodes a text message into the PNG image at the specified path using simple LSB steganography.
 */
export async function embedMessageInPNG(pngPath, message) {
  const image = await Jimp.read(pngPath);

  // Convert message to binary
  const messageBytes = Buffer.from(message, 'utf8');
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(messageBytes.length, 0);
  const dataToEncode = Buffer.concat([lengthBytes, messageBytes]);

  const bits = [];
  for (let i = 0; i < dataToEncode.length; i++) {
    const byteVal = dataToEncode[i];
    for (let b = 7; b >= 0; b--) {
      bits.push((byteVal >> b) & 1);
    }
  }

  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const totalPixels = width * height;
  const capacityInBits = totalPixels * 3; // storing in R,G,B channels only

  if (bits.length > capacityInBits) {
    throw new Error(
      `Message too large. Need ${bits.length} bits, have ${capacityInBits}.`
    );
  }

  let bitIndex = 0;
  image.scan(0, 0, width, height, (x, y, idx) => {
    for (let c = 0; c < 3; c++) {
      if (bitIndex < bits.length) {
        const colorVal = image.bitmap.data[idx + c];
        const newVal = (colorVal & 0xFE) | bits[bitIndex];
        image.bitmap.data[idx + c] = newVal;
        bitIndex++;
      }
    }
  });

  // Use getBufferAsync to create a PNG buffer
  const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

  // Write the buffer to the original file
  await fsPromises.writeFile(pngPath, pngBuffer);
}
