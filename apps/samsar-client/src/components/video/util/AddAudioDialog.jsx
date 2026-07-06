import { useState } from 'react';
import CommonButton from '../../common/CommonButton.tsx';

export default function AddAudioDialog(props) {
  const [file, setFile] = useState(null);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile && selectedFile.type.includes('audio')) {
      setFile(selectedFile);
    } else {
      setFile(null);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.includes('audio')) {
      setFile(droppedFile);
    } else {
      setFile(null);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleSubmit = () => {
    if (file) {
      props.addAudioToProject(file);
    }
  };

  return (
    <div>
      <input type="file" accept="audio/mp3" onChange={handleFileChange} />
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          width: '100%',
          height: '200px',
          border: '2px dashed #ccc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '20px',
        }}
      >
        Drag and drop MP3 files here
      </div>
      {file && <p>Selected file: {file.name}</p>}
      <CommonButton onClick={handleSubmit}>Submit</CommonButton>
    </div>
  );
}
