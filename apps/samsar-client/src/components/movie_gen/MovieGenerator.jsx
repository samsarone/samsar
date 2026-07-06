import { useState, useEffect, useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import CommonButton from '../common/CommonButton.tsx';
import { useParams, useNavigate } from 'react-router-dom';

import { FaChevronCircleDown, FaCog } from 'react-icons/fa';

import { useUser } from '../../contexts/UserContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';

import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';

import axios from 'axios';

import { getHeaders } from '../../utils/web.jsx';
import ProgressIndicator from '../oneshot_editor/ProgressIndicator.jsx'; // Import the ProgressIndicator component



const sampleLinks = [
  {
    url: 'https://static.samsar.one/videogpt_samples/video-674eb4ffa3ea94eaf4af8205_u815.mp4',
    prompt: `Give me a one minute long story set in the universe of the Mad hatter from "Through the looking glass". Make it extremely whimsical, psychedelic and trippy, with eerie themes in various contexts of the dark victorian era`
  },
  {
    url: 'https://static.samsar.one/videogpt_samples/video-674ea738a3ea94eaf4af62fa_p100.mp4',
    prompt: "The lone Hashira journeys through the cursed jungles looking for demons to end and wondering about life's purpose"
  },
  {
    url: 'https://static.samsar.one/videogpt_samples/video-6758bd428b56913df7f8a914_piyp+(1).mp4',
    prompt: "Give me a short 6 line story about a space cowboy Mario and his adventures in the orion's belt. Make it animated and pixelated"

  },
  {
    url: 'https://static.samsar.one/videogpt_samples/video-67599bcb54d9dc1491db62af_srxz.mp4',
    prompt: "A short story about Athena in a futuristic context , represent her as a cyborg hacker who saves the world from Detrimentus, a gummy villain who wants to cover the world with gummy."
  }
]



const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

// Move Typewriter component outside of OneshotEditor
function Typewriter({ text, delay = 100 }) {
  const [displayedText, setDisplayedText] = useState('');
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (hasAnimatedRef.current) return; // Prevent re-running the animation
    hasAnimatedRef.current = true;

    let currentIndex = 0;
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, currentIndex + 1));
      currentIndex++;
      if (currentIndex === text.length) {
        clearInterval(interval);
      }
    }, delay);

    return () => clearInterval(interval);

  }, []); // Empty dependency array ensures this runs only once

  return <span>{displayedText}</span>;
}

