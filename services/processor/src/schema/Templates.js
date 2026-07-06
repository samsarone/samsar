import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const templateSchema = new Schema({
  fileName: String,
  keywords: Array,
});

// 3. Create a Model.
const Template = model('Template', templateSchema);

export default Template;
