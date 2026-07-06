
import TextareaAutosize from 'react-textarea-autosize';

export default function AutoExpandableTextarea(props) {
  const {
    minRows = 3,
    maxRows = 10,
    className = '',
    ...rest
  } = props;

  return (
    <TextareaAutosize
      minRows={minRows}
      maxRows={maxRows}
      className={`resize-none overflow-y-auto ${className}`}
      {...rest}
    />
  );
}
