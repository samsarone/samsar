
import '../../common/Loader.css'; // Import the custom CSS styles

const LoadingImageBase = () => {
  return (
    <div className="loader-background flex items-center justify-center w-full h-full">
      <div className="text-center">
        <div className="muted-loader mb-8"></div>
        <div className="muted-text">Loading...</div>
      </div>
    </div>
  );
};

export default LoadingImageBase;
