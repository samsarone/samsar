import { Schema,model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const sessionSchema = new Schema({
    userId: String,
    generations: Array,
    activeSelectedImage: String,
    activeGeneratedImage: String,
    activeOutpaintedImage: String,
    generationStatus: String,
    generationError: String,
    outpaintError: String,
    outpaintStatus: String,
    witnesses: Array,
    intermediates: Array,
    lastWitnessSavedAt: Date,
    activeItemList: Array,
}, { timestamps: true });

// 3. Create a Model.
const Session = model('Session', sessionSchema);

export default Session;
