
import { FaTimes, FaEye } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode';
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

const grid = 8;

const LayersDisplay = (props) => {
  const { 
    activeItemList, 
    setActiveItemList,
    updateSessionLayerActiveItemList, 
    hideItemInLayer,
    setSelectedId 
  } = props;

  const { colorMode } = useColorMode();
  const displayItems = Array.isArray(activeItemList) ? [...activeItemList].reverse() : [];

  const bgColorDragging = colorMode === 'dark' ? '#0f1629' : '#fafafa';
  const bgColorDraggingOver = colorMode === 'dark' ? '#111a2f' : '#f5f5f5';
  
  const getListStyle = (isDraggingOver) => ({
    background: isDraggingOver ? bgColorDraggingOver : bgColorDragging,
    padding: grid,
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    borderRadius: 8,
    overflow: 'hidden'
  });

  const onDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    const actualSourceIndex = activeItemList.length - 1 - result.source.index;
    const actualDestinationIndex = activeItemList.length - 1 - result.destination.index;
    const newItems = reorder(
      [...activeItemList],
      actualSourceIndex,
      actualDestinationIndex
    );

    const reorderedItems = newItems.map((item, index) => ({
      ...item,
      id: `item_${index}`
    }));

    setActiveItemList(reorderedItems);
    updateSessionLayerActiveItemList(reorderedItems);
  };
  
  const deleteItem = (id) => {
    const filteredItems = activeItemList.filter(item => item.id !== id);
    
    const reorderedItems = filteredItems.map((item, index) => ({
      ...item,
      id: `item_${index}`
    }));

    setActiveItemList(reorderedItems);
    updateSessionLayerActiveItemList(reorderedItems);
  };

  const isDraggingBGColor = colorMode === 'dark' ? '#16213a' : '#a8a29e';
  const isStableBGColor = colorMode === 'dark' ? '#0b1021' : '#d6d3d1';
  const textColor = colorMode === 'dark' ? '#e5e7eb' : '#171717';

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="droppable">
        {(provided, snapshot) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            style={getListStyle(snapshot.isDraggingOver)}
          >
            {displayItems.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    onClick={() => setSelectedId(item.id)}
                    style={{
                      ...provided.draggableProps.style,
                      width: '100%',
                      margin: '0 0 8px',
                      backgroundColor: snapshot.isDragging ? isDraggingBGColor : isStableBGColor,
                      border: colorMode === 'dark' ? '1px solid #1f2a3d' : '1px solid #64748b',
                      color: textColor,
                      padding: '8px',
                      borderRadius: '5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      {...provided.dragHandleProps}
                      style={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {`item ${item.id} - ${item.type}`}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        hideItemInLayer(item.id);
                      }}
                      aria-label="Toggle layer visibility"
                      title="Toggle layer visibility"
                      style={{
                        color: textColor,
                        flex: '0 0 24px',
                        width: 24,
                        height: 24,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <FaEye />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteItem(item.id);
                      }}
                      aria-label="Delete layer"
                      title="Delete layer"
                      style={{
                        color: textColor,
                        flex: '0 0 24px',
                        width: 24,
                        height: 24,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <FaTimes />
                    </button>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
};

const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

export default LayersDisplay;
