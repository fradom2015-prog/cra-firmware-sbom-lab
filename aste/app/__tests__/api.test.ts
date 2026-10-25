import { api, ApiError, onSessionExpired, refreshSession, saveSession } from '@/lib/api';

jest.mock('@/lib/tokenStore', () => {
  let token: string | null = null;
  return {
    tokenStore: {
      get: jest.fn(async () => token),
      set: jest.fn(async (t: string) => void (token = t)),
      clear: jest.fn(async () => void (token = null)),
    },
  };
});

const json = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('client API', () => {
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    await saveSession({ accessToken: 'at_old', refreshToken: 'rt_1', expiresIn: 900 });
  });

  it('invia il token e restituisce i dati', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api('/me')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer at_old');
  });

  it('su 401 rinnova la sessione e ripete la richiesta', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'unauthorized' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'at_new', refreshToken: 'rt_2', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { user: 1 }));
    await expect(api('/me')).resolves.toEqual({ user: 1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refreshToken: 'rt_1' });
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe('Bearer at_new');
  });

  it('un solo rinnovo anche con richieste concorrenti (il server ruota il token)', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const a = refreshSession();
    const b = refreshSession();
    resolve(json(200, { accessToken: 'at_x', refreshToken: 'rt_x', expiresIn: 900 }));
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresh rifiutato: sessione chiusa e avviso all\'app', async () => {
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    fetchMock.mockResolvedValueOnce(json(401));
    await expect(refreshSession()).resolves.toBe(false);
    expect(expired).toHaveBeenCalled();
    off();
  });

  it('errori del server e di rete con messaggi leggibili', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'below_minimum', message: "L'offerta minima è 105,00 €" } }));
    await expect(api('/auctions/x/bids', { body: {} })).rejects.toMatchObject({ status: 400, code: 'below_minimum' });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = (await api('/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network');
  });
});

describe('avvio a freddo', () => {
  it('una richiesta partita prima del ripristino della sessione lo attende', async () => {
    jest.resetModules();
    const { tokenStore } = jest.requireMock('@/lib/tokenStore') as { tokenStore: { set: (t: string) => Promise<void> } };
    await tokenStore.set('rt_salvato');
    const fresh = jest.requireActual('@/lib/api') as typeof import('@/lib/api');
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(json(200, { accessToken: 'at_avvio', refreshToken: 'rt_nuovo', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { seller: null }));
    globalThis.fetch = fetchMock;
    await expect(fresh.api('/me/seller')).resolves.toEqual({ seller: null });
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer at_avvio');
  });
});
