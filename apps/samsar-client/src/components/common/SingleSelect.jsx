
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
    styles: customStyles,
  } = props;

  const { colorMode } = useColorMode();


  // Styles for select and dropdowns
  const formSelectBgColor = colorMode === 'dark' ? '#030712' : '#f3f4f6';
  const formSelectTextColor = colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectSelectedTextColor =
    colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectHoverColor = colorMode === 'dark' ? '#1f2937' : '#2563EB';
  const normalizedLabels = [
    ...(Array.isArray(options) ? options.map((option) => option?.label) : []),
    value?.label,
    placeholder,
  ]
    .filter(Boolean)
    .map((label) => String(label));
  const longestLabelLength = normalizedLabels.reduce(
    (maxLength, label) => Math.max(maxLength, label.length),
    0
  );
  const shouldUseMultilineValue =
    !truncateLabels && (compactLayout || longestLabelLength > 18);
  const controlMinHeight = shouldUseMultilineValue ? 52 : 38;
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
      paddingTop: shouldUseMultilineValue ? 6 : provided.paddingTop,
      paddingBottom: shouldUseMultilineValue ? 6 : provided.paddingBottom,
      overflow: 'visible',
      minWidth: 0,
      ...resolveCustomStyle('valueContainer', provided),
    }),
    control: (provided, state) => ({
      ...provided,
      backgroundColor: formSelectBgColor,
      borderColor: state.isFocused ? '#007BFF' : '#737373',
      '&:hover': {
        borderColor: state.isFocused ? '#007BFF' : '#737373',
      },
      boxShadow: state.isFocused
        ? '0 0 0 0.2rem rgba(0, 123, 255, 0.25)'
        : null,
      minHeight: `${controlMinHeight}px`,
      height: shouldUseMultilineValue ? 'auto' : '38px',
      width: '100%',
      minWidth: 0,
      ...resolveCustomStyle('control', provided, state),
    }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: formSelectBgColor,
      color: state.isSelected
        ? formSelectSelectedTextColor
        : formSelectTextColor,
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      '&:hover': {
        backgroundColor: formSelectHoverColor,
      },
      ...resolveCustomStyle('option', provided, state),
    }),
    input: (provided) => ({
      ...provided,
      color: formSelectTextColor,
      ...resolveCustomStyle('input', provided),
    }),
    placeholder: (provided) => ({
      ...provided,
      color: formSelectTextColor,
      whiteSpace: shouldUseMultilineValue ? 'normal' : 'nowrap',
      overflow: shouldUseMultilineValue ? 'visible' : 'hidden',
      textOverflow: shouldUseMultilineValue ? 'clip' : 'ellipsis',
      maxWidth: '100%',
      ...resolveCustomStyle('placeholder', provided),
    }),
  };


  return (
    <Select
      name={name}
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
    />
  );
}
