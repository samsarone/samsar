import path from 'path';
import { isDockerRuntime } from '../util/environmentUtils.js';

export function getProcessorAssetsV2Root() {
  if (process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }

  if (isDockerRuntime()) {
    return '/assets_v2';
  }

  return path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2');
}

export function getProcessorAssetsV2Path(...segments) {
  return path.join(getProcessorAssetsV2Root(), ...segments);
}

export function toAssetsV2RelativePath(...segments) {
  return path.posix.join(
    'assets_v2',
    ...segments.map((segment) => String(segment).replace(/^\/+/, '').replace(/\\/g, '/'))
  );
}
