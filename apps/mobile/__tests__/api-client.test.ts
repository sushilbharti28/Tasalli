import { auth, pathOf, setUnauthorizedHandler } from '@/api/client';

const call = (status: number, url: string) =>
  (auth.onResponse as (o: unknown) => unknown)({ response: new Response(null, { status }), request: new Request(url) });

describe('API client middleware (real API, not only mock)', () => {
  it('onResponse returns nothing (openapi-fetch rejects the fetch() response object on a device)', () => {
    expect(call(204, 'http://10.0.2.2:3000/auth/otp/request')).toBeUndefined();
    expect(call(200, 'http://10.0.2.2:3000/people')).toBeUndefined();
  });
  it('a 401 outside /auth/ signs the user out; a 401 on /auth/ does not', () => {
    const fn = jest.fn();
    setUnauthorizedHandler(fn);
    call(401, 'http://10.0.2.2:3000/auth/otp/verify');
    expect(fn).not.toHaveBeenCalled();
    call(401, 'http://10.0.2.2:3000/people?x=1');
    expect(fn).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });
  it('pathOf works without URL.pathname', () => {
    expect(pathOf('http://10.0.2.2:3000/auth/otp/request?x=1')).toBe('/auth/otp/request');
    expect(pathOf('https://api.example')).toBe('/');
  });
});
