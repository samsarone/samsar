import { useState, useCallback } from 'react';
import { useAlertDialog } from '../../../contexts/AlertDialogContext';
import { STAGE_DIMENSIONS } from '../../../constants/Image.jsx';
import { getCanvasDimensionsForAspectRatio } from '../../../utils/canvas.jsx';

export default function UploadImageDialog({ setUploadURL, aspectRatio }) {
  const [image, setImage] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  useAlertDialog();

  // Handler for file input change
  const handleFileChange = (event) => {
    processFile(event.target.files[0]);
  };

  // Handler for drag and drop
  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      processFile(event.dataTransfer.files[0]);
      event.dataTransfer.clearData();
    }
  };

  // Prevent default behavior for drag over
  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // Handle file processing
  const processFile = (file) => {
    if (!file) {
      setUploadStatus('Please upload an image file.');
      return;
    }
    const fileName = file.name ? file.name.toLowerCase() : '';
    const isHeicFile = fileName.endsWith('.heic') || fileName.endsWith('.heif');
    const isImageFile = Boolean(file.type && file.type.startsWith('image/')) || isHeicFile;
    if (!isImageFile) {
      setUploadStatus('Please upload an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target.result);
      setUploadStatus('Upload successful!');
    };
    reader.readAsDataURL(file);
  };

  // Handle paste event
  const handlePaste = useCallback((event) => {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let item of items) {
      if (item.type.indexOf("image") === 0) {
        processFile(item.getAsFile());
      }
    }
  }, []);

  const handleAddToCanvas = () => {
    const img = new Image();
    img.src = image;
    img.onload = () => {
      const stageHeight = STAGE_DIMENSIONS.height;
      const stageWidth = STAGE_DIMENSIONS.width;
  
      let imageWidth = img.width;
      let imageHeight = img.height;

      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  
      // Ensure width and height are within the bounds of 128 and 1024
      imageWidth = Math.max(128, Math.min(canvasDimensions.width, imageWidth));
      imageHeight = Math.max(128, Math.min(canvasDimensions.height, imageHeight));
  
      const x = (stageWidth - imageWidth) / 2;
      const y = (stageHeight - imageHeight) / 2;
  
      setUploadURL({
        url: image,
        width: imageWidth,
        height: imageHeight,
        x,
        y,
      });
    };
  };
  

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onPaste={handlePaste}
      className="upload-container relative h-[512px]"
      style={{ border: '1px solid black', padding: '20px', textAlign: 'center' }}
    >
      <input
        type="file"
        accept="image/*,image/heic,image/heif,.heic,.heif"
        onChange={handleFileChange}
      />
      {uploadStatus && <p>{uploadStatus}</p>}
      {image && (
        <div className='m-auto text-center'>
          <div>
            Preview
          </div>  
          <img src={image} alt="Preview" style={{ maxWidth: '300px', margin: 'auto'  }} />

          <button onClick={handleAddToCanvas} className="mt-4 py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600">
            Add To Canvas
          </button>

        </div>
      )}
    </div>
  );
}
