import { api, isMockApi, setAuthToken, unwrap } from '@/api/client';

describe('mock API mode', () => {
  it('is on and serves the typed client with no backend', async () => {
    expect(isMockApi).toBe(true);
    const session = await unwrap(api.POST('/auth/otp/verify', { body: { phone: '+919876543210', code: '123456' } }));
    setAuthToken(session.token!);
    const people = await unwrap(api.GET('/people'));
    expect(Array.isArray(people)).toBe(true);
    const { response } = await api.GET('/subscription');
    expect(response.ok).toBe(true);
  });
});
