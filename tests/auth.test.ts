import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Express } from 'express';

// Mock the database connection so app.ts does not open its own connection;
// the in-memory server is connected explicitly below.
jest.mock('../src/config/database', () => ({
  connectDatabase: jest.fn(),
}));

// Mock the logger to keep test output clean
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

let app: Express;
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const mod = await import('../src/app');
  app = mod.default;
});

afterEach(async () => {
  await mongoose.connection.collection('users').deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

const validUser = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'sup3rSecret!',
};

describe('POST /api/v1/auth/register', () => {
  it('registers a new user and returns sanitized data', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(validUser);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'success');
    expect(res.body.data.user).toMatchObject({
      name: validUser.name,
      email: validUser.email,
      role: 'user',
    });
    expect(res.body.data.user).toHaveProperty('id');
    // The password hash must never be returned
    expect(res.body.data.user).not.toHaveProperty('password');
  });

  it('persists the user with a bcrypt-hashed password', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser);

    const stored = await mongoose.connection
      .collection('users')
      .findOne({ email: validUser.email });

    expect(stored).not.toBeNull();
    expect(stored?.password).toBeDefined();
    expect(stored?.password).not.toBe(validUser.password);
    expect(stored?.password).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/v1/auth/register').send(validUser);
    const res = await request(app).post('/api/v1/auth/register').send(validUser);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('status', 'error');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validUser, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('rejects a weak password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validUser, password: 'short' });

    expect(res.status).toBe(400);
  });

  it('rejects a missing name with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(400);
  });
});
