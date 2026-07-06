import { getDBConnectionString } from './DBString.js';
import Interaction from '../schema/Interaction.js';


export async function getInteractionsForPost(publicationId) {
  await getDBConnectionString();
  const interactions = await Interaction.find({ publicationId: publicationId });
  return interactions;
}

export async function getInteractionsForUser(createdBy, publicationId) {
  await getDBConnectionString();
  const interactions = await Interaction.find({ publicationId: publicationId, createdBy: createdBy });
  return interactions;
}

export async function createInteraction(payload) {
  await getDBConnectionString();
  const interactingUser = payload.createdBy;
  const publicationId = payload.publicationId;
  const interactionsByUser = await Interaction.find({ publicationId: publicationId, createdBy: interactingUser });

  if (payload.interactionType === 'like') {
    const likeInteractions = interactionsByUser.filter((interaction) => interaction.interactionType === 'like');
    if (likeInteractions.length > 0) {
      const interactionId = likeInteractions[0]._id;
      await Interaction.deleteOne({_id: interactionId});
    } else {
      const interaction = new Interaction(payload);
      await interaction.save({});
      return interaction;
    }
  } else if (payload.interactionType === 'comment') {
    const commentInteractions = interactionsByUser.filter((interaction) => interaction.interactionType === 'comment');
    if (commentInteractions.length > 0) {
      const interactionId = commentInteractions[0]._id;
      await Interaction.updateOne({_id: interactionId}, { text: payload.text });
    } else {
      const interaction = new Interaction(payload);
      await interaction.save({});
      return interaction;
    }
  }
}

