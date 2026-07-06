
export function byteIndexOf(mainString, subString) {
  // Convert strings to UTF-8 byte arrays
  const mainBytes = new TextEncoder().encode(mainString);
  const subBytes = new TextEncoder().encode(subString);

  // Search for a matching subarray
  for (let i = 0; i <= mainBytes.length - subBytes.length; i++) {
      let match = true;
      for (let j = 0; j < subBytes.length; j++) {
          if (mainBytes[i + j] !== subBytes[j]) {
              match = false;
              break;
          }
      }
      if (match) {
          return i;  // Return the byte position
      }
  }
  return -1;  // Return -1 if no match found
}

export function lastCharacterByteIndex(string) {
  // Convert the string to a UTF-8 byte array
  const bytes = new TextEncoder().encode(string);
  
  // Handle empty string case
  if (bytes.length === 0) {
      return -1; // or appropriate error handling
  }

  // Get the last character as a string
  const lastChar = string[string.length - 1];

  // Encode just the last character to find its length in bytes
  const lastCharBytes = new TextEncoder().encode(lastChar);

  // Calculate the starting byte index of the last character
  return bytes.length - lastCharBytes.length;
}




export function getFirstTwentyWords(text) {
    // Split the text into words based on spaces
    const words = text.split(/\s+/);

    // Check if the total number of words is 20 or less
    if (words.length <= 20) {
        return text.trim(); // Return the original text, trimmed of any extra whitespace
    }

    // Use slice to get the first 20 words
    const firstTwentyWords = words.slice(0, 20);

    // Join the sliced words array back into a string
    return firstTwentyWords.join(' ');
}


export function truncateTo320Bytes(input) {
    const encoder = new TextEncoder();
    let encodedString = encoder.encode(input);
    
    if (encodedString.length <= 320) {
        return input; // Return original input if it's within the byte limit
    }
    
    // Truncate the Uint8Array to 320 bytes
    encodedString = encodedString.subarray(0, 320);
    
    // Decode the Uint8Array back to string, cutting off at the last complete character
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
        // Attempt to decode what might be an incomplete character at the end
        return decoder.decode(encodedString);
    } catch (error) {
        // If decoding fails, remove the last character and try again
        return decoder.decode(encodedString.subarray(0, encodedString.lastIndexOf(0xC0 !== (encodedString[encodedString.length - 1] & 0xC0))));
    }
}