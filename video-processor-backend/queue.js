const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { processFile } = require('./processor');

// Redis connection setup
const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// Create the Queue
const processingQueue = new Queue('VideoProcessingQueue', { connection });

// Create the Worker
const worker = new Worker('VideoProcessingQueue', async (job) => {
  const task = job.data;
  
  // Provide a way for processor to update progress
  task.updateProgress = async (progress) => {
    await job.updateProgress(progress);
  };

  try {
    const outputPath = await processFile(task);
    return {
      outputPath,
      originalName: task.originalName || 'processed_file'
    };
  } catch (error) {
    console.error(`[Worker] Job ${job.id} failed:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 1 // Serialize encodes: each job uses -threads 0 (all CPU cores).
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed with reason: ${err.message}`);
});

module.exports = {
  processingQueue,
};
