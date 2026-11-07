import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import LanguageSelect from '../common/LanguageSelect.jsx';
import { useRef, useState } from 'react';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import axios from 'axios';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function ForgotPassword(props) {
  const uiLanguage = useUiLanguage();
  const { setCurrentLoginView } = props;
  const { colorMode } = useColorMode();
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const formBgColor = colorMode === 'light' ? 'bg-neutral-50' : 'bg-neutral-900';
  const formTextColor = colorMode === 'light' ? 'text-neutral-900' : 'text-neutral-50';

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const email = e.currentTarget.elements.namedItem('email').value.trim().toLowerCase();
    if (!email) {
      setError("Email is required.");
      setSuccess(null);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.post(`${PROCESSOR_SERVER}/users/forgot_password`, { email, language: uiLanguage });
      setSuccess("Check your email for password reset instructions.");
    } catch {
      setError("Failed to send reset email. Please try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-[300px] m-auto mt-8">
      <LanguageSelect className="mb-4" />
      <div className="text-center font-bold text-2xl mb-4">{uiText("Forgot Password")}</div>
      {error && <div className="text-red-500 text-center mb-4">{uiText(error)}</div>}
      {success && <div className="text-blue-500 text-center mb-4">{uiText(success)}</div>}
      <p className="text-neutral-500 text-center mb-6">{uiText("Enter your email address below to reset your password.")}</p>
      <form onSubmit={handleForgotPassword} className="w-full">
        <div className="form-group">
          <label htmlFor="forgot-password-email" className="text-xs text-left font-bold pl-1">{uiText("Email")}</label>
          <input
            id="forgot-password-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            className={`form-control mb-4 mt-2 rounded-lg p-1 pl-4 h-[45px] w-full ${formBgColor} ${formTextColor}`}
            placeholder={uiText("Email")}
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg"
        >{uiText("Reset Password")}</button>
      </form>
      <div className="mt-4 text-center text-xs text-neutral-500">
        <a href="#" onClick={(event) => { event.preventDefault(); setCurrentLoginView('login'); }}>{uiText("Back to Login")}</a>
      </div>
    </div>
  );
}
