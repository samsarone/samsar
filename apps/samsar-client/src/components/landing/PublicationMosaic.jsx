import { useMemo } from 'react';
import { useMediaQuery } from 'react-responsive';

const layouts = {
  small: { itemsPerSlide: 8, targetRowRatio: 3.4, maxStacks: 4, maxSingleRowHeight: 180, gap: 6 },
  medium: { itemsPerSlide: 12, targetRowRatio: 5.2, maxStacks: 6, maxSingleRowHeight: 220, gap: 8 },
  large: { itemsPerSlide: 16, targetRowRatio: 6.8, maxStacks: 8, maxSingleRowHeight: 250, gap: 8 },
};

export function usePublicationLayout() {
  const large = useMediaQuery({ minWidth: 1024 });
  const medium = useMediaQuery({ minWidth: 640 });
  return large ? layouts.large : medium ? layouts.medium : layouts.small;
}

function packRows(items, { targetRowRatio, maxStacks }) {
  if (!items.length) return [];
  // Two landscapes can share the height of a neighboring portrait. For a
  // vertical stack of equal-width tiles, height/width is the sum of 1/ratio.
  const landscapes = items.filter((item) => item.aspectRatio >= 4 / 3);
  const portraitCount = items.filter((item) => item.aspectRatio < 1).length;
  const pairCount = Math.min(portraitCount, Math.floor(landscapes.length / 2));
  const paired = landscapes.slice(0, pairCount * 2);
  const groups = items.filter((item) => !paired.includes(item)).map((item) => [item]);
  for (let i = 0; i < paired.length; i += 2) groups.push(paired.slice(i, i + 2));

  const stacks = groups.map((tiles) => ({
    tiles,
    ratio: 1 / tiles.reduce((height, tile) => height + 1 / tile.aspectRatio, 0),
    order: items.indexOf(tiles[0]),
  }));
  const total = stacks.reduce((sum, stack) => sum + Math.min(stack.ratio, targetRowRatio), 0);
  const count = Math.max(Math.ceil(stacks.length / maxStacks), Math.round(total / targetRowRatio), 1);
  const rows = Array.from({ length: count }, () => ({ stacks: [], ratio: 0 }));

  // Place the widest stacks first so a run of similar videos in the feed
  // doesn't leave a sparse last row. DOM order follows the finished layout.
  stacks.sort((a, b) => b.ratio - a.ratio || a.order - b.order);
  for (const stack of stacks) {
    const available = rows.filter((row) => row.stacks.length < maxStacks);
    const row = available.reduce((best, next) => next.ratio < best.ratio ? next : best);
    row.stacks.push(stack);
    row.ratio += stack.ratio;
  }
  // Alternating the order staggers the seams even for repeating aspect ratios.
  rows.forEach((row, index) => {
    row.stacks.sort((a, b) => index % 2 === 0 ? a.order - b.order : b.order - a.order);
  });
  return rows;
}

// The width of a row at a given height, including its horizontal and vertical gutters.
function rowWidthAtHeight(stacks, height, gap) {
  let width = (stacks.length - 1) * gap;
  for (const { tiles, ratio } of stacks) {
    width += ratio * (height - (tiles.length - 1) * gap);
  }
  return width;
}

export default function PublicationMosaic({ items, layout, renderTile }) {
  const rows = useMemo(() => packRows(items, layout), [items, layout]);
  const { gap, maxSingleRowHeight } = layout;
  return <div className="flex w-full flex-col" style={{ gap }}>
    {rows.map((row) => {
      const depth = Math.max(...row.stacks.map((stack) => stack.tiles.length));
      // A short feed (especially a lone portrait) should keep thumbnail scale.
      const maxWidth = rows.length === 1 && items.length < layout.itemsPerSlide
        ? rowWidthAtHeight(row.stacks, maxSingleRowHeight, gap)
        : undefined;
      return <div key={row.stacks[0].tiles[0].id} className="flex w-full items-start" style={{ gap, maxWidth }}>
        {row.stacks.map((stack) => <div key={stack.tiles[0].id} className="flex min-w-0 flex-col" style={{
          gap,
          flexGrow: 100 * stack.ratio / row.ratio,
          // Shallower stacks get the width corresponding to the internal
          // gutters they lack. The remaining width scales all heights equally.
          flexBasis: stack.ratio * (depth - stack.tiles.length) * gap,
        }}>
          {stack.tiles.map(renderTile)}
        </div>)}
      </div>;
    })}
  </div>;
}
