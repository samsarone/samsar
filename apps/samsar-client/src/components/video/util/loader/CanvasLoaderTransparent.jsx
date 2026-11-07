import { useUiLanguage } from '../../../../hooks/useUiLanguage.js';

import './canvasLoader.css';

export default function CanvasLoaderTransparent() {
  useUiLanguage();
  return (
    <div className=" flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="muted-loader mb-8"></div>
      </div>
    </div>
  )
}