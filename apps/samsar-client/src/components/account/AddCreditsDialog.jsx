import { useMemo, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { FaArrowRight, FaChevronDown, FaChevronUp } from 'react-icons/fa6';
import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useUser } from '../../contexts/UserContext.jsx';
import { toast } from 'react-toastify';

const creditOptions = [
  { value: 10, caption: 'Quick' },
  { value: 25, caption: 'Starter' },
  { value: 50, caption: 'Popular', badge: 'Popular' },
  { value: 100, caption: 'Studio' },
  { value: 500, caption: 'Team' },
  { value: 1000, caption: 'Scale' },
];

const GALLERY_URL = 'https://gallery.samsar.one';

export default function AddCreditsDialog(props) {
  const {
    purchaseCreditsForUser,
    requestApplyCreditsCoupon,
    onClose,
    variant = 'dialog',
  } = props;
  const { closeAlertDialog } = useAlertDialog();
  const { colorMode } = useColorMode();
  const { user } = useUser();
  const isDark = colorMode === 'dark';
  const hasUser = Boolean(user?._id);
  const isPage = variant === 'page';
  const handleClose = typeof onClose === 'function'
    ? onClose
    : isPage
      ? null
      : closeAlertDialog;

  const defaultOption = creditOptions[2] || creditOptions[0];
  const [selectedOption, setSelectedOption] = useState(defaultOption);
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');

  const numberFormatter = useMemo(() => new Intl.NumberFormat('en-US'), []);
  const currencyFormatter = useMemo(() => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }), []);

  const selectedCredits = selectedOption ? selectedOption.value * 100 : 0;

  const shellClasses = isDark
    ? 'border-[#1f2a3d] bg-[#0f1629] text-slate-100 shadow-[0_18px_54px_rgba(0,0,0,0.36)]'
    : 'border-[#d7deef] bg-white text-slate-950 shadow-[0_18px_44px_rgba(15,23,42,0.12)]';

  const mutedText = isDark ? 'text-slate-400' : 'text-slate-600';
  const subtleText = isDark ? 'text-slate-500' : 'text-slate-500';
  const accentText = isDark ? 'text-[#72f1b0]' : 'text-sky-700';
  const galleryLinkClasses = isDark ? 'text-[#89dcff] hover:text-[#d7ffeb]' : 'text-sky-700 hover:text-sky-600';
  const dividerClasses = isDark ? 'border-[#1f2a3d]' : 'border-[#d7deef]';
  const panelClasses = isDark
    ? 'border-[#1f2a3d] bg-[#0f1629]'
    : 'border-[#d7deef] bg-white/60';

  const inactiveOptionClasses = isDark
    ? 'border-[#1f2a3d] bg-[#0f1629] hover:border-[#46bfff]/70 hover:bg-[#13213a]'
    : 'border-[#d7deef] bg-white/65 hover:border-sky-300 hover:bg-sky-50/60';

  const activeOptionClasses = isDark
    ? 'border-[#46bfff] bg-[#10223c] ring-1 ring-[#46bfff]/30'
    : 'border-sky-400 bg-sky-50/90 ring-1 ring-sky-200';
  const checkoutButtonClasses = isPage
    ? isDark
      ? 'min-h-[54px] w-full rounded-xl bg-[#39d881] px-6 text-base text-[#041420] shadow-[0_16px_32px_rgba(57,216,129,0.22)] hover:bg-[#55e8a2]'
      : 'min-h-[54px] w-full rounded-xl bg-sky-600 px-6 text-base text-white shadow-[0_16px_32px_rgba(2,132,199,0.18)] hover:bg-sky-700'
    : isDark
      ? 'min-h-[44px] w-full rounded-lg bg-[#39d881] px-5 text-sm text-[#041420] hover:bg-[#55e8a2] sm:w-auto'
      : 'min-h-[44px] w-full rounded-lg bg-sky-600 px-5 text-sm text-white hover:bg-sky-700 sm:w-auto';

  const shellWidthClasses = isPage ? 'max-w-5xl' : 'max-w-[560px]';
  const contentPaddingClasses = isPage
    ? 'px-5 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-10'
    : 'px-4 py-5 sm:px-6 sm:py-6';
  const packGridClasses = isPage
    ? 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'
    : 'grid grid-cols-1 gap-2 sm:grid-cols-3';
  const shellOverflowClasses = isPage
    ? 'overflow-hidden'
    : 'max-h-[calc(100dvh-1.5rem)] overflow-y-auto';

  const handlePurchase = () => {
    if (!selectedOption) {
      toast.error('Select a credit pack to continue.', { position: 'bottom-center' });
      return;
    }

    if (typeof purchaseCreditsForUser === 'function') {
      purchaseCreditsForUser(selectedOption.value);
    }
  };

  const handleApplyCoupon = () => {
    const trimmedCode = couponCode.trim();

    if (!trimmedCode) {
      toast.error('Enter a coupon code to apply.', { position: 'bottom-center' });
      return;
    }

    if (typeof requestApplyCreditsCoupon === 'function') {
      requestApplyCreditsCoupon(trimmedCode);
    }
  };

  const headerContent = (
    <div className={handleClose ? 'pr-10' : ''}>
      <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${accentText}`}>
        Workspace credits
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-normal sm:text-3xl">
        Add credits
      </h2>
      <p className={`mt-2 text-sm leading-6 ${mutedText}`}>
        Top up for renders, edits, and agent generation. Credits are ready after checkout.
      </p>
      <a
        href={GALLERY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-2 inline-flex text-sm font-medium underline-offset-4 transition hover:underline ${galleryLinkClasses}`}
      >
        See what's possible
      </a>
      <p className={`mt-3 text-xs font-semibold uppercase tracking-[0.18em] ${subtleText}`}>
        100 credits = $1
      </p>
    </div>
  );

  const packGrid = (
    <div className={packGridClasses}>
      {creditOptions.map((option) => {
        const isSelected = option.value === selectedOption?.value;
        const creditsLabel = `${numberFormatter.format(option.value * 100)} credits`;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => setSelectedOption(option)}
            aria-pressed={isSelected}
            className={`relative text-left transition-all duration-150 ${
              isPage
                ? 'flex min-h-[72px] items-center justify-between gap-3 rounded-lg border px-4 py-3'
                : 'flex min-h-[108px] flex-col items-start justify-between rounded-lg border p-4'
            } ${
              isSelected ? activeOptionClasses : inactiveOptionClasses
            }`}
          >
            {isPage ? (
              <>
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isSelected
                      ? isDark ? 'border-[#46bfff]' : 'border-sky-500'
                      : isDark ? 'border-slate-600' : 'border-slate-300'
                  }`}>
                    {isSelected && (
                      <span className={isDark ? 'h-2 w-2 rounded-full bg-[#46bfff]' : 'h-2 w-2 rounded-full bg-sky-500'} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold">{currencyFormatter.format(option.value)}</span>
                    <span className={`block text-xs ${mutedText}`}>{creditsLabel}</span>
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                  option.badge
                    ? isDark ? 'bg-[#13243d] text-[#72f1b0]' : 'bg-sky-50 text-sky-700'
                    : subtleText
                }`}>
                  {option.caption}
                </span>
              </>
            ) : (
              <>
                {option.badge ? (
                  <span className={`absolute right-3 top-3 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    isDark ? 'text-[#72f1b0]' : 'text-sky-700'
                  }`}>
                    {option.badge}
                  </span>
                ) : null}
                <span className="text-lg font-semibold">{currencyFormatter.format(option.value)}</span>
                <span className="space-y-1">
                  <span className="block text-sm font-semibold leading-5">{creditsLabel}</span>
                  <span className={`mt-1 block text-xs ${subtleText}`}>{option.caption}</span>
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  const couponPanel = (
    <div className={`rounded-lg border px-4 py-3 transition ${panelClasses}`}>
      <button
        type="button"
        onClick={() => setIsCouponOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 text-sm font-semibold"
      >
        <span>Promo code</span>
        {isCouponOpen ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
      </button>

      {isCouponOpen && (
        <div className="mt-4 space-y-3">
          <input
            type="text"
            placeholder="Code"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-sm ${
              isDark
                ? 'border-[#1f2a3d] bg-[#0b1021] text-slate-100 placeholder:text-slate-600'
                : 'border-[#cbd6e6] bg-white/80 text-slate-950 placeholder:text-slate-400'
            }`}
          />
          <button
            type="button"
            onClick={handleApplyCoupon}
            disabled={!hasUser || !couponCode.trim() || typeof requestApplyCreditsCoupon !== 'function'}
            className={`inline-flex min-h-[38px] items-center justify-center rounded-lg px-4 text-sm font-semibold transition ${
              isDark
                ? 'bg-[#111a2f] text-[#d7ffeb] hover:bg-[#172c49]'
                : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );

  const checkoutPanel = (
    <div className={`flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between ${dividerClasses}`}>
      <div>
        <p className={`text-xs uppercase tracking-[0.18em] ${subtleText}`}>Selected pack</p>
        <p className="mt-1 text-lg font-semibold">
          {numberFormatter.format(selectedCredits)} credits
          <span className={`ml-2 text-sm font-medium ${mutedText}`}>
            {selectedOption ? currencyFormatter.format(selectedOption.value) : ''}
          </span>
        </p>
      </div>
      <div className={isPage ? 'w-full sm:w-[280px]' : 'w-full sm:w-auto'}>
        <button
          type="button"
          onClick={handlePurchase}
          disabled={!selectedOption || !hasUser}
          className={`inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${checkoutButtonClasses}`}
        >
          {isPage ? 'Checkout' : 'Continue to checkout'}
          <FaArrowRight className={isPage ? 'text-sm' : 'text-xs'} />
        </button>
        {isPage && (
          <p className={`mt-2 text-center text-xs ${subtleText}`}>
            Secure Stripe checkout
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className={`relative w-full ${shellWidthClasses} ${shellOverflowClasses} rounded-xl border text-left ${shellClasses}`}>
      {typeof handleClose === 'function' && (
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close add credits dialog"
          className={`absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 ${
            isDark
              ? 'text-slate-400 hover:bg-[#16213a] hover:text-slate-100 focus:ring-cyan-400/40'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:ring-slate-300'
          }`}
        >
          <FaTimes className="text-sm" />
        </button>
      )}

      <div className={contentPaddingClasses}>
        {isPage ? (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              {headerContent}
              <div className="w-full lg:max-w-xs">
                {couponPanel}
              </div>
            </div>
            <div className="space-y-3">
              <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${subtleText}`}>
                Credit pack
              </p>
              {packGrid}
            </div>
            {checkoutPanel}
          </div>
        ) : (
          <div className="space-y-6">
            {headerContent}
            {packGrid}
            {couponPanel}
            {checkoutPanel}
          </div>
        )}
      </div>
    </div>
  );
}