export default function MovieGenerator() {
  const [promptText, setPromptText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerationPending, setIsGenerationPending] = useState(false);
  const [expressGenerationStatus, setExpressGenerationStatus] = useState(null);
  const [videoLink, setVideoLink] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showResultDisplay, setShowResultDisplay] = useState(false);

  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const { user } = useUser();

  const { colorMode } = useColorMode();

  const { id } = useParams();
  const navigate = useNavigate();

  // Add state variables for animation
  const [animateHeading, setAnimateHeading] = useState(false);
  const [showSubheading, setShowSubheading] = useState(false);

  // State variables for the selected duration and aspect ratio
  const [selectedDuration, setSelectedDuration] = useState('60'); // default to 60 seconds
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9'); // default to 16:9

  // Trigger animations on component mount
  useEffect(() => {
    const animationPlayed = localStorage.getItem('animationPlayed');
    if (!animationPlayed) {
      setTimeout(() => {
        setAnimateHeading(true);
        setTimeout(() => {
          setShowSubheading(true);
          // Mark the animation as played
          localStorage.setItem('animationPlayed', 'true');
        }, 500); // Delay before showing subheading
      }, 500); // Initial delay before moving up the heading
    } else {
      // If animation has already played, set the states immediately
      setAnimateHeading(true);
      setShowSubheading(true);
    }
  }, []);

  const resetForm = () => {
    setPromptText('');
    setShowResultDisplay(false);
    setErrorMessage(null);
    setVideoLink(null);
    setExpressGenerationStatus(null);
  };

  // Reset form on ID change
  useEffect(() => {
    if (id) {
      resetForm();
      getSessionDetails(); // Fetch session details for the new ID
    }

  }, [id]);

  const [isDisabled, setIsDisabled] = useState(false);
  useEffect(() => {


    if (!user) {
      setIsDisabled(true);
      return;
    }

    let isValidUser = user.isPremiumUser || user.isAdminUser;

    if (!user._id || (!isValidUser)) {
      setIsDisabled(true);
    } else {
      if (isValidUser) {
        setIsDisabled(false);
      }
    }
  }, [id, user]);



  const getSessionDetails = async () => {
    const headers = getHeaders();
    // Implement fetching session details
    await axios.get(`${API_SERVER}/quick_session/details?sessionId=${id}`, headers);


  };

  // Reset form after successful submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!promptText.trim()) {
      alert('Please enter theme text before submitting.');
      return;
    }

    setIsSubmitting(true);
    setIsGenerationPending(true);
    setShowResultDisplay(true);
    setErrorMessage(null);
    setVideoLink(null);
    setExpressGenerationStatus(null);

    const payload = {
      screenplay: promptText,
      sessionId: id,
      duration: selectedDuration,
      aspectRatio: selectedAspectRatio,
    };

    if (!id) {
      return;
    }

    const headers = getHeaders();

    if (!headers) {
      return;
    }

    try {
      await axios.post(`${API_SERVER}/moviegen/create`, payload, headers);
      pollGenerationStatus();
    } catch  {
      setIsGenerationPending(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pollGenerationStatus = () => {
    const interval = setInterval(async () => {
      try {
        const headers = getHeaders();
        const response = await axios.get(`${API_SERVER}/quick_session/status?sessionId=${id}`, headers);
        const resData = response.data;

        setExpressGenerationStatus(resData.expressGenerationStatus);

        if (resData.status === 'COMPLETED') {
          clearInterval(interval);
          const videoLink = resData.videoLink;
          setIsGenerationPending(false);
          setVideoLink(videoLink);
        } else if (resData.status === 'FAILED') {
          clearInterval(interval);
          setIsGenerationPending(false);
          setErrorMessage({ error: 'Video generation failed.' });
        }
      } catch  {

        clearInterval(interval);
        setIsGenerationPending(false);
        setErrorMessage({ error: 'An unexpected error occurred while fetching status.' });
      }
    }, 5000); // Poll every 5 seconds
  };

  const viewInStudio = () => {
    navigate(`/video/${id}`);
    // Implement view in studio functionality
  };

  const purchaseCreditsForUser = () => {
    // Implement purchase credits functionality
  };

  let text1Color = colorMode === 'dark' ? 'text-neutral-100' : 'text-neutral-900';

  // Function to show the VideoGPT options dialog
  const showVideoGPTOptionsDialog = () => {
    const content = (
      <VideoGPTOptionsDialogContent
        selectedDuration={selectedDuration}
        setSelectedDuration={setSelectedDuration}
        selectedAspectRatio={selectedAspectRatio}
        setSelectedAspectRatio={setSelectedAspectRatio}
        closeAlertDialog={closeAlertDialog}
      />
    );
    openAlertDialog(content);
  };

  // VideoGPTOptionsDialogContent Component
  const VideoGPTOptionsDialogContent = ({
    selectedDuration,
    setSelectedDuration,
    selectedAspectRatio,
    setSelectedAspectRatio,
    closeAlertDialog,
  }) => {
    const [duration, setDuration] = useState(selectedDuration);
    const [aspectRatio, setAspectRatio] = useState(selectedAspectRatio);

    const handleSubmit = () => {
      setSelectedDuration(duration);
      setSelectedAspectRatio(aspectRatio);
      closeAlertDialog();
    };

    return (
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">Video Options</h2>
        <div className="flex mb-4">
          {/* Duration Column */}
          <div className="w-1/2 pr-2">
            <h3 className="font-semibold mb-2">Duration</h3>
            <div className="mb-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  value="30"
                  checked={duration === '30'}
                  onChange={() => setDuration('30')}
                  className="form-radio"
                />
                <span className="ml-2">30 seconds</span>
              </label>
            </div>
            <div className="mb-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  value="60"
                  checked={duration === '60'}
                  onChange={() => setDuration('60')}
                  className="form-radio"
                />
                <span className="ml-2">60 seconds</span>
              </label>
            </div>
            <div className="mb-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  value="120"
                  checked={duration === '120'}
                  onChange={() => setDuration('120')}
                  className="form-radio"
                />
                <span className="ml-2">2 minutes</span>
              </label>
            </div>
          </div>
          {/* Aspect Ratio Column */}
          <div className="w-1/2 pl-2">
            <h3 className="font-semibold mb-2">Aspect Ratio</h3>
            <div className="mb-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  value="16:9"
                  checked={aspectRatio === '16:9'}
                  onChange={() => setAspectRatio('16:9')}
                  className="form-radio"
                />
                <span className="ml-2">16:9 (Landscape)</span>
              </label>
            </div>
            <div className="mb-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  value="9:16"
                  checked={aspectRatio === '9:16'}
                  onChange={() => setAspectRatio('9:16')}
                  className="form-radio"
                />
                <span className="ml-2">9:16 (Portrait)</span>
              </label>
            </div>
          </div>
        </div>
        <div className="text-right">
          <CommonButton onClick={handleSubmit}>Submit</CommonButton>
        </div>
      </div>
    );
  };

  let premiumUsersOnlyMessage = <span />;
  if (user && !user.isPremiumUser) {
    premiumUsersOnlyMessage = (
      <div className="text-xs mt-1 text-red-500">
        This feature is only available to premium users.
      </div>
    );
  }

  const [pricingDetailsDisplay, setPricingDetailsDisplay] = useState(false);
  const togglePricingDetailsDisplay = () => {
    setPricingDetailsDisplay(!pricingDetailsDisplay);
  }


  let pricingDetailsMessage = <span />;

  if (pricingDetailsDisplay) {
    pricingDetailsMessage = (
      <div className='block mt-1'>
        <div>The price is calculated as 150 credits per 10 seconds of video.</div>
        <div>For example, a 1 minute video will consume 900 credits.</div>
        {premiumUsersOnlyMessage}
      </div>
    )
  }

  return (
    <div className="mt-[100px] relative">
      <div className={`${text1Color} font-bold text-center mb-6 mt-4 h-[40px] block align-bottom text-center`}>
        <div
          className={`text-2xl block transform transition-transform duration-500 ease-out ${animateHeading ? '-translate-y-4' : ''
            }`}
        >
          Movie Generator By SamsarOne <span className='text-xs'>Alpha</span>
        </div>
        {showSubheading && (
          <div className="text-sm block mt-[-10px]">
            <Typewriter text="Create movies from a Transcript" delay={50} />
            <FaCog className="inline-block ml-2 hover:text-neutral-200 cursor-pointer" onClick={showVideoGPTOptionsDialog} />
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit}>
        <TextareaAutosize
          minRows={8}
          maxRows={20}
          className="w-full bg-gray-950 text-white pl-4 pt-4 p-2 rounded"
          placeholder="Enter a topic on which you'd like a story-video.
          For example: 'A 1 minute long journey through the cosmos' or 'A story in 6 lines on day in the life of a robot'."
          name="promptText"
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />



        <div className="mt-4 relative">
          {/* Centered Submit Button */}
          <div className="flex justify-center">
            <CommonButton type="submit" isDisabled={isSubmitting || isDisabled}>
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </CommonButton>
          </div>
          {/* Pricing Preview positioned to the right on medium and larger screens */}


          <div className="md:absolute md:right-0 top-0 text-white p-2 bg-gray-900 rounded text-center mt-4 md:mt-0 w-full md:w-auto">
            <div className='relative'>
              {/* Updated Flex Container */}
              <div className="flex justify-end font-bold text-sm text-neutral-100 cursor-pointer" onClick={togglePricingDetailsDisplay} >
                Pricing will be shown at completion
                <FaChevronCircleDown
                  className='inline-flex ml-2  mt-1'

                />
              </div>

              {/* Pricing Details Message */}
              <div className="mt-1 text-sm w-full text-right">
                {pricingDetailsMessage}
              </div>
            </div>
            </div>


        </div>

      </form>

      <div className="mt-4 text-neutral-100">
  <div className="flex items-center mb-2">
    <span className="font-bold text-lg">Examples</span>
    <FaChevronCircleDown className="ml-2" />
  </div>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {sampleLinks.map((item, index) => (
      <div
        key={index}
        className="bg-gray-950 p-4 rounded shadow-md border border-neutral-800"
      >
        <div className="mb-2 font-semibold text-sm text-neutral-200">
          {item.prompt}
        </div>
        <video
          className="w-full rounded-md border border-neutral-700"
          controls
          src={item.url}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    ))}
  </div>
</div>



      {showResultDisplay && (
        <ProgressIndicator
          isGenerationPending={isGenerationPending}
          expressGenerationStatus={expressGenerationStatus}
          videoLink={videoLink}
          setShowResultDisplay={setShowResultDisplay}
          errorMessage={errorMessage}
          purchaseCreditsForUser={purchaseCreditsForUser}
          viewInStudio={viewInStudio}
        />
      )}
    </div>
  );
}
