import { useEffect, useState } from 'react';
import { useColorMode } from '../../contexts/ColorMode';

import './toggleButton.css'; // Make sure to import the CSS file

function ToggleButton() {
  const [colorMode, setColorMode] = useState('dark');

  const { toggleColorMode } = useColorMode();

  useEffect(() => {
    const colorMode = localStorage.getItem('colorMode');
    const newColorMode = colorMode || 'dark';
    setColorMode(newColorMode);
  }, []);

  const toggleMode = () => {
    const colorMode = localStorage.getItem('colorMode') || 'dark';

    let newColorMode;
    if (colorMode === 'dark') {
      newColorMode = 'light';
    } else {
      newColorMode = 'dark';
    }

    localStorage.setItem('colorMode', newColorMode);

    setColorMode(newColorMode);
    toggleColorMode();
  };
  let currentMode = colorMode;


  return (
    <div>
      <div className="toggle-container" onClick={toggleMode}>
        <div className={`toggle-btn ${currentMode === 'dark' ? 'toggle-btn-dark' : ''}`}>
          <div className="toggle-circle"></div>
        </div>
      </div>
      <div className='text-xs block'>
        {currentMode} Mode
      </div>
    </div>

  );
}

export default ToggleButton;
