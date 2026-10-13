import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { MemoryIdentityStore } from '../../test/identity-memory-store';
import { IdentityEngine } from '../identity/core/engine';
import { loadIdentityConfig } from '../identity/core/config';
import { AccessClaims, AccessTokens } from '../identity/core/model';
import { parseRoster, provision } from '../identity/core/provision';
import { IdentityErrorFilter, IdentityGuard } from '../identity/identity.http';
import { CHAT_CONFIG, loadChatConfig } from './chat.config';
import { ChatModule } from './chat.module';
import { TextModelProvider } from './text-model.provider';
import { ChatError, CHAT_ERROR_STATUS } from './chat.error';

describe('authenticated chat endpoint (isolated in-memory identity store, real JWT, fake text provider)', () => {
  let app: INestApplication;
  let engine: IdentityEngine;
  let store: MemoryIdentityStore;
  let accessToken: string;
  let cookie: string;
  let csrf: string;
  const origin = 'https://app.example.test';
  const fake = { reply: jest.fn() };
  let logs: jest.SpyInstance;

  beforeAll(async () => {
    const cfg = loadIdentityConfig({
      NODE_ENV: 'test',
      AUTH_JWT_SECRET: randomBytes(32).toString('base64url'),
      AUTH_TOKEN_PEPPER: randomBytes(32).toString('base64url'),
      AUTH_WEB_ORIGINS: origin,
      AUTH_ALLOW_INSECURE_DEV: 'true',
      AUTH_OTP_MODE: 'development_test',
      AUTH_DEV_OTP: '817294',
      AUTH_SMOKE_SERVICE_KEY: randomBytes(32).toString('base64url'),
    });
    const jwt = new JwtService();
    const tokens: AccessTokens = {
      sign: (sub, sid, now, ttl) =>
        jwt.signAsync(
          {
            sub,
            sid,
            typ: 'native_access',
            iat: Math.floor(now / 1000),
            exp: Math.floor(now / 1000) + ttl,
          },
          {
            secret: cfg.jwtSecret,
            algorithm: 'HS256',
            issuer: cfg.issuer,
            audience: cfg.audience,
          },
        ),
      verify: (raw, now) =>
        jwt.verifyAsync<AccessClaims>(raw, {
          secret: cfg.jwtSecret,
          algorithms: ['HS256'],
          issuer: cfg.issuer,
          audience: cfg.audience,
          clockTimestamp: Math.floor(now / 1000),
          maxAge: cfg.accessSeconds,
        }),
    };
    store = new MemoryIdentityStore();
    engine = new IdentityEngine(store, cfg, tokens, {
      send: async () => {
        throw new Error('NO_SMS_IN_CHAT_TEST');
      },
    });
    await provision(
      store,
      parseRoster({
        tenant: {
          slug: 'enterprise-pilot',
          name: 'Synthetic chat tenant',
          status: 'active',
          enterprise: true,
        },
        members: [
          {
            phone: '+15550001001',
            firstName: 'Synthetic',
            lastName: 'Native',
            roles: ['operator'],
            status: 'active',
          },
          {
            phone: '+15550001002',
            firstName: 'Synthetic',
            lastName: 'Web',
            roles: ['operator'],
            status: 'active',
          },
        ],
      }),
      true,
      'chat-tests',
    );
    for (const client of ['native', 'web'] as const) {
      const phone = client === 'native' ? '+15550001001' : '+15550001002';
      const c = await engine.requestOtp(
        {
          phone,
          tenant: 'enterprise-pilot',
          client,
          deviceName: 'Synthetic test',
        },
        '192.0.2.10',
      );
      const signed = await engine.verifyOtp(
        {
          challengeId: c.challengeId,
          code: cfg.devOtp,
          firstName: 'Synthetic',
          lastName: 'Test',
          client,
        },
        '192.0.2.10',
      );
      if ('accessToken' in signed) accessToken = signed.accessToken;
      if ('cookieToken' in signed) {
        cookie = `${cfg.cookieName}=${signed.cookieToken}`;
        csrf = signed.csrfToken!;
      }
    }
    const module = await Test.createTestingModule({
      imports: [ChatModule],
      providers: [
        { provide: IdentityEngine, useValue: engine },
        { provide: 'DARA_IDENTITY_CONFIG', useValue: cfg },
        { provide: APP_GUARD, useClass: IdentityGuard },
        { provide: APP_FILTER, useClass: IdentityErrorFilter },
      ],
    })
      .overrideProvider(CHAT_CONFIG)
      .useValue(loadChatConfig({}))
      .overrideProvider(TextModelProvider)
      .useValue(fake)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        validationError: { target: false, value: false },
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    fake.reply.mockReset().mockResolvedValue({
      replyText: 'SYNTHETIC_REPLY',
      usage: { outputTokens: 3 },
    });
    logs = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => logs.mockRestore());
  afterAll(async () => {
    await app?.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/chat/reply')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body as object);

  it('rejects unauthenticated requests before touching the provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat/reply')
      .send({ message: 'Synthetic', history: [] })
      .expect(401);
    expect(res.body).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    expect(fake.reply).not.toHaveBeenCalled();
  });

  it('accepts the existing native principal and sends only text to the provider', async () => {
    const input = {
      message: 'Synthetic question',
      history: [
        { role: 'user', text: 'Earlier text' },
        { role: 'assistant', text: 'Earlier answer' },
      ],
    };
    const res = await post(input).expect(200);
    expect(fake.reply).toHaveBeenCalledTimes(1);
    expect(fake.reply).toHaveBeenCalledWith(input);
    expect(res.body).toEqual({
      version: '1.0',
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      replyText: 'SYNTHETIC_REPLY',
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      latencyMs: expect.any(Number),
      usage: { outputTokens: 3 },
    });
    expect(logs).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(logs.mock.calls[0][0]);
    expect(Object.keys(metadata).sort()).toEqual([
      'latencyMs',
      'model',
      'provider',
      'requestId',
    ]);
    expect(metadata.requestId).toBe(res.body.requestId);
  });

  it('retains Web origin/CSRF protection on the new route', async () => {
    await request(app.getHttpServer())
      .post('/chat/reply')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ message: 'Synthetic', history: [] })
      .expect(403);
    expect(fake.reply).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/chat/reply')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-DARA-CSRF', csrf)
      .send({ message: 'Synthetic', history: [] })
      .expect(200);
    expect(fake.reply).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { message: '', history: [] },
    { message: '  ', history: [] },
    { message: 1, history: [] },
    { message: 'x'.repeat(4001), history: [] },
    { message: 'x', history: {} },
    { message: 'x' },
    {
      message: 'x',
      history: Array.from({ length: 13 }, () => ({ role: 'user', text: 'x' })),
    },
    { message: 'x', history: [{ role: 'system', text: 'forbidden' }] },
    { message: 'x', history: [{ role: 'model', text: 'forbidden' }] },
    { message: 'x', history: [{ role: 'assistant', text: '' }] },
    { message: 'x', history: [{ role: 'user', text: 'x'.repeat(4001) }] },
    {
      message: 'x',
      history: Array.from({ length: 5 }, () => ({
        role: 'user',
        text: 'x'.repeat(4000),
      })),
    },
    { message: 'x', history: [], userId: 'forged' },
    { message: 'x', history: [], tenantId: 'forged' },
    { message: 'x', history: [], phone: '+15550001001' },
    { message: 'x', history: [{ role: 'user', text: 'x', system: 'forged' }] },
  ])('rejects invalid body %# before calling the provider', async (body) => {
    const res = await post(body).expect(400);
    expect(res.body).toEqual({ error: 'INVALID_CHAT_REQUEST' });
    expect(fake.reply).not.toHaveBeenCalled();
  });

  it('accepts the exact message and total-history boundary', async () => {
    await post({
      message: 'x'.repeat(4000),
      history: Array.from({ length: 4 }, () => ({
        role: 'user',
        text: 'x'.repeat(4000),
      })),
    }).expect(200);
    await post({
      message: 'x',
      history: Array.from({ length: 12 }, () => ({
        role: 'assistant',
        text: 'x',
      })),
    }).expect(200);
  });

  it.each(Object.entries(CHAT_ERROR_STATUS))(
    'returns only the allowlisted provider/service error %s',
    async (code, status) => {
      fake.reply.mockRejectedValueOnce(
        new ChatError(code as keyof typeof CHAT_ERROR_STATUS),
      );
      const res = await post({ message: 'Synthetic', history: [] }).expect(
        status,
      );
      expect(res.body).toEqual({ error: code });
      expect(Object.keys(JSON.parse(logs.mock.calls[0][0])).sort()).toEqual([
        'latencyMs',
        'model',
        'provider',
        'requestId',
      ]);
    },
  );

  it('rejects an inactive membership for chat using the existing engine', async () => {
    const principal = await engine.authenticateNative(accessToken);
    await store.transaction(async (tx) => {
      await tx.put('memberships', {
        ...principal.membership,
        status: 'suspended',
      });
    });
    const res = await post({ message: 'Synthetic', history: [] }).expect(401);
    expect(res.body).toEqual({ error: 'MEMBERSHIP_INACTIVE' });
    expect(fake.reply).not.toHaveBeenCalled();
  });
});
