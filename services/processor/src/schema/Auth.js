
import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const authSchema = new Schema({
  codeVerifier: String,
  state: String,

}, { timestamps: true });

// 3. Create a Model.
const Auth = model('Auth', authSchema);

export default Auth;
