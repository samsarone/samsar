
export const generateCursor = (size) => {
  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 1}' fill='%23000' /></svg>") ${size / 2} ${size / 2}, auto`;
};


export const generatePencilCursor = (size) => {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="white">
    <path d="M12.83 5.17l6 6-10.83 10.83-6-6 10.83-10.83zm-9.12 10.82l-3.71-3.71 1.41-1.41 3.71 3.71-1.41 1.41zm18.85-14.33l-2.83-2.83c-0.39-0.39-1.02-0.39-1.41 0l-2.83 2.83 6.24 6.24 2.83-2.83c0.39-0.39 0.39-1.02 0-1.41z"/>
  </svg>
`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${size / 2} ${size / 2}, auto`;

}