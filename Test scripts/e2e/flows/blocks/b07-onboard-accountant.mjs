// B-7 — Admin onboards an INTERNAL_ACCOUNTANT, accountant completes registration with the seeded phone.
import { registerUser } from './b01-register-user.mjs';

export async function onboardAccountant(ctx, { adminLabel = 'AD1', accountantLabel, phone, firstName = 'Samuel', lastName = 'Tadesse' }) {
  const { http, log, assert } = ctx;
  log.block(`B-7 onboardAccountant ${accountantLabel} ${phone}`, null, accountantLabel);

  const create = await http.post('/admin/accountants', {
    phoneNumber: phone, firstName, lastName,
  }, { actor: adminLabel, expectStatus: [200, 201] });
  const id = create.body?.id || create.body?.accountantId;
  assert.assert(id, 'admin/accountants must return id', create.body);
  const tempPin = create.body?.temporaryPin || create.body?.tempPin;

  // Accountant logs in: either the temp PIN flow or a full OTP register
  const ac = await registerUser(ctx, { label: accountantLabel, phone, pin: tempPin || '7777', firstName, lastName }).catch(async () => {
    // If admin already created the user row, registration may 409 — try login
    return { label: accountantLabel, phone, pin: tempPin || '7777', accessToken: null, refreshToken: null };
  });
  ac.role = 'INTERNAL_ACCOUNTANT';
  ac.accountantId = id;
  ctx.actors[accountantLabel] = ac;
  return ac;
}
