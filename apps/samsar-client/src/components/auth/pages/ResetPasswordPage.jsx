// src/components/auth/ResetPasswordPage.jsx
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, resolveLanguageCode } from '../../../constants/supportedLanguages.js';
import OverflowContainer from '../../common/OverflowContainer.tsx'; // keep as‑is if TSX
import { useColorMode } from '../../../contexts/ColorMode.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

const translations = {
  en: {
    title: 'Reset your password',
    emailLabel: 'Email',
    passwordLabel: 'New password',
    confirmPasswordLabel: 'Confirm new password',
    submit: 'Reset password',
    submitting: 'Submitting...',
    success: 'Password updated! Redirecting to login...',
    errors: {
      email: 'Email is required',
      password: 'New password is required',
      mismatch: 'Passwords do not match',
      code: 'Reset code is missing or invalid',
      generic: 'Something went wrong',
    },
    remember: 'Remembered your password?',
    login: 'Log in',
    language: 'Language',
    resendTitle: 'Need a new reset link?',
    resendBody: 'If your link expired or is incorrect, request another email.',
    resendButton: 'Send new reset email',
    resendSuccess: 'If this email exists, a new reset link has been sent.',
    resendError: 'Unable to send reset email. Please try again.',
  },
  es: {
    title: 'Restablece tu contraseña',
    emailLabel: 'Correo electrónico',
    passwordLabel: 'Nueva contraseña',
    confirmPasswordLabel: 'Confirmar contraseña',
    submit: 'Restablecer contraseña',
    submitting: 'Enviando...',
    success: '¡Contraseña actualizada! Redirigiendo al inicio...',
    errors: {
      email: 'El correo es obligatorio',
      password: 'La nueva contraseña es obligatoria',
      mismatch: 'Las contraseñas no coinciden',
      code: 'El enlace de restablecimiento no es válido',
      generic: 'Ha ocurrido un error',
    },
    remember: '¿Recordaste tu contraseña?',
    login: 'Iniciar sesión',
    language: 'Idioma',
    resendTitle: '¿Necesitas un nuevo enlace?',
    resendBody: 'Si el enlace venció o es incorrecto, solicita otro correo.',
    resendButton: 'Enviar nuevo correo',
    resendSuccess: 'Si el correo existe, se envió un nuevo enlace.',
    resendError: 'No se pudo enviar el correo. Inténtalo nuevamente.',
  },
  fr: {
    title: 'Réinitialisez votre mot de passe',
    emailLabel: 'E-mail',
    passwordLabel: 'Nouveau mot de passe',
    confirmPasswordLabel: 'Confirmer le mot de passe',
    submit: 'Réinitialiser le mot de passe',
    submitting: 'Envoi...',
    success: 'Mot de passe mis à jour ! Redirection...',
    errors: {
      email: "L'e-mail est requis",
      password: 'Le nouveau mot de passe est requis',
      mismatch: 'Les mots de passe ne correspondent pas',
      code: 'Le lien de réinitialisation est invalide',
      generic: 'Une erreur est survenue',
    },
    remember: 'Vous vous souvenez de votre mot de passe ?',
    login: 'Se connecter',
    language: 'Langue',
    resendTitle: "Besoin d'un nouveau lien ?",
    resendBody: 'Si le lien a expiré ou est incorrect, demandez un nouvel e-mail.',
    resendButton: 'Envoyer un nouvel e-mail',
    resendSuccess: 'Si cet e-mail existe, un nouveau lien a été envoyé.',
    resendError: "Impossible d'envoyer l'e-mail. Réessayez.",
  },
};

const getInitialLanguage = (urlLang) => {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('preferredLanguage') : null;
  const browser = typeof navigator !== 'undefined' && navigator.language ? navigator.language.split('-')[0] : null;
  const resolved = resolveLanguageCode(urlLang || saved || browser || 'en', 'en');
  return resolved === 'auto' ? 'en' : resolved;
};

export default function ResetPasswordPage() {
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
  const [language,        setLanguage]        = useState(() => getInitialLanguage(urlLang));
  const [allowResend,     setAllowResend]     = useState(!urlCode);
  const [resendStatus,    setResendStatus]    = useState(null);

  const copy = useMemo(() => translations[language] || translations.en, [language]);
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
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferredLanguage', language);
    }
  }, [language]);

  useEffect(() => {
    if (!urlCode) {
      setError(copy.errors.code);
    }
  }, [urlCode, copy.errors.code]);

  /* ——— form submit ——— */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResendStatus(null);
    setAllowResend(false);

    // minimal checks
    if (!email)                     { setError(copy.errors.email); setAllowResend(true); return; }
    if (!password)                  { setError(copy.errors.password); setAllowResend(true); return; }
    if (password !== confirmPassword) { setError(copy.errors.mismatch); return; }
    if (!urlCode)                   { setError(copy.errors.code); setAllowResend(true); return; }

    try {
      setSubmitting(true);

      await axios.post(
        `${PROCESSOR_SERVER}/users/submit_reset_password`,
        { email, code: urlCode, password }      // <── include both email & code
      );

      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || copy.errors.generic;
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
      setError(copy.errors.email);
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
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm mb-1">{copy.language}</label>
            <select
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
                <label className="block mb-1 text-sm">{copy.emailLabel}</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* New password */}
              <div>
                <label className="block mb-1 text-sm">{copy.passwordLabel}</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/* Confirm */}
              <div>
                <label className="block mb-1 text-sm">{copy.confirmPasswordLabel}</label>
                <input
                  type="password"
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
