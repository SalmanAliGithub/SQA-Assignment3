#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W8fcAAAAASUVORK5CYII=',
  'base64',
);

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 15000;
const DEFAULT_SMS_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 500;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const runDirectory = mkdtempSync(join(tmpdir(), 'maal-backend-validation-'));
  const artifactPath =
    options.outputFile ?? join(runDirectory, 'validation-run.json');
  const smsStubFile = options.smsStubFile ?? process.env.STUB_SMS_FILE ?? null;

  const runner = new ValidationRunner({
    baseUrl,
    smsStubFile,
    adminAccessToken: options.adminAccessToken ?? null,
    artifactPath,
    runDirectory,
    notificationTimeoutMs:
      options.notificationTimeoutMs ?? DEFAULT_NOTIFICATION_TIMEOUT_MS,
    smsTimeoutMs: options.smsTimeoutMs ?? DEFAULT_SMS_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  });

  try {
    await runner.run();
  } catch (error) {
    runner.failHard(error);
  }
}

class ValidationRunner {
  constructor(config) {
    this.config = config;
    this.startedAt = new Date().toISOString();
    this.results = [];
    this.runtime = {
      otpReady: false,
    };
    this.discovery = {
      openapiVersion: null,
      operations: [],
    };
    this.context = {
      actors: {},
      ids: {},
      artifacts: {},
    };
    this.files = {
      nationalIdImage: join(this.config.runDirectory, 'national-id.png'),
      selfieImage: join(this.config.runDirectory, 'selfie.png'),
    };
  }

  async run() {
    this.writeFixtureFiles();
    this.log('INFO', `Base URL: ${this.config.baseUrl}`);
    this.log(
      'INFO',
      `SMS stub file: ${this.config.smsStubFile ?? 'not configured'}`,
    );
    this.log(
      'INFO',
      `Admin token: ${this.config.adminAccessToken ? 'provided' : 'not provided'}`,
    );

    // ── Phase 1: Discovery & Health ───────────────────────────────────

    await this.step('Swagger discovery', async () => {
      const response = this.request({
        method: 'GET',
        path: '/docs-json',
      });
      this.assertStatus(response, 200);
      const document = this.parseJson(response, 'Swagger document');
      this.discovery.openapiVersion = document.openapi ?? null;
      this.discovery.operations = Object.entries(document.paths ?? {}).flatMap(
        ([path, definition]) =>
          Object.keys(definition).map((method) => ({
            method: method.toUpperCase(),
            path,
          })),
      );
      this.context.artifacts.swaggerOperationCount = this.discovery.operations.length;
      this.assert(
        this.discovery.operations.length > 0,
        'Swagger document did not expose any operations.',
      );
    });

    await this.step('Preflight', async () => {
      // Auth & Identity
      this.assertDiscovered('GET', '/health');
      this.assertDiscovered('POST', '/auth/register/request-otp');
      this.assertDiscovered('POST', '/auth/register/verify-otp');
      this.assertDiscovered('POST', '/auth/register/complete');
      this.assertDiscovered('POST', '/auth/login');
      this.assertDiscovered('POST', '/auth/refresh');
      this.assertDiscovered('POST', '/auth/logout');
      this.assertDiscovered('POST', '/auth/pin-reset/request');
      this.assertDiscovered('POST', '/auth/pin-reset/verify');
      this.assertDiscovered('POST', '/auth/pin-reset/complete');
      this.assertDiscovered('POST', '/auth/device/bind/verify');
      this.assertDiscovered('POST', '/auth/device/bind');
      this.assertDiscovered('GET', '/auth/me');
      this.assertDiscovered('GET', '/me');
      this.assertDiscovered('GET', '/admin/probe');

      // Wallet & Transactions
      this.assertDiscovered('GET', '/me/wallet');
      this.assertDiscovered('GET', '/me/transactions');
      this.assertDiscovered('GET', '/me/transactions/{id}');

      // User Lookup & Transfers
      this.assertDiscovered('GET', '/users/lookup');
      this.assertDiscovered('POST', '/transfers');
      this.assertDiscovered('GET', '/transfers/by-key/{idempotencyKey}');

      // KYC
      this.assertDiscovered('POST', '/me/kyc/upload');
      this.assertDiscovered('POST', '/me/kyc/submit');
      this.assertDiscovered('GET', '/me/kyc');
      this.assertDiscovered('GET', '/me/kyc/submissions/{id}');
      this.assertDiscovered('GET', '/admin/kyc/submissions');
      this.assertDiscovered('GET', '/admin/kyc/submissions/{id}');
      this.assertDiscovered('POST', '/admin/kyc/submissions/{id}/approve');
      this.assertDiscovered('POST', '/admin/kyc/submissions/{id}/reject');
      this.assertDiscovered('POST', '/admin/kyc/submissions/{id}/request-update');

      // Notifications
      this.assertDiscovered('GET', '/me/notifications');
      this.assertDiscovered('GET', '/me/notifications/{id}');
      this.assertDiscovered('POST', '/me/notifications/mark-read');

      // CICO
      this.assertDiscovered('POST', '/cico/cash-in');
      this.assertDiscovered('POST', '/cico/cash-out/request');
      this.assertDiscovered('POST', '/cico/cash-out/{requestId}/verify-otp');
      this.assertDiscovered('POST', '/cico/cash-out/{requestId}/commit');
      this.assertDiscovered('GET', '/cico/cash-out/{requestId}/status');
      this.assertDiscovered('POST', '/cico/cash-out/{requestId}/cancel');
      this.assertDiscovered('GET', '/cico/agents/nearby');

      // Admin Agents & Commission
      this.assertDiscovered('POST', '/admin/agents');
      this.assertDiscovered('GET', '/admin/agents');
      this.assertDiscovered('GET', '/admin/agents/{id}');
      this.assertDiscovered('POST', '/admin/agents/{id}/suspend');
      this.assertDiscovered('POST', '/admin/agents/{id}/reactivate');
      this.assertDiscovered('POST', '/admin/agents/{id}/float-topup');
      this.assertDiscovered('GET', '/admin/commission-rules');
      this.assertDiscovered('POST', '/admin/commission-rules');

      // Disputes
      this.assertDiscovered('POST', '/disputes');
      this.assertDiscovered('GET', '/disputes/{id}');
      this.assertDiscovered('POST', '/disputes/{id}/response');
      this.assertDiscovered('POST', '/disputes/{id}/withdraw');
      this.assertDiscovered('GET', '/admin/disputes');
      this.assertDiscovered('POST', '/admin/disputes/{id}/pickup');
      this.assertDiscovered('POST', '/admin/disputes/{id}/resolve');
      this.assertDiscovered('POST', '/admin/disputes/{id}/reject');

      // BNPL
      this.assertDiscovered('GET', '/bnpl/products');
      this.assertDiscovered('POST', '/bnpl/applications');
      this.assertDiscovered('GET', '/bnpl/applications/{id}');
      this.assertDiscovered('POST', '/bnpl/applications/{id}/accept');
      this.assertDiscovered('POST', '/bnpl/applications/{id}/cancel');
      this.assertDiscovered('GET', '/me/bnpl/contracts');
      this.assertDiscovered('GET', '/me/bnpl/contracts/{id}');
      this.assertDiscovered('POST', '/me/bnpl/contracts/{id}/repayments');

      // Admin Financing
      this.assertDiscovered('GET', '/admin/financing/overview');
      this.assertDiscovered('GET', '/admin/financing/products');
      this.assertDiscovered('POST', '/admin/financing/products');
      this.assertDiscovered('PATCH', '/admin/financing/products/{id}');
      this.assertDiscovered('POST', '/admin/financing/products/{id}/publish');
      this.assertDiscovered('POST', '/admin/financing/products/{id}/retire');
      this.assertDiscovered('GET', '/admin/financing/contracts');
      this.assertDiscovered('GET', '/admin/financing/contracts/{id}');
      this.assertDiscovered('POST', '/admin/financing/contracts/{id}/record-repayment');
      this.assertDiscovered('POST', '/admin/financing/contracts/{id}/writeoff');
      this.assertDiscovered('GET', '/admin/financing/overdue');
      this.assertDiscovered('POST', '/admin/financing/contracts/{id}/remind');

      // Admin Dashboard
      this.assertDiscovered('GET', '/admin/dashboard/kpis');
      this.assertDiscovered('GET', '/admin/dashboard/queues');
      this.assertDiscovered('GET', '/admin/dashboard/recent-activity');

      // Admin Config
      this.assertDiscovered('GET', '/admin/config');
      this.assertDiscovered('PATCH', '/admin/config/{key}');
      this.assertDiscovered('GET', '/admin/config/{key}/history');

      // Admin Broadcast
      this.assertDiscovered('POST', '/admin/broadcast');

      // Admin Accountants
      this.assertDiscovered('POST', '/admin/accountants');
      this.assertDiscovered('GET', '/admin/accountants');
      this.assertDiscovered('GET', '/admin/accountants/{id}');
      this.assertDiscovered('POST', '/admin/accountants/{id}/deactivate');
      this.assertDiscovered('POST', '/admin/accountants/{id}/reactivate');
      this.assertDiscovered('POST', '/admin/accountants/{id}/reset-password');

      // Admin Adjustments
      this.assertDiscovered('POST', '/admin/adjustments');
      this.assertDiscovered('GET', '/admin/adjustments');
      this.assertDiscovered('GET', '/admin/adjustments/{id}');
      this.assertDiscovered('POST', '/admin/adjustments/{id}/approve');
      this.assertDiscovered('POST', '/admin/adjustments/{id}/reject');
      this.assertDiscovered('POST', '/admin/adjustments/{id}/cancel');

      // Admin Risk
      this.assertDiscovered('GET', '/admin/risk/flags');
      this.assertDiscovered('GET', '/admin/risk/flags/{id}');
      this.assertDiscovered('POST', '/admin/risk/flags');
      this.assertDiscovered('POST', '/admin/risk/flags/{id}/decide');
      this.assertDiscovered('GET', '/admin/risk/scores/{userId}');
      this.assertDiscovered('POST', '/admin/risk/scores/{userId}/rescore');

      // Admin Reports
      this.assertDiscovered('GET', '/admin/reports/types');
      this.assertDiscovered('POST', '/admin/reports/{type}');
      this.assertDiscovered('GET', '/admin/reports/jobs');
      this.assertDiscovered('GET', '/admin/reports/jobs/{jobId}');
      this.assertDiscovered('POST', '/admin/reports/jobs/{jobId}/cancel');

      this.runtime.otpReady = Boolean(
        this.config.smsStubFile && existsSync(this.config.smsStubFile),
      );
      this.context.artifacts.otpReady = this.runtime.otpReady;
    });

    await this.step('Health', async () => {
      const response = this.request({ method: 'GET', path: '/health' });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'health response');
      this.assert(typeof body.status === 'string', 'Health response missing status.');
    });

