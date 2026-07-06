export function getAnimationPresetForType(videoType, animationType, canvasDimensions) {
  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;

  if (videoType === 'Slideshow') {
    const tenPercentWidth = 0.1 * canvasWidth;
    const tenPercentHeight = 0.1 * canvasHeight;

    if (animationType === 'pan_left_to_right') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": 0,
            "startY": -tenPercentHeight,
            "endX": -tenPercentWidth,
            "endY": -tenPercentHeight
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 110,
            "endScale": 110
          }
        }
      ];
    } else if (animationType === 'pan_right_to_left') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": -tenPercentWidth,
            "startY": -tenPercentHeight,
            "endX": 0,
            "endY": -tenPercentHeight
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 110,
            "endScale": 110
          }
        }
      ];
    } else if (animationType === 'pan_top_to_bottom') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": 0,
            "startY": -tenPercentHeight,
            "endX": 0,
            "endY": 0
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 110,
            "endScale": 110
          }
        }
      ];
    } else if (animationType === 'pan_bottom_to_top') { // Corrected the typo
      return [
        {
          "type": "slide",
          "params": {
            "startX": 0,
            "startY": 0,
            "endX": 0,
            "endY": -tenPercentHeight
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 110,
            "endScale": 110
          }
        }
      ];
    } else if (animationType === 'zoom_out') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": -tenPercentWidth,
            "startY": -tenPercentHeight,
            "endX": 0,
            "endY": 0
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 115,
            "endScale": 100
          }
        }
      ];
    } else if (animationType === 'zoom_in') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": 0,
            "startY": 0,
            "endX": -tenPercentWidth,
            "endY": -tenPercentHeight
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 100,
            "endScale": 115
          }
        }
      ];
    } else {
      return;
    }
  } else if (videoType === 'Infinitezoom') {
    const fiftyPercentWidth = 0.5 * canvasWidth;
    const fiftyPercentHeight = 0.5 * canvasHeight;

    if (animationType === 'zoom_out') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": -fiftyPercentWidth,
            "startY": -fiftyPercentHeight,
            "endX": 0,
            "endY": 0
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 200,
            "endScale": 100
          }
        }
      ];
    } else if (animationType === 'zoom_in') {
      return [
        {
          "type": "slide",
          "params": {
            "startX": 0,
            "startY": 0,
            "endX": -fiftyPercentWidth,
            "endY": -fiftyPercentHeight
          }
        },
        {
          "type": "zoom",
          "params": {
            "startScale": 100,
            "endScale": 200
          }
        }
      ];
    } else {
      return;
    }
  }
}


export function getRandomAnimation(animations) {
  const randomIndex = Math.floor(Math.random() * animations.length);
  return animations[randomIndex];
}

export function getAlternateAnimation(animations, index) {
  return animations[index % animations.length];
}


export function getBannerDisplayActiveItemsForSession(bannerText, canvasDimensions) {
  const presets = [
    {
      rectangleFillColor: "#1A1A1A", // Dark Gray
      rectangleStrokeColor: "#333333",
      rectangleStrokeWidth: 2,
      textFillColor: "#FFFFFF", // White Text
      textStrokeColor: "#FFFFFF",
      textStrokeWidth: 0,
      fontFamily: "Montserrat",
      fontSize: 48,
    },
    {
      rectangleFillColor: "#0D0D0D", // Very Dark Gray
      rectangleStrokeColor: "#262626",
      rectangleStrokeWidth: 2,
      textFillColor: "#FF4081", // Vibrant Pink
      textStrokeColor: "#FF4081",
      textStrokeWidth: 0,
      fontFamily: "Oswald",
      fontSize: 50,
    },
    // Additional presets can be added here...
  ];

  // Randomly select a preset
  const randomIndex = Math.floor(Math.random() * presets.length);
  const preset = presets[randomIndex];

  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;

  const maxTextWidth = 800; // Maximum width for the text before wrapping

  const paddingX = 40;
  const paddingY = 100; // Increased padding for top and bottom

  // Estimate maximum characters per line based on font size
  const maxCharsPerLine = Math.floor(maxTextWidth / (preset.fontSize * 0.6));

  const numberOfLines = Math.ceil(bannerText.length / maxCharsPerLine);

  const lineHeight = preset.fontSize * 1.2;

  const textHeight = lineHeight * numberOfLines;

  // Adding extra padding on top and bottom
  const rectWidth = maxTextWidth + paddingX * 2;
  const rectHeight = textHeight + paddingY; // Increased padding for top and bottom

  const rectX = (canvasWidth - rectWidth) / 2;
  const rectY = (canvasHeight - rectHeight) / 2;

  const textX = canvasWidth / 2; // Centered text

  return [
    {
      type: "shape",
      shape: "rectangle",
      id: 'item_1',
      config: {
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        fillColor: preset.rectangleFillColor,
        strokeColor: preset.rectangleStrokeColor,
        strokeWidth: preset.rectangleStrokeWidth,
        frameDuration: 1,
        frameOffset: 0,
        borderRadius: 10, // Rounded corners for a modern look
      },
    },
    {
      type: "text",
      text: bannerText,
      id: 'item_2',
      config: {
        x: textX,
        y: rectY + paddingY, // Adjusted to start inside the rectangle's padding
        width: maxTextWidth,
        fontSize: preset.fontSize,
        fontFamily: preset.fontFamily,
        fillColor: preset.textFillColor,
        strokeColor: preset.textStrokeColor,
        strokeWidth: preset.textStrokeWidth,
        textAlign: "center",
        fontEmphasis: 'bold',
        textShadow: true,
        autoWrap: true,
        frameDuration: 1,
        frameOffset: 0,
      },
    }
  ];
}

