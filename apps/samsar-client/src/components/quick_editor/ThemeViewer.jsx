import { useState, useEffect } from 'react';
import AceEditor from 'react-ace';
import axios from 'axios';
import { FaExpand, FaCompress } from 'react-icons/fa6';
import TextareaAutosize from 'react-textarea-autosize';

import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/ext-beautify';

import SecondaryButton from '../common/SecondaryButton.tsx';
import { cleanJsonTheme, getHeaders } from '../../utils/web.jsx';
import ThemeUIEditor from './ThemeUIEditor.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

export default function ThemeViewer(props) {
  const {
    sessionId,
    aspectRatio,
    showTheme,
    themeType,
    setThemeType,
    parentJsonTheme,
    setParentJsonTheme,
    derivedJsonTheme,
    setDerivedJsonTheme,
    errorMessage,
    setErrorMessage,
    errorState,
    setErrorState,
    basicTextTheme,
    setBasicTextTheme,
    customThemeText,
    setCustomThemeText,
    derivedTextTheme,
    setDerivedTextTheme,
  } = props;

  const [parentJsonSubmitting, setParentJsonSubmitting] = useState(false);
  const [derivedJsonSubmitting, setDerivedJsonSubmitting] = useState(false);

  // ------------------------
  // States for Wizard vs JSON
  // Default to "wizard" if we have any JSON; otherwise use "json".
  // ------------------------
  const [uiViewMode, setUiViewMode] = useState('wizard'); // 'wizard' or 'json'
  const [editorData, setEditorData] = useState(null);
  const [isWizardExpanded, setIsWizardExpanded] = useState(false);

  useEffect(() => {
    // If there's no JSON at all, wizard won't do anything, so fallback to JSON view
    if (!parentJsonTheme && !derivedJsonTheme) {
      setUiViewMode('json');
    }
  }, [parentJsonTheme, derivedJsonTheme]);

  // Whenever user *switches* to wizard mode, parse the existing JSON if possible
  useEffect(() => {
    if (uiViewMode === 'wizard') {
      try {
        let activeJson = null;
        if (themeType === 'parentJson' || themeType === 'derivedParentJson') {
          activeJson = parentJsonTheme;
        } else if (themeType === 'derivedJson') {
          activeJson = derivedJsonTheme;
        }
        if (activeJson) {
          const parsed = JSON.parse(activeJson);
          setEditorData(parsed);
        }
      } catch  {
        
      }
    }
  }, [uiViewMode, themeType, parentJsonTheme, derivedJsonTheme]);

  // ------------------------
  // Handlers for JSON changes
  // ------------------------
  const handleParentJsonThemeChange = (value) => {
    setParentJsonTheme(value);
    try {
      JSON.parse(value);
      setErrorMessage(null);
      setErrorState(false);
    } catch  {
      setErrorMessage('Invalid JSON format');
      setErrorState(true);
    }
  };

  const handleDerivedJsonThemeChange = (value) => {
    setDerivedJsonTheme(value);
    try {
      JSON.parse(value);
      setErrorMessage(null);
      setErrorState(false);
    } catch  {
      setErrorMessage('Invalid JSON format');
      setErrorState(true);
    }
  };

  // ------------------------
  // Submit Parent JSON
  // ------------------------
  const updatePrimaryJsonTheme = async (evt) => {
    evt?.preventDefault();
    setParentJsonSubmitting(true);
    setErrorMessage(null);
    setErrorState(false);

    const headers = getHeaders();
    if (!headers) {
      // Not logged in, handle appropriately
      setParentJsonSubmitting(false);
      return;
    }

    try {
      let cleaned;
      if (uiViewMode === 'wizard' && editorData) {
        const newJsonString = JSON.stringify(editorData, null, 2);
        setParentJsonTheme(newJsonString);
        cleaned = cleanJsonTheme(newJsonString);
      } else {
        cleaned = cleanJsonTheme(parentJsonTheme);
      }
      if (!cleaned) throw new Error('Invalid JSON format for parent theme.');

      const payload = {
        sessionId,
        parentJsonTheme: cleaned,
      };
      await axios.post(`${PROCESSOR_API_URL}/quick_session/update_primary_json`, payload, headers);
    } catch  {
      
      setErrorMessage('Failed to update parent theme.');
      setErrorState(true);
    }
    setParentJsonSubmitting(false);
  };

  // ------------------------
  // Submit Derived JSON
  // ------------------------
  const updateDerivedJsonTheme = async (evt) => {
    evt?.preventDefault();
    setDerivedJsonSubmitting(true);
    setErrorMessage(null);
    setErrorState(false);

    const headers = getHeaders();
    if (!headers) {
      setDerivedJsonSubmitting(false);
      return;
    }

    try {
      let cleaned;
      if (uiViewMode === 'wizard' && editorData) {
        const newJsonString = JSON.stringify(editorData, null, 2);
        setDerivedJsonTheme(newJsonString);
        cleaned = cleanJsonTheme(newJsonString);
      } else {
        cleaned = cleanJsonTheme(derivedJsonTheme);
      }
      if (!cleaned) throw new Error('Invalid JSON format for derived theme.');

      const payload = {
        sessionId,
        derivedJsonTheme: cleaned,
      };
      await axios.post(`${PROCESSOR_API_URL}/quick_session/update_derived_json`, payload, headers);
    } catch  {
      
      setErrorMessage('Failed to update derived theme.');
      setErrorState(true);
    }
    setDerivedJsonSubmitting(false);
  };

  // ------------------------
  // “Add Derived” from text
  // ------------------------
  const submitDerivedJsonTheme = async (evt) => {
    evt.preventDefault();
    setDerivedJsonSubmitting(true);
    setErrorMessage(null);
    setErrorState(false);

    const headers = getHeaders();
    if (!headers) {
      setDerivedJsonSubmitting(false);
      return;
    }

    try {
      // Must have a valid parent
      const parentCleaned = cleanJsonTheme(parentJsonTheme);
      if (!parentCleaned) {
        throw new Error('Invalid JSON format for parent theme.');
      }

      const payload = {
        sessionId,
        derivedTextTheme,
        parentJsonTheme: parentCleaned,
        aspectRatio: aspectRatio?.value || '1:1',
      };
      const { data } = await axios.post(
        `${PROCESSOR_API_URL}/quick_session/set_derived_theme`,
        payload,
        headers
      );
      if (data.derivedJsonTheme) {
        setThemeType('derivedJson');
        try {
          const parsed = JSON.parse(data.derivedJsonTheme);
          setDerivedJsonTheme(JSON.stringify(parsed, null, 2));
        } catch  {
          setDerivedJsonTheme(data.derivedJsonTheme);
        }
      }
    } catch  {
      
      setErrorMessage('Failed to set derived theme.');
      setErrorState(true);
    }

    setDerivedJsonSubmitting(false);
  };

  // ------------------------
  // Reset derived => revert to parent
  // ------------------------
  const resetDerivedJson = () => {
    setDerivedJsonTheme(null);
    setThemeType('parentJson');
  };

  // ------------------------
  // Toggle Wizard/JSON
  // ------------------------
  const handleViewToggle = (evt) => {
    evt.stopPropagation();
    setErrorMessage(null);
    setErrorState(false);
    setUiViewMode((prev) => (prev === 'json' ? 'wizard' : 'json'));
  };

  // ------------------------
  // Top-level theme selection buttons
  // ------------------------
  const getButtonClasses = (buttonType) => {
    const baseClasses = `rounded-lg px-4 py-1 inline-flex cursor-pointer mr-2
      justify-center items-center min-w-[6rem]
      text-sm font-semibold
    `;
    const selected =
      themeType === buttonType
        ? 'bg-gray-700 text-white'
        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white';
    return `${baseClasses} ${selected}`;
  };

  let topLevelButtons = null;
  if (!parentJsonTheme && !derivedJsonTheme) {
    // No JSON => “basic”, “custom”
    topLevelButtons = (
      <>
        <div
          className={getButtonClasses('basic')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('basic');
          }}
        >
          Basic
        </div>
        <div
          className={getButtonClasses('custom')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('custom');
          }}
        >
          Custom
        </div>
      </>
    );
  } else if (parentJsonTheme && !derivedJsonTheme) {
    // Has parent => “parentJson”, “addDerivedJson”
    topLevelButtons = (
      <>
        <div
          className={getButtonClasses('parentJson')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('parentJson');
          }}
        >
          Parent JSON
        </div>
        <div
          className={getButtonClasses('addDerivedJson')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('addDerivedJson');
          }}
        >
          Add Derived
        </div>
      </>
    );
  } else if (parentJsonTheme && derivedJsonTheme) {
    // Has both => “derivedParentJson”, “derivedJson”
    topLevelButtons = (
      <>
        <div
          className={getButtonClasses('derivedParentJson')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('derivedParentJson');
          }}
        >
          Parent JSON
        </div>
        <div
          className={getButtonClasses('derivedJson')}
          onClick={(evt) => {
            evt.stopPropagation();
            setThemeType('derivedJson');
          }}
        >
          Derived JSON
        </div>
      </>
    );
  }

  // Are we in a JSON-based mode?
  const isJsonBasedMode = ['parentJson', 'derivedParentJson', 'derivedJson'].includes(themeType);
  const isParent = themeType === 'parentJson' || themeType === 'derivedParentJson';
  const isDerived = themeType === 'derivedJson';

  // ------------------------
  // Submit custom theme
  // ------------------------
  const submitCustomTheme = (evt) => {
    evt.preventDefault();
    const headers = getHeaders();
    if (!headers) {
      return;
    }
    setParentJsonSubmitting(true);
    const payload = {
      sessionId,
      customTheme: customThemeText,
      aspectRatio: aspectRatio?.value,
    };
    axios
      .post(`${PROCESSOR_API_URL}/quick_session/set_base_theme`, payload, headers)
      .then((res) => {
        const data = res.data || {};
        setParentJsonSubmitting(false);
        if (data.parentJsonTheme) {
          setThemeType('parentJson');
          try {
            const parsed = JSON.parse(data.parentJsonTheme);
            setParentJsonTheme(JSON.stringify(parsed, null, 2));
          } catch  {
            setParentJsonTheme(data.parentJsonTheme);
          }
        }
      })
      .catch(() => {
        
        setParentJsonSubmitting(false);
      });
  };

  // ------------------------
  // Render the main theme input panel (depending on themeType and uiViewMode)
  // ------------------------
  const renderThemeInput = () => {
    if (themeType === 'basic') {
      return (
        <div className="p-2 bg-gray-950 rounded mt-2 text-neutral-100">
          <label className="block text-xs text-left pl-2 pb-1">
            Basic keywords or short text:
          </label>
          <TextareaAutosize
            minRows={2}
            maxRows={5}
            className="w-full bg-gray-950 text-white p-2 rounded"
            placeholder='e.g. "rustic, watercolor, vibrant"'
            value={basicTextTheme}
            onChange={(e) => setBasicTextTheme(e.target.value)}
          />
        </div>
      );
    }

    if (themeType === 'custom') {
      return (
        <div className="p-2 bg-gray-950 rounded mt-2 text-neutral-100">
          <label className="block text-xs text-left pl-2 pb-1">
            Custom theme text (override defaults):
          </label>
          <TextareaAutosize
            minRows={6}
            maxRows={10}
            className="w-full bg-gray-950 text-white p-2 rounded"
            placeholder="Enter your custom theme base text..."
            value={customThemeText}
            onChange={(e) => setCustomThemeText(e.target.value)}
          />
          <SecondaryButton
            onClick={submitCustomTheme}
            isPending={parentJsonSubmitting}
            extraClasses="mt-2"
          >
            Apply Custom Theme
          </SecondaryButton>
        </div>
      );
    }

    if (themeType === 'addDerivedJson') {
      // “Add Derived” from text
      return (
        <div className="p-2 bg-gray-950 rounded mt-2 text-neutral-100">
          <label className="block text-xs text-left pl-2 pb-1">
            Enter text to generate derived theme:
          </label>
          <TextareaAutosize
            minRows={6}
            maxRows={10}
            className="w-full bg-gray-950 text-white p-2 rounded"
            placeholder="Enter derived theme text..."
            value={derivedTextTheme}
            onChange={(e) => setDerivedTextTheme(e.target.value)}
          />
          <SecondaryButton
            onClick={submitDerivedJsonTheme}
            isPending={derivedJsonSubmitting}
            extraClasses="mt-2"
          >
            Apply Derived Theme
          </SecondaryButton>
        </div>
      );
    }

    // JSON-based modes => either Wizard or JSON Editor
    if (isJsonBasedMode) {
      // Wizard mode
      if (uiViewMode === 'wizard') {
        return (
          <div
            className={
              'p-2 bg-gray-950 rounded mt-2 text-neutral-100 ' +
              (isWizardExpanded ? '' : 'max-h-96 overflow-auto')
            }
          >
            <ThemeUIEditor editorData={editorData} setEditorData={setEditorData} />
          </div>
        );
      }

      // JSON Editor mode
      const activeValue = isParent ? parentJsonTheme : derivedJsonTheme;
      return (
        <div className="p-2 bg-gray-950 rounded mt-2 text-neutral-100">
          <label className="block text-xs text-left pl-2 pb-1">
            {isParent
              ? 'Enter JSON for parent theme'
              : 'Enter JSON for derived theme'}
          </label>
          <AceEditor
            mode="json"
            theme="monokai"
            name="jsonThemeEditor"
            value={activeValue || ''}
            onChange={isParent ? handleParentJsonThemeChange : handleDerivedJsonThemeChange}
            fontSize={14}
            showPrintMargin
            showGutter
            highlightActiveLine
            setOptions={{
              enableBasicAutocompletion: true,
              enableLiveAutocompletion: true,
              enableSnippets: true,
              showLineNumbers: true,
              tabSize: 2,
            }}
            editorProps={{ $blockScrolling: true }}
            width="100%"
            height="200px"
            className="rounded"
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="p-2 bg-gray-900 mt-2 text-white rounded">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        {/* Left: Theme Settings label + toggle */}
        {showTheme && (
          <>
            <div
              className="flex items-center cursor-pointer"

            >
              <span className="font-semibold">Theme Settings</span>
            </div>
            <div className="flex flex-wrap items-center justify-center mt-2">
              {topLevelButtons}
              {isJsonBasedMode && (
                <div
                  className="rounded-lg px-4 py-1 inline-flex cursor-pointer
                justify-center items-center min-w-[6rem]
                text-sm font-semibold
                bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white
                ml-2"
                  onClick={handleViewToggle}
                >
                  {uiViewMode === 'json' ? 'Wizard View' : 'JSON View'}
                </div>
              )}
            </div>


            <div className="flex items-center space-x-2">
              {/* Show update/reset/expand only in JSON-based wizard mode */}
              {isJsonBasedMode && uiViewMode === 'wizard' && (
                <>
                  {isParent && (
                    <SecondaryButton
                      onClick={updatePrimaryJsonTheme}
                      isPending={parentJsonSubmitting}
                    >
                      Update Parent JSON
                    </SecondaryButton>
                  )}
                  {isDerived && (
                    <>
                      <div
                        className="inline-block bg-gray-700 text-white py-1 px-2 rounded cursor-pointer"
                        onClick={resetDerivedJson}
                      >
                        Reset Derived
                      </div>
                      <SecondaryButton
                        onClick={updateDerivedJsonTheme}
                        isPending={derivedJsonSubmitting}
                      >
                        Update Derived JSON
                      </SecondaryButton>
                    </>
                  )}

                  {/* Expand/Collapse Button */}
                  <button
                    type="button"
                    className="flex items-center px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                    onClick={() => setIsWizardExpanded(!isWizardExpanded)}
                  >
                    {isWizardExpanded ? <FaCompress /> : <FaExpand />}
                  </button>
                </>
              )}
            </div>

          </>
        )}
      </div>


      {/* Content area */}
      {showTheme && (
        <div className="mt-2">
          {renderThemeInput()}
          {errorState && errorMessage && (
            <div className="text-red-400 text-sm mt-2">{errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
