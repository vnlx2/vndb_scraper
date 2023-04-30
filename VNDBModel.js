import mongoose from "mongoose";
import mongoose_fuzzy_searching from 'mongoose-fuzzy-searching';

const VisualNovelSchema = mongoose.Schema({
    code: {
        type: String,
        required: true,
        index: true,
        unique: true,
    },
    title: {
        type: String,
        required: true
    },
    aliases: [{
        type: String
    }],
    length: {
        type: Number
    },
    rating: {
        type: Number,
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String
    }
}, {
    timestamps: true
});

VisualNovelSchema.index({title: "text", aliases: "text"});
VisualNovelSchema.plugin(mongoose_fuzzy_searching, { fields: [
    {
        name: 'title',
        minSize: 3,
        weight: 1
    },
    {
        name: 'aliases',
        minSize: 3,
        weight: 3,
        prefixOnly: true
    }
] });

const VisualNovel = mongoose.model('visual_novels', VisualNovelSchema);
export default VisualNovel;