
import Select from 'react-select';
import { useColorMode } from '../../contexts/ColorMode';

const MENU_Z_INDEX = 11050; // Keep dropdown above modals like AlertDialog

export default function SingleSelect(props) {
  const {
    options,
    value,
    onChange,
    classNamePrefix,
    isSearchable = true,
    placeholder,
    name,
    compactLayout = false,
    truncateLabels = false,
    isDisabled = false,
    className,
    styles: customStyles,
    formatOptionLabel,
  } = props;

  const { colorMode } = useColorMode();


  // Styles for select and dropdowns
  const formSelectBgColor = colorMode === 'dark' ? '#181b24' : '#f3f4f6';
  const formSelectTextColor = colorMode === 'dark' ? '#f4f6fb' : '#111827';
  const formSelectSelectedTextColor =
    colorMode === 'dark' ? '#fff1c8' : '#1e3a8a';
  const formSelectSelectedBgColor =
    colorMode === 'dark' ? 'rgba(246, 196, 83, 0.14)' : '#dbeafe';
  const formSelectHoverColor = colorMode === 'dark' ? '#292d3a' : '#2563EB';
  const formSelectBorderColor = colorMode === 'dark' ? '#667188' : '#737373';
  const formSelectFocusColor = colorMode === 'dark' ? '#f6c453' : '#007BFF';
  const shouldUseMultilineValue =
    !compactLayout && !truncateLabels && String(value?.label || '').length > 42;
  const controlMinHeight = compactLayout ? 34 : shouldUseMultilineValue ? 46 : 36;
  const resolveCustomStyle = (slotName, ...args) => {
    const slotOverride = customStyles?.[slotName];
    return typeof slotOverride === 'function' ? slotOverride(...args) : {};
  };
  const mergedStyles = {
    container: (provided) => ({
      ...provided,
      width: '100%',
      minWidth: 0,
      ...resolveCustomStyle('container', provided),
    }),
    menuPortal: (provided) => ({
      ...provided,
      zIndex: MENU_Z_INDEX,
      ...resolveCustomStyle('menuPortal', provided),
    }),
    menu: (provided) => ({
      ...provided,
      backgroundColor: formSelectBgColor,
      border: `1px solid ${colorMode === 'dark' ? '#3a4050' : '#d1d5db'}`,
      borderRadius: 10,
      boxShadow: colorMode === 'dark'
        ? '0 18px 42px rgba(0, 0, 0, 0.38)'
        : '0 14px 30px rgba(15, 23, 42, 0.14)',
      overflow: 'hidden',
      zIndex: MENU_Z_INDEX,
      ...resolveCustomStyle('menu', provided),
    }),
    singleValue: (provided) => ({
      ...provided,
      color: formSelectTextColor,
      maxWidth: '100%',
      marginLeft: 0,
      marginRight: 0,
      overflow: shouldUseMultilineValue ? 'visible' : 'hidden',
      textOverflow: shouldUseMultilineValue ? 'clip' : 'ellipsis',
      whiteSpace: shouldUseMultilineValue ? 'normal' : 'nowrap',
      lineHeight: shouldUseMultilineValue ? '1.2' : provided.lineHeight,
      position: shouldUseMultilineValue ? 'static' : provided.position,
      transform: shouldUseMultilineValue ? 'none' : provided.transform,
      ...resolveCustomStyle('singleValue', provided),
    }),
    valueContainer: (provided) => ({
      ...provided,
      padding: shouldUseMultilineValue ? '4px 10px' : '0 10px',
      overflow: shouldUseMultilineValue ? 'visible' : 'hidden',
      minWidth: 0,
      ...resolveCustomStyle('valueContainer', provided),
    }),
    control: (provided, state) => ({
      ...provided,
      backgroundColor: formSelectBgColor,
      borderColor: state.isFocused ? formSelectFocusColor : formSelectBorderColor,
      '&:hover': {
        borderColor: state.isFocused ? formSelectFocusColor : formSelectBorderColor,
      },
      boxShadow: state.isFocused
        ? colorMode === 'dark'
          ? '0 0 16px rgba(246, 196, 83, 0.18)'
          : '0 0 12px rgba(0, 123, 255, 0.16)'
        : null,
      borderRadius: 8,
      minHeight: `${controlMinHeight}px`,
      height: shouldUseMultilineValue ? 'auto' : `${controlMinHeight}px`,
      width: '100%',
      minWidth: 0,
      ...resolveCustomStyle('control', provided, state),
    }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? formSelectSelectedBgColor
        : state.isFocused
          ? formSelectHoverColor
          : formSelectBgColor,
      color: state.isSelected
        ? formSelectSelectedTextColor
        : state.isFocused && colorMode !== 'dark'
          ? '#ffffff'
          : formSelectTextColor,
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      fontSize: 13,
      padding: '7px 10px',
      '&:hover': {
        backgroundColor: state.isSelected ? formSelectSelectedBgColor : formSelectHoverColor,
      },
      ...resolveCustomStyle('option', provided, state),
    }),
    input: (provided) => ({
      ...provided,
      color: colorMode === 'dark' ? '#8b96aa' : formSelectTextColor,
      ...resolveCustomStyle('input', provided),
    }),
    placeholder: (provided) => ({
      ...provided,
      color: colorMode === 'dark' ? '#8b96aa' : '#6b7280',
      whiteSpace: shouldUseMultilineValue ? 'normal' : 'nowrap',
      overflow: shouldUseMultilineValue ? 'visible' : 'hidden',
      textOverflow: shouldUseMultilineValue ? 'clip' : 'ellipsis',
      maxWidth: '100%',
      ...resolveCustomStyle('placeholder', provided),
    }),
    indicatorSeparator: (provided) => ({
      ...provided,
      display: 'none',
      ...resolveCustomStyle('indicatorSeparator', provided),
    }),
    dropdownIndicator: (provided) => ({
      ...provided,
      padding: compactLayout ? 5 : 6,
      ...resolveCustomStyle('dropdownIndicator', provided),
    }),
    clearIndicator: (provided) => ({
      ...provided,
      padding: compactLayout ? 5 : 6,
      ...resolveCustomStyle('clearIndicator', provided),
    }),
  };


  return (
    <Select
      name={name}
      className={className}
      isSearchable={isSearchable}
      placeholder={placeholder}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
      menuPosition="fixed"
      styles={mergedStyles}
      options={options}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      classNamePrefix={classNamePrefix}
      formatOptionLabel={formatOptionLabel}
    />
  );
}
