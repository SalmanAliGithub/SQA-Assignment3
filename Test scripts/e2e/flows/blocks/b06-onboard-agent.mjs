// B-6 — Admin onboards an AGENT, then agent completes B-1 registration.
import { registerUser } from './b01-register-user.mjs';

export async function onboardAgent(ctx, { adminLabel = 'AD1', agentLabel, phone, firstName = 'Tesfaye', lastName = 'Bekele', businessName = 'Agent Kiosk', lat = 9.03, lng = 38.74 }) {
  const { http, log, assert } = ctx;
  log.block(`B-6 onboardAgent ${agentLabel} ${phone}`, null, agentLabel);

  const create = await http.post('/admin/agents', {
    phoneNumber: phone, firstName, lastName, businessName, lat, lng,
  }, { actor: adminLabel, expectStatus: [200, 201] });
  const agentId = create.body?.id || create.body?.agentId;
  assert.assert(agentId, 'admin/agents must return id', create.body);

  // Agent completes OTP registration on the seeded phone
  const agent = await registerUser(ctx, { label: agentLabel, phone, pin: '4242', firstName, lastName });
  agent.role = 'AGENT';
  agent.agentId = agentId;
  agent.businessName = businessName;
  return agent;
}
