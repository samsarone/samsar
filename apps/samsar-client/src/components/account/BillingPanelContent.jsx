// BillingPanelContent.jsx
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import { FaArrowRight, FaCheck, FaChevronDown, FaCrown, FaExternalLinkAlt, FaTicketAlt, FaWallet } from "react-icons/fa";
import { useLocation } from "react-router-dom";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useUser } from "../../contexts/UserContext.jsx";
import { getHeaders } from "../../utils/web.jsx";
import { getSessionType } from "../../utils/environment.jsx";
import DockerProvidersPanelContent from "./DockerProvidersPanelContent.jsx";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const numberFormatter = new Intl.NumberFormat("en-US");

const DEFAULT_PURCHASE_USD = 50;
const MIN_PURCHASE_USD = 1;
const PRICING_DOCS_URL = "https://docs.samsar.one/pricing/";
const rechargeAmountPresets = [10, 25, 50, 100];

const sanitizeWholeDollarInput = (value) =>
  String(value ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");

const normalizeWholeDollarAmount = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_PURCHASE_USD) return MIN_PURCHASE_USD;
  return parsed;
};

const formatDateString = (value) => {
  if (!value) return "";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : value;
};

export default function BillingPanelContent() {
  const { colorMode } = useColorMode();
  const { user, getUserAPI } = useUser();
  const location = useLocation();
  const isDockerInstall = getSessionType() === "docker";

  const isDark = colorMode === "dark";
  const textColor = isDark ? "text-slate-100" : "text-slate-900";
  const subtleText = isDark ? "text-slate-400" : "text-slate-600";
  const mutedText = isDark ? "text-slate-500" : "text-slate-500";
  const cardBgColor = isDark ? "bg-[#0f1629]" : "bg-white";
  const mutedBg = isDark ? "bg-[#0b1224]" : "bg-slate-50";
  const borderColor = isDark ? "border-[#1f2a3d]" : "border-slate-200";
  const inputBg = isDark ? "bg-[#080f1f] text-slate-100" : "bg-white text-slate-900";
  const primaryButton = isDark
    ? "border-indigo-400/40 bg-indigo-400/15 text-indigo-100 hover:bg-indigo-400/25"
    : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100";
  const rechargeButton = isDark
    ? "border border-cyan-400/30 bg-cyan-400/15 text-cyan-50 hover:border-cyan-300/45 hover:bg-cyan-400/25"
    : "border border-cyan-200 bg-cyan-50 text-cyan-900 hover:border-cyan-300 hover:bg-cyan-100";
  const upgradeButton = isDark
    ? "border border-emerald-300/25 bg-emerald-400/12 text-emerald-50 hover:border-emerald-200/40 hover:bg-emerald-400/20"
    : "border border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100";
  const secondaryButton = isDark
    ? "border-[#273651] bg-[#0b1224] text-slate-200 hover:border-indigo-300/60"
    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300";

  const [creditPurchaseUsd, setCreditPurchaseUsd] = useState(String(DEFAULT_PURCHASE_USD));
  const [couponCode, setCouponCode] = useState("");
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("setup") === "success") {
      getUserAPI();
    }
  }, [location.search, getUserAPI]);

  const purchaseAmountUsd = useMemo(
    () => normalizeWholeDollarAmount(creditPurchaseUsd),
    [creditPurchaseUsd]
  );
  const purchaseCreditCount = useMemo(
    () => purchaseAmountUsd * 100,
    [purchaseAmountUsd]
  );
  const currentCredits = numberFormatter.format(user?.generationCredits || 0);
  const nextRefillLabel = user?.isPremiumUser ? formatDateString(user?.nextCreditRefill) : "";

  const allowPopupNavigation = useMemo(() => {
    if (typeof navigator === "undefined") return true;
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
    const isIPadOS = platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return !(isMobileUA || isIPadOS);
  }, []);

  if (isDockerInstall) {
    return <DockerProvidersPanelContent />;
  }

  const openNavigationTarget = (targetWindow, url) => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = url;
      targetWindow.focus?.();
      return true;
    }

    window.location.assign(url);
    return false;
  };

  const handleCreditPurchaseChange = (event) => {
    setCreditPurchaseUsd(sanitizeWholeDollarInput(event.target.value));
  };

  const handleCreditPurchaseBlur = () => {
    setCreditPurchaseUsd(String(purchaseAmountUsd));
  };

  const purchaseCreditsForUser = async (amountToPurchase) => {
    const purchaseAmountRequest = parseInt(amountToPurchase, 10);
    if (Number.isNaN(purchaseAmountRequest) || purchaseAmountRequest <= 0) {
      toast.error("Enter a whole dollar amount first.", { position: "bottom-center" });
      return;
    }

    setIsPurchasing(true);
    let purchaseWindow;
    let navigationHandled = false;
    try {
      purchaseWindow = allowPopupNavigation ? window.open("", "_blank") : null;
      const res = await axios.post(
        `${PROCESSOR_SERVER}/users/purchase_credits`,
        { amount: purchaseAmountRequest },
        getHeaders()
      );
      const { url } = res.data || {};
      if (url) {
        navigationHandled = openNavigationTarget(purchaseWindow, url);
        toast.success("Redirecting to Stripe checkout...", { position: "bottom-center" });
      } else {
        toast.error("Failed to generate payment URL", { position: "bottom-center" });
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Payment process failed";
      toast.error(errorMessage, { position: "bottom-center" });
    } finally {
      if (purchaseWindow && !navigationHandled && !purchaseWindow.closed) {
        purchaseWindow.close();
      }
      setIsPurchasing(false);
    }
  };

  const requestApplyCreditsCoupon = async () => {
    const trimmedCode = couponCode.trim();
    if (!trimmedCode) return;

    setIsApplyingCoupon(true);
    try {
      await axios.post(
        `${PROCESSOR_SERVER}/users/apply_credits_coupon`,
        { couponCode: trimmedCode },
        getHeaders()
      );
      toast.success("Coupon applied!", { position: "bottom-center" });
      setCouponCode("");
      setIsCouponOpen(false);
      await getUserAPI();
    } catch  {
      toast.error("Failed to apply coupon", { position: "bottom-center" });
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleUpgradePlan = async () => {
    const upgradeWindow = allowPopupNavigation ? window.open("", "_blank") : null;
    let navigationHandled = false;
    try {
      if (!user || !user._id) {
        toast.error("User not found");
        if (upgradeWindow && !upgradeWindow.closed) upgradeWindow.close();
        return;
      }

      setIsUpgrading(true);
      setUpgradeError("");
      localStorage.setItem("setShowSetPaymentFlow", "false");

      const { data } = await axios.post(
        `${PROCESSOR_SERVER}/users/upgrade_plan`,
        { email: user.email, plan: "creator" },
        getHeaders()
      );

      if (data?.url) {
        navigationHandled = openNavigationTarget(upgradeWindow, data.url);
      }
    } catch  {
      setUpgradeError("Failed to upgrade the plan. Please try again.");
      toast.error("Upgrade failed");
      if (upgradeWindow && !upgradeWindow.closed) {
        upgradeWindow.close();
      }
    } finally {
      if (upgradeWindow && !navigationHandled && !upgradeWindow.closed) {
        upgradeWindow.close();
      }
      setIsUpgrading(false);
    }
  };

  const handleCancelMembership = async () => {
    setIsCancelling(true);
    try {
      await axios.post(`${PROCESSOR_SERVER}/users/cancel_membership`, {}, getHeaders());
      await getUserAPI();
      toast.success("Membership canceled!", { position: "bottom-center" });
    } catch  {
      toast.error("Failed to cancel membership", { position: "bottom-center" });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className={`mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 overflow-x-hidden sm:gap-5 ${textColor}`}>
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${mutedText}`}>Billing</p>
          <h2 className="text-2xl font-semibold tracking-normal sm:text-3xl">Recharge credits</h2>
        </div>
        <a
          href={PRICING_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex min-h-[42px] w-full max-w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition sm:w-auto ${secondaryButton}`}
        >
          View pricing docs
          <FaExternalLinkAlt className="text-xs" />
        </a>
      </div>

      <section className={`w-full min-w-0 overflow-hidden rounded-lg border ${borderColor} ${cardBgColor}`}>
        <div className={`flex min-w-0 flex-col gap-3 border-b ${borderColor} px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${mutedBg}`}>
              <FaWallet className={isDark ? "text-indigo-200" : "text-indigo-600"} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">Add credits</h3>
              <p className={`text-sm ${subtleText}`}>Current balance: {currentCredits} credits</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 sm:items-end">
            <p className={`text-sm ${subtleText}`}>$1 = 100 credits</p>
            <p className={`flex items-start gap-2 text-sm ${subtleText}`}>
              <FaCheck className="mt-1 shrink-0 text-cyan-500" />
              <span>Commercial usage rights for all renders</span>
            </p>
          </div>
        </div>

        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 p-4 sm:p-6">
            <label className="block">
              <span className="text-sm font-semibold">Amount</span>
              <div className={`mt-2 flex min-h-[58px] w-full min-w-0 items-center rounded-lg border ${borderColor} ${inputBg}`}>
                <span className={`px-3 text-xl font-semibold sm:px-4 ${subtleText}`}>$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={creditPurchaseUsd}
                  onChange={handleCreditPurchaseChange}
                  onBlur={handleCreditPurchaseBlur}
                  aria-label="Whole dollar credit purchase amount"
                  className="min-w-0 flex-1 bg-transparent py-3 text-2xl font-semibold outline-none sm:text-3xl"
                />
                <span className={`shrink-0 px-3 text-sm font-semibold sm:px-4 ${subtleText}`}>USD</span>
              </div>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {rechargeAmountPresets.map((preset) => {
                const isSelected = purchaseAmountUsd === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCreditPurchaseUsd(String(preset))}
                    className={`min-h-[42px] w-full rounded-lg border px-3 text-sm font-semibold transition ${
                      isSelected ? primaryButton : secondaryButton
                    }`}
                  >
                    ${preset}
                  </button>
                );
              })}
            </div>
          </div>

          <aside className={`min-w-0 border-t ${borderColor} ${mutedBg} p-4 sm:p-6 lg:border-l lg:border-t-0`}>
            <p className={`text-xs uppercase tracking-[0.18em] ${mutedText}`}>Checkout</p>
            <p className="mt-2 break-words text-3xl font-semibold sm:text-4xl">{numberFormatter.format(purchaseCreditCount)}</p>
            <p className={`text-sm ${subtleText}`}>credits for ${numberFormatter.format(purchaseAmountUsd)}</p>
            <button
              type="button"
              onClick={() => purchaseCreditsForUser(purchaseAmountUsd)}
              disabled={isPurchasing}
              className={`mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${rechargeButton}`}
            >
              {isPurchasing ? "Opening checkout..." : "Recharge now"}
              <FaArrowRight className="text-xs" />
            </button>
          </aside>
        </div>
      </section>

      <section className={`w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-6`}>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${mutedBg}`}>
              <FaCrown className={isDark ? "text-emerald-200" : "text-emerald-600"} />
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${mutedText}`}>Premium</p>
              <h3 className="text-xl font-semibold">Creators plan</h3>
              <p className={`mt-1 text-sm ${subtleText}`}>
                5,000 credits every month, priority queues, and expanded render storage.
              </p>
            </div>
          </div>
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
            user?.isPremiumUser
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : `${borderColor} ${mutedBg} ${subtleText}`
          }`}>
            {user?.isPremiumUser ? "Active" : "$50/mo"}
          </span>
        </div>

        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              "5,000 credits monthly",
              "50GB render storage",
              "Priority generation queue",
              "Priority support",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <FaCheck className="mt-1 shrink-0 text-emerald-500" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-col gap-2">
            <button
              type="button"
              onClick={handleUpgradePlan}
              disabled={user?.isPremiumUser || isUpgrading}
              className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${upgradeButton}`}
            >
              {user?.isPremiumUser ? "Premium active" : isUpgrading ? "Opening checkout..." : "Register premium"}
              {!user?.isPremiumUser && <FaArrowRight className="text-xs" />}
            </button>
            {user?.isPremiumUser && nextRefillLabel && (
              <p className={`text-center text-xs ${subtleText}`}>Next refill {nextRefillLabel}</p>
            )}
            {user?.isPremiumUser && (
              <button
                type="button"
                onClick={handleCancelMembership}
                disabled={isCancelling}
                className={`min-h-[40px] rounded-lg border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${secondaryButton}`}
              >
                {isCancelling ? "Cancelling..." : "Cancel membership"}
              </button>
            )}
          </div>
        </div>

        {upgradeError && <p className="mt-4 text-sm text-red-500">{upgradeError}</p>}
      </section>

      <section className={`w-full min-w-0 overflow-hidden rounded-lg border ${borderColor} ${cardBgColor}`}>
        <button
          type="button"
          onClick={() => setIsCouponOpen((prev) => !prev)}
          aria-expanded={isCouponOpen}
          className={`flex min-h-[58px] w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left transition sm:px-5 ${
            isDark ? "hover:bg-white/[0.03]" : "hover:bg-slate-50"
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${mutedBg}`}>
              <FaTicketAlt className={isDark ? "text-cyan-200" : "text-cyan-600"} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Have a credit coupon?</span>
              <span className={`block truncate text-xs ${subtleText}`}>Apply promotional credits.</span>
            </span>
          </span>
          <span className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${secondaryButton}`}>
            {isCouponOpen ? "Close" : "Add"}
            <FaChevronDown className={`text-[10px] transition-transform ${isCouponOpen ? "rotate-180" : ""}`} />
          </span>
        </button>

        {isCouponOpen && (
          <form
            className={`flex min-w-0 flex-col gap-2 border-t ${borderColor} ${mutedBg} p-3 sm:flex-row sm:p-4`}
            onSubmit={(event) => {
              event.preventDefault();
              requestApplyCreditsCoupon();
            }}
          >
            <div className={`flex min-h-[42px] min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 ${borderColor} ${inputBg}`}>
              <input
                type="text"
                placeholder="Credit coupon code"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!couponCode.trim() || isApplyingCoupon}
              className={`min-h-[42px] w-full rounded-lg border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${secondaryButton}`}
            >
              {isApplyingCoupon ? "Applying..." : "Submit"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
