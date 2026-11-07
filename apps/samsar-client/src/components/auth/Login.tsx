import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText, translateAuthError } from '../../utils/localization.js';
import LanguageSelect from '../common/LanguageSelect.jsx';
import { useRef, useState } from 'react';
import { FaGoogle } from 'react-icons/fa6';
import LoginButton from './LoginButton.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { persistAuthToken } from '../../utils/web';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function Login(props) {
  useUiLanguage();
  const {
    setCurrentLoginView,
    signInWithGoogle,
    setUser,
    closeAlertDialog,
    getOrCreateUserSession,
    showSignupButton = true,
    showGoogleAuth = true,
  } = props;

  const { colorMode } = useColorMode();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submitUserLogin = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const email = e.currentTarget.elements.namedItem('email').value.trim().toLowerCase();
    const password = e.currentTarget.elements.namedItem('password').value;

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    submittingRef.current = true;
    setIsSubmitting(true);
    const payload = { email, password };

    try {
      const { data: userData } = await axios.post(`${PROCESSOR_SERVER}/users/login`, payload);
      persistAuthToken(userData.authToken);
      setUser(userData);
      closeAlertDialog();
      await getOrCreateUserSession(userData);
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
        setError(err.response.data.message);
      } else {
        setError("Invalid email or password. Please try again.");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const cardClasses =
    `border border-line text-fg ${colorMode === 'light' ? 'bg-[#f8fafc]' : 'bg-[#181b24]/96 shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl'}`;
  const tabBase =
    'rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#f6c453]/65';
  const tabActive = colorMode === 'light' ? 'bg-blue-600 text-white' : 'bg-[#ff4655]/16 text-[#ffd4d8]';
  const tabInactive =
    `text-fg-muted ${colorMode === 'light' ? 'hover:text-slate-900' : 'hover:text-slate-100'}`;

  const inputClasses =
    `border-line-control text-fg ${colorMode === 'light' ? 'bg-[#ffffff] placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-200' : 'bg-[#151720] placeholder:text-[#8b96aa] focus:border-[#f6c453] focus:ring-[#f6c453]/24'}`;

  const googleButtonClasses =
    `text-fg border border-line-control ${colorMode === 'light' ? 'bg-[#ffffff] hover:border-blue-400/70 hover:bg-slate-50' : 'bg-[#20232e] hover:border-[#ff4655]/60 hover:bg-[#292d3a]'}`;
  const tabShellClasses =
    `border border-line ${colorMode === 'light' ? 'bg-slate-100' : 'bg-[#12141c]'}`;
  const subduedText = "text-fg-muted";
  const fieldClasses = 'space-y-1.5';
  const labelClasses = 'block text-xs font-semibold';
  const controlClasses = `w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${inputClasses}`;

  return (
    <div className={`w-full max-w-[420px] rounded-xl p-5 sm:p-6 space-y-4 ${cardClasses}`}>
      <LanguageSelect />
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold">{uiText("Welcome back")}</h2>
        <p className={`text-xs ${subduedText}`}>{uiText("Sign in to continue")}</p>
      </div>

      <div className={`grid ${showSignupButton ? 'grid-cols-2' : 'grid-cols-1'} rounded-lg p-1 ${tabShellClasses}`}>
        <button type="button" className={`${tabBase} ${tabActive}`}>{uiText("Login")}</button>
        {showSignupButton && (
          <button
            type="button"
            className={`${tabBase} ${tabInactive}`}
            onClick={() => setCurrentLoginView('register')}
          >{uiText("Sign up")}</button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-500" role="alert">
          {translateAuthError(error, "Invalid email or password. Please try again.")}
        </p>
      )}

      {showGoogleAuth && (
        <>
          <button
            type="button"
            className={`flex items-center justify-center w-full rounded-lg py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#f6c453]/65 ${googleButtonClasses}`}
            onClick={signInWithGoogle}
          >
            <FaGoogle className={`inline-block mr-2 ${colorMode === 'dark' ? 'text-[#ffe0a3]' : 'text-blue-600'}`} />
            <span className="font-semibold">{uiText("Continue with Google")}</span>
          </button>

          <div className="flex items-center gap-3 text-caption uppercase tracking-[0.3em] text-slate-400">
            <span className="flex-1 h-px bg-slate-300/50" />
            <span>{uiText("OR")}</span>
            <span className="flex-1 h-px bg-slate-300/50" />
          </div>
        </>
      )}

      <form onSubmit={submitUserLogin} className="space-y-3.5">
        <div className={fieldClasses}>
          <label htmlFor="login-email" className={labelClasses}>{uiText("Email")}</label>
          <input
            id="login-email"
            type="email"
            name="email"
            autoComplete="email"
            className={controlClasses}
            placeholder={uiText("you@example.com")}
            required
          />
        </div>
        <div className={fieldClasses}>
          <label htmlFor="login-password" className={labelClasses}>{uiText("Password")}</label>
          <input
            id="login-password"
            type="password"
            name="password"
            autoComplete="current-password"
            className={controlClasses}
            placeholder={uiText("Password")}
            required
          />
        </div>
        <LoginButton type="submit" isPending={isSubmitting} extraClasses="w-full">{uiText("Login")}</LoginButton>
      </form>

      <div className="text-center text-xs text-slate-500">
        <Link to="/forgot_password" className={colorMode === 'dark' ? 'text-[#ffe0a3] hover:underline' : 'text-blue-600 hover:underline'}>{uiText("Forgot password?")}</Link>
      </div>

      {showSignupButton && (
        <div className={`text-center text-sm ${subduedText}`}>{uiText("Don't have an account?")}{' '}
          <button
            type="button"
            onClick={() => setCurrentLoginView('register')}
            className={colorMode === 'dark' ? 'text-[#ffe0a3] hover:underline' : 'text-blue-500 hover:underline'}
          >{uiText("Sign up")}</button>
        </div>
      )}
    </div>
  );
}
