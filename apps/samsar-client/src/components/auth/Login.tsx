import { useState } from 'react';
import { FaGoogle } from 'react-icons/fa6';
import LoginButton from './LoginButton.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { persistAuthToken } from '../../utils/web';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function Login(props) {
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

  const submitUserLogin = (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase();
    const password = e.target.password.value;

    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setError(null);
    const payload = { email, password };

    axios
      .post(`${PROCESSOR_SERVER}/users/login`, payload)
      .then((dataRes) => {
        const userData = dataRes.data;
        const authToken = userData.authToken;
        persistAuthToken(authToken);
        setUser(userData);
        closeAlertDialog();
        getOrCreateUserSession(userData);
      })
      .catch((err) => {
        if (err.response && err.response.data && err.response.data.message) {
          setError(err.response.data.message);
        } else {
          setError('Invalid email or password. Please try again.');
        }
      });
  };

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

  return (
    <div className={`w-full max-w-[420px] rounded-xl p-5 sm:p-6 space-y-4 ${cardClasses}`}>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold">Welcome back</h2>
        <p className={`text-xs ${subduedText}`}>Sign in to continue</p>
      </div>

      <div className={`grid ${showSignupButton ? 'grid-cols-2' : 'grid-cols-1'} rounded-lg p-1 ${tabShellClasses}`}>
        <button type="button" className={`${tabBase} ${tabActive}`}>
          Login
        </button>
        {showSignupButton && (
          <button
            type="button"
            className={`${tabBase} ${tabInactive}`}
            onClick={() => setCurrentLoginView('register')}
          >
            Sign up
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {showGoogleAuth && (
        <>
          <button
            type="button"
            className={`flex items-center justify-center w-full rounded-lg py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${googleButtonClasses}`}
            onClick={signInWithGoogle}
          >
            <FaGoogle className="inline-block mr-2 text-blue-600" />
            <span className="font-semibold">Continue with Google</span>
          </button>

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-400">
            <span className="flex-1 h-px bg-slate-300/50" />
            <span>OR</span>
            <span className="flex-1 h-px bg-slate-300/50" />
          </div>
        </>
      )}

      <form onSubmit={submitUserLogin} className="space-y-3.5">
        <div className={fieldClasses}>
          <label htmlFor="login-email" className={labelClasses}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            name="email"
            autoComplete="email"
            className={controlClasses}
            placeholder="you@example.com"
            required
          />
        </div>
        <div className={fieldClasses}>
          <label htmlFor="login-password" className={labelClasses}>
            Password
          </label>
          <input
            id="login-password"
            type="password"
            name="password"
            autoComplete="current-password"
            className={controlClasses}
            placeholder="Password"
            required
          />
        </div>
        <LoginButton type="submit" extraClasses="w-full">Login</LoginButton>
      </form>

      <div className="text-center text-xs text-slate-500">
        <Link to="/forgot_password" className="text-blue-600 hover:underline">
          Forgot password?
        </Link>
      </div>

      {showSignupButton && (
        <div className={`text-center text-sm ${subduedText}`}>
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => setCurrentLoginView('register')}
            className="text-blue-500 hover:underline"
          >
            Sign up
          </button>
        </div>
      )}
    </div>
  );
}
