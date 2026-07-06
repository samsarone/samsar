export function hslToRgb(h, s, l) {
  // h in [0, 360], s and l in [0, 100]
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1, g1, b1;

  if (hPrime >= 0 && hPrime < 1) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hPrime >= 1 && hPrime < 2) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hPrime >= 2 && hPrime < 3) {
    [r1, g1, b1] = [0, c, x];
  } else if (hPrime >= 3 && hPrime < 4) {
    [r1, g1, b1] = [0, x, c];
  } else if (hPrime >= 4 && hPrime < 5) {
    [r1, g1, b1] = [x, 0, c];
  } else if (hPrime >= 5 && hPrime < 6) {
    [r1, g1, b1] = [c, 0, x];
  } else {
    [r1, g1, b1] = [0, 0, 0];
  }

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return `rgb(${r}, ${g}, ${b})`;
}

export function hslToRgba(h, s, l, a) {
  // h in [0, 360], s and l in [0, 100], a in [0, 1]
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1, g1, b1;

  if (hPrime >= 0 && hPrime < 1) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hPrime >= 1 && hPrime < 2) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hPrime >= 2 && hPrime < 3) {
    [r1, g1, b1] = [0, c, x];
  } else if (hPrime >= 3 && hPrime < 4) {
    [r1, g1, b1] = [0, x, c];
  } else if (hPrime >= 4 && hPrime < 5) {
    [r1, g1, b1] = [x, 0, c];
  } else if (hPrime >= 5 && hPrime < 6) {
    [r1, g1, b1] = [c, 0, x];
  } else {
    [r1, g1, b1] = [0, 0, 0];
  }

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
