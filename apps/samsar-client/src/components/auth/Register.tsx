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
    colorMode === 'light'
      ? 'bg-[#f8fafc] text-slate-900 border border-slate-200'
      : 'bg-slate-950 text-slate-100 border border-slate-800 shadow-xl';
  const tabBase =
    'rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500/40';
  const tabActive = colorMode === 'light' ? 'bg-blue-600 text-white' : 'bg-blue-500/20 text-blue-200';
  const tabInactive =
    colorMode === 'light'
      ? 'text-slate-500 hover:text-slate-900'
      : 'text-slate-400 hover:text-slate-100';

  const inputClasses =
    colorMode === 'light'
      ? 'bg-[#ffffff] border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-200'
      : 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:ring-blue-500/30';

  const googleButtonClasses =
    colorMode === 'light'
      ? 'bg-[#ffffff] text-slate-900 border border-slate-200 hover:border-blue-400/70 hover:bg-slate-50'
      : 'bg-slate-900 text-slate-100 border border-slate-700 hover:border-blue-400/60 hover:bg-slate-800';
  const tabShellClasses =
    colorMode === 'light'
      ? 'border border-slate-200 bg-slate-100'
      : 'border border-slate-300/30 bg-black/5';
  const subduedText = colorMode === 'light' ? 'text-slate-500' : 'text-slate-400';

  const fieldClasses = 'space-y-1.5';
  const labelClasses = 'block text-xs font-semibold';
  const controlClasses = `w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${inputClasses}`;

  const submitUserRegister = (evt) => {
    evt.preventDefault();
    const email = evt.target.email.value.trim().toLowerCase();
    const password = evt.target.password.value;

    if (!email || !password) {
      setError('Email and password are required.');
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
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold">Create account</h2>
        <p className={`text-xs ${subduedText}`}>Start with email and password.</p>
      </div>

      <div className={`grid grid-cols-2 rounded-lg p-1 ${tabShellClasses}`}>
        <button
          type="button"
          className={`${tabBase} ${tabInactive}`}
          onClick={() => setCurrentLoginView('login')}
        >
          Login
        </button>
        <button type="button" className={`${tabBase} ${tabActive}`}>
          Sign up
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleRegisterWithGoogle}
        className={`flex items-center justify-center w-full rounded-lg py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${googleButtonClasses}`}
        aria-label="Register with Google"
      >
        <FaGoogle className="mr-2 text-blue-500" />
        <span className="font-semibold">Sign up with Google</span>
      </button>

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-400">
        <span className="flex-1 h-px bg-slate-300/50" />
        <span>OR</span>
        <span className="flex-1 h-px bg-slate-300/50" />
      </div>

      <form onSubmit={submitUserRegister} className="space-y-3.5">
        <div className={fieldClasses}>
          <label htmlFor="email" className={labelClasses}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={controlClasses}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className={fieldClasses}>
          <label htmlFor="password" className={labelClasses}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={controlClasses}
            placeholder="Password"
            required
          />
        </div>

        <LoginButton type="submit" extraClasses="w-full">
          Create account
        </LoginButton>
      </form>

      <p className={`text-center text-[11px] leading-5 ${subduedText}`}>
        By creating an account, you confirm you are 18 or older and agree to the{' '}
        <a href="https://samsar.one/terms" target="_blank" rel="noopener noreferrer" className="underline">
          terms
        </a>{' '}
        and{' '}
        <a href="https://samsar.one/privacy" target="_blank" rel="noopener noreferrer" className="underline">
          privacy policy
        </a>
        .
      </p>

      {showLoginButton && (
        <div className={`text-center text-sm ${subduedText}`}>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => setCurrentLoginView('login')}
            className="text-blue-500 hover:underline"
          >
            Login
          </button>
        </div>
      )}
    </div>
  );
}
