import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText, translateAuthError } from '../../utils/localization.js';
import LanguageSelect from '../common/LanguageSelect.jsx';
import { useState } from 'react';
import { FaGoogle } from 'react-icons/fa6';
import LoginButton from './LoginButton.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';

const buildUsernameFromEmail = (email) => {
  const localPart = email.split('@')[0] || 'user';
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  return normalized || `user_${Date.now().toString(36)}`;
};

export default function Register(props) {
  useUiLanguage();
  const {
    setCurrentLoginView,
    registerWithGoogle,
    registerUserWithEmail,
    showLoginButton = true,
  } = props;

  const { colorMode } = useColorMode();
  const { language } = useLocalization();

  const [error, setError] = useState(null);

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

  const submitUserRegister = (evt) => {
    evt.preventDefault();
    const email = evt.currentTarget.elements.namedItem('email').value.trim().toLowerCase();
    const password = evt.currentTarget.elements.namedItem('password').value;

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    const payload = {
      email,
      password,
      username: buildUsernameFromEmail(email),
      preferredLanguage: language || 'en',
      subscribeToWeeklyNewsletter: false,
    };

    registerUserWithEmail(payload, (serverErrorMessage) => {
      setError(serverErrorMessage);
    });

    localStorage.setItem('isPaymentPopupVisible', 'true');
  };

  const handleRegisterWithGoogle = () => {
    setError(null);
    registerWithGoogle({ subscribeToWeeklyNewsletter: false });
  };

  return (
    <div className={`w-full max-w-[420px] rounded-xl p-5 sm:p-6 space-y-4 ${cardClasses}`}>
      <LanguageSelect />
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold">{uiText("Create account")}</h2>
        <p className={`text-xs ${subduedText}`}>{uiText("Start with email and password.")}</p>
      </div>

      <div className={`grid grid-cols-2 rounded-lg p-1 ${tabShellClasses}`}>
        <button
          type="button"
          className={`${tabBase} ${tabInactive}`}
          onClick={() => setCurrentLoginView('login')}
        >{uiText("Login")}</button>
        <button type="button" className={`${tabBase} ${tabActive}`}>{uiText("Sign up")}</button>
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-500" role="alert">
          {translateAuthError(error, "Unable to create your account. Please try again.")}
        </p>
      )}

      <button
        type="button"
        onClick={handleRegisterWithGoogle}
        className={`flex items-center justify-center w-full rounded-lg py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#f6c453]/65 ${googleButtonClasses}`}
        aria-label={uiText("Register with Google")}
      >
        <FaGoogle className={`mr-2 ${colorMode === 'dark' ? 'text-[#ffe0a3]' : 'text-blue-500'}`} />
        <span className="font-semibold">{uiText("Sign up with Google")}</span>
      </button>

      <div className="flex items-center gap-3 text-caption uppercase tracking-[0.3em] text-slate-400">
        <span className="flex-1 h-px bg-slate-300/50" />
        <span>{uiText("OR")}</span>
        <span className="flex-1 h-px bg-slate-300/50" />
      </div>

      <form onSubmit={submitUserRegister} className="space-y-3.5">
        <div className={fieldClasses}>
          <label htmlFor="email" className={labelClasses}>{uiText("Email")}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={controlClasses}
            placeholder={uiText("you@example.com")}
            required
          />
        </div>

        <div className={fieldClasses}>
          <label htmlFor="password" className={labelClasses}>{uiText("Password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={controlClasses}
            placeholder={uiText("Password")}
            required
          />
        </div>

        <LoginButton type="submit" extraClasses="w-full">{uiText("Create account")}</LoginButton>
      </form>

      <p className={`text-center text-caption leading-5 ${subduedText}`}>{uiText("By creating an account, you confirm you are 18 or older and agree to the")}{' '}
        <a href="https://samsar.one/terms" target="_blank" rel="noopener noreferrer" className="underline">{uiText("terms")}</a>{' '}{uiText("and")}{' '}
        <a href="https://samsar.one/privacy" target="_blank" rel="noopener noreferrer" className="underline">{uiText("privacy policy")}</a>
        .
      </p>

      {showLoginButton && (
        <div className={`text-center text-sm ${subduedText}`}>{uiText("Already have an account?")}{' '}
          <button
            type="button"
            onClick={() => setCurrentLoginView('login')}
            className={colorMode === 'dark' ? 'text-[#ffe0a3] hover:underline' : 'text-blue-500 hover:underline'}
          >{uiText("Login")}</button>
        </div>
      )}
    </div>
  );
}
