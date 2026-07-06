
import MusicLibraryHome from '../library/audio/MusicLibraryHome';
export default function MusicPanelContent() {
  return (
    <div className="h-[calc(100vh-150px)] min-h-[520px] min-w-0 overflow-hidden sm:h-[calc(100vh-170px)]">
      <MusicLibraryHome hideSelectButton={true} />
    </div>
  )
}
