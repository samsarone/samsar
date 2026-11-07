import { useUiLanguage } from '../../hooks/useUiLanguage.js';

import { useMediaQuery } from 'react-responsive';
import TopNav from "./TopNav.tsx";

import MobileTopNav from "./MobileTopNav.tsx";
import { AlertDialog } from "./AlertDialog.tsx";


import { getHeaders } from "../../utils/web.jsx";
import { useNavigate } from "react-router-dom";
import { createBlankVidgenieSession } from '../../utils/vidgenieRouting.js';


const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function OverflowContainer(props) {
  useUiLanguage();
  const { children, bounded = false } = props;

  const navigate = useNavigate();

  const resetCurrentSession = () => {
    if (props.resetSession) {
      props.resetSession();
    }
  }

    const addNewVidGPTSession = () => {
      const headers = getHeaders();
      createBlankVidgenieSession(PROCESSOR_SERVER, headers).then(function (sessionId) {
        if (sessionId) navigate(`/vidgenie/${sessionId}`);
      });
    }





  const isMobile = useMediaQuery({ maxWidth: 767 });

  // Pages normally scroll with the document. Bounded account panels own their
  // scrolling and must fit the viewport without the document's bottom padding.
  return (
    <div className={`workspace-page ${bounded ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh] pb-8'}`} >
      {isMobile ? (
        <MobileTopNav
          resetCurrentSession={resetCurrentSession}
          addNewVidGPTSession={addNewVidGPTSession}
        />
      ) : (
        <TopNav
          resetCurrentSession={resetCurrentSession}


        />
      )}
      <div>
        <AlertDialog />
        {children}
      </div>
    </div>
  )
}