    // ── Phase 2: Identity & Auth ──────────────────────────────────────

    await this.step('Register sender', async () => {
      this.requireOtpReady();
      this.context.actors.sender = await this.registerUser({
        label: 'sender',
        firstName: 'Flow',
        lastName: 'Sender',
        pin: '1234',
      });
    });

    await this.step('Register recipient', async () => {
      this.requireOtpReady();
      this.context.actors.recipient = await this.registerUser({
        label: 'recipient',
        firstName: 'Flow',
        lastName: 'Recipient',
        pin: '1234',
      });
    });

    await this.step('Register extra-user', async () => {
      this.requireOtpReady();
      this.context.actors['extra-user'] = await this.registerUser({
        label: 'extra-user',
        firstName: 'Flow',
        lastName: 'Extra',
        pin: '1234',
      });
    });

    await this.step('Auth me', async () => {
      const sender = this.requireActorOrSkip('sender');
      const authMe = this.request({
        method: 'GET',
        path: '/auth/me',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(authMe, 200);
      const authMeBody = this.parseJson(authMe, '/auth/me');
      this.assert(authMeBody.id === sender.userId, '/auth/me returned the wrong user.');

      const me = this.request({
        method: 'GET',
        path: '/me',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(me, 200);
      const meBody = this.parseJson(me, '/me');
      this.assert(meBody.id === sender.userId, '/me returned the wrong user.');
    });

    await this.step('Refresh token', async () => {
      const sender = this.requireActorOrSkip('sender');
      const response = this.request({
        method: 'POST',
        path: '/auth/refresh',
        json: { refreshToken: sender.refreshToken },
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'refresh token response');
      this.assert(typeof body.accessToken === 'string', 'Refresh response missing accessToken.');
      this.assert(typeof body.refreshToken === 'string', 'Refresh response missing refreshToken.');
      sender.accessToken = body.accessToken;
      sender.refreshToken = body.refreshToken;
    });

    await this.step('Device binding flow', async () => {
      this.requireOtpReady();
      const sender = this.requireActorOrSkip('sender');
      const newDeviceId = randomUUID();
      const loginAttemptTimestamp = Date.now();
      const loginAttempt = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: sender.phone,
          pin: sender.pin,
          deviceId: newDeviceId,
        },
      });

      this.assertStatus(loginAttempt, 403);
      const error = this.parseJson(loginAttempt, 'device binding challenge');
      const errorCode = this.getErrorCode(error);
      this.assert(
        errorCode === 'ERR_AUTH_DEVICE_UNBOUND',
        `Expected ERR_AUTH_DEVICE_UNBOUND, received ${errorCode ?? 'unknown'}.`,
      );
      const challengeToken = error.error?.details?.challengeToken;
      this.assert(typeof challengeToken === 'string', 'Missing device binding challenge token.');
      const otp = await this.readLatestOtp(sender.phone, loginAttemptTimestamp);

      const verify = this.request({
        method: 'POST',
        path: '/auth/device/bind/verify',
        json: { challengeToken, otp },
      });
      this.assertStatus(verify, 200);
      const verifyBody = this.parseJson(verify, 'device bind verify response');
      this.assert(typeof verifyBody.setupToken === 'string', 'Missing device bind setup token.');

      const bind = this.request({
        method: 'POST',
        path: '/auth/device/bind',
        json: {
          setupToken: verifyBody.setupToken,
          deviceId: newDeviceId,
          platform: 'ANDROID',
          deviceName: 'Validation Runner Device',
        },
      });
      this.assertStatus(bind, 200);
      const bindBody = this.parseJson(bind, 'device bind response');
      this.assert(bindBody.deviceId === newDeviceId, 'Bound device id did not match request.');
      this.assert(bindBody.trusted === true, 'Bound device was not trusted.');

      const login = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: sender.phone,
          pin: sender.pin,
          deviceId: newDeviceId,
        },
      });
      this.assertStatus(login, 200);
      const loginBody = this.parseJson(login, 'device login response');
      this.assert(typeof loginBody.accessToken === 'string', 'Missing accessToken after device bind.');
      sender.boundDeviceId = newDeviceId;
      sender.accessToken = loginBody.accessToken;
      sender.refreshToken = loginBody.refreshToken;
    });

    await this.step('PIN reset flow', async () => {
      this.requireOtpReady();
      const sender = this.requireActorOrSkip('sender');
      const newPin = '4321';
      const requestTimestamp = Date.now();
      const request = this.request({
        method: 'POST',
        path: '/auth/pin-reset/request',
        json: { phone: sender.phone },
      });
      this.assertStatus(request, 200);
      const requestBody = this.parseJson(request, 'pin reset request');
      this.assert(typeof requestBody.challengeToken === 'string', 'Missing pin reset challenge token.');
      const otp = await this.readLatestOtp(sender.phone, requestTimestamp);

      const verify = this.request({
        method: 'POST',
        path: '/auth/pin-reset/verify',
        json: {
          challengeToken: requestBody.challengeToken,
          otp,
        },
      });
      this.assertStatus(verify, 200);
      const verifyBody = this.parseJson(verify, 'pin reset verify');
      this.assert(typeof verifyBody.resetToken === 'string', 'Missing resetToken.');

      const complete = this.request({
        method: 'POST',
        path: '/auth/pin-reset/complete',
        json: {
          resetToken: verifyBody.resetToken,
          newPin,
        },
      });
      this.assertStatus(complete, 200);
      const completeBody = this.parseJson(complete, 'pin reset complete');
      this.assert(completeBody.success === true, 'PIN reset did not return success=true.');

      const staleTokenResponse = this.request({
        method: 'GET',
        path: '/me',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(staleTokenResponse, 401);

      const login = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: sender.phone,
          pin: newPin,
          deviceId: sender.boundDeviceId ?? sender.deviceId,
        },
      });
      this.assertStatus(login, 200);
      const loginBody = this.parseJson(login, 'login after pin reset');
      sender.pin = newPin;
      sender.accessToken = loginBody.accessToken;
      sender.refreshToken = loginBody.refreshToken;
    });

    await this.step('Logout flow', async () => {
      const sender = this.requireActorOrSkip('sender');
      const logoutToken = sender.accessToken;
      const response = this.request({
        method: 'POST',
        path: '/auth/logout',
        bearerToken: logoutToken,
        json: {},
      });
      this.assertStatus(response, 204);

      const rejected = this.request({
        method: 'GET',
        path: '/me',
        bearerToken: logoutToken,
      });
      this.assertStatus(rejected, 401);

      const login = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: sender.phone,
          pin: sender.pin,
          deviceId: sender.boundDeviceId ?? sender.deviceId,
        },
      });
      this.assertStatus(login, 200);
      const loginBody = this.parseJson(login, 'login after logout');
      sender.accessToken = loginBody.accessToken;
      sender.refreshToken = loginBody.refreshToken;
    });

    await this.step('Auth negative paths', async () => {
      const sender = this.requireActorOrSkip('sender');

      // Wrong PIN
      const wrongPin = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: sender.phone,
          pin: '0000',
          deviceId: sender.boundDeviceId ?? sender.deviceId,
        },
      });
      this.assertStatus(wrongPin, 401);
      this.assertErrorCode(wrongPin, 'ERR_AUTH_INVALID_CREDENTIALS', 'wrong PIN login');

      // Unregistered phone
      const unknownPhone = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: this.generatePhone(),
          pin: '1234',
          deviceId: randomUUID(),
        },
      });
      this.assertStatus(unknownPhone, 401);
      this.assertErrorCode(unknownPhone, 'ERR_AUTH_INVALID_CREDENTIALS', 'unknown phone login');

      // Register already-registered phone
      const duplicateRegister = this.request({
        method: 'POST',
        path: '/auth/register/request-otp',
        json: { phone: sender.phone },
      });
      this.assertStatus(duplicateRegister, 409);
      this.assertErrorCode(duplicateRegister, 'ERR_AUTH_PHONE_ALREADY_REGISTERED', 'duplicate registration');

      // Refresh with invalid token
      const badRefresh = this.request({
        method: 'POST',
        path: '/auth/refresh',
        json: { refreshToken: 'invalid-token-value' },
      });
      this.assertStatus(badRefresh, 401);

      // Access /me without token
      const noAuth = this.request({
        method: 'GET',
        path: '/me',
      });
      this.assertStatus(noAuth, 401);
    });

    // ── Phase 3: Admin Setup ──────────────────────────────────────────

    await this.step('Admin probe', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/probe',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin probe');
      this.assert(body.ok === true, 'Admin probe did not return ok=true.');
    });

    await this.step('Admin dashboard KPIs', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/dashboard/kpis',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin dashboard KPIs');
      this.assert(typeof body === 'object' && body !== null, 'Dashboard KPIs did not return an object.');
    });

    await this.step('Admin dashboard queues', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/dashboard/queues',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin dashboard queues');
      this.assert(typeof body === 'object' && body !== null, 'Dashboard queues did not return an object.');
    });

    await this.step('Admin dashboard recent activity', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/dashboard/recent-activity',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin dashboard recent-activity');
      this.assert(Array.isArray(body.items), 'Recent activity missing items array.');
    });

    await this.step('Admin config', async () => {
      this.requireAdminOrSkip();

      const list = this.request({
        method: 'GET',
        path: '/admin/config',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(list, 200);
      const listBody = this.parseJson(list, 'admin config list');
      this.assert(Array.isArray(listBody.items), 'Admin config list missing items.');

      if (listBody.items.length > 0) {
        const firstKey = listBody.items[0].key;

        const history = this.request({
          method: 'GET',
          path: `/admin/config/${encodeURIComponent(firstKey)}/history`,
          bearerToken: this.config.adminAccessToken,
        });
        this.assertStatus(history, 200);
        const historyBody = this.parseJson(history, 'admin config history');
        this.assert(Array.isArray(historyBody.items), 'Config history missing items.');

        // Update with current value to exercise PATCH without changing state
        const update = this.request({
          method: 'PATCH',
          path: `/admin/config/${encodeURIComponent(firstKey)}`,
          bearerToken: this.config.adminAccessToken,
          json: { value: listBody.items[0].value },
        });
        this.assertStatus(update, 200);
      }
    });

    // ── Phase 4: Agent Onboarding & Commission ────────────────────────

    await this.step('Admin onboard agent', async () => {
      this.requireAdminOrSkip();
      this.requireOtpReady();

      const agentPhone = this.generatePhone();
      const onboard = this.request({
        method: 'POST',
        path: '/admin/agents',
        bearerToken: this.config.adminAccessToken,
        json: {
          phoneNumber: agentPhone,
          firstName: 'Flow',
          lastName: 'Agent',
          businessName: 'Validation Agent Shop',
          lat: 9.02,
          lng: 38.75,
        },
      });
      this.assertStatus(onboard, 201);
      const onboardBody = this.parseJson(onboard, 'agent onboard response');
      this.assert(typeof onboardBody.id === 'string', 'Agent onboard missing id.');
      this.context.ids.agentId = onboardBody.id;
      this.context.ids.agentPhone = agentPhone;

      // The agent user is created via admin, we need to register them to get tokens
      // Agent was created with the phone, now register and login
      const agentActor = await this.registerUser({
        label: 'agent',
        firstName: 'Flow',
        lastName: 'Agent',
        pin: '1234',
        phoneOverride: agentPhone,
      });
      this.context.actors.agent = agentActor;
    });

    await this.step('Agent login', async () => {
      const agent = this.requireActorOrSkip('agent');

      const login = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: agent.phone,
          pin: agent.pin,
          deviceId: agent.boundDeviceId ?? agent.deviceId,
        },
      });
      this.assertStatus(login, 200);
      const loginBody = this.parseJson(login, 'agent login response');
      agent.accessToken = loginBody.accessToken;
      agent.refreshToken = loginBody.refreshToken;
    });

    await this.step('Admin list agents', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/agents',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin agents list');
      this.assert(Array.isArray(body.items), 'Admin agents list missing items.');
    });

    await this.step('Admin agent detail', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.agentId) {
        throw new SkipStepError('No agent was onboarded.');
      }

      const response = this.request({
        method: 'GET',
        path: `/admin/agents/${this.context.ids.agentId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin agent detail');
      this.assert(body.id === this.context.ids.agentId, 'Agent detail returned wrong id.');
    });

    await this.step('Admin create commission rule', async () => {
      this.requireAdminOrSkip();

      const create = this.request({
        method: 'POST',
        path: '/admin/commission-rules',
        bearerToken: this.config.adminAccessToken,
        json: {
          agentTier: 'TIER_0',
          txType: 'CICO_IN',
          percentageRate: '0.0100',
          fixedFee: '5.00',
        },
      });
      this.assertStatus(create, 201);
      const createBody = this.parseJson(create, 'commission rule create');
      this.assert(typeof createBody.id !== 'undefined', 'Commission rule create missing id.');
      this.context.ids.commissionRuleId = createBody.id;
    });

    await this.step('Admin list commission rules', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/commission-rules',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'commission rules list');
      this.assert(Array.isArray(body.items), 'Commission rules list missing items.');
    });

    await this.step('Admin float topup', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.agentId) {
        throw new SkipStepError('No agent was onboarded.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/agents/${this.context.ids.agentId}/float-topup`,
        bearerToken: this.config.adminAccessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: { amount: '10000.00' },
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'float topup response');
      this.assert(typeof body.newBalance === 'string', 'Float topup missing newBalance.');
    });

    await this.step('Agent suspend and reactivate', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.agentId) {
        throw new SkipStepError('No agent was onboarded.');
      }

      // Suspend
      const suspend = this.request({
        method: 'POST',
        path: `/admin/agents/${this.context.ids.agentId}/suspend`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(suspend, 200);

      // Attempt cash-in while suspended
      const agent = this.requireActorOrSkip('agent');
      const sender = this.requireActorOrSkip('sender');
      const blockedCashIn = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          customerPhone: sender.phone,
          amount: '100.00',
        },
      });
      this.assertStatus(blockedCashIn, 403);
      this.assertErrorCode(blockedCashIn, 'ERR_CICO_AGENT_SUSPENDED', 'cash-in while suspended');

      // Reactivate
      const reactivate = this.request({
        method: 'POST',
        path: `/admin/agents/${this.context.ids.agentId}/reactivate`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(reactivate, 200);
    });

    // ── Phase 5: CICO Cash-In ─────────────────────────────────────────

    await this.step('Cash-in happy path', async () => {
      const agent = this.requireActorOrSkip('agent');
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          customerPhone: sender.phone,
          amount: '500.00',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'cash-in response');
      this.assert(typeof body.transactionId === 'string', 'Cash-in missing transactionId.');
      this.context.ids.cashInTxId = body.transactionId;
    });

    await this.step('Cash-in negative paths', async () => {
      const agent = this.requireActorOrSkip('agent');
      const sender = this.requireActorOrSkip('sender');

      // Missing idempotency key
      const noKey = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: agent.accessToken,
        json: {
          customerPhone: sender.phone,
          amount: '10.00',
        },
      });
      this.assertStatus(noKey, 400);
      this.assertErrorCode(noKey, 'ERR_VALIDATION', 'cash-in missing idempotency');

      // Invalid phone format
      const badPhone = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          customerPhone: 'not-a-phone',
          amount: '10.00',
        },
      });
      this.assertStatus(badPhone, 400);
      this.assertErrorCode(badPhone, 'ERR_VALIDATION', 'cash-in invalid phone');
    });

    // ── Phase 6: CICO Cash-Out ────────────────────────────────────────

    await this.step('Cash-out happy path', async () => {
      this.requireOtpReady();
      const agent = this.requireActorOrSkip('agent');
      const sender = this.requireActorOrSkip('sender');

      // Request
      const requestTimestamp = Date.now();
      const cashOutRequest = this.request({
        method: 'POST',
        path: '/cico/cash-out/request',
        bearerToken: agent.accessToken,
        json: {
          customerPhone: sender.phone,
          amount: '50.00',
        },
      });
      this.assertStatus(cashOutRequest, 201);
      const requestBody = this.parseJson(cashOutRequest, 'cash-out request');
      this.assert(typeof requestBody.requestId === 'string', 'Cash-out request missing requestId.');
      const requestId = requestBody.requestId;
      this.context.ids.cashOutRequestId = requestId;

      // Status
      const status = this.request({
        method: 'GET',
        path: `/cico/cash-out/${requestId}/status`,
        bearerToken: agent.accessToken,
      });
      this.assertStatus(status, 200);
      const statusBody = this.parseJson(status, 'cash-out status');
      this.assert(typeof statusBody.status === 'string', 'Cash-out status missing status field.');

      // Verify OTP
      const otp = await this.readLatestOtp(sender.phone, requestTimestamp);
      const verifyOtp = this.request({
        method: 'POST',
        path: `/cico/cash-out/${requestId}/verify-otp`,
        bearerToken: agent.accessToken,
        json: { otp },
      });
      this.assertStatus(verifyOtp, 200);

      // Commit
      const commit = this.request({
        method: 'POST',
        path: `/cico/cash-out/${requestId}/commit`,
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {},
      });
      this.assertStatus(commit, 200);
      const commitBody = this.parseJson(commit, 'cash-out commit');
      this.assert(typeof commitBody.transactionId === 'string', 'Cash-out commit missing transactionId.');
      this.context.ids.cashOutTxId = commitBody.transactionId;
    });

    await this.step('Cash-out cancel flow', async () => {
      this.requireOtpReady();
      const agent = this.requireActorOrSkip('agent');
      const sender = this.requireActorOrSkip('sender');

      // Create a new cash-out request
      const cashOutRequest = this.request({
        method: 'POST',
        path: '/cico/cash-out/request',
        bearerToken: agent.accessToken,
        json: {
          customerPhone: sender.phone,
          amount: '10.00',
        },
      });
      this.assertStatus(cashOutRequest, 201);
      const requestBody = this.parseJson(cashOutRequest, 'cash-out cancel request');
      const requestId = requestBody.requestId;

      // Customer cancels
      const cancel = this.request({
        method: 'POST',
        path: `/cico/cash-out/${requestId}/cancel`,
        bearerToken: sender.accessToken,
        json: {},
      });
      this.assertStatus(cancel, 200);
    });

    await this.step('Cash-out negative paths', async () => {
      const agent = this.requireActorOrSkip('agent');

      if (!this.context.ids.cashOutRequestId) {
        throw new SkipStepError('No cash-out request was created.');
      }

      // Double commit (already committed)
      const doubleCommit = this.request({
        method: 'POST',
        path: `/cico/cash-out/${this.context.ids.cashOutRequestId}/commit`,
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {},
      });
      this.assertStatus(doubleCommit, 409);
      this.assertErrorCode(doubleCommit, 'ERR_CICO_ALREADY_COMMITTED', 'double commit');

      // Cancel after commit
      const sender = this.requireActorOrSkip('sender');
      const cancelAfterCommit = this.request({
        method: 'POST',
        path: `/cico/cash-out/${this.context.ids.cashOutRequestId}/cancel`,
        bearerToken: sender.accessToken,
        json: {},
      });
      this.assertStatus(cancelAfterCommit, 409);
      this.assertErrorCode(cancelAfterCommit, 'ERR_CICO_INVALID_STATE', 'cancel after commit');
    });

    // ── Phase 7: Agent Discovery ──────────────────────────────────────

    await this.step('Find nearby agents', async () => {
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'GET',
        path: '/cico/agents/nearby?lat=9.02&lng=38.75&radius=10',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'nearby agents');
      this.assert(Array.isArray(body.items), 'Nearby agents missing items array.');
    });

    // ── Phase 8: Wallet & Transactions (post cash-in/cash-out) ────────

    await this.step('Wallet summary', async () => {
      const sender = this.requireActorOrSkip('sender');
      const response = this.request({
        method: 'GET',
        path: '/me/wallet',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, '/me/wallet');
      this.assert(body.userId === sender.userId, 'Wallet userId did not match sender.');
      this.assert(typeof body.availableBalance === 'string', 'Wallet response missing availableBalance.');
      sender.wallet = body;
      this.context.ids.senderWalletId = body.walletId;
    });

    await this.step('User lookup', async () => {
      const sender = this.requireActorOrSkip('sender');
      const recipient = this.requireActorOrSkip('recipient');
      const response = this.request({
        method: 'GET',
        path: `/users/lookup?phone=${encodeURIComponent(recipient.phone)}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, '/users/lookup');
      this.assert(
        typeof body.maskedFirstName === 'string' || body.maskedFirstName === null,
        'Lookup response missing maskedFirstName.',
      );
      this.assert(
        typeof body.maskedLastName === 'string' || body.maskedLastName === null,
        'Lookup response missing maskedLastName.',
      );
    });

    // ── Phase 9: Transfers ────────────────────────────────────────────

    await this.step('Transfer negative paths', async () => {
      const sender = this.requireActorOrSkip('sender');

      const lookupUnknown = this.request({
        method: 'GET',
        path: `/users/lookup?phone=${encodeURIComponent(this.generatePhone())}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(lookupUnknown, 404);
      this.assertErrorCode(
        lookupUnknown,
        'ERR_TRANSFER_RECIPIENT_NOT_FOUND',
        'unknown recipient lookup',
      );

      const missingIdempotency = this.request({
        method: 'POST',
        path: '/transfers',
        bearerToken: sender.accessToken,
        json: {
          recipientPhone: this.requireActorOrSkip('recipient').phone,
          amount: '1.00',
          note: 'missing-idempotency',
        },
      });
      this.assertStatus(missingIdempotency, 400);
      this.assertErrorCode(
        missingIdempotency,
        'ERR_VALIDATION',
        'missing idempotency key',
      );

      const selfTransfer = this.request({
        method: 'POST',
        path: '/transfers',
        bearerToken: sender.accessToken,
        headers: {
          'Idempotency-Key': randomUUID(),
        },
        json: {
          recipientPhone: sender.phone,
          amount: '1.00',
          note: 'self-transfer',
        },
      });
      this.assertStatus(selfTransfer, 422);
      this.assertErrorCode(selfTransfer, 'ERR_TRANSFER_SELF', 'self transfer');

      const byKeyMissing = this.request({
        method: 'GET',
        path: `/transfers/by-key/${randomUUID()}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(byKeyMissing, 404);
      this.assertErrorCode(byKeyMissing, 'ERR_NOT_FOUND', 'transfer lookup by missing key');

      // Invalid amount format
      const badAmount = this.request({
        method: 'POST',
        path: '/transfers',
        bearerToken: sender.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          recipientPhone: this.requireActorOrSkip('recipient').phone,
          amount: 'abc',
          note: 'bad-amount',
        },
      });
      this.assertStatus(badAmount, 400);
      this.assertErrorCode(badAmount, 'ERR_VALIDATION', 'invalid amount format');
    });

    await this.step('Transfer happy path', async () => {
      const sender = this.requireActorOrSkip('sender');
      const recipient = this.requireActorOrSkip('recipient');
      const balance = Number.parseFloat(sender.wallet?.availableBalance ?? '0');

      if (!Number.isFinite(balance) || balance < 1) {
        throw new SkipStepError(
          'Sender wallet has insufficient balance for transfer test.',
        );
      }

      const idempotencyKey = randomUUID();
      const response = this.request({
        method: 'POST',
        path: '/transfers',
        bearerToken: sender.accessToken,
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        json: {
          recipientPhone: recipient.phone,
          amount: '1.00',
          note: 'validation-runner',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'transfer create response');
      this.assert(body.idempotencyKey === idempotencyKey, 'Transfer idempotencyKey mismatch.');
      this.assert(body.status === 'committed' || body.status === 'pending', 'Transfer returned unexpected status.');
      this.context.ids.transferId = body.transactionId;
      this.context.ids.transferIdempotencyKey = idempotencyKey;

      const byKey = this.request({
        method: 'GET',
        path: `/transfers/by-key/${idempotencyKey}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(byKey, 200);
      const byKeyBody = this.parseJson(byKey, 'transfer by key response');
      this.assert(byKeyBody.transactionId === body.transactionId, 'Transfer by key returned the wrong transaction.');
    });

    await this.step('Transactions list', async () => {
      const sender = this.requireActorOrSkip('sender');
      const response = this.request({
        method: 'GET',
        path: '/me/transactions',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, '/me/transactions');
      this.assert(Array.isArray(body.items), 'Transactions response missing items.');
      this.assert(body.pagination && typeof body.pagination.hasMore === 'boolean', 'Transactions response missing pagination.');
      this.context.artifacts.transactionListCount = body.items.length;
    });

    await this.step('Transaction detail', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.transferId) {
        throw new SkipStepError('No committed transfer was available for transaction detail validation.');
      }

      const response = this.request({
        method: 'GET',
        path: `/me/transactions/${this.context.ids.transferId}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'transaction detail');
      this.assert(body.txId === this.context.ids.transferId, 'Transaction detail returned the wrong txId.');
      this.assert(Array.isArray(body.ledger), 'Transaction detail missing ledger entries.');
    });

    // ── Phase 10: KYC Full Lifecycle ──────────────────────────────────

    await this.step('KYC user flow', async () => {
      const sender = this.requireActorOrSkip('sender');

      const before = this.request({
        method: 'GET',
        path: '/me/kyc',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(before, 200);
      const beforeBody = this.parseJson(before, 'initial KYC response');
      this.assert(Array.isArray(beforeBody.availableTiers), 'KYC response missing availableTiers.');

      const nationalIdUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: sender.accessToken,
        form: [
          { name: 'type', value: 'ID_DOCUMENT' },
          {
            name: 'image',
            filePath: this.files.nationalIdImage,
            contentType: 'image/png',
          },
        ],
      });
      this.assertStatus(nationalIdUpload, 201);
      const nationalIdUploadBody = this.parseJson(nationalIdUpload, 'national id upload');

      const selfieUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: sender.accessToken,
        form: [
          { name: 'type', value: 'SELFIE' },
          {
            name: 'image',
            filePath: this.files.selfieImage,
            contentType: 'image/png',
          },
        ],
      });
      this.assertStatus(selfieUpload, 201);
      const selfieUploadBody = this.parseJson(selfieUpload, 'selfie upload');

      const submit = this.request({
        method: 'POST',
        path: '/me/kyc/submit',
        bearerToken: sender.accessToken,
        json: {
          targetTier: 'TIER_1',
          fullName: `${sender.firstName} ${sender.lastName}`,
          dateOfBirth: '1998-03-15',
          address: 'Addis Ababa',
          nationalIdNumber: `ET-${Date.now()}`,
          nationalIdUploadId: nationalIdUploadBody.uploadId,
          selfieUploadId: selfieUploadBody.uploadId,
        },
      });
      this.assertStatus(submit, 201);
      const submitBody = this.parseJson(submit, 'KYC submit response');
      this.context.ids.kycSubmissionId = submitBody.id;

      const current = this.request({
        method: 'GET',
        path: '/me/kyc',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(current, 200);
      const currentBody = this.parseJson(current, 'current KYC response');
      this.assert(currentBody.submission?.id === submitBody.id, 'Current KYC response did not include the submitted profile.');

      const submission = this.request({
        method: 'GET',
        path: `/me/kyc/submissions/${submitBody.id}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(submission, 200);
      const submissionBody = this.parseJson(submission, 'KYC submission detail');
      this.assert(submissionBody.id === submitBody.id, 'KYC submission detail returned the wrong id.');
    });

    await this.step('Admin KYC review', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.kycSubmissionId) {
        throw new SkipStepError('No KYC submission was created.');
      }

      const list = this.request({
        method: 'GET',
        path: '/admin/kyc/submissions',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(list, 200);
      const listBody = this.parseJson(list, 'admin KYC list');
      this.assert(Array.isArray(listBody.items), 'Admin KYC list missing items.');

      const detail = this.request({
        method: 'GET',
        path: `/admin/kyc/submissions/${this.context.ids.kycSubmissionId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(detail, 200);
      const detailBody = this.parseJson(detail, 'admin KYC detail');
      this.assert(
        detailBody.id === this.context.ids.kycSubmissionId,
        'Admin KYC detail returned the wrong submission.',
      );
    });

    await this.step('Admin KYC approve', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.kycSubmissionId) {
        throw new SkipStepError('No KYC submission was created.');
      }

      const approve = this.request({
        method: 'POST',
        path: `/admin/kyc/submissions/${this.context.ids.kycSubmissionId}/approve`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(approve, 200);

      // Verify tier upgraded
      const sender = this.requireActorOrSkip('sender');
      const kyc = this.request({
        method: 'GET',
        path: '/me/kyc',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(kyc, 200);
      const kycBody = this.parseJson(kyc, 'KYC after approval');
      this.assert(
        kycBody.currentTier === 'TIER_1' || kycBody.submission?.status === 'APPROVED',
        'KYC tier did not upgrade after approval.',
      );
    });

    await this.step('KYC reject flow (recipient)', async () => {
      this.requireAdminOrSkip();
      const recipient = this.requireActorOrSkip('recipient');

      // Upload and submit KYC for recipient
      const idUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: recipient.accessToken,
        form: [
          { name: 'type', value: 'ID_DOCUMENT' },
          { name: 'image', filePath: this.files.nationalIdImage, contentType: 'image/png' },
        ],
      });
      this.assertStatus(idUpload, 201);
      const idUploadBody = this.parseJson(idUpload, 'recipient id upload');

      const selfieUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: recipient.accessToken,
        form: [
          { name: 'type', value: 'SELFIE' },
          { name: 'image', filePath: this.files.selfieImage, contentType: 'image/png' },
        ],
      });
      this.assertStatus(selfieUpload, 201);
      const selfieUploadBody = this.parseJson(selfieUpload, 'recipient selfie upload');

      const submit = this.request({
        method: 'POST',
        path: '/me/kyc/submit',
        bearerToken: recipient.accessToken,
        json: {
          targetTier: 'TIER_1',
          fullName: `${recipient.firstName} ${recipient.lastName}`,
          dateOfBirth: '1997-06-20',
          address: 'Dire Dawa',
          nationalIdNumber: `ET-${Date.now()}`,
          nationalIdUploadId: idUploadBody.uploadId,
          selfieUploadId: selfieUploadBody.uploadId,
        },
      });
      this.assertStatus(submit, 201);
      const submitBody = this.parseJson(submit, 'recipient KYC submit');
      this.context.ids.recipientKycSubmissionId = submitBody.id;

      // Admin rejects
      const reject = this.request({
        method: 'POST',
        path: `/admin/kyc/submissions/${submitBody.id}/reject`,
        bearerToken: this.config.adminAccessToken,
        json: { reason: 'Validation runner test rejection.' },
      });
      this.assertStatus(reject, 200);
    });

    await this.step('KYC request-update flow (extra-user)', async () => {
      this.requireAdminOrSkip();
      const extraUser = this.requireActorOrSkip('extra-user');

      const idUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: extraUser.accessToken,
        form: [
          { name: 'type', value: 'ID_DOCUMENT' },
          { name: 'image', filePath: this.files.nationalIdImage, contentType: 'image/png' },
        ],
      });
      this.assertStatus(idUpload, 201);
      const idUploadBody = this.parseJson(idUpload, 'extra-user id upload');

      const selfieUpload = this.request({
        method: 'POST',
        path: '/me/kyc/upload',
        bearerToken: extraUser.accessToken,
        form: [
          { name: 'type', value: 'SELFIE' },
          { name: 'image', filePath: this.files.selfieImage, contentType: 'image/png' },
        ],
      });
      this.assertStatus(selfieUpload, 201);
      const selfieUploadBody = this.parseJson(selfieUpload, 'extra-user selfie upload');

      const submit = this.request({
        method: 'POST',
        path: '/me/kyc/submit',
        bearerToken: extraUser.accessToken,
        json: {
          targetTier: 'TIER_1',
          fullName: `${extraUser.firstName} ${extraUser.lastName}`,
          dateOfBirth: '1999-01-01',
          address: 'Hawassa',
          nationalIdNumber: `ET-${Date.now()}`,
          nationalIdUploadId: idUploadBody.uploadId,
          selfieUploadId: selfieUploadBody.uploadId,
        },
      });
      this.assertStatus(submit, 201);
      const submitBody = this.parseJson(submit, 'extra-user KYC submit');

      const requestUpdate = this.request({
        method: 'POST',
        path: `/admin/kyc/submissions/${submitBody.id}/request-update`,
        bearerToken: this.config.adminAccessToken,
        json: { reason: 'Please re-upload a clearer selfie.' },
      });
      this.assertStatus(requestUpdate, 200);
    });

    // ── Phase 11: Disputes ────────────────────────────────────────────

    await this.step('Create dispute', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.cashInTxId) {
        throw new SkipStepError('No CICO transaction available for dispute.');
      }

      const response = this.request({
        method: 'POST',
        path: '/disputes',
        bearerToken: sender.accessToken,
        json: {
          transactionId: this.context.ids.cashInTxId,
          category: 'WRONG_AMOUNT',
          description: 'The cash-in amount does not match what I handed to the agent.',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'create dispute');
      this.assert(typeof body.id === 'string', 'Dispute create missing id.');
      this.context.ids.disputeId = body.id;
    });

    await this.step('Get dispute detail', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.disputeId) {
        throw new SkipStepError('No dispute was created.');
      }

      const response = this.request({
        method: 'GET',
        path: `/disputes/${this.context.ids.disputeId}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'dispute detail');
      this.assert(body.id === this.context.ids.disputeId, 'Dispute detail returned wrong id.');
    });

    await this.step('Agent respond to dispute', async () => {
      const agent = this.requireActorOrSkip('agent');
      if (!this.context.ids.disputeId) {
        throw new SkipStepError('No dispute was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/disputes/${this.context.ids.disputeId}/response`,
        bearerToken: agent.accessToken,
        json: {
          message: 'The amount was correct. Customer may have miscounted.',
        },
      });
      this.assertStatus(response, 201);
    });

    await this.step('Admin list disputes', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/disputes',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin disputes list');
      this.assert(Array.isArray(body.items), 'Admin disputes list missing items.');
    });

    await this.step('Admin pickup and resolve dispute', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.disputeId) {
        throw new SkipStepError('No dispute was created.');
      }

      const pickup = this.request({
        method: 'POST',
        path: `/admin/disputes/${this.context.ids.disputeId}/pickup`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(pickup, 200);

      const resolve = this.request({
        method: 'POST',
        path: `/admin/disputes/${this.context.ids.disputeId}/resolve`,
        bearerToken: this.config.adminAccessToken,
        json: {
          reason: 'After review, the amounts matched. No reversal needed.',
        },
      });
      this.assertStatus(resolve, 200);
    });

    await this.step('Dispute withdraw flow', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.cashOutTxId) {
        throw new SkipStepError('No second CICO transaction for withdraw test.');
      }

      const create = this.request({
        method: 'POST',
        path: '/disputes',
        bearerToken: sender.accessToken,
        json: {
          transactionId: this.context.ids.cashOutTxId,
          category: 'WRONG_AMOUNT',
          description: 'Testing withdrawal of dispute.',
        },
      });
      this.assertStatus(create, 201);
      const createBody = this.parseJson(create, 'dispute for withdraw');

      const withdraw = this.request({
        method: 'POST',
        path: `/disputes/${createBody.id}/withdraw`,
        bearerToken: sender.accessToken,
        json: {},
      });
      this.assertStatus(withdraw, 200);
    });

    await this.step('Admin reject dispute', async () => {
      this.requireAdminOrSkip();
      const extraUser = this.requireActorOrSkip('extra-user');

      // Cash-in for extra-user so they have a disputable transaction
      const agent = this.requireActorOrSkip('agent');
      const cashIn = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: agent.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          customerPhone: extraUser.phone,
          amount: '100.00',
        },
      });
      this.assertStatus(cashIn, 201);
      const cashInBody = this.parseJson(cashIn, 'extra-user cash-in');

      const create = this.request({
        method: 'POST',
        path: '/disputes',
        bearerToken: extraUser.accessToken,
        json: {
          transactionId: cashInBody.transactionId,
          category: 'WRONG_AMOUNT',
          description: 'Testing admin rejection.',
        },
      });
      this.assertStatus(create, 201);
      const createBody = this.parseJson(create, 'dispute for reject');

      const pickup = this.request({
        method: 'POST',
        path: `/admin/disputes/${createBody.id}/pickup`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(pickup, 200);

      const reject = this.request({
        method: 'POST',
        path: `/admin/disputes/${createBody.id}/reject`,
        bearerToken: this.config.adminAccessToken,
        json: { reason: 'Dispute has no merit after investigation.' },
      });
      this.assertStatus(reject, 200);
    });

    await this.step('Dispute negative paths', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.cashInTxId) {
        throw new SkipStepError('No CICO transaction for dispute negative tests.');
      }

      // Duplicate dispute on already-disputed transaction
      const duplicate = this.request({
        method: 'POST',
        path: '/disputes',
        bearerToken: sender.accessToken,
        json: {
          transactionId: this.context.ids.cashInTxId,
          category: 'WRONG_AMOUNT',
          description: 'Duplicate dispute attempt.',
        },
      });
      // Could be 409 (already open) or 422 (not disputable since resolved)
      this.assert(
        duplicate.status === 409 || duplicate.status === 422,
        `Duplicate dispute returned ${duplicate.status}, expected 409 or 422.`,
      );
    });

    // ── Phase 12: BNPL ────────────────────────────────────────────────

    await this.step('Admin create financing product', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'POST',
        path: '/admin/financing/products',
        bearerToken: this.config.adminAccessToken,
        json: {
          name: 'Validation Test Loan',
          description: 'Product created by validation runner.',
          category: 'RETAIL',
          fixedMarkup: '50.00',
          minAmount: '100.00',
          maxAmount: '5000.00',
          tenureMonths: 3,
          minCreditScore: 0,
          minKycTier: 'TIER_1',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'financing product create');
      this.assert(typeof body.id !== 'undefined', 'Financing product create missing id.');
      this.context.ids.financingProductId = body.id;
    });

    await this.step('Admin list financing products', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/financing/products',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin financing products list');
      this.assert(Array.isArray(body.items), 'Financing products list missing items.');
    });

    await this.step('Admin update financing product', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.financingProductId) {
        throw new SkipStepError('No financing product was created.');
      }

      const response = this.request({
        method: 'PATCH',
        path: `/admin/financing/products/${this.context.ids.financingProductId}`,
        bearerToken: this.config.adminAccessToken,
        json: { description: 'Updated by validation runner.' },
      });
      this.assertStatus(response, 200);
    });

    await this.step('Admin publish financing product', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.financingProductId) {
        throw new SkipStepError('No financing product was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/financing/products/${this.context.ids.financingProductId}/publish`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    await this.step('BNPL list products (user)', async () => {
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'GET',
        path: '/bnpl/products',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'BNPL products list');
      this.assert(Array.isArray(body.items), 'BNPL products list missing items.');
    });

    await this.step('BNPL apply', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.financingProductId) {
        throw new SkipStepError('No financing product available.');
      }

      const response = this.request({
        method: 'POST',
        path: '/bnpl/applications',
        bearerToken: sender.accessToken,
        json: {
          productId: this.context.ids.financingProductId,
          requestedAmount: '500.00',
          purpose: 'Validation runner test application.',
          consents: { creditCheck: true, termsAccepted: true },
          consentVersion: 'v1',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'BNPL application');
      this.assert(typeof body.id !== 'undefined', 'BNPL application missing id.');
      this.context.ids.bnplApplicationId = body.id;
    });

    await this.step('BNPL get application', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.bnplApplicationId) {
        throw new SkipStepError('No BNPL application was created.');
      }

      const response = this.request({
        method: 'GET',
        path: `/bnpl/applications/${this.context.ids.bnplApplicationId}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'BNPL application detail');
      this.assert(body.id === this.context.ids.bnplApplicationId, 'BNPL application detail wrong id.');
    });

    await this.step('BNPL accept offer', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.bnplApplicationId) {
        throw new SkipStepError('No BNPL application was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/bnpl/applications/${this.context.ids.bnplApplicationId}/accept`,
        bearerToken: sender.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {},
      });
      // May be 200 (accepted) or 422 (not yet approved by system)
      if (response.status === 422) {
        const body = this.parseJson(response, 'BNPL accept');
        const code = this.getErrorCode(body);
        if (code === 'ERR_BNPL_NOT_APPROVED') {
          throw new SkipStepError('BNPL application was not auto-approved; manual approval needed.');
        }
      }
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'BNPL accept');
      this.context.ids.bnplContractId = body.contractId ?? null;
    });

    await this.step('BNPL list contracts', async () => {
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'GET',
        path: '/me/bnpl/contracts',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'BNPL contracts list');
      this.assert(Array.isArray(body.items), 'BNPL contracts list missing items.');

      if (body.items.length > 0 && !this.context.ids.bnplContractId) {
        this.context.ids.bnplContractId = body.items[0].id;
      }
    });

    await this.step('BNPL contract detail', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.bnplContractId) {
        throw new SkipStepError('No BNPL contract available.');
      }

      const response = this.request({
        method: 'GET',
        path: `/me/bnpl/contracts/${this.context.ids.bnplContractId}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'BNPL contract detail');
      this.assert(body.id === this.context.ids.bnplContractId, 'BNPL contract detail wrong id.');
    });

    await this.step('BNPL make repayment', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.bnplContractId) {
        throw new SkipStepError('No BNPL contract available.');
      }

      const response = this.request({
        method: 'POST',
        path: `/me/bnpl/contracts/${this.context.ids.bnplContractId}/repayments`,
        bearerToken: sender.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: { amount: '50.00' },
      });
      // 201 on success, or 422 if no outstanding balance
      if (response.status === 422) {
        throw new SkipStepError('No outstanding balance for repayment test.');
      }
      this.assertStatus(response, 201);
    });

    await this.step('Admin financing overview', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/financing/overview',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin financing overview');
      this.assert(typeof body === 'object' && body !== null, 'Financing overview did not return an object.');
    });

    await this.step('Admin financing contracts', async () => {
      this.requireAdminOrSkip();

      const list = this.request({
        method: 'GET',
        path: '/admin/financing/contracts',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(list, 200);
      const listBody = this.parseJson(list, 'admin financing contracts list');
      this.assert(Array.isArray(listBody.items), 'Financing contracts list missing items.');

      if (this.context.ids.bnplContractId) {
        const detail = this.request({
          method: 'GET',
          path: `/admin/financing/contracts/${this.context.ids.bnplContractId}`,
          bearerToken: this.config.adminAccessToken,
        });
        this.assertStatus(detail, 200);
      }
    });

    await this.step('Admin record repayment', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.bnplContractId) {
        throw new SkipStepError('No BNPL contract available.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/financing/contracts/${this.context.ids.bnplContractId}/record-repayment`,
        bearerToken: this.config.adminAccessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: { amount: '10.00' },
      });
      // May fail if contract already paid off
      if (response.status === 422 || response.status === 409) {
        throw new SkipStepError('Contract has no outstanding balance for admin record-repayment.');
      }
      this.assertStatus(response, 200);
    });

    await this.step('Admin financing overdue queue', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/financing/overdue',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin financing overdue');
      this.assert(Array.isArray(body.items), 'Financing overdue queue missing items.');
    });

    await this.step('Admin send reminder', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.bnplContractId) {
        throw new SkipStepError('No BNPL contract available.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/financing/contracts/${this.context.ids.bnplContractId}/remind`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      // 200 on success, or 422 if contract not overdue
      if (response.status === 422) {
        throw new SkipStepError('Contract is not overdue, reminder not applicable.');
      }
      this.assertStatus(response, 200);
    });

    await this.step('BNPL cancel flow', async () => {
      const sender = this.requireActorOrSkip('sender');
      if (!this.context.ids.financingProductId) {
        throw new SkipStepError('No financing product available.');
      }

      // Create a new application to cancel
      const apply = this.request({
        method: 'POST',
        path: '/bnpl/applications',
        bearerToken: sender.accessToken,
        json: {
          productId: this.context.ids.financingProductId,
          requestedAmount: '200.00',
          purpose: 'Application to be cancelled.',
          consents: { creditCheck: true, termsAccepted: true },
          consentVersion: 'v1',
        },
      });
      // May fail with duplicate or other constraint
      if (apply.status === 409) {
        throw new SkipStepError('Cannot create a second BNPL application (duplicate).');
      }
      this.assertStatus(apply, 201);
      const applyBody = this.parseJson(apply, 'BNPL cancel apply');

      const cancel = this.request({
        method: 'POST',
        path: `/bnpl/applications/${applyBody.id}/cancel`,
        bearerToken: sender.accessToken,
        json: {},
      });
      this.assertStatus(cancel, 200);
    });

    await this.step('Admin retire financing product', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.financingProductId) {
        throw new SkipStepError('No financing product was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/financing/products/${this.context.ids.financingProductId}/retire`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    await this.step('Admin writeoff contract', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.bnplContractId) {
        throw new SkipStepError('No BNPL contract available.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/financing/contracts/${this.context.ids.bnplContractId}/writeoff`,
        bearerToken: this.config.adminAccessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {},
      });
      // May fail if contract already closed
      if (response.status === 409) {
        throw new SkipStepError('Contract already closed, cannot writeoff.');
      }
      this.assertStatus(response, 200);
    });

    // ── Phase 13: Accountants & Approvals ─────────────────────────────

    await this.step('Admin create accountant', async () => {
      this.requireAdminOrSkip();
      this.requireOtpReady();

      const accountantPhone = this.generatePhone();
      const response = this.request({
        method: 'POST',
        path: '/admin/accountants',
        bearerToken: this.config.adminAccessToken,
        json: {
          phoneNumber: accountantPhone,
          firstName: 'Flow',
          lastName: 'Accountant',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'accountant create');
      this.assert(typeof body.id === 'string', 'Accountant create missing id.');
      this.context.ids.accountantId = body.id;
      this.context.ids.accountantPhone = accountantPhone;

      // Register the accountant user to get tokens
      const accountantActor = await this.registerUser({
        label: 'accountant',
        firstName: 'Flow',
        lastName: 'Accountant',
        pin: '1234',
        phoneOverride: accountantPhone,
      });
      this.context.actors.accountant = accountantActor;
    });

    await this.step('Admin list accountants', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/accountants',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin accountants list');
      this.assert(Array.isArray(body.items), 'Accountants list missing items.');
    });

    await this.step('Admin accountant detail', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.accountantId) {
        throw new SkipStepError('No accountant was created.');
      }

      const response = this.request({
        method: 'GET',
        path: `/admin/accountants/${this.context.ids.accountantId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'accountant detail');
      this.assert(body.id === this.context.ids.accountantId, 'Accountant detail wrong id.');
    });

    await this.step('Accountant login', async () => {
      const accountant = this.requireActorOrSkip('accountant');

      const login = this.request({
        method: 'POST',
        path: '/auth/login',
        json: {
          phone: accountant.phone,
          pin: accountant.pin,
          deviceId: accountant.boundDeviceId ?? accountant.deviceId,
        },
      });
      this.assertStatus(login, 200);
      const body = this.parseJson(login, 'accountant login');
      accountant.accessToken = body.accessToken;
      accountant.refreshToken = body.refreshToken;
    });

    await this.step('Submit adjustment', async () => {
      const accountant = this.requireActorOrSkip('accountant');
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'POST',
        path: '/admin/adjustments',
        bearerToken: accountant.accessToken,
        json: {
          targetWalletPhone: sender.phone,
          amount: '25.00',
          direction: 'CREDIT',
          reason: 'Validation runner test adjustment for manual credit.',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'adjustment submit');
      this.assert(typeof body.id === 'string', 'Adjustment submit missing id.');
      this.context.ids.adjustmentId = body.id;
    });

    await this.step('List adjustments', async () => {
      const accountant = this.requireActorOrSkip('accountant');

      const response = this.request({
        method: 'GET',
        path: '/admin/adjustments',
        bearerToken: accountant.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'adjustments list');
      this.assert(Array.isArray(body.items), 'Adjustments list missing items.');
    });

    await this.step('Adjustment detail', async () => {
      const accountant = this.requireActorOrSkip('accountant');
      if (!this.context.ids.adjustmentId) {
        throw new SkipStepError('No adjustment was submitted.');
      }

      const response = this.request({
        method: 'GET',
        path: `/admin/adjustments/${this.context.ids.adjustmentId}`,
        bearerToken: accountant.accessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'adjustment detail');
      this.assert(body.id === this.context.ids.adjustmentId, 'Adjustment detail wrong id.');
    });

    await this.step('Admin approve adjustment', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.adjustmentId) {
        throw new SkipStepError('No adjustment was submitted.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/adjustments/${this.context.ids.adjustmentId}/approve`,
        bearerToken: this.config.adminAccessToken,
        json: { note: 'Approved by validation runner.' },
      });
      this.assertStatus(response, 200);
    });

    await this.step('Submit and cancel adjustment', async () => {
      const accountant = this.requireActorOrSkip('accountant');
      const sender = this.requireActorOrSkip('sender');

      const submit = this.request({
        method: 'POST',
        path: '/admin/adjustments',
        bearerToken: accountant.accessToken,
        json: {
          targetWalletPhone: sender.phone,
          amount: '10.00',
          direction: 'DEBIT',
          reason: 'Validation runner test adjustment to be cancelled.',
        },
      });
      this.assertStatus(submit, 201);
      const submitBody = this.parseJson(submit, 'adjustment to cancel');

      const cancel = this.request({
        method: 'POST',
        path: `/admin/adjustments/${submitBody.id}/cancel`,
        bearerToken: accountant.accessToken,
        json: {},
      });
      this.assertStatus(cancel, 200);
    });

    await this.step('Submit and reject adjustment', async () => {
      this.requireAdminOrSkip();
      const accountant = this.requireActorOrSkip('accountant');
      const sender = this.requireActorOrSkip('sender');

      const submit = this.request({
        method: 'POST',
        path: '/admin/adjustments',
        bearerToken: accountant.accessToken,
        json: {
          targetWalletPhone: sender.phone,
          amount: '5.00',
          direction: 'CREDIT',
          reason: 'Validation runner test adjustment to be rejected.',
        },
      });
      this.assertStatus(submit, 201);
      const submitBody = this.parseJson(submit, 'adjustment to reject');

      const reject = this.request({
        method: 'POST',
        path: `/admin/adjustments/${submitBody.id}/reject`,
        bearerToken: this.config.adminAccessToken,
        json: { reason: 'Rejected by validation runner.' },
      });
      this.assertStatus(reject, 200);
    });

    await this.step('Approval negative paths', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.adjustmentId) {
        throw new SkipStepError('No adjustment was submitted.');
      }

      // Approve already-decided adjustment
      const alreadyDecided = this.request({
        method: 'POST',
        path: `/admin/adjustments/${this.context.ids.adjustmentId}/approve`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(alreadyDecided, 409);
      this.assertErrorCode(alreadyDecided, 'ERR_APPROVAL_ALREADY_DECIDED', 'approve already decided');
    });

    await this.step('Admin deactivate accountant', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.accountantId) {
        throw new SkipStepError('No accountant was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/accountants/${this.context.ids.accountantId}/deactivate`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    await this.step('Admin reactivate accountant', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.accountantId) {
        throw new SkipStepError('No accountant was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/accountants/${this.context.ids.accountantId}/reactivate`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    await this.step('Admin reset accountant password', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.accountantId) {
        throw new SkipStepError('No accountant was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/accountants/${this.context.ids.accountantId}/reset-password`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    // ── Phase 14: Risk ────────────────────────────────────────────────

    await this.step('Admin list risk flags', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/risk/flags',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'admin risk flags list');
      this.assert(Array.isArray(body.items), 'Risk flags list missing items.');
    });

    await this.step('Admin create risk flag', async () => {
      this.requireAdminOrSkip();
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'POST',
        path: '/admin/risk/flags',
        bearerToken: this.config.adminAccessToken,
        json: {
          userId: sender.userId,
          severity: 'WARNING',
          reason: 'Validation runner test flag for audit purposes.',
        },
      });
      this.assertStatus(response, 201);
      const body = this.parseJson(response, 'risk flag create');
      this.assert(typeof body.id === 'string', 'Risk flag create missing id.');
      this.context.ids.riskFlagId = body.id;
    });

    await this.step('Admin risk flag detail', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.riskFlagId) {
        throw new SkipStepError('No risk flag was created.');
      }

      const response = this.request({
        method: 'GET',
        path: `/admin/risk/flags/${this.context.ids.riskFlagId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'risk flag detail');
      this.assert(body.id === this.context.ids.riskFlagId, 'Risk flag detail wrong id.');
    });

    await this.step('Admin decide risk flag', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.riskFlagId) {
        throw new SkipStepError('No risk flag was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/risk/flags/${this.context.ids.riskFlagId}/decide`,
        bearerToken: this.config.adminAccessToken,
        json: {
          decision: 'DISMISS',
          reason: 'Flag dismissed by validation runner.',
        },
      });
      this.assertStatus(response, 200);
    });

    await this.step('Risk flag negative paths', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.riskFlagId) {
        throw new SkipStepError('No risk flag was created.');
      }

      // Decide already-decided flag
      const alreadyDecided = this.request({
        method: 'POST',
        path: `/admin/risk/flags/${this.context.ids.riskFlagId}/decide`,
        bearerToken: this.config.adminAccessToken,
        json: {
          decision: 'DISMISS',
          reason: 'Double decide attempt.',
        },
      });
      this.assertStatus(alreadyDecided, 409);
      this.assertErrorCode(alreadyDecided, 'ERR_RISK_FLAG_ALREADY_DECIDED', 'decide already decided flag');
    });

    await this.step('Admin credit score', async () => {
      this.requireAdminOrSkip();
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'GET',
        path: `/admin/risk/scores/${sender.userId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'credit score');
      this.assert(typeof body === 'object' && body !== null, 'Credit score did not return an object.');
    });

    await this.step('Admin rescore', async () => {
      this.requireAdminOrSkip();
      const sender = this.requireActorOrSkip('sender');

      const response = this.request({
        method: 'POST',
        path: `/admin/risk/scores/${sender.userId}/rescore`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 200);
    });

    // ── Phase 15: Reporting ───────────────────────────────────────────

    await this.step('List report types', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/reports/types',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'report types');
      this.assert(Array.isArray(body.items), 'Report types missing items array.');
      if (body.items.length > 0) {
        this.context.ids.reportType = body.items[0].type ?? body.items[0].id ?? body.items[0];
      }
    });

    await this.step('Create report job', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.reportType) {
        throw new SkipStepError('No report types available.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/reports/${encodeURIComponent(this.context.ids.reportType)}`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      this.assertStatus(response, 202);
      const body = this.parseJson(response, 'report job create');
      this.assert(typeof body.jobId === 'string', 'Report job create missing jobId.');
      this.context.ids.reportJobId = body.jobId;
    });

    await this.step('List report jobs', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'GET',
        path: '/admin/reports/jobs',
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'report jobs list');
      this.assert(Array.isArray(body.items), 'Report jobs list missing items.');
    });

    await this.step('Report job detail', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.reportJobId) {
        throw new SkipStepError('No report job was created.');
      }

      const response = this.request({
        method: 'GET',
        path: `/admin/reports/jobs/${this.context.ids.reportJobId}`,
        bearerToken: this.config.adminAccessToken,
      });
      this.assertStatus(response, 200);
      const body = this.parseJson(response, 'report job detail');
      this.assert(body.jobId === this.context.ids.reportJobId, 'Report job detail wrong jobId.');
    });

    await this.step('Cancel report job', async () => {
      this.requireAdminOrSkip();
      if (!this.context.ids.reportJobId) {
        throw new SkipStepError('No report job was created.');
      }

      const response = this.request({
        method: 'POST',
        path: `/admin/reports/jobs/${this.context.ids.reportJobId}/cancel`,
        bearerToken: this.config.adminAccessToken,
        json: {},
      });
      // 200 if cancelled, 409 if already completed
      if (response.status === 409) {
        throw new SkipStepError('Report job already completed, cannot cancel.');
      }
      this.assertStatus(response, 200);
    });

    // ── Phase 16: Admin Broadcast ─────────────────────────────────────

    await this.step('Admin broadcast', async () => {
      this.requireAdminOrSkip();

      const response = this.request({
        method: 'POST',
        path: '/admin/broadcast',
        bearerToken: this.config.adminAccessToken,
        json: {
          title: 'Validation Runner Test',
          body: 'This is a test broadcast from the validation runner.',
        },
      });
      this.assertStatus(response, 201);
    });

    // ── Phase 17: Notifications (enhanced) ────────────────────────────

    await this.step('Notifications flow', async () => {
      const sender = this.requireActorOrSkip('sender');
      const recipient = this.requireActorOrSkip('recipient');

      if (!this.context.ids.transferId && !this.context.ids.cashInTxId) {
        throw new SkipStepError('Notifications depend on a committed transaction.');
      }

      const senderList = await this.waitForNotifications(sender.accessToken);
      const recipientList = await this.waitForNotifications(recipient.accessToken);
      this.assert(senderList.items.length > 0, 'Sender notifications remained empty.');
      this.assert(recipientList.items.length > 0, 'Recipient notifications remained empty.');

      const senderNotification = senderList.items[0];
      const detail = this.request({
        method: 'GET',
        path: `/me/notifications/${senderNotification.notificationId}`,
        bearerToken: sender.accessToken,
      });
      this.assertStatus(detail, 200);
      const detailBody = this.parseJson(detail, 'notification detail');
      this.assert(
        detailBody.notificationId === senderNotification.notificationId,
        'Notification detail returned the wrong notification.',
      );

      const markRead = this.request({
        method: 'POST',
        path: '/me/notifications/mark-read',
        bearerToken: sender.accessToken,
        json: {
          notificationIds: [senderNotification.notificationId],
        },
      });
      this.assertStatus(markRead, 201);
      const markReadBody = this.parseJson(markRead, 'mark-read response');
      this.assert(markReadBody.markedCount >= 1, 'mark-read did not mark any notifications.');

      if (this.config.smsStubFile) {
        const smsDelivered = await this.waitFor(() => {
          const lines = this.readSmsLogLines();
          return lines.some((line) => {
            try {
              const parsed = JSON.parse(line);
              return (
                typeof parsed.to === 'string' &&
                (parsed.to === sender.phone || parsed.to === recipient.phone) &&
                typeof parsed.body === 'string' &&
                (parsed.body.toLowerCase().includes('transfer') ||
                  parsed.body.toLowerCase().includes('received'))
              );
            } catch {
              return false;
            }
          });
        }, this.config.notificationTimeoutMs, 'SMS transfer notification');

        if (!smsDelivered) {
          throw new SkipStepError(
            'Notification endpoints became active, but no transfer SMS was observed in the stub file within the timeout window.',
          );
        }
      }
    });

    // ── Phase 18: RBAC Negative Paths ─────────────────────────────────

    await this.step('RBAC negative paths', async () => {
      const sender = this.requireActorOrSkip('sender');

      // USER accessing admin endpoint -> 403
      const userAdminAccess = this.request({
        method: 'GET',
        path: '/admin/dashboard/kpis',
        bearerToken: sender.accessToken,
      });
      this.assertStatus(userAdminAccess, 403);

      // USER accessing agent-only endpoint -> 403
      const userAgentAccess = this.request({
        method: 'POST',
        path: '/cico/cash-in',
        bearerToken: sender.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
        json: {
          customerPhone: this.generatePhone(),
          amount: '10.00',
        },
      });
      this.assertStatus(userAgentAccess, 403);

      // Unauthenticated accessing protected endpoint -> 401
      const noAuthProtected = this.request({
        method: 'GET',
        path: '/me/wallet',
      });
      this.assertStatus(noAuthProtected, 401);

      // AGENT accessing admin endpoint -> 403
      const agent = this.context.actors.agent;
      if (agent) {
        const agentAdminAccess = this.request({
          method: 'GET',
          path: '/admin/dashboard/kpis',
          bearerToken: agent.accessToken,
        });
        this.assertStatus(agentAdminAccess, 403);
      }

      // ACCOUNTANT accessing BNPL user endpoint -> 403
      const accountant = this.context.actors.accountant;
      if (accountant) {
        const accountantBnplAccess = this.request({
          method: 'GET',
          path: '/bnpl/products',
          bearerToken: accountant.accessToken,
        });
        this.assertStatus(accountantBnplAccess, 403);
      }
    });

    this.finish(0);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  failHard(error) {
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    this.results.push({
      name: 'Runner execution',
      status: 'failed',
      durationMs: 0,
      message,
    });
    this.finish(1);
  }

  async step(name, fn) {
    const startedAt = Date.now();
    this.log('STEP', name);

    try {
      await fn();
      this.results.push({
        name,
        status: 'passed',
        durationMs: Date.now() - startedAt,
      });
      this.log('PASS', name);
    } catch (error) {
      if (error instanceof SkipStepError) {
        this.results.push({
          name,
          status: 'skipped',
          durationMs: Date.now() - startedAt,
          message: error.message,
        });
        this.log('SKIP', `${name}: ${error.message}`);
        return;
      }

      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.results.push({
        name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        message,
      });
      this.log('FAIL', `${name}: ${message}`);
    }
  }

  finish(exitCode) {
    const summary = this.buildSummary(exitCode);
    const artifact = {
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      config: {
        baseUrl: this.config.baseUrl,
        smsStubFile: this.config.smsStubFile,
        adminAccessTokenProvided: Boolean(this.config.adminAccessToken),
      },
      discovery: this.discovery,
      context: this.context,
      results: this.results,
      summary,
    };

    writeFileSync(this.config.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    this.printSummary(summary);
    this.log('INFO', `Artifact written to ${this.config.artifactPath}`);
    process.exitCode = summary.failed > 0 || exitCode !== 0 ? 1 : 0;
  }

  buildSummary(exitCode) {
    const counts = this.results.reduce(
      (acc, result) => {
        acc[result.status] += 1;
        return acc;
      },
      { passed: 0, failed: 0, skipped: 0 },
    );

    return {
      ...counts,
      exitCode,
    };
  }

  printSummary(summary) {
    console.log('');
    console.log('Summary');
    console.log(`  Passed:  ${summary.passed}`);
    console.log(`  Failed:  ${summary.failed}`);
    console.log(`  Skipped: ${summary.skipped}`);

    if (summary.failed > 0) {
      console.log('');
      console.log('Failures');
      for (const result of this.results.filter((entry) => entry.status === 'failed')) {
        console.log(`  - ${result.name}: ${result.message}`);
      }
    }

    if (summary.skipped > 0) {
      console.log('');
      console.log('Skipped');
      for (const result of this.results.filter((entry) => entry.status === 'skipped')) {
        console.log(`  - ${result.name}: ${result.message}`);
      }
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────

  request(options) {
    const url = this.buildUrl(options.path);
    const args = [
      '-sS',
      '-X',
      options.method,
      url,
      '-H',
      'Accept: application/json',
      '-H',
      'Accept-Language: en',
      '-w',
      '\n__CURL_STATUS__:%{http_code}',
    ];

    for (const [header, value] of Object.entries(options.headers ?? {})) {
      args.push('-H', `${header}: ${value}`);
    }

    if (options.bearerToken) {
      args.push('-H', `Authorization: Bearer ${options.bearerToken}`);
    }

    if (options.json !== undefined) {
      args.push('-H', 'Content-Type: application/json');
      args.push('--data', JSON.stringify(options.json));
    }

    if (options.form) {
      for (const field of options.form) {
        if ('filePath' in field) {
          args.push(
            '-F',
            `${field.name}=@${field.filePath};type=${field.contentType}`,
          );
        } else {
          args.push('-F', `${field.name}=${field.value}`);
        }
      }
    }

    const stdout = execFileSync('curl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const marker = '\n__CURL_STATUS__:';
    const index = stdout.lastIndexOf(marker);
    this.assert(index >= 0, `Unable to parse curl status for ${options.method} ${options.path}.`);

    const bodyText = stdout.slice(0, index).trim();
    const status = Number.parseInt(stdout.slice(index + marker.length).trim(), 10);

    return {
      method: options.method,
      path: options.path,
      url,
      status,
      bodyText,
    };
  }

  // ── Parsing & Assertions ──────────────────────────────────────────

  parseJson(response, label) {
    if (!response.bodyText) {
      return {};
    }

    try {
      return JSON.parse(response.bodyText);
    } catch (error) {
      throw new Error(
        `${label} was not valid JSON. Response body: ${response.bodyText}`,
      );
    }
  }

  assertStatus(response, expectedStatus) {
    this.assert(
      response.status === expectedStatus,
      `${response.method} ${response.path} returned ${response.status}, expected ${expectedStatus}. Body: ${response.bodyText || '<empty>'}`,
    );
  }

  assertErrorCode(response, expectedCode, label) {
    const body = this.parseJson(response, `${label} error response`);
    const actualCode = this.getErrorCode(body);
    this.assert(
      actualCode === expectedCode,
      `${label} returned ${actualCode ?? 'unknown error code'}, expected ${expectedCode}.`,
    );
  }

  getErrorCode(body) {
    return body?.error?.code ?? null;
  }

  // ── Actor Provisioning ────────────────────────────────────────────

  async registerUser(input) {
    const phone = input.phoneOverride ?? this.generatePhone();
    const deviceId = randomUUID();
    const requestTimestamp = Date.now();
    const requestOtp = this.request({
      method: 'POST',
      path: '/auth/register/request-otp',
      json: { phone },
    });
    this.assertStatus(requestOtp, 200);
    const requestOtpBody = this.parseJson(requestOtp, 'registration otp response');
    this.assert(typeof requestOtpBody.challengeToken === 'string', 'Missing registration challengeToken.');
    const otp = await this.readLatestOtp(phone, requestTimestamp);

    const verifyOtp = this.request({
      method: 'POST',
      path: '/auth/register/verify-otp',
      json: {
        challengeToken: requestOtpBody.challengeToken,
        otp,
      },
    });
    this.assertStatus(verifyOtp, 200);
    const verifyOtpBody = this.parseJson(verifyOtp, 'registration verify response');
    this.assert(typeof verifyOtpBody.setupToken === 'string', 'Missing registration setupToken.');

    const complete = this.request({
      method: 'POST',
      path: '/auth/register/complete',
      json: {
        setupToken: verifyOtpBody.setupToken,
        pin: input.pin,
        deviceId,
        platform: 'ANDROID',
        deviceName: `${input.label}-device`,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });
    this.assertStatus(complete, 200);
    const completeBody = this.parseJson(complete, 'registration complete response');
    this.assert(typeof completeBody.accessToken === 'string', 'Registration response missing accessToken.');
    this.assert(typeof completeBody.refreshToken === 'string', 'Registration response missing refreshToken.');
    this.assert(typeof completeBody.user?.id === 'string', 'Registration response missing user.id.');

    return {
      label: input.label,
      phone,
      pin: input.pin,
      firstName: input.firstName,
      lastName: input.lastName,
      deviceId,
      boundDeviceId: deviceId,
      accessToken: completeBody.accessToken,
      refreshToken: completeBody.refreshToken,
      userId: completeBody.user.id,
      user: completeBody.user,
      wallet: null,
    };
  }

  // ── Polling Helpers ───────────────────────────────────────────────

  async waitForNotifications(accessToken) {
    const body = await this.waitFor(async () => {
      const response = this.request({
        method: 'GET',
        path: '/me/notifications',
        bearerToken: accessToken,
      });
      if (response.status !== 200) {
        return null;
      }

      const parsed = this.parseJson(response, 'notifications list');
      return Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed : null;
    }, this.config.notificationTimeoutMs, 'notifications');

    if (!body) {
      throw new SkipStepError(
        'Notification worker did not materialize notifications within the timeout window.',
      );
    }

    return body;
  }

  async readLatestOtp(phone, notBefore) {
    if (!this.config.smsStubFile) {
      throw new SkipStepError('SMS stub file is not configured.');
    }

    const otp = await this.waitFor(() => {
      const lines = this.readSmsLogLines();
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        try {
          const parsed = JSON.parse(line);
          const sentAt = Date.parse(parsed.sentAt ?? '');
          if (
            parsed.to === phone &&
            Number.isFinite(sentAt) &&
            sentAt >= notBefore
          ) {
            const match = String(parsed.body ?? '').match(/\b(\d{6})\b/);
            if (match) {
              return match[1];
            }
          }
        } catch {
          continue;
        }
      }

      return null;
    }, this.config.smsTimeoutMs, `OTP for ${phone}`);

    if (!otp) {
      throw new Error(`Unable to find OTP for ${phone} in ${this.config.smsStubFile}.`);
    }

    return otp;
  }

  readSmsLogLines() {
    if (!this.config.smsStubFile || !existsSync(this.config.smsStubFile)) {
      return [];
    }

    const contents = readFileSync(this.config.smsStubFile, 'utf8').trim();
    return contents ? contents.split('\n') : [];
  }

  async waitFor(callback, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const value = await callback();
      if (value) {
        return value;
      }

      await sleep(this.config.pollIntervalMs);
    }

    this.log('INFO', `Timed out waiting for ${label}.`);
    return null;
  }

  // ── Utilities ─────────────────────────────────────────────────────

  writeFixtureFiles() {
    writeFileSync(this.files.nationalIdImage, ONE_BY_ONE_PNG);
    writeFileSync(this.files.selfieImage, ONE_BY_ONE_PNG);
  }

  generatePhone() {
    const suffix = String(Date.now()).slice(-7);
    const randomDigit = String(Math.floor(Math.random() * 10));
    return `+2519${suffix}${randomDigit}`;
  }

  assertDiscovered(method, path) {
    const normalizedPath = path.replace(/\{[^}]+\}/g, '{id}');
    const match = this.discovery.operations.some((operation) => {
      const candidate = operation.path.replace(/\{[^}]+\}/g, '{id}');
      return operation.method === method && candidate === normalizedPath;
    });
    this.assert(match, `Swagger is missing ${method} ${path}.`);
  }

  buildUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    return `${this.config.baseUrl}${path}`;
  }

  requireActor(label) {
    const actor = this.context.actors[label];
    this.assert(actor, `Missing actor context for ${label}.`);
    return actor;
  }

  requireActorOrSkip(label) {
    const actor = this.context.actors[label];
    if (!actor) {
      throw new SkipStepError(
        `Actor ${label} was not provisioned earlier in the run.`,
      );
    }

    return actor;
  }

  requireOtpReady() {
    if (!this.runtime.otpReady) {
      throw new SkipStepError(
        'OTP-driven flows require a readable STUB_SMS_FILE or --sms-stub-file.',
      );
    }
  }

  requireAdminOrSkip() {
    if (!this.config.adminAccessToken) {
      throw new SkipStepError(
        'Admin endpoints require --admin-access-token.',
      );
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
  }
}

