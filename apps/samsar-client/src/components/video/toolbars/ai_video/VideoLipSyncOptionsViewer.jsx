
import SecondaryButton from '../../../common/SecondaryButton.tsx';


export default function VideoAiVideoOptionsViewer(props) {
  const {
    currentLayer,           // you likely already pass this in from your parent
    onDeleteLayer,          // prop to handle Delete
    removeVideoLayer,
    sizeVariant = "default",
  } = props;
  const isSidebarPanel =
    sizeVariant === "sidebarCollapsed" || sizeVariant === "sidebarExpanded";




  const handleDeleteLayer = () => {
    // Make sure the parent-provided handler exists
    if (onDeleteLayer) {
      removeVideoLayer(currentLayer);
    }
  };

  return (
    <div className="mt-2">
      {/* Delete button */}
      <div className="mb-2">
        <SecondaryButton
          onClick={handleDeleteLayer}
          className={isSidebarPanel ? 'w-full whitespace-normal text-center leading-tight' : ''}
        >
          Delete Layer
        </SecondaryButton>
      </div>

    </div>
  );
}
