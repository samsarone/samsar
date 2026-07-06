import { useState, useContext, createContext, useEffect } from 'react';

// Step 2: Define the ColorModeContext 
const ColorModeContext = createContext({
  colorMode: 'light',
  setColorMode: () => { },
  toggleColorMode: () => { }
});

// Step 3: Create the Context Provider
export const ColorModeProvider = ({ children }) => {
  const [colorMode, setColorMode] = useState('dark'); // Default to dark

  useEffect(() => {

    const handleStorageChange = () => {
      // Check the value from localStorage and update colorMode accordingly
      const storedMode = localStorage.getItem('colorMode')  || 'dark';
      setColorMode(storedMode);
    };

    // Add event listener to storage change
    window.addEventListener('storage', handleStorageChange);

    if (!localStorage.getItem('colorMode')) {
      localStorage.setItem('colorMode', 'dark');
      setColorMode('dark');
    } else {
      handleStorageChange();
    }

    // Cleanup the event listener when the component unmounts
   // return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const toggleColorMode = () => {
    // Toggle the color mode and update localStorage
    const newMode = colorMode === 'light' ? 'dark' : 'light';
    setColorMode(newMode);
    localStorage.setItem('colorMode', newMode);
  };

  useEffect(() => {
    const body = document.body;
    body.classList.remove('theme-dark', 'theme-light');
    body.classList.add(colorMode === 'dark' ? 'theme-dark' : 'theme-light');
  }, [colorMode]);

  return (
    <ColorModeContext.Provider value={{ colorMode, setColorMode, toggleColorMode }}>
      {children}
    </ColorModeContext.Provider>
  );
};

// Custom hook to use the ColorModeContext
export const useColorMode = () => useContext(ColorModeContext);
