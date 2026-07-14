function splitLongToken(ctx, token, maxWidth) {
 const segmenter = typeof Intl?.Segmenter === 'function'
   ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
   : null;
 const graphemes = segmenter
   ? Array.from(segmenter.segment(token), (entry) => entry.segment)
   : Array.from(token);
 const chunks = [];
 let currentChunk = '';

 graphemes.forEach((grapheme) => {
   const candidate = `${currentChunk}${grapheme}`;
   if (currentChunk && ctx.measureText(candidate).width > maxWidth) {
     chunks.push(currentChunk);
     currentChunk = grapheme;
   } else {
     currentChunk = candidate;
   }
 });

 if (currentChunk) {
   chunks.push(currentChunk);
 }

 return chunks;
}

export function wrapText(ctx, text, maxWidth, { breakLongWords = false } = {}) {


 const words = text.split(' ');
 const lines = [];
 let currentLine = '';

 words.forEach(word => {
   if (breakLongWords && ctx.measureText(word).width > maxWidth) {
     if (currentLine) {
       lines.push(currentLine);
       currentLine = '';
     }

     const chunks = splitLongToken(ctx, word, maxWidth);
     if (chunks.length > 0) {
       lines.push(...chunks.slice(0, -1));
       currentLine = chunks[chunks.length - 1];
     }
     return;
   }

   const testLine = currentLine ? `${currentLine} ${word}` : word;
   const metrics = ctx.measureText(testLine);
   const testWidth = metrics.width;


   if (testWidth > maxWidth && currentLine) {
     lines.push(currentLine);
     currentLine = word;
   } else {
     currentLine = testLine;
   }
 });

 if (currentLine) {
   lines.push(currentLine);
 }

 return lines;
}
