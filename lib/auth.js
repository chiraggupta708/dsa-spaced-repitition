import { verifyToken } from '@clerk/backend';

export class AuthError extends Error {
  constructor(code) {
    super(code === 'CONFIGURATION' ? 'Authentication service is unavailable.' : 'Unauthorized.');
    this.name = 'AuthError';
    this.code = code;
  }
}

function getAuthorizationHeader(req) {
  if (!req || !req.headers) {
    return undefined;
  }

  return req.headers.authorization ?? req.headers.Authorization;
}

export function getBearerToken(req) {
  const authorization = getAuthorizationHeader(req);

  if (typeof authorization !== 'string') {
    throw new AuthError('UNAUTHORIZED');
  }

  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim());
  if (!match) {
    throw new AuthError('UNAUTHORIZED');
  }

  return match[1];
}

function getClerkConfig() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const jwtKey = process.env.CLERK_JWT_KEY;

  // This Clerk SDK version fetches JWKS when jwtKey is omitted, even with secretKey.
  // Require the configured PEM key so server-side verification remains networkless.
  if (!secretKey || !jwtKey) {
    throw new AuthError('CONFIGURATION');
  }

  return { secretKey, jwtKey };
}

export async function requireAuth(req) {
  const token = getBearerToken(req);
  const { secretKey, jwtKey } = getClerkConfig();

  try {
    const payload = await verifyToken(token, { secretKey, jwtKey });
    const userId = typeof payload?.sub === 'string' ? payload.sub.trim() : '';

    if (!userId) {
      throw new AuthError('UNAUTHORIZED');
    }

    return { userId };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError('UNAUTHORIZED');
  }
}

export function getAuthErrorResponse(error) {
  if (error instanceof AuthError && error.code === 'CONFIGURATION') {
    return { status: 503, error: 'Authentication service unavailable.' };
  }

  return { status: 401, error: 'Unauthorized.' };
}
