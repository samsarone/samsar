
export function getNFTMetaData(nftPayload) {
  const metadata = {
    name: nftPayload.name,
    description: nftPayload.description ? nftPayload.description : '',
    image: nftPayload.image,
    attributes: nftPayload.attributes ? nftPayload.attributes : [],
  };
  return metadata;
}