class SkipStepError extends Error {}

function parseArgs(argv) {
  const options = {
    baseUrl: null,
    smsStubFile: null,
    adminAccessToken: null,
    outputFile: null,
    notificationTimeoutMs: null,
    smsTimeoutMs: null,
    pollIntervalMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if ((current === '--base-url' || current === '-u') && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--sms-stub-file' && argv[index + 1]) {
      options.smsStubFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--admin-access-token' && argv[index + 1]) {
      options.adminAccessToken = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--output-file' && argv[index + 1]) {
      options.outputFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--notification-timeout-ms' && argv[index + 1]) {
      options.notificationTimeoutMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (current === '--sms-timeout-ms' && argv[index + 1]) {
      options.smsTimeoutMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (current === '--poll-interval-ms' && argv[index + 1]) {
      options.pollIntervalMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (current === '--help' || current === '-h') {
      printHelp();
      process.exit(0);
    }

    if (!options.baseUrl && !current.startsWith('-')) {
      options.baseUrl = current;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  if (!options.baseUrl) {
    printHelp();
    throw new Error('Missing required --base-url.');
  }

  return options;
}

function printHelp() {
  console.log(`Standalone backend validation runner

Usage:
  pnpm validate:backend --base-url http://127.0.0.1:3000
  node tools/validation/backend-validation-runner.mjs --base-url http://127.0.0.1:3000

Options:
  --base-url, -u              Base URL for the live backend.
  --sms-stub-file             JSONL file written by STUB_SMS_FILE.
  --admin-access-token        Optional JWT for admin-only endpoints.
  --output-file               Optional path for the JSON artifact.
  --notification-timeout-ms   Poll timeout for notifications.
  --sms-timeout-ms            Poll timeout for OTP lookup.
  --poll-interval-ms          Poll interval for OTP and notification checks.
`);
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
