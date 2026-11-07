import { useUiLanguage } from '../../../hooks/useUiLanguage.js';

import Loader from '../../common/Loader';

export default function LoadingImage() {
  useUiLanguage();
  return (
    <Loader />
  );
}
