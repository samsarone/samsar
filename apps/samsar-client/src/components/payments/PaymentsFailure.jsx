import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';

import CommonContainer from '../common/CommonContainer.tsx';

export default function PaymentsFailure() {
  useUiLanguage();
  return (
    <CommonContainer>
      <div>
        <h1>{uiText("Payment Failed")}</h1>
        <p>{uiText("Sorry, your payment failed. Please try again.")}</p>
      </div>
    </CommonContainer>
  );
}