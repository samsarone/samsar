import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';

import '../../common/Loader.css'; // Import the custom CSS styles

const LoadingImageBase = () => {
  useUiLanguage();
  return (
    <div className="loader-background flex items-center justify-center w-full h-full">
      <div className="text-center">
        <div className="muted-loader mb-8"></div>
        <div className="muted-text">{uiText("Loading...")}</div>
      </div>
    </div>
  );
};

export default LoadingImageBase;
