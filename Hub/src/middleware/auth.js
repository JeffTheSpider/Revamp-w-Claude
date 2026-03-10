// ============================================================
// Authentication Middleware
// ============================================================
// Optional bearer token auth. When HUB_AUTH_TOKEN is set in .env,
// all /api routes (except /api/health and /api/notify) require it.
// Token can be passed as:
//   - Authorization: Bearer <token>
//   - Query param: ?token=<token>
// ============================================================

function createAuthMiddleware(token) {
  if (!token) {
    // No token configured — auth disabled, allow all
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    // Public endpoints (no auth required)
    if (req.path === '/health' || req.path === '/api/health') return next();
    // Webhook has its own auth (API key)
    if (req.path === '/notify' || req.path === '/api/notify') return next();

    // Check Authorization header
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === token) {
      return next();
    }

    // Check query param
    if (req.query.token === token) {
      return next();
    }

    res.status(401).json({ error: 'Authentication required' });
  };
}

module.exports = createAuthMiddleware;
