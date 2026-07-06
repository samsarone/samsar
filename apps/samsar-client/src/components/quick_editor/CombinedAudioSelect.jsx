
import Select, { components } from 'react-select';

export default function CombinedAudioSelect(props) {
  const {
    speakerType,
    onSpeakerChange,
    speakerOptions,
    colorMode,
  } = props;

  // Styles for select and dropdowns
  const formSelectBgColor = colorMode === 'dark' ? '#1a1a1a' : '#f3f4f6';
  const formSelectTextColor = colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectSelectedTextColor = colorMode === 'dark' ? '#f3f4f6' : '#111827';
  const formSelectHoverColor = colorMode === 'dark' ? '#007BFF' : '#2563EB';


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
            }),
            singleValue: (provided) => ({
              ...provided,
              color: formSelectTextColor,
            }),
            control: (provided, state) => ({
              ...provided,
              backgroundColor: formSelectBgColor,
              borderColor: state.isFocused ? '#007BFF' : '#ced4da',
              '&:hover': {
                borderColor: state.isFocused ? '#007BFF' : '#ced4da',
              },
              boxShadow: state.isFocused
                ? '0 0 0 0.2rem rgba(0, 123, 255, 0.25)'
                : null,
              minHeight: '38px',
              height: '38px',
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
