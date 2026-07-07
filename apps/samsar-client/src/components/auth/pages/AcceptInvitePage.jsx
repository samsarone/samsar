import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaCheckCircle, FaEnvelope, FaLock } from 'react-icons/fa';

import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { useUser } from '../../../contexts/UserContext.jsx';
import { persistAuthToken } from '../../../utils/web.jsx';
import OverflowContainer from '../../common/OverflowContainer.tsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

function formatLimit(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? `${numericValue} model calls` : 'Unlimited model calls';
}

export default function AcceptInvitePage() {
  const { colorMode } = useColorMode();
  const { setUser } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search]);

  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isDark = colorMode === 'dark';
  const pageClass = isDark ? 'text-slate-100' : 'text-slate-900';
  const panelClass = isDark
    ? 'border border-slate-800 bg-slate-950'
    : 'border border-slate-200 bg-white';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputClass = isDark
    ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-cyan-500/25'
    : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:ring-cyan-200';
  const infoClass = isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50';

  useEffect(() => {
    let isCancelled = false;

    const previewInvite = async () => {
      if (!token) {
        setError('Invitation token is missing.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await axios.get(`${PROCESSOR_SERVER}/users/team/invite/preview`, {
          params: { token },
        });
        if (!isCancelled) {
          setInvite(response.data);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err?.response?.data?.error || 'Invitation link is invalid or expired.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void previewInvite();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  const submitInvite = async (event) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await axios.post(`${PROCESSOR_SERVER}/users/team/accept_invite`, {
        token,
        password,
      });
      const userData = response.data;
      if (!userData?.authToken) {
        throw new Error('Missing authentication token.');
      }
      persistAuthToken(userData.authToken);
      setUser(userData);
      navigate('/vidgenie', { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Unable to accept this invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OverflowContainer>
      <div className={`flex min-h-[calc(100vh-96px)] w-full items-center justify-center px-4 py-8 ${pageClass}`}>
        <div className={`w-full max-w-md rounded-lg p-5 shadow-sm sm:p-6 ${panelClass}`}>
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
              <FaEnvelope />
            </div>
            <h1 className="text-2xl font-semibold">Join {invite?.organizationName || 'team'}</h1>
            <p className={`mt-1 text-sm ${mutedText}`}>Set your password to finish your team account.</p>
          </div>

          {loading ? (
            <div className={`rounded-lg border p-4 text-sm ${infoClass}`}>Loading invitation...</div>
          ) : error && !invite ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
                {error}
              </div>
              <Link to="/login" className="block text-center text-sm font-semibold text-cyan-500 hover:underline">
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <div className={`mb-5 rounded-lg border p-4 text-sm ${infoClass}`}>
                <div className="flex items-start gap-3">
                  <FaCheckCircle className="mt-0.5 shrink-0 text-emerald-500" />
                  <div className="min-w-0">
                    <p className="font-semibold">{invite?.username || invite?.email}</p>
                    <p className={`break-all ${mutedText}`}>{invite?.email}</p>
                    <p className={`mt-2 ${mutedText}`}>{formatLimit(invite?.modelApiCallLimit)}</p>
                    {invite?.expiresAt && (
                      <p className={`mt-1 ${mutedText}`}>Expires {formatDate(invite.expiresAt)}</p>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
                  {error}
                </div>
              )}

              <form onSubmit={submitInvite} className="space-y-4">
                <div>
                  <label htmlFor="team-invite-email" className="mb-1 block text-sm font-semibold">
                    Email
                  </label>
                  <input
                    id="team-invite-email"
                    type="email"
                    value={invite?.email || ''}
                    readOnly
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm opacity-80 outline-none ${inputClass}`}
                  />
                </div>
                <div>
                  <label htmlFor="team-invite-password" className="mb-1 block text-sm font-semibold">
                    Password
                  </label>
                  <div className="relative">
                    <FaLock className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`} />
                    <input
                      id="team-invite-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      className={`w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 ${inputClass}`}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="team-invite-confirm-password" className="mb-1 block text-sm font-semibold">
                    Confirm password
                  </label>
                  <input
                    id="team-invite-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 ${inputClass}`}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[42px] w-full items-center justify-center rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-60"
                >
                  {submitting ? 'Joining...' : 'Join team'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </OverflowContainer>
  );
}
