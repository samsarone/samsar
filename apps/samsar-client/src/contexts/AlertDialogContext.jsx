// UserContext.js
import { useState, useContext, createContext } from 'react';


const AlertDialogContext = createContext({
  isAlertDialogOpen: false,
  alertDialogContent: null,
  openAlertDialog: () => {},
  closeAlertDialog: () => {},
  alertDialogSubmit: null,
  setAlertComponentHTML: () => {},
  isAlertActionPending: false,
  setIsAlertActionPending: () => {},

  dialogOptions: {},


  useXL: false,

});

export const AlertDialogProvider = ({ children }) => {
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [alertDialogContent, setDialogContent] = useState(null);
  const [, setAlertDialogSubmit] = useState(null);
  const [isAlertActionPending, setIsAlertActionPending] = useState(false);
  const [, setAlertComponentData] = useState(<span />);

  const [dialogOptions, setDialogOptions] = useState({});

  const [useXL, setUseXL] = useState(false);

  const openAlertDialog = (content, onsubmit, useXLValue = false, options = {}) => {

    setDialogContent(content);
    setAlertDialogSubmit(onsubmit);
    setUseXL(useXLValue);
    setIsAlertDialogOpen(true);
    setDialogOptions(options || {});
  };

  const closeAlertDialog = () => {
    setIsAlertDialogOpen(false);
    setDialogContent(null);
    setUseXL(false);
  };

  const setAlertComponentHTML = (html) => {
    setAlertComponentData(html);
  }

  return (
    <AlertDialogContext.Provider value={{ isAlertDialogOpen, alertDialogContent, openAlertDialog,
     closeAlertDialog,  setAlertComponentHTML , isAlertActionPending, setIsAlertActionPending,   useXL,
     dialogOptions }}>
      {children}
    </AlertDialogContext.Provider>
  );
};


export const useAlertDialog = () => useContext(AlertDialogContext);
