import { getDBConnectionString } from "./DBString.js";
import VideoGeneration from "./schema/VideoGeneration.js";
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
ffmpeg.setFfmpegPath(ffmpegPath);
