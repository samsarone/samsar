import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { useAlertDialog } from "../../contexts/AlertDialogContext.jsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";
import AuthContainer, { AUTH_DIALOG_OPTIONS } from "../auth/AuthContainer.jsx";

const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';

export default function BillingAccessGate() {
  const { openAlertDialog } = useAlertDialog();
  const { colorMode } = useColorMode();
  const location = useLocation();
  const [hasPrompted, setHasPrompted] = useState(false);

  const redirectPath = `${location.pathname}${location.search || ""}`;

  const openLoginDialog = useCallback(() => {
    openAlertDialog(<AuthContainer redirectTo={redirectPath} />, undefined, false, AUTH_DIALOG_OPTIONS);
  }, [openAlertDialog, redirectPath]);

  const openRegisterDialog = useCallback(() => {
    openAlertDialog(
      <AuthContainer initView="register" redirectTo={redirectPath} />,
      undefined,
      false,
      AUTH_DIALOG_OPTIONS
    );
  }, [openAlertDialog, redirectPath]);

  useEffect(() => {
    if (hasPrompted) return;
    openLoginDialog();
    setHasPrompted(true);
  }, [hasPrompted, openLoginDialog]);

  const isDark = colorMode === "dark";
  const textColor = isDark ? "text-slate-100" : "text-slate-900";
  const bgColor = isDark ? "bg-[#0b1021]" : "bg-[#f7f9fc]";
  const cardBg = isDark ? "bg-[#0f1629]" : "bg-white";
  const borderColor = isDark ? "border-[#1f2a3d]" : "border-slate-200";
  const muted = isDark ? "bg-[#121b33]" : "bg-slate-200";
  const subtleText = isDark ? "text-slate-400" : "text-slate-500";
  const primaryButton = isDark
    ? "bg-rose-500 hover:bg-rose-400 text-white"
    : "bg-blue-600 hover:bg-blue-500 text-white";
  const secondaryButton = isDark
    ? "border border-slate-600 text-slate-200 hover:border-slate-400"
    : "border border-slate-300 text-slate-700 hover:border-slate-400";

  return (
    <div className={`pt-[50px] min-h-screen ${bgColor} ${textColor}`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 shadow-sm`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Billing</h1>
              <p className={`text-sm ${subtleText}`}>
                Sign in to manage credits, payment methods, and billing history.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openLoginDialog}
                className={`px-4 py-2 rounded-lg font-semibold ${primaryButton}`}
              >
                Log in
              </button>
              {!IS_DOCKER_INSTALL && (
                <button
                  type="button"
                  onClick={openRegisterDialog}
                  className={`px-4 py-2 rounded-lg font-semibold ${secondaryButton}`}
                >
                  Create account
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="animate-pulse space-y-4">
          <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 space-y-4`}>
            <div className={`${muted} h-4 w-40 rounded-full`} />
            <div className="grid gap-4 md:grid-cols-3">
              <div className={`${muted} h-20 rounded-xl`} />
              <div className={`${muted} h-20 rounded-xl`} />
              <div className={`${muted} h-20 rounded-xl`} />
            </div>
          </div>

          <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 space-y-3`}>
            <div className={`${muted} h-4 w-48 rounded-full`} />
            <div className={`${muted} h-10 w-full rounded-xl`} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className={`${muted} h-12 rounded-xl`} />
              <div className={`${muted} h-12 rounded-xl`} />
            </div>
          </div>

          <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 space-y-3`}>
            <div className={`${muted} h-4 w-36 rounded-full`} />
            <div className="grid gap-3 md:grid-cols-3">
              <div className={`${muted} h-16 rounded-xl`} />
              <div className={`${muted} h-16 rounded-xl`} />
              <div className={`${muted} h-16 rounded-xl`} />
            </div>
          </div>

          <div className={`rounded-2xl border ${borderColor} ${cardBg} p-6 space-y-3`}>
            <div className={`${muted} h-4 w-32 rounded-full`} />
            <div className={`${muted} h-12 rounded-xl`} />
            <div className={`${muted} h-12 rounded-xl`} />
            <div className={`${muted} h-12 rounded-xl`} />
          </div>
        </div>
      </div>
    </div>
  );
}
