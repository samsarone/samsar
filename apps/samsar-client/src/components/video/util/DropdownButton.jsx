import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';
import { useState, useEffect, useId, useRef } from 'react';
import { FaChevronDown, FaPlus } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode';
import FloatingPanel from '../../common/FloatingPanel';

function DropdownButton(props) {
  useUiLanguage();
  const {
    addLayerToComposition, // function to add a layer with the chosen position
    copyCurrentLayerBelow,
    showBatchLayerDialog,
    compact = false,
    iconOnly = false,
    buttonLabel = uiText("Layer"),
    menuAlign = 'right',
    fullWidth = false,
    fitMenuToTrigger = false,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [defaultSubOption, setDefaultSubOption] = useState(null); // default sub-option
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const { colorMode } = useColorMode();

  // Container & hover colors separated
  const triggerSurfaceClassName =
    `border border-line-control focus-visible:ring-2 ${colorMode === 'dark' ? 'bg-[#20232e]/88 text-slate-100 shadow-[0_14px_36px_rgba(0,0,0,0.32)] backdrop-blur-xl hover:border-[#ff4655]/60 hover:bg-[#292d3a] focus-visible:ring-[#ffe0a3]/70' : 'bg-white/92 text-slate-800 shadow-sm backdrop-blur-md hover:bg-slate-50 focus-visible:ring-blue-400/50'}`;
  const menuSurfaceClassName =
    `border border-line text-fg-body backdrop-blur-xl ${colorMode === 'dark' ? 'bg-[#181b24]/96 shadow-[0_22px_52px_rgba(0,0,0,0.40)]' : 'bg-white/96 shadow-[0_18px_38px_rgba(15,23,42,0.16)]'}`;
  const sectionLabelClassName =
    'text-fg-muted';
  const actionItemClassName =
    'text-fg-secondary hover:bg-surface-hover';
  const addOptionClassName =
    `text-fg-body ${colorMode === 'dark' ? 'bg-[#20232e]/80 hover:bg-[#292d3a]' : 'bg-white/90 hover:bg-slate-50'}`;
  const defaultOptionClassName =
    colorMode === 'dark'
      ? 'bg-[#ff4655]/14 text-[#ffd4d8]'
      : 'bg-sky-50 text-sky-700';
  const triggerSizeClassName = iconOnly
    ? (compact ? 'h-[34px] w-[34px] px-0 text-caption' : 'h-10 w-10 px-0 text-sm')
    : (compact ? 'min-h-[34px] px-2.5 text-caption' : 'min-h-9 px-3 py-1.5 text-xs');
  const iconClassName = iconOnly
    ? (compact ? 'text-caption' : 'text-sm')
    : (compact ? 'shrink-0 text-caption' : 'shrink-0 text-sm');
  const rootWidthClassName = fullWidth ? 'w-full' : '';

  const addOptions = [
    { value: 'below', label: uiText("Below current") },
    { value: 'end', label: uiText("At end") },
    { value: 'beginning', label: uiText("At beginning") },
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
      if (rootRef.current && !rootRef.current.contains(event.target) && !menuRef.current?.contains(event.target)) {
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
            <FaChevronDown className="shrink-0 text-micro opacity-80" />
          </>
        )}
      </button>

      {/* MAIN DROPDOWN MENU */}
      {isOpen && (
        <FloatingPanel
          anchorRef={rootRef} panelRef={menuRef} align={menuAlign} fitToAnchor={fitMenuToTrigger}
          className={`rounded-2xl p-1.5 ${menuSurfaceClassName}`}
        >
          <div id={menuId} className="space-y-2" role="menu" aria-orientation="vertical" aria-label={uiText("{value0} actions", { value0: buttonLabel })}>
            <div className="px-2 pt-0.5" role="presentation">
              <div className={`text-micro font-semibold uppercase tracking-[0.16em] ${sectionLabelClassName}`}>{uiText("Add Layer")}</div>
            </div>

            <div className="space-y-1" role="presentation">
              {addOptions.map((option) => {
                const isDefault = defaultSubOption === option.value;

                return (
                  <button
                    type="button"
                    key={option.value}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-caption leading-tight transition ${addOptionClassName} ${isDefault ? defaultOptionClassName : ''}`}
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
                className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-caption transition ${actionItemClassName}`}
                role="menuitem"
              >{uiText("Copy current")}</button>

              <button
                type="button"
                onClick={() => {
                  showBatchLayerDialog();
                  setIsOpen(false);
                }}
                className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-caption transition ${actionItemClassName}`}
                role="menuitem"
              >{uiText("Add Batch")}</button>
            </div>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}

export default DropdownButton;
