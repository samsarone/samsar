import { useState } from 'react';
import SecondaryButton from '../../../../common/SecondaryButton.tsx';
import { FaPlus, FaTimes, FaEye, FaEyeSlash, FaCheck, FaPlay, FaMagic, FaChevronCircleLeft } from 'react-icons/fa';
import { FaRegCircleStop } from "react-icons/fa6";
import SingleSelect from '../../../../common/SingleSelect.jsx';

const TEXT_ANIMATION_OPTIONS = [
  { label: 'Typewriter', value: 'typewriter' },
  { label: 'Fade In', value: 'fade-in' },
  { label: 'Fade Out', value: 'fade-out' },
  { label: 'Slide In', value: 'slide-in' },
  { label: 'Slide Out', value: 'slide-out' },
];

export default function SelectedTextToolbarDisplay(props) {
  const {
    handleStartTimeChange,
    handleEndTimeChange,
    removeTextLayer,
    selectedTextTrack,
    bgColor,
    handleSaveChanges,
    newTextAnimationSelected,
    setShowTextTrackAnimations,
    showTextTrackAnimations,
    selectedAnimation,
    removeAnimationLayer,
    colorMode = 'dark',
    // Add the new prop:
    onBackClicked
  } = props;

  const [mode, setMode] = useState('view');
  const [selectedTextAnimation, setSelectedTextAnimation] = useState(null);
  const neutralButtonClassName = colorMode === 'light'
    ? 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
    : 'bg-neutral-800 text-white';
  const dangerButtonClassName = colorMode === 'light'
    ? 'bg-rose-600 text-white hover:bg-rose-500'
    : 'bg-red-800 text-white';
  const animationDangerButtonClassName = colorMode === 'light'
    ? 'bg-rose-600 text-white hover:bg-rose-500'
    : 'bg-red-700 text-white';

  const startFrame = selectedAnimation ? selectedAnimation.startFrame : selectedTextTrack.startFrame;
  const endFrame = selectedAnimation ? selectedAnimation.endFrame : selectedTextTrack.endFrame;

  const displayedStartTime = (startFrame / 30).toFixed(2);
  const displayedEndTime = (endFrame / 30).toFixed(2);

  const textTrackId = `${selectedTextTrack.layerId}_${selectedTextTrack.id}`;



  const handleAddAnimationClick = () => {
    setSelectedTextAnimation({
      startTime: displayedStartTime,
      endTime: displayedEndTime,
    });
    setMode('addAnimation');
  };

  const handleAnimationSave = () => {
    if (selectedTextAnimation && selectedTextAnimation.value) {
      newTextAnimationSelected(selectedTextAnimation);
    }
    setSelectedTextAnimation(null);
    setMode('view');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === 'view' ? (
        selectedAnimation ? (
          // If an animation is selected, show only Start/End time, Save, Remove, and Back button
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveChanges();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              className={`rounded-sm flex items-center px-2 py-1 mr-2 ${neutralButtonClassName}`}
              onClick={() => {
                // Call the onBackClicked prop to reset view and unselect all layers
                if (onBackClicked) {
                  onBackClicked();
                }
              }}
            >
              <FaChevronCircleLeft className='inline-flex mr-1' /> Back
            </button>

            {/* Start Time Input */}
            <div className="flex items-center gap-1">
              <FaPlay className="text-xs" />
              <input type="hidden" name="layerId" value={textTrackId} />
              <input
                type="text"
                name="startTime"
                value={displayedStartTime}
                className={`w-[50px] ${bgColor} pl-2 text-sm`}
                onChange={handleStartTimeChange}
              />
            </div>

            {/* End Time Input */}
            <div className="flex items-center gap-1">
              <FaRegCircleStop className="text-xs" />
              <input type="hidden" name="layerId" value={textTrackId} />
              <input
                type="text"
                name="endTime"
                value={displayedEndTime}
                className={`w-[50px] ${bgColor}`}
                onChange={handleEndTimeChange}
              />
            </div>

            {/* Save Button */}
            <SecondaryButton type="submit">
              <FaCheck className='inline-flex' /> Save
            </SecondaryButton>

            {/* Remove Effect Button */}
            <button
              type="button"
              className={`rounded-sm flex items-center px-2 py-1 ${animationDangerButtonClassName}`}
              onClick={() => removeAnimationLayer(selectedAnimation, selectedTextTrack)}
            >
              <FaTimes className='mr-1' />
            </button>
          </form>
        ) : (
          // If no animation is selected, show the original text track controls
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveChanges();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            {/* Start Time Input */}
            <div className="flex items-center gap-1">
              <FaPlay className="text-xs" />
              <input type="hidden" name="layerId" value={textTrackId} />
              <input
                type="text"
                name="startTime"
                value={displayedStartTime}
                className={`w-[50px] ${bgColor} pl-2 text-sm`}
                onChange={handleStartTimeChange}
              />
            </div>

            {/* End Time Input */}
            <div className="flex items-center gap-1">
              <FaRegCircleStop className="text-xs" />
              <input type="hidden" name="layerId" value={textTrackId} />
              <input
                type="text"
                name="endTime"
                value={displayedEndTime}
                className={`w-[50px] ${bgColor}`}
                onChange={handleEndTimeChange}
              />
            </div>

            {/* Update (Save) Button */}
            <SecondaryButton type="submit">
              <FaCheck className='inline-flex' /> Save
            </SecondaryButton>

            {/* Remove Text Layer Button */}


            {/* Animations Toggle */}
            <SecondaryButton type="button" onClick={() => setShowTextTrackAnimations(!showTextTrackAnimations)}>
              {showTextTrackAnimations ? <FaEyeSlash className='inline-flex' /> : <FaEye className='inline-flex' />}
              Effects
            </SecondaryButton>

            {/* Add Animation Button */}
            <SecondaryButton type="button" onClick={handleAddAnimationClick}>
              <FaPlus className='inline-flex' /> Effect
            </SecondaryButton>


            <button
              type="button"
              className={`rounded-sm flex items-center px-2 py-1 ${dangerButtonClassName}`}
              onClick={() => removeTextLayer(textTrackId)}
            >
              <FaTimes />
            </button>
          </form>
        )
      ) : (
        // 'addAnimation' Mode
        <>
          {/* Animation Selection */}
          <div className="flex items-center gap-1">
            <FaMagic className="text-xs" />
            <SingleSelect
              options={TEXT_ANIMATION_OPTIONS}
              value={
                selectedTextAnimation && selectedTextAnimation.value
                  ? { label: selectedTextAnimation.label, value: selectedTextAnimation.value }
                  : null
              }
              onChange={(selectedOption) => {
                setSelectedTextAnimation({
                  ...selectedTextAnimation,
                  label: selectedOption.label,
                  value: selectedOption.value,
                });
              }}
            />
          </div>

          {/* Animation Start Time Input */}
          <div className="flex items-center gap-1">
            <FaPlay className="text-xs" />
            <input
              type="text"
              value={selectedTextAnimation.startTime}
              className={`w-[50px] ${bgColor} pl-2 text-sm`}
              onChange={(e) => {
                const newTime = e.target.value;
                setSelectedTextAnimation({
                  ...selectedTextAnimation,
                  startTime: newTime,
                });
              }}
            />
          </div>

          {/* Animation End Time Input */}
          <div className="flex items-center gap-1">
            <FaRegCircleStop className="text-xs" />
            <input
              type="text"
              value={selectedTextAnimation.endTime}
              className={`w-[50px] ${bgColor}`}
              onChange={(e) => {
                const newTime = e.target.value;
                setSelectedTextAnimation({
                  ...selectedTextAnimation,
                  endTime: newTime,
                });
              }}
            />
          </div>

          {/* Save Animation Button */}
          <SecondaryButton type="button" onClick={handleAnimationSave} extraClasses='ml-0 mr-0'>
            <div className='flex'>
            <FaCheck className='inline-flex mr-1 mt-1'/> 
            <div className='inline-flex '>
            Add</div>
            </div>
          </SecondaryButton>

          {/* Cancel Button */}
          <button
            type="button"
            className={`rounded-sm flex items-center px-2 py-1 ${neutralButtonClassName}`}
            onClick={() => setMode('view')}
          >
            <FaTimes />
          </button>

        </>
      )}
    </div>
  );
}
