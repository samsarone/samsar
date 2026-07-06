export function wrapText(ctx, text, maxWidth) {


 const words = text.split(' ');
 const lines = [];
 let currentLine = '';

 words.forEach(word => {
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
