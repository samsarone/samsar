import { useState, useRef } from 'react';
import ReactSlider from 'react-slider';
import { FaGripLines } from 'react-icons/fa6';
import './audioLevelsTrackSlider.css';

export default function AudioLevelsTrackSlider(props) {
  const { totalDuration, min = 0, max = totalDuration * 30 } = props; // Adjust as per your time units (frames or seconds)

  const [thumbs, setThumbs] = useState([]); // Array of thumbs with position and volume
  const [selectedThumbIndex, setSelectedThumbIndex] = useState(null); // Index of the selected thumb for the popup
  const sliderRef = useRef(null);

  const handleSliderClick = (e) => {
    e.stopPropagation();
    // Get slider dimensions
    const sliderRect = sliderRef.current.getBoundingClientRect();
    const clickY = e.clientY - sliderRect.top;
    const sliderHeight = sliderRect.height;
    // Calculate the value based on click position
    const percent = 1 - clickY / sliderHeight; // Adjust if your slider's values increase from bottom to top
    const value = min + percent * (max - min);

    // Check if there's a thumb near the click position
    const existingThumbIndex = thumbs.findIndex(
      (thumb) => Math.abs(thumb.position - value) < (max - min) * 0.01 // Threshold for proximity
    );

    if (existingThumbIndex === -1) {
      // Add new thumb
      const newThumb = {
        id: Date.now(),
        position: value,
        volume: 1.0, // Default volume
      };
      setThumbs((prevThumbs) => [...prevThumbs, newThumb]);
      setSelectedThumbIndex(thumbs.length); // Select the new thumb
    } else {
      // Select existing thumb
      setSelectedThumbIndex(existingThumbIndex);
    }
  };

  const handleThumbClick = (e, index) => {
    e.stopPropagation(); // Prevent triggering handleSliderClick
    setSelectedThumbIndex(index);
  };

  const handleChange = (values) => {
    setThumbs((prevThumbs) =>
      values.map((value, idx) => ({
        ...prevThumbs[idx],
        position: value,
      }))
    );
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setThumbs((prevThumbs) =>
      prevThumbs.map((thumb, idx) =>
        idx === selectedThumbIndex ? { ...thumb, volume: newVolume } : thumb
      )
    );
  };

  const handleSave = () => {
    setSelectedThumbIndex(null);
  };

  const handleDeleteThumb = () => {
    setThumbs((prevThumbs) => prevThumbs.filter((_, idx) => idx !== selectedThumbIndex));
    setSelectedThumbIndex(null);
  };

  const renderTrack = (props) => {
    const { key, className, style, ...trackProps } = props;
    return (
      <div
        key={key}
        {...trackProps}
        ref={sliderRef}
        className={className}
        style={style}
        onClick={handleSliderClick}
      />
    );
  };

  const renderThumb = (props, state) => {
    const { key, className, style, ...thumbProps } = props;
    return (
      <div
        key={key}
        {...thumbProps}
        className={className}
        style={style}
        onClick={(e) => handleThumbClick(e, state.index)}
      >
        <FaGripLines />
      </div>
    );
  };

  const sliderValues = thumbs.map((thumb) => thumb.position);
  const selectedThumb = thumbs[selectedThumbIndex];

  return (
    <div className="audio-levels-track-slider">
      <ReactSlider
        className="vertical-slider audio-levels-slider"
        thumbClassName="thumb audio-levels-thumb"
        trackClassName="track audio-levels-track"
        orientation="vertical"
        min={min}
        max={max}
        value={sliderValues}
        renderTrack={renderTrack}
        renderThumb={renderThumb}
        onChange={handleChange}
        invert={true} // Invert if necessary
      />
      {selectedThumbIndex !== null && (
        <div className="thumb-popup">
          <label>
            Volume:
            <input
              type="number"
              value={selectedThumb.volume}
              onChange={handleVolumeChange}
              step="0.01"
              min="0"
              max="1"
            />
          </label>
          <button onClick={handleSave}>Save</button>
          <button onClick={handleDeleteThumb}>Delete</button>
        </div>
      )}
    </div>
  );
}
