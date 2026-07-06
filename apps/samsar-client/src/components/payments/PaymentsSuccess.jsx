import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FaChartLine, FaCheckCircle, FaCoins, FaSync } from 'react-icons/fa';
import { useLocation, useNavigate } from 'react-router-dom';

import CommonContainer from '../common/CommonContainer.tsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const numberFormatter = new Intl.NumberFormat('en-US');

const formatAmount = (amountCents = 0, currency = 'USD') => {
  const dollars = Math.max(0, Number(amountCents || 0) / 100);
  return `${currency.toUpperCase()} ${dollars.toFixed(2)}`;
};

const formatDate = (value) => {
  if (!value) return 'Pending';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
};

export default function PaymentsSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const { colorMode } = useColorMode();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const stripeCustomerId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('stripeCustomerId') || params.get('stripe_customer_id') || '';
  }, [location.search]);

  const fetchSummary = useCallback(async () => {
    if (!stripeCustomerId) {
      setErrorMessage('Missing customer reference. Please return to your receipt link or sign in.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await axios.get(`${PROCESSOR_SERVER}/payments/summary`, {
        params: { stripeCustomerId },
      });
      setSummary(response.data || null);
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Unable to load payment summary right now.';
      setErrorMessage(message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [stripeCustomerId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const isDark = colorMode === 'dark';
  const textColor = isDark ? 'text-slate-100' : 'text-slate-900';
  const secondaryText = isDark ? 'text-slate-400' : 'text-slate-600';
  const cardBgColor = isDark ? 'bg-[#0f1629]' : 'bg-white';
  const borderColor = isDark ? 'border-[#1f2a3d]' : 'border-slate-200';
  const mutedBg = isDark ? 'bg-[#0b1224]' : 'bg-slate-50';
  const buttonClasses = isDark
    ? 'bg-[#111a2f] text-slate-100 shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:bg-[#162744] hover:shadow-[0_12px_24px_rgba(70,191,255,0.2)]'
    : 'bg-white text-slate-900 shadow-[0_8px_16px_rgba(15,23,42,0.08)] hover:bg-slate-50 hover:shadow-[0_12px_20px_rgba(15,23,42,0.14)]';

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date()),
    []
  );

  const creditsRecharged = summary?.creditsRecharged ?? 0;
  const creditsUsedThisMonth = summary?.creditsUsedThisMonth ?? 0;
  const totalCredits = summary?.totalCredits ?? 0;
  const lastTopUp = summary?.lastTopUp || null;
  const hasPayment = !!lastTopUp;

  return (
    <CommonContainer>
      <div className={`pt-[96px] pb-12 px-4 ${textColor} h-[calc(100vh-56px)] overflow-y-auto`}>
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className={`text-xs uppercase tracking-[0.32em] ${secondaryText}`}>
                Payment confirmed
              </p>
              <h1 className="text-3xl md:text-4xl font-bold">Credits recharged</h1>
              <p className={`mt-2 text-sm ${secondaryText}`}>
                Your credits are ready. If the balance looks off, give Stripe a moment and refresh.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/')}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0 ${buttonClasses}`}
              >
                Back to home
              </button>
              <button
                type="button"
                onClick={fetchSummary}
                disabled={loading || !stripeCustomerId}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0 ${buttonClasses} disabled:opacity-60`}
              >
                <FaSync className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div className={`rounded-2xl border ${borderColor} ${mutedBg} p-5`}>
              <p className="text-lg font-semibold">We could not load your payment summary.</p>
              <p className={`mt-2 text-sm ${secondaryText}`}>{errorMessage}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className={`rounded-2xl border ${borderColor} ${cardBgColor} p-4`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-400">
                      <FaCheckCircle />
                    </div>
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${secondaryText}`}>
                        Credits recharged
                      </p>
                      <p className="text-2xl font-bold">
                        {loading
                          ? '...'
                          : hasPayment
                            ? numberFormatter.format(Number(creditsRecharged) || 0)
                            : 'Pending'}
                      </p>
                      <p className={`text-xs ${secondaryText}`}>
                        {loading
                          ? 'Fetching latest payment'
                          : hasPayment
                            ? formatDate(lastTopUp?.paymentDate)
                            : 'Stripe confirmation pending'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border ${borderColor} ${cardBgColor} p-4`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-indigo-500/10 p-3 text-indigo-300">
                      <FaCoins />
                    </div>
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${secondaryText}`}>Total credits</p>
                      <p className="text-2xl font-bold">
                        {loading ? '...' : numberFormatter.format(Number(totalCredits) || 0)}
                      </p>
                      <p className={`text-xs ${secondaryText}`}>Available now</p>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border ${borderColor} ${cardBgColor} p-4`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-amber-500/10 p-3 text-amber-300">
                      <FaChartLine />
                    </div>
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${secondaryText}`}>
                        Credits used in {monthLabel}
                      </p>
                      <p className="text-2xl font-bold">
                        {loading ? '...' : numberFormatter.format(Number(creditsUsedThisMonth) || 0)}
                      </p>
                      <p className={`text-xs ${secondaryText}`}>Tracked usage this month</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`rounded-2xl border ${borderColor} ${cardBgColor} p-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-lg font-semibold">Latest payment</p>
                    <p className={`text-sm ${secondaryText}`}>
                      Keep this receipt summary for your records.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className={`rounded-xl border ${borderColor} ${mutedBg} p-4`}>
                    <p className={`text-xs uppercase tracking-wide ${secondaryText}`}>
                      Product summary
                    </p>
                    <p className="text-base font-semibold">
                      {lastTopUp?.productSummary || 'Payment processing'}
                    </p>
                    <p className={`text-xs ${secondaryText}`}>
                      {hasPayment ? `Applied on ${formatDate(lastTopUp?.paymentDate)}` : 'Applied once Stripe confirms'}
                    </p>
                  </div>
                  <div className={`rounded-xl border ${borderColor} ${mutedBg} p-4`}>
                    <p className={`text-xs uppercase tracking-wide ${secondaryText}`}>Amount paid</p>
                    <p className="text-base font-semibold">
                      {lastTopUp
                        ? formatAmount(lastTopUp.amountPaidCents, lastTopUp.currency)
                        : 'Pending'}
                    </p>
                    <p className={`text-xs ${secondaryText}`}>
                      {lastTopUp?.paymentStatus ? `Status: ${lastTopUp.paymentStatus}` : 'Status pending'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </CommonContainer>
  );
}
