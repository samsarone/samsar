import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';
import { useLocalization } from '../../../contexts/LocalizationContext.jsx';
import { useState } from 'react';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import LanguageSelect from '../../common/LanguageSelect.jsx';
import axios from 'axios';
import { Link } from 'react-router-dom';
import OverflowContainer from '../../common/OverflowContainer.tsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;



export default function ForgotPassword() {
  useUiLanguage();

  const { colorMode } = useColorMode();
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const { language, setLanguage } = useLocalization();

  const formBgColor = colorMode === 'light' ? 'bg-neutral-50' : 'bg-neutral-900';
  const formTextColor = colorMode === 'light' ? 'text-neutral-900' : 'text-neutral-50';
  const selectClasses = colorMode === 'light'
    ? 'bg-white text-slate-900 border border-slate-200'
    : 'bg-neutral-800 text-white';
  const mutedText = colorMode === 'light' ? "text-slate-500" : "text-neutral-400";
  const copy = {
  "title": uiText("Forgot Password"),
  "intro": uiText("Enter your email address below to reset your password."),
  "emailLabel": uiText("Email"),
  "submit": uiText("Reset Password"),
  "success": uiText("Check your email for password reset instructions."),
  "error": uiText("Failed to send reset email. Please try again."),
  "back": uiText("Back to Login"),
  "language": uiText("Language")
};



  const handleForgotPassword = (e) => {
    e.preventDefault();
    const email = e.currentTarget.elements.namedItem('email').value.trim().toLowerCase();

    axios
      .post(`${PROCESSOR_SERVER}/users/forgot_password`, { email, language })
      .then(() => {
        setSuccess(true);
        setError(null);
      })
      .catch(() => {

        setError(true);
        setSuccess(null);
      });
  };

  return (
    <OverflowContainer>
    <div className={`w-[300px] m-auto mt-16`}>
      <div className={`text-center font-bold text-2xl mb-4 ${formTextColor}`}>{copy.title}</div>
      {error && <div className="text-red-500 text-center mb-4">{copy.error}</div>}
      {success && <div className="text-blue-500 text-center mb-4">{copy.success}</div>}
      <LanguageSelect className="mb-4" />
      <p className={`${mutedText} text-center mb-6`}>{copy.intro}</p>
      <form onSubmit={handleForgotPassword} className={`w-full ${formTextColor}` }>
        <div className="form-group">
          <label htmlFor="recovery-email" className="text-xs text-left font-bold pl-1">{copy.emailLabel}</label>
          <input
            id="recovery-email"
            required
            autoComplete="email"
            type="email"
            name="email"
            className={`form-control mb-4 mt-2 rounded-lg p-1 pl-4 h-[45px] w-full ${formBgColor} ${formTextColor}`}
            placeholder={copy.emailLabel}
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg"
        >
          {copy.submit}
        </button>
      </form>
      <div className="mt-4 text-center text-xs text-neutral-500">
        <Link to="/login" className="text-blue-500 hover:text-blue-600">
          {copy.back}
        </Link>
      </div>
    </div>
    </OverflowContainer>
  );
}
