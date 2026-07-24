import './App.css';
import { UserProvider } from './contexts/UserContext';
import { LocalizationProvider } from './contexts/LocalizationContext.jsx';
import { AlertDialogProvider } from './contexts/AlertDialogContext';
import Home from './components/landing/Home.tsx';
import { NavCanvasControlProvider } from './contexts/NavCanvasControlContext.jsx';
import { ColorModeProvider } from './contexts/ColorMode.jsx';
import { BrowserRouter } from 'react-router-dom';
import AppErrorBoundary from './components/common/AppErrorBoundary.jsx';


function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <UserProvider>
          <LocalizationProvider>
            <AlertDialogProvider>
              <ColorModeProvider>
                <NavCanvasControlProvider>
                  <AppErrorBoundary>
                    <Home />
                  </AppErrorBoundary>
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
