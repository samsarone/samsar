import './App.css';
import { UserProvider } from './contexts/UserContext';
import { LocalizationProvider } from './contexts/LocalizationContext.jsx';
import { AlertDialogProvider } from './contexts/AlertDialogContext';
import Home from './components/landing/Home.tsx';
import { NavCanvasControlProvider } from './contexts/NavCanvasControlContext.jsx';
import { ColorModeProvider } from './contexts/ColorMode.jsx';
import { BrowserRouter } from 'react-router-dom';


function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <UserProvider>
          <LocalizationProvider>
            <AlertDialogProvider>
              <ColorModeProvider>
                <NavCanvasControlProvider>
                  <Home />
                </NavCanvasControlProvider>
              </ColorModeProvider>
            </AlertDialogProvider>
          </LocalizationProvider>
        </UserProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
