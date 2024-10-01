const express = require('express');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { Queue, Worker, QueueScheduler, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const { users, activities } = require('./data');

// Environment variables
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const PORT = process.env.PORT || 3000;

// Initialize Redis connection
const connection = new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

// Initialize Queues
const emailQueue = new Queue('send_email', { connection });
const activationQueue = new Queue('activate_user', { connection });
const activityQueue = new Queue('log_activity', { connection });

// Initialize Queue Schedulers
new QueueScheduler('send_email', { connection });
new QueueScheduler('activate_user', { connection });
new QueueScheduler('log_activity', { connection });

const activityQueueEvents = new QueueEvents('log_activity', { connection });

// Initialize Workers (Consumers)

// 1. Email Worker
const emailWorker = new Worker('send_email', async (job) => {
  const { userId, email } = job.data;
  console.log(`Sending welcome email to ${email} (User ID: ${userId})`);
  // Simulate email sending delay
  await new Promise((res) => setTimeout(res, 1000));
  console.log(`Email sent to ${email}`);
}, { connection });

// 2. Activation Worker
const activationWorker = new Worker('activate_user', async (job) => {
  const { userId } = job.data;
  const user = users.find((u) => u.id === userId);
  if (user) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    user.active = true;
    console.log(`User ${user.email} activated.`);
  } else {
    throw new Error(`User with ID ${userId} not found.`);
  }
}, { connection });

// 3. Activity Log Worker
const activityWorker = new Worker('log_activity', async (job) => {
  const { userId, activityType } = job.data;
  activities.push({
    userId,
    activity: activityType,
    timestamp: new Date(),
  });
  console.log(`Activity logged for User ID ${userId}: ${activityType}`);
}, { connection });

// Handle Worker Errors
emailWorker.on('failed', (job, err) => {
  console.error(`Email Worker failed for job ${job.id}: ${err.message}`);
});

activationWorker.on('failed', (job, err) => {
  console.error(`Activation Worker failed for job ${job.id}: ${err.message}`);
});

activityWorker.on('failed', (job, err) => {
  console.error(`Activity Worker failed for job ${job.id}: ${err.message}`);
});

// Initialize Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(activationQueue),
    new BullMQAdapter(activityQueue),
  ],
  serverAdapter: serverAdapter,
});

// Initialize Express app
const app = express();
app.use(express.json());

// Setup Bull Board routes
app.use('/admin/queues', serverAdapter.getRouter());

// API Endpoints

/**
 * Register a new user
 * POST /register
 * Body: { "email": "user@example.com" }
 */
app.post('/register', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  // Check if user already exists
  const existingUser = users.find((u) => u.email === email);
  if (existingUser) {
    return res.status(400).json({ error: 'User already exists.' });
  }

  const userId = uuidv4();
  const newUser = {
    id: userId,
    email,
    active: false,
  };
  users.push(newUser);
  console.log(`User registered: ${email} (ID: ${userId})`);

  try {
    // Add jobs to respective queues
    await emailQueue.add('send_welcome_email', { userId, email });
    await activationQueue.add('activate_user', { userId }, { delay: 1000 });
    await activityQueue.add('log_activity', { userId, activityType: 'User Registered' });

    res.status(201).json({ message: 'User registered successfully.', user: newUser });
  } catch (error) {
    console.error('Error adding jobs:', error);
    res.status(500).json({ error: 'Failed to process registration.' });
  }
});

/**
 * Login a user
 * POST /login
 * Body: { "email": "user@example.com" }
 */
app.post('/login', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(400).json({ error: 'User not found.' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'User is not activated.' });
  }

  try {
    // Log login activity
    const logJob = await activityQueue.add('log_activity', { userId: user.id, activityType: 'User Logged In' });

    await logJob.waitUntilFinished(activityQueueEvents, 1000);

    // Retrieve user activities
    const userActivities = activities
      .filter((act) => act.userId === user.id)
      .map((act) => ({
        activity: act.activity,
        timestamp: act.timestamp,
      }));

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        active: user.active,
      },
      activities: userActivities,
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Failed to process login.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Bull Board is available at http://localhost:${PORT}/admin/queues`);
});
``