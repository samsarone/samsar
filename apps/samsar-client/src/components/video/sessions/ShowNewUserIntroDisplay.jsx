import { useEffect, useState } from 'react';
import axios from 'axios';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { getHeaders } from '../../../utils/web';
import { useNavigate } from 'react-router-dom';

import { FaVideo, FaStar, FaQuestionCircle } from "react-icons/fa";

// 1) Import react-tooltip
import 'react-tooltip/dist/react-tooltip.css';
import { Tooltip } from 'react-tooltip';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function ShowNewUserIntroDisplay(props) {
  const { createNewStudioSession, createNewVidGPTSession } = props;

  const [, setIntroSessionList] = useState([]);
  useState(null);
  useNavigate();

  useEffect(() => {
    const headers = getHeaders();
    axios.get(`${API_SERVER}/video_sessions/intro_sessions`, headers).then((dataRes) => {
      const introSessionList = dataRes.data;
      if (introSessionList.length > 0) {
        setIntroSessionList(introSessionList);
      }
    });
  }, []);

  const { colorMode } = useColorMode();
  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100 border border-[#1f2a3d]'
      : 'bg-slate-50 text-slate-900 border border-slate-200';
  const cardSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_14px_36px_rgba(0,0,0,0.35)]'
      : 'bg-white border border-slate-200 shadow-sm';
  const iconStyle = colorMode === 'dark' ? 'text-rose-200' : 'text-indigo-500';



  let introSessionsListDisplay = <span />;


  return (
    <div>
      <div className={`${panelSurface} rounded-2xl p-6 space-y-6`}>

        <div className={`${cardSurface} rounded-xl p-6`}>
          <div className='text-lg font-bold mb-4 '>
            Create New Project
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 justify-items-center">
            {/* Studio Session */}
            <div
              onClick={() => createNewStudioSession()}
              className="flex flex-col items-center justify-center cursor-pointer space-y-2"
            >
              <FaVideo className={`text-4xl ${iconStyle}`} />
              <span className="flex items-center text-sm font-medium">
                Studio Session
                {/* 2) Add FaQuestionCircle with tooltip props */}
                <FaQuestionCircle
                  data-tooltip-id="studioSessionTooltip"
                  data-tooltip-content="Studio creator and editor. Create And Edit image, video, audio etc."
                  className="ml-2 text-xs"
                />
              </span>
            </div>


            <div
              onClick={() => createNewVidGPTSession()}
              className="flex flex-col items-center justify-center cursor-pointer space-y-2"
            >
              <FaStar className={`text-4xl ${iconStyle}`} />
              <span className="flex items-center text-sm font-medium">
                VidGenie Session
                <FaQuestionCircle
                  data-tooltip-id="vidgptSessionTooltip"
                  data-tooltip-content="1-Shot Feature film creator in grounded or cinematic mode. Edit in Studio."
                  className="ml-2 text-xs"
                />
              </span>
            </div>


          </div>
        </div>
        {introSessionsListDisplay}
      </div>

      {/* 3) Render the Tooltip components, each with its matching ID */}
      <Tooltip id="studioSessionTooltip" place="top" effect="solid" />
      <Tooltip id="expressSessionTooltip" place="top" effect="solid" />
      <Tooltip id="vidgptSessionTooltip" place="top" effect="solid" />
    </div>
  );
}
