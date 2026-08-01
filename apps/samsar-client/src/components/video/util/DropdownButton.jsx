import { useState, useEffect, useId, useRef } from 'react';
import { FaChevronDown, FaPlus } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode';

function DropdownButton(props) {
  const {
    addLayerToComposition, // function to add a layer with the chosen position
    copyCurrentLayerBelow,
    showBatchLayerDialog,
    compact = false,
    iconOnly = false,
    buttonLabel = 'Layer',
    menuAlign = 'right',
    fullWidth = false,
    fitMenuToTrigger = false,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [defaultSubOption, setDefaultSubOption] = useState(null); // default sub-option
  const rootRef = useRef(null);
  const menuId = useId();

  const { colorMode } = useColorMode();

  // Container & hover colors separated
  const triggerSurfaceClassName =
    colorMode === 'dark'
      ? 'bg-[#20232e]/88 text-slate-100 border border-[#667188] shadow-[0_14px_36px_rgba(0,0,0,0.32)] backdrop-blur-xl hover:border-[#ff4655]/60 hover:bg-[#292d3a] focus-visible:ring-2 focus-visible:ring-[#ffe0a3]/70'
      : 'bg-white/92 text-slate-800 border border-slate-200 shadow-sm backdrop-blur-md hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400/50';
  const menuSurfaceClassName =
    colorMode === 'dark'
      ? 'bg-[#181b24]/96 border border-[#3a4050] text-slate-100 shadow-[0_22px_52px_rgba(0,0,0,0.40)] backdrop-blur-xl'
      : 'bg-white/96 border border-slate-200 text-slate-700 shadow-[0_18px_38px_rgba(15,23,42,0.16)] backdrop-blur-xl';
  const sectionLabelClassName =
    colorMode === 'dark'
      ? 'text-slate-400'
      : 'text-slate-500';
  const actionItemClassName =
    colorMode === 'dark'
      ? 'text-slate-200 hover:bg-[#292d3a]'
      : 'text-slate-700 hover:bg-slate-100';
  const addOptionClassName =
    colorMode === 'dark'
      ? 'bg-[#20232e]/80 text-slate-100 hover:bg-[#292d3a]'
      : 'bg-white/90 text-slate-700 hover:bg-slate-50';
  const defaultOptionClassName =
    colorMode === 'dark'
      ? 'bg-[#ff4655]/14 text-[#ffd4d8]'
      : 'bg-sky-50 text-sky-700';
  const triggerSizeClassName = iconOnly
    ? (compact ? 'h-[34px] w-[34px] px-0 text-[11px]' : 'h-10 w-10 px-0 text-sm')
    : (compact ? 'min-h-[34px] px-2.5 text-[11px]' : 'min-h-9 px-3 py-1.5 text-xs');
  const iconClassName = iconOnly
    ? (compact ? 'text-[11px]' : 'text-sm')
    : (compact ? 'shrink-0 text-[11px]' : 'shrink-0 text-sm');
  const menuAlignmentClassName = menuAlign === 'left'
    ? 'left-0 origin-top-left'
    : 'right-0 origin-top-right';
  const rootWidthClassName = fullWidth ? 'w-full' : '';
  const menuWidthClassName = fitMenuToTrigger ? 'w-full min-w-0' : 'w-[220px]';

  const addOptions = [
    { value: 'below', label: 'Below current' },
    { value: 'end', label: 'At end' },
    { value: 'beginning', label: 'At beginning' },
  ];

  useEffect(() => {
    const storedOption = localStorage.getItem('defaultAddLayerSubOption');
    if (storedOption) {
      setDefaultSubOption(storedOption);
    } else {
      setDefaultSubOption('below');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const handleAddLayerClick = (option) => {
    localStorage.setItem('defaultAddLayerSubOption', option);
    setDefaultSubOption(option);
    addLayerToComposition(option);
    setIsOpen(false);
  };

  const copyCurrentLayer = () => {
    copyCurrentLayerBelow();
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative z-[260] inline-block text-left ${rootWidthClassName}`}>
      {/* MAIN "Add" BUTTON */}
      <button
        type="button"
        onClick={toggleDropdown}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className={`inline-flex w-full items-center ${iconOnly ? 'justify-center' : 'justify-between'} gap-1.5 font-medium leading-none rounded-lg focus:outline-none transition-all duration-150 ${triggerSizeClassName} ${triggerSurfaceClassName}`}
      >
        {iconOnly ? (
          <FaPlus className={iconClassName} />
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 leading-none text-xs">
              <FaPlus className={iconClassName} />
              <span>{buttonLabel}</span>
            </span>
            <FaChevronDown className="shrink-0 text-[10px] opacity-80" />
          </>
        )}
      </button>

      {/* MAIN DROPDOWN MENU */}
      {isOpen && (
        <div
          className={`absolute ${menuAlignmentClassName} z-[320] mt-2 rounded-2xl p-1.5 ${menuWidthClassName} ${menuSurfaceClassName}`}
        >
          <div id={menuId} className="space-y-2" role="menu" aria-orientation="vertical" aria-label={`${buttonLabel} actions`}>
            <div className="px-2 pt-0.5" role="presentation">
              <div className={`text-[9px] font-semibold uppercase tracking-[0.16em] ${sectionLabelClassName}`}>
                Add Layer
              </div>
            </div>

            <div className="space-y-1" role="presentation">
              {addOptions.map((option) => {
                const isDefault = defaultSubOption === option.value;

                return (
                  <button
                    type="button"
                    key={option.value}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] leading-tight transition ${addOptionClassName} ${isDefault ? defaultOptionClassName : ''}`}
                    onClick={() => handleAddLayerClick(option.value)}
                    role="menuitem"
                  >
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className={colorMode === 'dark' ? 'h-px bg-white/8' : 'h-px bg-slate-200'} role="separator" />

            <div className="space-y-1" role="presentation">
              <button
                type="button"
                onClick={copyCurrentLayer}
                className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-[11px] transition ${actionItemClassName}`}
                role="menuitem"
              >
                Copy current
              </button>

              <button
                type="button"
                onClick={() => {
                  showBatchLayerDialog();
                  setIsOpen(false);
                }}
                className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-[11px] transition ${actionItemClassName}`}
                role="menuitem"
              >
                Add Batch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DropdownButton;
