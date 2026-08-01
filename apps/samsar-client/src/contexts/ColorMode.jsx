import { useState, useContext, createContext, useEffect } from 'react';

// Step 2: Define the ColorModeContext 
const ColorModeContext = createContext({
  colorMode: 'light',
  setColorMode: () => { },
  toggleColorMode: () => { }
});

function getInitialColorMode() {
  if (typeof window === 'undefined') return 'dark';

  try {
    return localStorage.getItem('colorMode') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Step 3: Create the Context Provider
export const ColorModeProvider = ({ children }) => {
  const [colorMode, setColorMode] = useState(getInitialColorMode);

  useEffect(() => {
    const handleStorageChange = () => {
      // Check the value from localStorage and update colorMode accordingly
      setColorMode(getInitialColorMode());
    };

    // Add event listener to storage change
    window.addEventListener('storage', handleStorageChange);

    try {
      if (!localStorage.getItem('colorMode')) {
        localStorage.setItem('colorMode', 'dark');
      }
    } catch {
      // Storage can be unavailable in private browsing; dark remains the fallback.
    }

    // Cleanup the event listener when the component unmounts
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const toggleColorMode = () => {
    // Toggle the color mode and update localStorage
    const newMode = colorMode === 'light' ? 'dark' : 'light';
    setColorMode(newMode);
    try {
      localStorage.setItem('colorMode', newMode);
    } catch {
      // The in-memory theme can still change when storage is unavailable.
    }
  };

  useEffect(() => {
    const isDark = colorMode === 'dark';
    const body = document.body;
    const root = document.documentElement;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');

    body.classList.remove('theme-dark', 'theme-light');
    body.classList.add(isDark ? 'theme-dark' : 'theme-light');
    root.classList.toggle('dark', isDark);
    root.style.backgroundColor = isDark ? '#0c0d12' : '#d9e2f0';
    root.style.colorScheme = isDark ? 'dark' : 'light';

    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', isDark ? '#0c0d12' : '#d9e2f0');
    }
  }, [colorMode]);

  return (
    <ColorModeContext.Provider value={{ colorMode, setColorMode, toggleColorMode }}>
      {children}
    </ColorModeContext.Provider>
  );
};

// Custom hook to use the ColorModeContext
export const useColorMode = () => useContext(ColorModeContext);
