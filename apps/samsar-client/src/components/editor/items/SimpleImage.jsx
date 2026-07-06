import { useRef } from "react";
import { Image } from 'react-konva';
import { useImage } from 'react-konva-utils';

export default function SimpleImage({ image, isSelected, onSelect, onUnselect, updateToolbarButtonPosition, ...props }) {

  const [img] = useImage(image.src, "anonymous");
  useRef();
  useRef();




  return (
    <Image
      {...props}
      image={img}
      draggable={true}
    />

  );
}
