import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const interactionSchema = new Schema({
  publicationId: String,
  interactionType: String, // like or comment
  createdBy: String, // address of user
  text: String,
}, { timestamps: true });

// 3. Create a Model.
const Interaction = model('Interaction', interactionSchema);
export default Interaction;


