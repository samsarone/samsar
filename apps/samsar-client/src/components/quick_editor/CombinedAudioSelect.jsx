
import Select, { components } from 'react-select';

export default function CombinedAudioSelect(props) {
  const {
    speakerType,
    onSpeakerChange,
    speakerOptions,
    colorMode,
  } = props;

  // Styles for select and dropdowns
  const formSelectBgColor = colorMode === 'dark' ? '#181b24' : '#f3f4f6';
  const formSelectTextColor = colorMode === 'dark' ? '#f4f6fb' : '#111827';
  const formSelectSelectedTextColor = colorMode === 'dark' ? '#ffd4d8' : '#111827';
  const formSelectHoverColor = colorMode === 'dark' ? '#292d3a' : '#2563EB';
  const formSelectBorderColor = colorMode === 'dark' ? '#667188' : '#ced4da';
  const formSelectFocusColor = colorMode === 'dark' ? '#f6c453' : '#007BFF';


  // Custom Option Component to include play/pause icons and provider
  const Option = (props) => {
    const { data } = props;
    return (
      <components.Option {...props}>
        <div className="flex items-center justify-between">
          <span>
            {data.label}
            <small className="text-xs text-gray-500">
              {' '}
              ({data.provider.toLowerCase()})
            </small>
          </span>
          {data.icon && (
            <span onClick={(evt) => data.onClick(evt)}>
              {data.icon}
            </span>
          )}
        </div>
      </components.Option>
    );
  };

  const SingleValue = (props) => (
    <components.SingleValue {...props}>
      {props.data.label}{' '}
      <small className="text-xs text-gray-500">
        ({props.data.provider.toLowerCase()})
      </small>
    </components.SingleValue>
  );

  return (
    <div className="flex items-center">

      <div className="w-full ml-2">
        <Select
          value={speakerType}
          onChange={onSpeakerChange}
          options={speakerOptions}
          components={{ Option, SingleValue }}
          styles={{
            menu: (provided) => ({
              ...provided,
              backgroundColor: formSelectBgColor,
              border: `1px solid ${colorMode === 'dark' ? '#3a4050' : '#d1d5db'}`,
              borderRadius: 10,
              overflow: 'hidden',
            }),
            singleValue: (provided) => ({
              ...provided,
              color: formSelectTextColor,
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
              minHeight: '36px',
              height: '36px',
            }),
            option: (provided, state) => ({
              ...provided,
              backgroundColor: state.isSelected
                ? formSelectHoverColor
                : formSelectBgColor,
              color: state.isSelected ? formSelectSelectedTextColor : formSelectTextColor,
              '&:hover': {
                backgroundColor: formSelectHoverColor,
              },
            }),
          }}
        />
      </div>
    </div>
  );
}
