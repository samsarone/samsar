import { useEffect, useState } from 'react';
import OverflowContainer from '../common/OverflowContainer.tsx';
import UpgradePlan from './UpgradePlan.tsx';
import AddCreditsDialog from '../account/AddCreditsDialog.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { getHeaders } from '../../utils/web.jsx';
import axios from 'axios';
import { useUser } from '../../contexts/UserContext.jsx';
import { ToastContainer, toast } from "react-toastify";
import { useLocation } from 'react-router-dom';

import 'react-toastify/dist/ReactToastify.css';


const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function CreatePayment() {
  const [selectedTab, setSelectedTab] = useState('upgradePlan');
  const { colorMode } = useColorMode();
  const { getUserAPI } = useUser();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'purchaseCredits' || tab === 'credits') {
      setSelectedTab('purchaseCredits');
    } else if (tab === 'upgradePlan' || tab === 'plan') {
      setSelectedTab('upgradePlan');
    }
  }, [location.search]);

  // Helper function to derive button styles based on selection and theme
  const getButtonClass = (isActive) => {
    const baseClasses = `min-h-[38px] rounded-lg px-4 text-sm font-semibold transition-colors duration-150 focus:outline-none`;
    if (isActive) {
      // Active / Selected button styles
      return colorMode === 'dark'
        ? `${baseClasses} bg-[#46bfff] text-[#041420]`
        : `${baseClasses} bg-slate-950 text-white`;
    } else {
      // Inactive / Unselected button styles
      return colorMode === 'dark'
        ? `${baseClasses} text-slate-400 hover:bg-[#111a2f] hover:text-slate-100`
        : `${baseClasses} text-slate-600 hover:bg-white hover:text-slate-950`;
    }
  };

  const requestApplyCreditsCoupon = (couponCode) => {

    axios.post(
        `${PROCESSOR_SERVER}/users/apply_credits_coupon`,
        { couponCode },
        getHeaders()
      )
      .then(function () {


        toast.success("Coupon applied successfully!", { position: "bottom-center" });
        getUserAPI();
      })
      .catch(function () {
        
        toast.error("Failed to apply coupon", { position: "bottom-center" });
      });
  };

  const purchaseCreditsForUser = (amountToPurchase) => {
    const purchaseAmountRequest = parseInt(amountToPurchase, 10);

    if (Number.isNaN(purchaseAmountRequest) || purchaseAmountRequest <= 0) {
      toast.error("Select a valid amount to purchase.", { position: "bottom-center" });
      return;
    }

    axios
      .post(
        `${PROCESSOR_SERVER}/users/purchase_credits`,
        { amount: purchaseAmountRequest },
        getHeaders()
      )
      .then((res) => {
        const { url } = res.data;
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          toast.success("Redirecting to checkout…", { position: "bottom-center" });
        } else {
          toast.error("Failed to generate payment URL", { position: "bottom-center" });
        }
      })
      .catch(() => {
        
        toast.error("Payment process failed. Please try again.", { position: "bottom-center" });
      });
  };


  const pageClasses = colorMode === 'dark'
    ? 'bg-[#0b1021] text-slate-100'
    : 'bg-[#f7f9fc] text-slate-950';
  const segmentedClasses = colorMode === 'dark'
    ? 'border-[#1f2a3d] bg-[#0f1629]'
    : 'border-[#d7deef] bg-white/70';
  const pricingLinkClasses = colorMode === 'dark'
    ? 'text-[#89dcff] hover:text-[#d7ffeb]'
    : 'text-sky-700 hover:text-sky-600';
  const pageContainerClasses = selectedTab === 'purchaseCredits'
    ? 'mx-auto w-full max-w-5xl'
    : 'mx-auto w-full max-w-3xl';
  const contentShellClasses = selectedTab === 'purchaseCredits'
    ? 'mt-6 w-full'
    : `mt-5 rounded-lg border p-4 ${segmentedClasses}`;

  return (
    <OverflowContainer>
      <ToastContainer />
      {/* Page background + text color based on colorMode */}
      <div className={`min-h-screen px-4 py-16 ${pageClasses}`}>
        {/* Centered container so it doesn't span the entire width */}
        <div className={pageContainerClasses}>
          {/* Top toggle + link row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className={`inline-flex w-full gap-1 rounded-lg border p-1 sm:w-auto ${segmentedClasses}`}>
              <button
                type="button"
                onClick={() => setSelectedTab('upgradePlan')}
                className={getButtonClass(selectedTab === 'upgradePlan')}
              >
                Plan
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('purchaseCredits')}
                className={getButtonClass(selectedTab === 'purchaseCredits')}
              >
                Credits
              </button>
            </div>

            <a
              href="https://docs.samsar.one/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm font-medium underline-offset-4 hover:underline ${pricingLinkClasses}`}
            >
              Pricing
            </a>
          </div>

          {/* Content section with a modern card look */}
          <div className={contentShellClasses}>
            {selectedTab === 'upgradePlan' ? (
              <UpgradePlan />
            ) : (
              <AddCreditsDialog
                variant="page"
                purchaseCreditsForUser={purchaseCreditsForUser}
                requestApplyCreditsCoupon={requestApplyCreditsCoupon}
              />
            )}
          </div>
        </div>
      </div>
    </OverflowContainer>
  );
}
