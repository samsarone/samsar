import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText, translateAuthError } from '../../../utils/localization.js';
import { useLocalization } from '../../../contexts/LocalizationContext.jsx';
// src/components/auth/ResetPasswordPage.jsx
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, resolveLanguageCode } from '../../../constants/supportedLanguages.js';
import OverflowContainer from '../../common/OverflowContainer.tsx'; // keep as‑is if TSX
import { useColorMode } from '../../../contexts/ColorMode.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;



export default function ResetPasswordPage() {
  useUiLanguage();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { colorMode } = useColorMode();

  /* ——— grab url params ——— */
  const params  = new URLSearchParams(location.search);
  const urlEmail = params.get('email') || '';          // ?email=jane@doe.com
  const urlCode  = params.get('code');                 // ?code=ABC123
  const urlLang  = params.get('lang');

  /* ——— component state ——— */
  const [email,           setEmail]           = useState(urlEmail);
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState(null);
  const [success,         setSuccess]         = useState(false);
  const { language, setLanguage } = useLocalization();
  const [allowResend,     setAllowResend]     = useState(!urlCode);
  const [resendStatus,    setResendStatus]    = useState(null);

  const copy = {
  "title": uiText("Reset your password"),
  "emailLabel": uiText("Email"),
  "passwordLabel": uiText("New password"),
  "confirmPasswordLabel": uiText("Confirm new password"),
  "submit": uiText("Reset password"),
  "submitting": uiText("Submitting..."),
  "success": uiText("Password updated! Redirecting to login..."),
  "errors": {
    "email": uiText("Email is required"),
    "password": uiText("New password is required"),
    "mismatch": uiText("Passwords do not match"),
    "code": uiText("Reset code is missing or invalid"),
    "generic": uiText("Something went wrong")
  },
  "remember": uiText("Remembered your password?"),
  "login": uiText("Log in"),
  "language": uiText("Language"),
  "resendTitle": uiText("Need a new reset link?"),
  "resendBody": uiText("If your link expired or is incorrect, request another email."),
  "resendButton": uiText("Send new reset email"),
  "resendSuccess": uiText("If this email exists, a new reset link has been sent."),
  "resendError": uiText("Unable to send reset email. Please try again.")
};
  const isLight = colorMode === 'light';
  const panelClass = isLight
    ? 'bg-[#f8fafc] text-slate-900 border border-slate-200 rounded-lg p-6 max-w-md w-full'
    : 'bg-gray-800 text-white rounded-lg p-6 max-w-md w-full';
  const fieldClass = isLight
    ? 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring focus:ring-indigo-300'
    : 'w-full rounded bg-gray-700 text-white px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-500';
  const errorClass = isLight
    ? 'bg-red-50 text-red-700 border border-red-200 rounded p-2 mb-4'
    : 'bg-red-600/20 text-red-300 rounded p-2 mb-4';
  const successClass = isLight ? 'text-green-700 text-center' : 'text-green-400 text-center';
  const resendPanelClass = isLight
    ? 'mt-4 border border-slate-200 rounded p-3 bg-white'
    : 'mt-4 border border-gray-700 rounded p-3 bg-gray-900/50';
  const resendBodyClass = isLight ? 'text-sm text-slate-600 mb-2' : 'text-sm text-gray-300 mb-2';

  useEffect(() => {
    if (urlLang) setLanguage(resolveLanguageCode(urlLang, 'en'));
  }, [urlLang, setLanguage]);

  useEffect(() => {
    if (!urlCode) {
      setError("Reset code is missing or invalid");
    }
  }, [urlCode]);

  /* ——— form submit ——— */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResendStatus(null);
    setAllowResend(false);

    // minimal checks
    if (!email)                     { setError("Email is required"); setAllowResend(true); return; }
    if (!password)                  { setError("New password is required"); setAllowResend(true); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!urlCode)                   { setError("Reset code is missing or invalid"); setAllowResend(true); return; }

    try {
      setSubmitting(true);

      await axios.post(
        `${PROCESSOR_SERVER}/users/submit_reset_password`,
        { email, code: urlCode, password }      // <── include both email & code
      );

      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Something went wrong';
      setError(msg);
      const lowered = msg?.toString().toLowerCase() || '';
      if (lowered.includes('expired') || lowered.includes('invalid') || lowered.includes('token')) {
        setAllowResend(true);
      }
      setSubmitting(false);
    }
  };

  const requestNewLink = async () => {
    if (!email) {
      setError("Email is required");
      return;
    }

    try {
      setResendStatus('pending');
      await axios.post(`${PROCESSOR_SERVER}/users/forgot_password`, { email, language });
      setResendStatus('success');
      setError(null);
    } catch  {
      
      setResendStatus('error');
    }
  };

  /* ——— render ——— */
  return (
    <OverflowContainer>
      <div className="w-full flex flex-col items-center justify-center pt-20">
        <div className={panelClass}>
          <h1 className="text-2xl font-semibold text-center mb-6">
            {copy.title}
          </h1>

          {error && (
            <div className={errorClass}>
              {translateAuthError(error)}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="reset-password-language" className="block text-sm mb-1">{copy.language}</label>
            <select
              id="reset-password-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={fieldClass}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName || lang.name}
                </option>
              ))}
            </select>
          </div>

          {success ? (
            <div className={successClass}>
              {copy.success}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email field (pre‑filled but editable) */}
              <div>
                <label htmlFor="reset-password-email" className="block mb-1 text-sm">{copy.emailLabel}</label>
                <input
                  id="reset-password-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* New password */}
              <div>
                <label htmlFor="reset-password-new" className="block mb-1 text-sm">{copy.passwordLabel}</label>
                <input
                  id="reset-password-new"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* Confirm */}
              <div>
                <label htmlFor="reset-password-confirm" className="block mb-1 text-sm">{copy.confirmPasswordLabel}</label>
                <input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={fieldClass}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className={`w-full rounded py-2 font-medium
                            ${submitting ? 'bg-indigo-400' : 'bg-indigo-500 hover:bg-indigo-600'}
                            transition-colors`}
              >
                {submitting ? copy.submitting : copy.submit}
              </button>
            </form>
          )}

          {allowResend && !success && (
            <div className={resendPanelClass}>
              <div className="font-semibold mb-1">{copy.resendTitle}</div>
              <div className={resendBodyClass}>{copy.resendBody}</div>
              <button
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white rounded py-2 font-medium disabled:opacity-60"
                onClick={requestNewLink}
                disabled={resendStatus === 'pending'}
              >
                {resendStatus === 'pending' ? copy.submitting : copy.resendButton}
              </button>
              {resendStatus === 'success' && (
                <div className="text-green-400 text-sm mt-2">{copy.resendSuccess}</div>
              )}
              {resendStatus === 'error' && (
                <div className="text-red-400 text-sm mt-2">{copy.resendError}</div>
              )}
            </div>
          )}

          {!success && (
            <div className="text-center mt-4">
              {copy.remember}{' '}
              <Link to="/login" className="underline">
                {copy.login}
              </Link>
            </div>
          )}
        </div>
      </div>
    </OverflowContainer>
  );
}
